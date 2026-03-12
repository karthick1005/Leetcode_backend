/**
 * Judge API Server with WebSocket & Firestore Support
 * Handles submissions, real-time updates, and result retrieval
 */

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { sendMessage } from './config/rabbitmq.js';
import { getFromRedis, setInRedis, errorResponse, successResponse } from './utils.js';
import { doc, setDoc, updateDoc, getDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from './utils/Firebase.js';

const app = express();
const httpServer = createServer(app);

// ============= MIDDLEWARE =============
app.use(cors());
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }));
app.use(bodyParser.json({ limit: '50mb' }));

// ============= WEBSOCKET SETUP =============
const wss = new WebSocketServer({ server: httpServer });

// Store active connections by submissionId
const activeConnections = new Map();

/**
 * Broadcast result to connected clients
 */
function broadcastResult(submissionId, result) {
  if (activeConnections.has(submissionId)) {
    const clients = activeConnections.get(submissionId);
    clients.forEach((ws) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'result',
            submissionId,
            data: result,
          })
        );
      }
    });
  }
}

/**
 * Broadcast status update to connected clients
 */
function broadcastStatus(submissionId, status) {
  if (activeConnections.has(submissionId)) {
    const clients = activeConnections.get(submissionId);
    clients.forEach((ws) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'status',
            submissionId,
            status,
            timestamp: new Date().toISOString(),
          })
        );
      }
    });
  }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('✅ WebSocket client connected');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'subscribe') {
        const { submissionId } = data;

        // Add to active connections
        if (!activeConnections.has(submissionId)) {
          activeConnections.set(submissionId, new Set());
        }
        activeConnections.get(submissionId).add(ws);

        // Send initial status
        const status = await getFromRedis(`submission:${submissionId}:status`);
        ws.send(
          JSON.stringify({
            type: 'subscribed',
            submissionId,
            currentStatus: status || 'queued',
          })
        );

        console.log(`👂 Subscribed to ${submissionId}`);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    console.log('❌ WebSocket client disconnected');
    // Clean up
    for (const [submissionId, clients] of activeConnections.entries()) {
      clients.delete(ws);
      if (clients.size === 0) {
        activeConnections.delete(submissionId);
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// ============= API ENDPOINTS =============

/**
 * Health check
 */
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'judge-api' });
});

/**
 * Submit code for judging
 * POST /submit
 */
const groupTestcases = (testcases, n = 1) =>
  Array.from({ length: Math.ceil(testcases.length / n) }, (_, i) =>
    testcases.slice(i * n, i * n + n).join("\n")
  );
app.post('/submit', async (req, res) => {
  try {
    const { problemId, code, language, userId, testcases = [], quesId } = req.body;

    // Validation
    if (!problemId || !code || !language || !userId) {
      return res.status(400).json(errorResponse(400, 'Missing required fields'));
    }

    // Generate submission ID
    const submissionId = `${userId}-${problemId}-${uuidv4()}`;

    console.log(`📝 New submission: ${submissionId}`);
    
    // Fetch problem details from Firestore (just code templates, admin code execution moves to worker)
    let adminCode = null;
    let remainingCode = null;
    let groupedTestcases = testcases;
    try {
      const docSnap = await getDoc(doc(db, 'problem', quesId));
      if (docSnap.exists()) {
        const problemData = docSnap.data();
        
        // Decode admin code and remaining code
        adminCode = problemData.Adminsrc
        remainingCode = atob(problemData.Remaining[language] || '');
        groupedTestcases=groupTestcases(testcases, problemData?.Inputname?.length || 1)

        console.log(`✅ Loaded admin code and remaining code for ${language}`);
      } else {
        return res.status(404).json(errorResponse(404, 'Problem not found'));
      }
    } catch (error) {
      console.error('Failed to fetch problem from Firestore:', error);
      return res.status(500).json(errorResponse(500, 'Failed to load problem'));
    }

    // Merge user code into remaining code
    const mergedCode = remainingCode.replace('// INSERT_CODE_HERE', code);

    // Prepare job for worker
    // Testcases contain only inputs - worker will execute admin code to get expected outputs
    const job = {
      submissionId,
      problemId,
      userId,
      code: mergedCode,
      language,
      testcases: groupedTestcases,  // Raw inputs only
      adminCode,  // Send admin code to worker for execution in containers
      submittedAt: new Date().toISOString(),
    };

    // Save to Firestore
    try {
      await setDoc(doc(db, 'submissions', submissionId), {
        ...job,
        status: 'queued',
        createdAt: new Date(),
      });
    } catch (error) {
      console.warn('Firestore save failed:', error.message);
    }

    // Set initial status in Redis with short TTL (5 min)
    await setInRedis(`submission:${submissionId}:status`, 'queued', 300);

    // Send to RabbitMQ queue
    await sendMessage(job);

    console.log(`📤 Sent to queue: ${submissionId} with ${testcases.length} testcases`);

    // Return submission ID
    res.status(202).json(
      successResponse({
        submissionId,
        statusUrl: `/submissions/${submissionId}`,
        websocketUrl: `ws://${req.get('host')}/ws`,
      })
    );
  } catch (error) {
    console.error('Submission error:', error);
    res.status(500).json(errorResponse(500, 'Submission failed'));
  }
});

/**
 * Get submission results
 * GET /submissions/:submissionId
 */
app.get('/submissions/:submissionId', async (req, res) => {
  try {
    const { submissionId } = req.params;

    // Check Redis first (fast)
    const cachedResult = await getFromRedis(`submission:${submissionId}:result`);

    if (cachedResult) {
      try {
        const result = JSON.parse(cachedResult);
        return res.json(successResponse(result));
      } catch (e) {
        // Corrupted cache
      }
    }

    // Check status
    const status = await getFromRedis(`submission:${submissionId}:status`);

    if (!status) {
      // Try Firestore
      try {
        const docSnap = await getDoc(doc(db, 'submissions', submissionId));
        if (docSnap.exists()) {
          return res.json(
            successResponse({
              status: docSnap.data().status,
              submittedAt: docSnap.data().submittedAt,
            })
          );
        }
      } catch (e) {
        // Ignore
      }

      return res.status(404).json(errorResponse(404, 'Submission not found'));
    }

    // Return current status
    res.status(202).json({
      success: true,
      status,
      message: 'Processing...',
    });
  } catch (error) {
    console.error('Get submission error:', error);
    res.status(500).json(errorResponse(500, 'Failed to retrieve submission'));
  }
});

/**
 * Get user submissions history
 * GET /users/:userId/submissions
 */
app.get('/users/:userId/submissions', async (req, res) => {
  try {
    const { userId } = req.params;

    // Query Firestore
    const submissionsRef = query(
      collection(db, 'submissions'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const querySnapshot = await getDocs(submissionsRef);
    const submissions = querySnapshot.docs.map((doc) => ({
      submissionId: doc.id,
      ...doc.data(),
    }));

    res.json(successResponse(submissions));
  } catch (error) {
    console.error('Get submissions error:', error);
    res.status(500).json(errorResponse(500, 'Failed to retrieve submissions'));
  }
});

/**
 * Get problem statistics
 * GET /problems/:problemId/stats
 */
app.get('/problems/:problemId/stats', async (req, res) => {
  try {
    const { problemId } = req.params;

    // Query submissions for this problem
    const submissionsRef = query(
      collection(db, 'submissions'),
      where('problemId', '==', problemId)
    );

    const querySnapshot = await getDocs(submissionsRef);
    const submissions = querySnapshot.docs.map((doc) => doc.data());

    const total = submissions.length;
    const accepted = submissions.filter((s) => s.status === 'Accepted').length;
    const wrongAnswer = submissions.filter((s) => s.status === 'Wrong Answer').length;
    const runtimeError = submissions.filter((s) => s.status === 'Runtime Error').length;
    const compilationError = submissions.filter((s) => s.status === 'Compilation Error')
      .length;

    res.json(
      successResponse({
        total,
        accepted,
        acceptanceRate: total > 0 ? ((accepted / total) * 100).toFixed(2) + '%' : '0%',
        wrongAnswer,
        runtimeError,
        compilationError,
      })
    );
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json(errorResponse(500, 'Failed to retrieve statistics'));
  }
});

/**
 * Update submission result (called by worker)
 * PUT /submissions/:submissionId/result
 */
app.put('/submissions/:submissionId/result', async (req, res) => {
  try {
    const { submissionId } = req.params;
    const result = req.body;

    // Store in Redis for fast access
    await setInRedis(
      `submission:${submissionId}:result`,
      JSON.stringify(result),
      3600
    );

    // Update status
    await setInRedis(`submission:${submissionId}:status`, result.status, 3600);

    // Update Firestore
    try {
      await updateDoc(doc(db, 'submissions', submissionId), {
        status: result.status,
        result,
        completedAt: new Date(),
      });
    } catch (error) {
      console.warn('Firestore update failed:', error.message);
    }

    // Broadcast to WebSocket clients
    broadcastResult(submissionId, result);
    broadcastStatus(submissionId, result.status);

    res.json(successResponse({ submissionId, status: result.status }));
  } catch (error) {
    console.error('Update result error:', error);
    res.status(500).json(errorResponse(500, 'Failed to update result'));
  }
});

/**
 * Get server metrics
 * GET /metrics
 */
app.get('/metrics', async (req, res) => {
  try {
    const activeSubmissions = activeConnections.size;

    res.json(
      successResponse({
        activeWebSocketConnections: activeSubmissions,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (error) {
    res.status(500).json(errorResponse(500, 'Failed to retrieve metrics'));
  }
});

// ============= ERROR HANDLING =============

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json(errorResponse(500, 'Internal server error'));
});

// ============= SERVER STARTUP =============

const PORT = process.env.PORT || 7000;

httpServer.listen(PORT, () => {
  console.log(`\n🚀 Judge API Server running on port ${PORT}`);
  console.log(`   HTTP: http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}`);
  console.log('\n');
});

export default app;
