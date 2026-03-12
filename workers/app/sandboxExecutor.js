/**
 * Sandbox Executor
 * Executes code in pooled Docker containers with resource limits
 * Supports: Python, JavaScript, C++, Java
 */

import { getPool } from './containerPool.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// ============= LANGUAGE CONFIGURATIONS =============
const LANGUAGES = {
  python: {
    ext: 'py',
    compile: null,
    run: (file) => `python3 ${file}`,
  },
  javascript: {
    ext: 'js',
    compile: null,
    run: (file) => `node ${file}`,
  },
  cpp: {
    ext: 'cpp',
    compile: (file) => `g++ -O2 ${file} -o ${file.replace('.cpp', '')}`,
    run: (file) => `./${file.replace('.cpp', '')}`,
  },
  java: {
    ext: 'java',
    compile: (file) => {
      const className = path.basename(file, '.java');
      return `javac ${file}`;
    },
    run: (file) => {
      const className = path.basename(file, '.java');
      return `java ${className}`;
    },
  },
};

// Compile cache: hash(code + lang) -> binary path
const compileCache = new Map();

// ============= HELPER FUNCTIONS =============

/**
 * Generate cache key for compiled code
 */
function getCacheKey(code, lang) {
  if (!LANGUAGES[lang]?.compile) return null; // Interpreted languages don't cache
  return crypto.createHash('md5').update(code + lang).digest('hex');
}

/**
 * Get cached binary path
 */
function getCachedBinary(cacheKey) {
  if (!cacheKey) return null;
  const cached = compileCache.get(cacheKey);
  if (cached && fs.existsSync(cached)) {
    return cached;
  }
  compileCache.delete(cacheKey);
  return null;
}

/**
 * Cache compiled binary
 */
function cacheBinary(cacheKey, binaryPath) {
  if (cacheKey) {
    compileCache.set(cacheKey, binaryPath);
  }
}

// ============= CONTAINER EXECUTION =============

/**
 * Execute command in container
 */
async function executeInContainer(container, cmd, input, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let killed = false;

    const timeoutHandle = setTimeout(() => {
      killed = true;
      reject(new Error(`Timeout (${timeout}ms)`));
    }, timeout);

    try {
      // If input is provided, prepend input as a command that echoes it
      let finalCmd = cmd;
      if (input) {
        // Use echo to pipe input to the command
        finalCmd = `echo '${input.replace(/'/g, "'\\''")}' | ${cmd}`;
      }

      // Create exec instance
      container.exec(
        {
          Cmd: ['/bin/sh', '-c', finalCmd],
          AttachStdout: true,
          AttachStderr: true,
        },
        async (err, exec) => {
          if (err) {
            clearTimeout(timeoutHandle);
            reject(err);
            return;
          }

          try {
            // Start the exec
            exec.start(
              { Detach: false, Tty: false },
              (startErr, stream) => {
                if (startErr) {
                  clearTimeout(timeoutHandle);
                  reject(startErr);
                  return;
                }

                // Collect stream data
                stream.on('data', (data) => {
                  if (!killed) {
                    stdout += data.toString();
                  }
                });

                stream.on('error', (streamErr) => {
                  clearTimeout(timeoutHandle);
                  if (!killed) {
                    reject(streamErr);
                  }
                });

                stream.on('end', () => {
                  clearTimeout(timeoutHandle);
                  if (!killed) {
                    resolve({ stdout, stderr: '', code: 0 });
                  }
                });
              }
            );
          } catch (execErr) {
            clearTimeout(timeoutHandle);
            reject(execErr);
          }
        }
      );
    } catch (err) {
      clearTimeout(timeoutHandle);
      reject(err);
    }
  });
}

// ============= MAIN EXECUTION =============
function normalizeOutput(str) {
  return String(str)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .split("\n")
    .map(line => line.trim())
    .join("\n");
}
/**
 * Execute code in container
 */
export async function executeCode(payload) {
  const { code, lang, testcases, submissionId, timeout = 5 } = payload;

  if (!LANGUAGES[lang]) {
    throw new Error(`Unsupported language: ${lang}`);
  }

  const langConfig = LANGUAGES[lang];
  const execTimeout = Math.min(parseInt(timeout) || 5, 15) * 1000;
  const cacheKey = getCacheKey(code, lang);

  const container = await getPool().acquire();
  const containerId = container.id ? container.id.substring(0, 12) : 'unknown';
  console.log(`[${submissionId}] 🐳 Acquired container: ${containerId}`);

  try {
    // Create execution directory
    const execDir = `/tmp/execution/${submissionId}`;
    console.log(`[${submissionId}] 📁 Creating execution directory: ${execDir}`);
    await executeInContainer(container, `mkdir -p ${execDir}`);

    // Step 1: Write source file
    const sourceFile = `${execDir}/source.${langConfig.ext}`;
    const writeCmd = `cat > ${sourceFile} << 'EOF'\n${code}\nEOF`;
    console.log(`[${submissionId}] ✍️  Writing source file: ${sourceFile} (${code.length} bytes)`);
    await executeInContainer(container, writeCmd);

    // Step 2: Compile if needed
    let binaryPath = sourceFile;

    if (langConfig.compile) {
      // Check cache first
      const cached = getCachedBinary(cacheKey);
      if (cached) {
        binaryPath = cached;
        console.log(`[${submissionId}] ⚡ Using cached binary: ${cached} (🐳 ${containerId})`);
      } else {
        // Compile
        const compileCmd = langConfig.compile(sourceFile);
        console.log(`[${submissionId}] 🔨 Compiling in container ${containerId}: ${compileCmd}`);

        try {
          const compileResult = await executeInContainer(
            container,
            `cd ${execDir} && ${compileCmd}`,
            null,
            10000 // 10s compile timeout
          );

          if (compileResult.stdout.includes('error')) {
            console.log(`[${submissionId}] ❌ Compilation error in container ${containerId}`);
            return {
              status: 'Compilation Error',
              error: compileResult.stdout,
              testcases: [],
            };
          }

          // Determine binary path
          if (lang === 'cpp') {
            binaryPath = `${execDir}/source`;
          } else if (lang === 'java') {
            const className = langConfig.run(sourceFile)
              .match(/java\s+(.+)/)[1];
            binaryPath = `${execDir}/${className}.class`;
          }

          // Cache the binary
          cacheBinary(cacheKey, binaryPath);
          console.log(`[${submissionId}] 💾 Cached binary: ${binaryPath}`);
        } catch (error) {
          console.log(`[${submissionId}] ❌ Compilation failed in container ${containerId}: ${error.message}`);
          return {
            status: 'Compilation Error',
            error: error.message,
            testcases: [],
          };
        }
      }
    }

    // Step 3: Execute test cases in parallel
    console.log(`[${submissionId}] 🧪 Executing ${testcases.length} test case(s) in container ${containerId}...`);

    const executions = testcases.map(async (testcase, index) => {
      try {
        // Validate testcase has required fields
        if (!testcase || typeof testcase !== 'object') {
          return {
            input: '',
            output: '',
            expected: '',
            passed: false,
            status: 'Runtime Error',
            error: 'Invalid testcase format',
          };
        }

        // Ensure input and expected are strings
        let input = String(testcase.input || '').trim();
        let expected = String(testcase.expected || '').trim();

        const runCmd = langConfig.run(binaryPath);
        console.log(`[${submissionId}] ▶️  Test case ${index + 1}/${testcases.length}: Running in ${containerId}`);
        
        // Create input file for stdin
        const inputFile = `${execDir}/test_input_${index}.txt`;
        const writeCmd = `echo -n "${input.replace(/"/g, '\\"')}" > ${inputFile}`;
        
        try {
          await executeInContainer(container, writeCmd, null, 5000);
        } catch (e) {
          console.warn(`[${submissionId}] Warning: Failed to create input file: ${e.message}`);
        }
        
        // Execute with stdin from file (don't pass input parameter - let shell handle it)
        const result = await executeInContainer(
          container,
          `cd ${execDir} && ${runCmd} < ${inputFile}`,
          null,  // null instead of input - shell handles the redirection
          execTimeout
        );

        const actualOutput = normalizeOutput(
  Buffer.from(result.stdout).toString("utf8")
);
         expected=normalizeOutput(expected);
        const passed = actualOutput === expected;
       
        console.log("actual bytes:", [...actualOutput].map(c => c.charCodeAt(0)));
console.log("expected bytes:", [...expected].map(c => c.charCodeAt(0)));
        console.log("this is type of",typeof actualOutput, typeof expected,actualOutput, expected, actualOutput===expected);
        const status = passed ? 'Passed' : 'Wrong Answer';
        
        console.log(`[${submissionId}] ▶️  Command: cd ${execDir} && ${runCmd} < ${inputFile}`);
        console.log(`[${submissionId}] 📤 STDOUT: "${actualOutput}"`);
        if (result.stderr) {
          console.log(`[${submissionId}] 📥 STDERR: "${result.stderr.trim()}"`);
        }
        console.log(`[${submissionId}] 🎯 Expected: "${expected}"`);
        console.log(`[${submissionId}] ${passed ? '✅' : '❌'} Test case ${index + 1}: ${status}`);

        return {
          input: input.substring(0, 100), // Truncate for display
          output: actualOutput,
          expected: expected,
          passed,
          status,
        };
      } catch (error) {
        // Safely get input from testcase
        let input = '';
        let expected = '';
        if (testcase && typeof testcase === 'object') {
          input = String(testcase?.input || '').substring(0, 100);
          expected = String(testcase?.expected || '').trim();
        }
        
        console.log(`[${submissionId}] ❌ Test case ${index + 1}: Runtime Error - ${error.message}`);
        
        return {
          input: input,
          output: '',
          expected: expected,
          passed: false,
          status: 'Runtime Error',
          error: error.message,
        };
      }
    });

    const results = await Promise.all(executions);

    // Determine overall status
    const allPassed = results.every((r) => r.passed);
    const hasError = results.some((r) => r.status === 'Runtime Error');
    const hasWrongAnswer = results.some((r) => r.status === 'Wrong Answer');

    let status = 'Accepted';
    if (hasError) status = 'Runtime Error';
    else if (hasWrongAnswer) status = 'Wrong Answer';

    const passed = results.filter((r) => r.passed).length;

    console.log(`[${submissionId}] 📊 Results: ${passed}/${results.length} passed - ${status}`);
    console.log(`[${submissionId}] 🐳 Container ${containerId} completed execution`);

    return {
      status,
      passed,
      total: results.length,
      runtime: `${execTimeout}ms`,
      memory: 'N/A', // Can be enhanced
      testcases: results,
    };
  } catch (error) {
    console.log(`[${submissionId}] ❌ System error in container ${containerId}: ${error.message}`);
    return {
      status: 'System Error',
      error: error.message,
      testcases: [],
    };
  } finally {
    // Return container to pool
    console.log(`[${submissionId}] 🔄 Releasing container ${containerId} back to pool`);
    await getPool().release(container);
  }
}

/**
 * Get compilation cache stats
 */
export function getCacheStats() {
  return {
    cachedBinaries: compileCache.size,
    cacheSize: Array.from(compileCache.values()).reduce(
      (sum, path) => sum + (fs.existsSync(path) ? fs.statSync(path).size : 0),
      0
    ),
  };
}

/**
 * Clear compilation cache
 */
export function clearCache() {
  compileCache.clear();
  console.log('Compilation cache cleared');
}

export default { executeCode, getCacheStats, clearCache };
