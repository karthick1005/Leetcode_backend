/**
 * Fast Code Execution Engine - LeetCode Judger 1 style
 * Implements in-memory execution with minimal overhead
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import os from 'os';
import crypto from 'crypto';

const execAsync = promisify(require('child_process').exec);

// ============= CONFIGURATION =============
const TEMP_DIR = '/tmp/leetcode_judge';
const MEMORY_LIMIT = 512 * 1024 * 1024; // 512MB
const CPU_SHARES = 512;
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB
const COMPILE_TIMEOUT = 10000; // 10s
const EXEC_TIMEOUT_DEFAULT = 5000; // 5s

// Language configurations
const LANGUAGES = {
  python: {
    ext: 'py',
    compile: null, // Python doesn't need compilation
    run: (file, input) => ['python3', file],
    cacheKey: false, // Python interpreted, no binary cache
  },
  javascript: {
    ext: 'js',
    compile: null,
    run: (file, input) => ['node', file],
    cacheKey: false,
  },
  cpp: {
    ext: 'cpp',
    compile: (file) => ['g++', '-O2', file, '-o', file.replace('.cpp', '')],
    run: (file, input) => [file.replace('.cpp', '')],
    cacheKey: true,
  },
  c: {
    ext: 'c',
    compile: (file) => ['gcc', '-O2', file, '-o', file.replace('.c', '')],
    run: (file, input) => [file.replace('.c', '')],
    cacheKey: true,
  },
  java: {
    ext: 'java',
    compile: (file) => ['javac', file],
    run: (file, input) => {
      const className = path.basename(file, '.java');
      return ['java', '-cp', path.dirname(file), className];
    },
    cacheKey: true,
  },
  csharp: {
    ext: 'cs',
    compile: (file) => ['csc', file, `/out:${file.replace('.cs', '.exe')}`],
    run: (file, input) => [file.replace('.cs', '.exe')],
    cacheKey: true,
  },
};

// ============= CACHE MANAGEMENT =============
const binaryCache = new Map(); // Maps source hash -> compiled binary path

/**
 * Generate cache key for compiled code
 */
function getCacheKey(code, lang) {
  if (!LANGUAGES[lang]?.cacheKey) return null;
  return crypto.createHash('md5').update(code).digest('hex');
}

/**
 * Store compiled binary in cache
 */
function cacheBinary(cacheKey, binaryPath) {
  if (!cacheKey) return;
  binaryCache.set(cacheKey, {
    path: binaryPath,
    timestamp: Date.now(),
  });
}

/**
 * Retrieve cached binary
 */
function getCachedBinary(cacheKey) {
  if (!cacheKey) return null;
  const cached = binaryCache.get(cacheKey);
  if (cached && fs.existsSync(cached.path)) {
    return cached.path;
  }
  binaryCache.delete(cacheKey);
  return null;
}

// ============= PROCESS EXECUTION =============

/**
 * Execute a spawned process with timeout and output capture
 */
async function spawnWithTimeout(cmd, args, input, timeout = EXEC_TIMEOUT_DEFAULT) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let killed = false;

    const proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Security: Use null stdio for most cases
      detached: false,
    });

    let stdout = '';
    let stderr = '';
    let outputSize = 0;

    proc.stdout.on('data', (data) => {
      outputSize += data.length;
      if (outputSize > MAX_OUTPUT_SIZE) {
        proc.kill('SIGKILL');
        killed = true;
      } else {
        stdout += data.toString();
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Timeout handler
    const timeoutId = setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGKILL');
        killed = true;
      }
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      const wallTime = Date.now() - startTime;

      if (killed) {
        reject(new Error(`Process timeout or exceeded output limit`));
      }

      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        time: wallTime,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });

    // Send input
    if (input) {
      proc.stdin.write(input);
    }
    proc.stdin.end();
  });
}

// ============= COMPILATION =============

/**
 * Compile source code with caching
 */
async function compile(code, lang, submissionId) {
  const langConfig = LANGUAGES[lang];
  if (!langConfig) throw new Error(`Unsupported language: ${lang}`);

  // Check cache first
  const cacheKey = getCacheKey(code, lang);
  if (cacheKey) {
    const cached = getCachedBinary(cacheKey);
    if (cached) {
      console.log(`Using cached binary for ${lang}: ${cacheKey}`);
      return cached;
    }
  }

  // No compilation needed
  if (!langConfig.compile) {
    const sourceFile = path.join(TEMP_DIR, `${submissionId}.${langConfig.ext}`);
    return sourceFile;
  }

  // Create temp directory
  const workDir = path.join(TEMP_DIR, submissionId);
  if (!fs.existsSync(workDir)) {
    fs.mkdirSync(workDir, { recursive: true });
  }

  const sourceFile = path.join(workDir, `source.${langConfig.ext}`);
  fs.writeFileSync(sourceFile, code);

  try {
    const compileCmd = langConfig.compile(sourceFile);
    console.log(`Compiling ${lang}: ${compileCmd.join(' ')}`);

    await spawnWithTimeout(compileCmd[0], compileCmd.slice(1), null, COMPILE_TIMEOUT);

    // Determine output file
    let outputFile = sourceFile;
    if (lang === 'cpp' || lang === 'c') {
      outputFile = sourceFile.replace(/\.(cpp|c)$/, '');
    } else if (lang === 'java') {
      outputFile = sourceFile.replace('.java', '.class');
    } else if (lang === 'csharp') {
      outputFile = sourceFile.replace('.cs', '.exe');
    }

    if (!fs.existsSync(outputFile)) {
      throw new Error('Compilation failed: output file not created');
    }

    // Cache the binary
    if (cacheKey) {
      cacheBinary(cacheKey, outputFile);
    }

    return sourceFile;
  } catch (error) {
    throw new Error(`Compilation error: ${error.message}`);
  }
}

// ============= EXECUTION =============

/**
 * Execute compiled code with a single test input
 */
async function executeTestCase(sourceFile, lang, input, timeout = EXEC_TIMEOUT_DEFAULT) {
  const langConfig = LANGUAGES[lang];
  const cmd = langConfig.run(sourceFile, input);

  try {
    const result = await spawnWithTimeout(cmd[0], cmd.slice(1), input, timeout);
    return {
      output: result.stdout,
      error: result.stderr,
      time: result.time,
      status: result.code === 0 ? 'success' : 'error',
    };
  } catch (error) {
    return {
      output: '',
      error: error.message,
      time: 0,
      status: 'timeout',
    };
  }
}

/**
 * Execute all test cases in parallel
 */
async function executeAllTestCases(sourceFile, lang, testCases, timeout = EXEC_TIMEOUT_DEFAULT) {
  // Run all test cases in parallel
  const promises = testCases.map((testCase) =>
    executeTestCase(sourceFile, lang, testCase.input, timeout)
  );

  const results = await Promise.all(promises);

  return results.map((result, idx) => ({
    ...result,
    expected: testCases[idx].expected,
    passed: result.output === testCases[idx].expected,
  }));
}

// ============= MAIN EXECUTION PIPELINE =============

/**
 * Full execution pipeline: compile + execute all tests
 */
export async function executeCode(payload) {
  const {
    src,
    lang,
    input,
    Admin,
    timeOut = 5,
    folder,
    testcase,
  } = payload;

  const startTime = Date.now();
  const results = [];

  try {
    // 1. Compile code
    console.log(`\n[${folder}] Compiling ${lang}...`);
    const sourceFile = await compile(src, lang, folder);

    // 2. Parse test cases
    let testCases = [];
    if (Array.isArray(input)) {
      testCases = input.map((tc) => ({
        input: typeof tc === 'string' ? tc : tc.input || '',
        expected: typeof tc === 'object' ? tc.expected || '' : '',
      }));
    } else if (typeof input === 'string') {
      testCases = [{ input, expected: '' }];
    }

    // 3. Execute all test cases in parallel
    console.log(`[${folder}] Executing ${testCases.length} test cases...`);
    const timeout = Math.min(parseInt(timeOut) || 5, 15) * 1000;
    const execResults = await executeAllTestCases(sourceFile, lang, testCases, timeout);

    console.log(`[${folder}] Execution completed in ${Date.now() - startTime}ms`);

    // Return formatted results
    return {
      status: 'success',
      data: execResults,
      totalTime: Date.now() - startTime,
      testsPassed: execResults.filter((r) => r.passed).length,
      totalTests: execResults.length,
    };
  } catch (error) {
    console.error(`[${folder}] Execution error:`, error.message);
    return {
      status: 'error',
      error: error.message,
      totalTime: Date.now() - startTime,
    };
  }
}

/**
 * Get execution statistics
 */
export function getExecutorStats() {
  return {
    cachedBinaries: binaryCache.size,
    cacheSize: Array.from(binaryCache.values()).reduce(
      (sum, entry) => sum + (fs.existsSync(entry.path) ? fs.statSync(entry.path).size : 0),
      0
    ),
  };
}

/**
 * Clear cache if needed
 */
export function clearCache() {
  binaryCache.clear();
  console.log('Executor cache cleared');
}

// ============= INITIALIZATION =============

// Create temp directory
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  console.log(`Created temp directory: ${TEMP_DIR}`);
}

export default {
  executeCode,
  getExecutorStats,
  clearCache,
};
