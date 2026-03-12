/**
 * Judge Worker with Container Pool
 * Processes submissions from RabbitMQ queue using pooled Docker containers
 */

import { initializePool, shutdownPool, getPool } from './containerPool.js';
import { executeCode, getCacheStats } from './sandboxExecutor.js';
import { initializePools, getRedisPool } from './pool.js';
import { monitor } from './monitor.js';
import * as amqp from 'amqp-connection-manager';
import axios from 'axios';

const QUEUE_NAME = 'judge';
const API_SERVER = process.env.API_SERVER || 'http://server:7000';

let redisPool = null;

/**
 * Update submission result via API
 */
async function updateSubmissionResult(submissionId, result) {
  try {
    await axios.put(`${API_SERVER}/submissions/${submissionId}/result`, result);
    console.log(`✅ Result pushed for ${submissionId}`);
  } catch (error) {
    console.error(`Failed to update result for ${submissionId}:`, error.message);
  }
}

/**
 * Process a single submission
 */
async function processSubmission(job) {
  const { submissionId, problemId, code, language, testcases = [] } = job;
  const startTime = Date.now();

  console.log(`\n⏱️  Processing: ${submissionId}`);
  console.log(`   Language: ${language}, Test cases: ${testcases.length}`);

  monitor.startSubmission(submissionId);

  try {
    // Execute code in container
    const result = await executeCode({
      code,
      lang: language,
      testcases,
      submissionId,
      timeout: 5,
    });

    const totalTime = Date.now() - startTime;
    monitor.recordExecution(submissionId, totalTime);

    console.log(`✨ Result: ${result.status} (${totalTime}ms)`);
    console.log(`   Passed: ${result.passed}/${result.total}`);

    // Update result via API
    await updateSubmissionResult(submissionId, {
      ...result,
      submissionId,
      totalTime,
      processingTime: totalTime,
    });

    monitor.completeSubmission(submissionId, 'success');

    // Print metrics periodically
    if (monitor.getMetrics().totalSubmissions % 5 === 0) {
      monitor.printMetrics();
      console.log(`📦 Container Pool:`, getPool().getStats());
      console.log(`💾 Cache Stats:`, getCacheStats());
    }

    return result;
  } catch (error) {
    console.error(`❌ Error processing ${submissionId}:`, error.message);

    const errorResult = {
      status: 'System Error',
      error: error.message,
      testcases: [],
      totalTime: Date.now() - startTime,
    };

    await updateSubmissionResult(submissionId, errorResult);
    monitor.completeSubmission(submissionId, 'error');

    return errorResult;
  }
}

/**
 * RabbitMQ message handler
 */
async function handleMessage(msg) {
  if (!msg) return;

  try {
    // Parse message
    const content = msg.content.toString();
    const job = JSON.parse(content);

    console.log(`📨 Received job: ${job.submissionId}`);

    // Process submission
    await processSubmission(job);

    // Acknowledge message
    const ch = msg._channel || msg.channel;
    if (ch && ch.ack) {
      ch.ack(msg);
    }
  } catch (error) {
    console.error('Message handler error:', error);

    // Reject and requeue
    const ch = msg._channel || msg.channel;
    if (ch && ch.nack) {
      ch.nack(msg, false, true);
    }
  }
}

/**
 * Start consuming messages from RabbitMQ
 */
async function startWorker() {
  try {
    console.log('\n🚀 Starting Judge Worker...\n');

    // Initialize container pool
    const containerCount = await initializePool({
      poolSize: parseInt(process.env.CONTAINER_POOL_SIZE || '2'),
      image: 'judge-sandbox',
    });

    // Initialize connection pools
    await initializePools();
    redisPool = getRedisPool();

    // Connect to RabbitMQ
    const connection = amqp.connect(['amqp://rabbitmq:5672']);

    connection.on('connect', () => {
      console.log('✅ Connected to RabbitMQ');
    });

    connection.on('disconnect', (err) => {
      console.error('❌ Disconnected from RabbitMQ:', err);
    });

    // Create channel and configure
    const channelWrapper = connection.createChannel({
      setup: async (channel) => {
        // Assert queue
        await channel.assertQueue(QUEUE_NAME, { durable: true });

        // Set prefetch (process 2 jobs concurrently per worker)
        await channel.prefetch(2);

        // Consume messages
        await channel.consume(QUEUE_NAME, handleMessage);

        console.log(`👂 Listening on queue: ${QUEUE_NAME}`);
        console.log(`🏗️  Container Pool: ${containerCount} containers`);
        console.log(`🔄 Prefetch: 2 jobs per worker\n`);
      },
    });

    // Graceful shutdown
    let isShuttingDown = false;
    
    const gracefulShutdown = async (signal) => {
      if (isShuttingDown) return; // Prevent multiple shutdown calls
      isShuttingDown = true;
      
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
      
      // Force exit after 15 seconds if shutdown takes too long
      const shutdownTimeout = setTimeout(() => {
        console.error('⚠️  Shutdown timeout, forcing exit...');
        process.exit(1);
      }, 15000);
      
      try {
        monitor.printMetrics();
        await shutdownPool();
        await channelWrapper.close();
        await connection.close();
        clearTimeout(shutdownTimeout);
        console.log('✅ Graceful shutdown complete');
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        clearTimeout(shutdownTimeout);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

    // Print metrics every 60 seconds
    setInterval(() => {
      if (monitor.getMetrics().totalSubmissions > 0) {
        console.log('');
        monitor.printMetrics();
        console.log(`📦 Container Pool:`, getPool().getStats());
        console.log(`💾 Cache Stats:`, getCacheStats());
        console.log('');
      }
    }, 60000);
  } catch (error) {
    console.error('Worker startup failed:', error);
    process.exit(1);
  }
}

// Start the worker
startWorker();

export { processSubmission, handleMessage };
