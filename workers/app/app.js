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
  const { submissionId, problemId, code, language, testcases = [], adminCode } = job;
  const startTime = Date.now();

  console.log(`\n⏱️ Processing: ${submissionId}`);
  console.log(`Language: ${language}, Test cases: ${testcases.length}`);

  monitor.startSubmission(submissionId);

  try {
    const result = await executeCode({
      code,
      lang: language,
      testcases,
      submissionId,
      timeout: 5,
      adminCode
    });

    const totalTime = Date.now() - startTime;

    monitor.recordExecution(submissionId, totalTime);

    console.log(`✨ Result: ${result.status} (${totalTime}ms)`);

    await updateSubmissionResult(submissionId, {
      ...result,
      submissionId,
      totalTime,
      processingTime: totalTime
    });

    monitor.completeSubmission(submissionId, 'success');

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
      totalTime: Date.now() - startTime
    };

    await updateSubmissionResult(submissionId, errorResult);

    monitor.completeSubmission(submissionId, 'error');

    return errorResult;
  }
}

/**
 * Handle message (only processing logic)
 */
async function handleMessage(msg) {
  const content = msg.content.toString();
  const job = JSON.parse(content);

  console.log(`📨 Received job: ${job.submissionId}`);

  await processSubmission(job);
}

/**
 * Start worker
 */
async function startWorker() {

  try {

    console.log('\n🚀 Starting Judge Worker...\n');

    const poolSize = parseInt(process.env.CONTAINER_POOL_SIZE || '2');

    const containerCount = await initializePool({
      poolSize,
      image: 'judge-sandbox'
    });

    await initializePools();
    redisPool = getRedisPool();

    const connection = amqp.connect(['amqp://rabbitmq:5672']);

    connection.on('connect', () => {
      console.log('✅ Connected to RabbitMQ');
    });

    connection.on('disconnect', (err) => {
      console.error('❌ RabbitMQ disconnected:', err);
    });

    const channelWrapper = connection.createChannel({

      setup: async (channel) => {

        await channel.assertQueue(QUEUE_NAME, { durable: true });

        // important: tie concurrency to container pool
        await channel.prefetch(poolSize);

        await channel.consume(QUEUE_NAME, async (msg) => {

          if (!msg) return;

          try {

            await handleMessage(msg);

            channel.ack(msg);

          } catch (error) {

            console.error('Worker processing error:', error);

            // requeue message
            channel.nack(msg, false, true);
          }

        });

        console.log(`👂 Listening on queue: ${QUEUE_NAME}`);
        console.log(`🏗️ Container Pool: ${containerCount}`);
        console.log(`🔄 Prefetch: ${poolSize}\n`);

      }
    });

    /**
     * Graceful shutdown
     */

    let shuttingDown = false;

    const shutdown = async (signal) => {

      if (shuttingDown) return;

      shuttingDown = true;

      console.log(`\n🛑 Received ${signal}, shutting down...`);

      const timeout = setTimeout(() => {
        console.error('⚠️ Forced shutdown');
        process.exit(1);
      }, 15000);

      try {

        monitor.printMetrics();

        await shutdownPool();

        await channelWrapper.close();

        await connection.close();

        clearTimeout(timeout);

        console.log('✅ Shutdown complete');

        process.exit(0);

      } catch (err) {

        console.error('Shutdown error:', err);

        clearTimeout(timeout);

        process.exit(1);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGHUP', shutdown);

    /**
     * Periodic metrics
     */

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

startWorker();

export { processSubmission, handleMessage };