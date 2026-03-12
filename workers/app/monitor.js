/**
 * Performance Metrics Monitor
 * Tracks execution times, throughput, and bottlenecks
 * Similar to LeetCode's metric collection
 */

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      totalSubmissions: 0,
      successfulSubmissions: 0,
      failedSubmissions: 0,
      totalTime: 0, // ms
      compilationTime: 0,
      executionTime: 0,
      queueWaitTime: 0,
      avgExecutionTime: 0,
      avgCompilationTime: 0,
      p95ExecutionTime: 0,
      p99ExecutionTime: 0,
      executionTimes: [],
      compilationTimes: [],
    };

    this.jobMetrics = new Map(); // Track per-job metrics
    this.startTime = Date.now();
  }

  /**
   * Record submission start
   */
  startSubmission(submissionId) {
    this.jobMetrics.set(submissionId, {
      startTime: Date.now(),
      queueStartTime: Date.now(),
    });
  }

  /**
   * Record when job starts processing
   */
  startProcessing(submissionId) {
    const job = this.jobMetrics.get(submissionId);
    if (job) {
      job.processingStartTime = Date.now();
      job.queueWaitTime = job.processingStartTime - job.queueStartTime;
    }
  }

  /**
   * Record compilation time
   */
  recordCompilation(submissionId, duration) {
    const job = this.jobMetrics.get(submissionId);
    if (job) {
      job.compilationTime = duration;
      this.metrics.compilationTimes.push(duration);
      this.metrics.compilationTime += duration;
    }
  }

  /**
   * Record execution time
   */
  recordExecution(submissionId, duration) {
    const job = this.jobMetrics.get(submissionId);
    if (job) {
      job.executionTime = duration;
      this.metrics.executionTimes.push(duration);
      this.metrics.executionTime += duration;
    }
  }

  /**
   * Record submission completion
   */
  completeSubmission(submissionId, status) {
    const job = this.jobMetrics.get(submissionId);
    if (!job) return;

    job.endTime = Date.now();
    job.totalTime = job.endTime - job.startTime;
    job.status = status;

    this.metrics.totalSubmissions++;
    if (status === 'success') {
      this.metrics.successfulSubmissions++;
    } else {
      this.metrics.failedSubmissions++;
    }

    this.metrics.totalTime += job.totalTime;

    // Update averages
    this.updateAverages();

    // Remove old jobs from memory (keep last 1000)
    if (this.jobMetrics.size > 1000) {
      const firstKey = this.jobMetrics.keys().next().value;
      this.jobMetrics.delete(firstKey);
    }
  }

  /**
   * Calculate percentiles
   */
  updateAverages() {
    const execTimes = this.metrics.executionTimes;
    const compileTimes = this.metrics.compilationTimes;

    if (execTimes.length > 0) {
      this.metrics.avgExecutionTime =
        this.metrics.executionTime / this.metrics.totalSubmissions;

      const sorted = [...execTimes].sort((a, b) => a - b);
      this.metrics.p95ExecutionTime = sorted[Math.floor(sorted.length * 0.95)];
      this.metrics.p99ExecutionTime = sorted[Math.floor(sorted.length * 0.99)];
    }

    if (compileTimes.length > 0) {
      this.metrics.avgCompilationTime =
        this.metrics.compilationTime / compileTimes.length;
    }
  }

  /**
   * Get job metrics
   */
  getJobMetrics(submissionId) {
    return this.jobMetrics.get(submissionId);
  }

  /**
   * Get overall metrics
   */
  getMetrics() {
    const uptime = Date.now() - this.startTime;
    const throughput = (this.metrics.totalSubmissions / uptime) * 1000; // per second

    return {
      ...this.metrics,
      uptime,
      throughput: uptime > 0 ? throughput : 0,
      successRate:
        this.metrics.totalSubmissions > 0
          ? (this.metrics.successfulSubmissions / this.metrics.totalSubmissions) * 100
          : 0,
    };
  }

  /**
   * Reset metrics
   */
  reset() {
    this.metrics = {
      totalSubmissions: 0,
      successfulSubmissions: 0,
      failedSubmissions: 0,
      totalTime: 0,
      compilationTime: 0,
      executionTime: 0,
      queueWaitTime: 0,
      avgExecutionTime: 0,
      avgCompilationTime: 0,
      p95ExecutionTime: 0,
      p99ExecutionTime: 0,
      executionTimes: [],
      compilationTimes: [],
    };
    this.startTime = Date.now();
    console.log('Metrics reset');
  }

  /**
   * Print metrics to console
   */
  printMetrics() {
    const metrics = this.getMetrics();
    console.log('');
    console.log('=== PERFORMANCE METRICS ===');
    console.log(`Total Submissions: ${metrics.totalSubmissions}`);
    console.log(`Success Rate: ${metrics.successRate.toFixed(2)}%`);
    console.log(`Throughput: ${metrics.throughput.toFixed(2)} submissions/sec`);
    console.log(`Avg Execution Time: ${metrics.avgExecutionTime.toFixed(0)}ms`);
    console.log(`Avg Compilation Time: ${metrics.avgCompilationTime.toFixed(0)}ms`);
    console.log(`P95 Execution Time: ${metrics.p95ExecutionTime.toFixed(0)}ms`);
    console.log(`P99 Execution Time: ${metrics.p99ExecutionTime.toFixed(0)}ms`);
    console.log(`Total Uptime: ${(metrics.uptime / 1000).toFixed(0)}s`);
    console.log('');
  }
}

// Singleton instance
export const monitor = new PerformanceMonitor();

export default monitor;
