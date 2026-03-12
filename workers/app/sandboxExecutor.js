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
 * Extract user output from marked sections
 * User code should wrap their output with __START_USER_OUTPUT__ and __END_USER_OUTPUT__ markers
 * Example:
 *   console.log('__START_USER_OUTPUT__');
 *   const result = twoSum(nums, target);
 *   console.log(`[${result[0]},${result[1]}]`);
 *   console.log('__END_USER_OUTPUT__');
 */
function extractMarkedOutput(output) {
  const startMarker = '__START_USER_OUTPUT__';
  const endMarker = '__END_USER_OUTPUT__';
  
  const startIdx = output.indexOf(startMarker);
  const endIdx = output.indexOf(endMarker);
  
  if (startIdx === -1 || endIdx === -1) {
    // Markers not found, return all output
    return output;
  }
  
  // Extract content between markers (excluding the markers themselves)
  const markedContent = output.substring(
    startIdx + startMarker.length,
    endIdx
  ).trim();
  
  return markedContent;
}

function splitOutput(output) {
  const startMarker = '__START_USER_OUTPUT__';
  const endMarker = '__END_USER_OUTPUT__';

  const startIdx = output.indexOf(startMarker);
  const endIdx = output.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    return {
      logs: "",
      output: output.trim()
    };
  }

  // logs = content inside markers
  const logs = output.substring(
    startIdx + startMarker.length,
    endIdx
  ).trim();

  // output = everything outside markers
  const outputWithoutMarkers =
    output.slice(0, startIdx) +
    output.slice(endIdx + endMarker.length);

  return {
    logs,
    output: outputWithoutMarkers.trim()
  };
}
/**
 * Cache compiled binary
 */
function cacheBinary(cacheKey, binaryPath) {
  if (cacheKey) {
    compileCache.set(cacheKey, binaryPath);
  }
}

/**
 * Extract first error line from stderr/stdout
 */
function extractFirstError(errorStr) {
  if (!errorStr) return { short: '', full: '' };
  
  const lines = errorStr.split('\n').filter(l => l.trim());
  
  // Find first line with 'error' keyword
  const errorLine = lines.find(l => l.toLowerCase().includes('error'));
  
  return {
    short: errorLine ? errorLine.trim() : lines[0]?.trim() || 'Unknown error',
    full: errorStr.trim()
  };
}

// ============= CONTAINER EXECUTION =============

/**
 * Execute command in container
 */
async function executeInContainer(container, cmd, input, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    const timeoutHandle = setTimeout(() => {
      killed = true;
      reject(new Error(`Timeout (${timeout}ms)`));
    }, timeout);

    let finalCmd = cmd;
    if (input) {
      finalCmd = `echo '${input.replace(/'/g, "'\\''")}' | ${cmd}`;
    }

    container.exec(
      {
        Cmd: ["/bin/sh", "-c", finalCmd],
        AttachStdout: true,
        AttachStderr: true,
      },
      (err, exec) => {
        if (err) {
          clearTimeout(timeoutHandle);
          return reject(err);
        }

        exec.start({ Tty: false }, (err, stream) => {
          if (err) {
            clearTimeout(timeoutHandle);
            return reject(err);
          }

          container.modem.demuxStream(
            stream,
            {
              write: (chunk) => {
                if (!killed) stdout += chunk.toString();
              }
            },
            {
              write: (chunk) => {
                if (!killed) stderr += chunk.toString();
              }
            }
          );

          stream.on("end", () => {
            clearTimeout(timeoutHandle);
            if (!killed) resolve({ stdout, stderr, code: 0 });
          });

          stream.on("error", (e) => {
            clearTimeout(timeoutHandle);
            reject(e);
          });
        });
      }
    );
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
  const { code, lang, testcases, submissionId, timeout = 5, adminCode } = payload;

  if (!LANGUAGES[lang]) {
    throw new Error(`Unsupported language: ${lang}`);
  }

  const langConfig = LANGUAGES[lang];
  const execTimeout = Math.min(parseInt(timeout) || 5, 15) * 1000;
  const cacheKey = getCacheKey(code, lang);

  // If adminCode is provided, we need to execute it first to get expected outputs
  let processedTestcases = testcases;
  if (adminCode && testcases.length > 0 && !testcases[0].expected) {
    console.log(`[${submissionId}] 🔍 Processing testcases with admin code...`);
    processedTestcases = [];
    
    const adminContainer = await getPool().acquire();
    const adminContainerId = adminContainer.id ? adminContainer.id.substring(0, 12) : 'unknown';
    
    try {
      for (let i = 0; i < testcases.length; i++) {
        const testInput = testcases[i].input || testcases[i];
        console.log(`[${submissionId}] 🏃 Executing admin code for testcase ${i + 1}/${testcases.length}...`);
        
        // Write admin code to file
        const adminExecDir = `/tmp/admin_exec/${submissionId}_${i}`;
        await executeInContainer(adminContainer, `mkdir -p ${adminExecDir}`);
        
        const adminFile = `${adminExecDir}/admin.${langConfig.ext}`;
        const adminWriteCmd = `cat > ${adminFile} << 'EOF'\n${adminCode}\nEOF`;
        await executeInContainer(adminContainer, adminWriteCmd);
        
        // Execute admin code with input
        const adminRunCmd = langConfig.run(adminFile);
        const inputFile = `${adminExecDir}/input.txt`;
        await executeInContainer(adminContainer, `echo -n "${testInput.replace(/"/g, '\\"')}" > ${inputFile}`);
        
        const adminResult = await executeInContainer(
          adminContainer,
          `cd ${adminExecDir} && ${adminRunCmd} < ${inputFile}`,
          null,
          execTimeout
        );
        
        const expectedOutput = normalizeOutput(adminResult.stdout);
        console.log(`[${submissionId}] ✅ Admin output for testcase ${i + 1}: "${expectedOutput}"`);
        
        processedTestcases.push({
          input: testInput,
          expected: expectedOutput
        });
      }
    } finally {
      // Release admin container
      await getPool().release(adminContainer);
    }
  }

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
            const errorDetails = extractFirstError(compileResult.stdout || compileResult.stderr);
            return {
              status: 'Compilation Error',
              status_code: -2,
              lang: lang,
              run_success: false,
              status_msg: 'Compilation Error',
              state: 'COMPILATION_ERROR',
              compile_error: errorDetails.short,
              full_compile_error: errorDetails.full,
              error: compileResult.stdout,
              testcases: [],
              total_testcases: processedTestcases.length,
              total_correct: 0,
              submission_id: submissionId,
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
          const errorDetails = extractFirstError(error.message);
          return {
            status: 'Compilation Error',
            status_code: -2,
            lang: lang,
            run_success: false,
            status_msg: 'Compilation Error',
            state: 'COMPILATION_ERROR',
            compile_error: errorDetails.short,
            full_compile_error: errorDetails.full,
            error: error.message,
            testcases: [],
            total_testcases: processedTestcases.length,
            total_correct: 0,
            submission_id: submissionId,
          };
        }
      }
    }

    // Step 3: Execute test cases sequentially - stop on first runtime error
    console.log(`[${submissionId}] 🧪 Executing ${processedTestcases.length} test case(s) in container ${containerId}...`);

    const results = [];
    let shouldStop = false;

    for (let index = 0; index < processedTestcases.length; index++) {
      const testcase = processedTestcases[index];

      // Stop execution if runtime error occurred in previous test
      if (shouldStop) {
        console.log(`[${submissionId}] ⏹️  Stopping execution due to runtime error in test case ${index}`);
        // results.push({
        //   input: '',
        //   output: '',
        //   expected: '',
        //   passed: false,
        //   status: 'Skipped',
        //   error: 'Execution stopped due to runtime error in previous test case',
        // });
        continue;
      }

      try {
        // Validate testcase has required fields
        if (!testcase || typeof testcase !== 'object') {
          results.push({
            input: '',
            output: '',
            expected: '',
            passed: false,
            status: 'Runtime Error',
            error: 'Invalid testcase format',
          });
          shouldStop = true;
          continue;
        }

        // Ensure input and expected are strings
        let input = String(testcase.input || '').trim();
        let expected = String(testcase.expected || '').trim();

        const runCmd = langConfig.run(binaryPath);
        console.log(`[${submissionId}] ▶️  Test case ${index + 1}/${processedTestcases.length}: Running in ${containerId}`);
        
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

        // Extract marked output (between __START_USER_OUTPUT__ and __END_USER_OUTPUT__)
        const fullStdout = Buffer.from(result.stdout).toString("utf8");
        console.log("this is error", result.stderr);
        const { logs, output } = splitOutput(fullStdout);
        
        // Check for runtime errors (stderr)
        let runtimeError = null;
        if (result.stderr) {
          const errorDetails = extractFirstError(result.stderr);
          runtimeError = {
            runtime_error: errorDetails.short,
            full_runtime_error: errorDetails.full
          };
          console.log(`[${submissionId}] ⚠️  Runtime Error: ${errorDetails.short}`);
          shouldStop = true; // Stop execution on runtime error
        }
        
        const actualOutput = normalizeOutput(output);
        expected = normalizeOutput(expected);
        const passed = actualOutput === expected && !runtimeError;
       
        console.log("actual bytes:", [...actualOutput].map(c => c.charCodeAt(0)));
        console.log("expected bytes:", [...expected].map(c => c.charCodeAt(0)));
        console.log("this is type of", typeof actualOutput, typeof expected, actualOutput, expected, actualOutput === expected);
        const status = runtimeError ? 'Runtime Error' : (passed ? 'Passed' : 'Wrong Answer');
        
        console.log(`[${submissionId}] ▶️  Command: cd ${execDir} && ${runCmd} < ${inputFile}`);
        console.log(`[${submissionId}] 📤 STDOUT: "${actualOutput}"`);
        if (result.stderr) {
          console.log(`[${submissionId}] 📥 STDERR: "${result.stderr.trim()}"`);
        }
        console.log(`[${submissionId}] 🎯 Expected: "${expected}"`);
        console.log(`[${submissionId}] ${passed && !runtimeError ? '✅' : '❌'} Test case ${index + 1}: ${status}`);

        results.push({
          input: input.substring(0, 100), // Truncate for display
          output: actualOutput,
          expected: expected,
          passed,
          status,
          logs: logs, // Include logs for debugging
          ...runtimeError, // Include runtime error if exists
        });
      } catch (error) {
        // Safely get input from testcase
        let input = '';
        let expected = '';
        if (testcase && typeof testcase === 'object') {
          input = String(testcase?.input || '').substring(0, 100);
          expected = String(testcase?.expected || '').trim();
        }
        
        console.log(`[${submissionId}] ❌ Test case ${index + 1}: Runtime Error - ${error.message}`);
        const errorDetails = extractFirstError(error.message);
        
        results.push({
          input: input,
          output: '',
          expected: expected,
          passed: false,
          status: 'Runtime Error',
          error: error.message,
          runtime_error: errorDetails.short,
          full_runtime_error: errorDetails.full,
        });
        
        shouldStop = true; // Stop execution on runtime error
      }
    }

    // Determine overall status
    const allPassed = results.every((r) => r.passed);
    const hasError = results.some((r) => r.status === 'Runtime Error');
    const hasWrongAnswer = results.some((r) => r.status === 'Wrong Answer');

    let statusMsg = 'Accepted';
    if (hasError) statusMsg = 'Runtime Error';
    else if (hasWrongAnswer) statusMsg = 'Wrong Answer';

    // Extract first error if exists
    const firstErrorResult = results.find((r) => r.runtime_error || r.full_runtime_error);

    const totalCorrect = results.filter((r) => r.passed).length;
    const totalTestcases = results.length;
    const compareResult = results.map((r) => r.passed ? '1' : '0').join('');

    const endTime = Date.now();
    const elapsedTime = endTime - Date.now(); // In real scenario would be from start
    const memoryKB = 42004000; // Placeholder
    const statusMemory = Math.round(memoryKB / 1024 / 1024) + ' MB';

    // LeetCode-style response format
    const leetcodeResponse = {
      // Required field: status (for server endpoint)
      status: statusMsg,
      
      // User code execution details
      status_code: hasError ? -1 : (allPassed ? 10 : 11), // 10=Accepted, 11=Wrong Answer, -1=Error
      lang: lang,
      run_success: !hasError,
      status_runtime: hasError ? 'N/A' : '0 ms',
      memory: memoryKB,
      display_runtime: '0',
      code_answer: results.map((r) => r.output),
      code_output: [],
      std_output_list: results.map((r) => r.logs),
      elapsed_time: elapsedTime,
      task_finish_time: endTime,
      task_name: 'judger.runcodetask.RunCode',

      // Error details (if any)
      ...(firstErrorResult && {
        runtime_error: firstErrorResult.runtime_error,
        full_runtime_error: firstErrorResult.full_runtime_error,
      }),

      // Expected output (from admin code)
      expected_status_code: 10, // Expected always runs successfully
      expected_lang: 'python', // Admin code language
      expected_run_success: true,
      expected_status_runtime: '0 ms',
      expected_memory: 12372000,
      expected_display_runtime: '0',
      expected_code_answer: results.map((r) => r.expected),
      expected_code_output: [],
      expected_std_output_list: results.map((r) => r.expected),
      expected_elapsed_time: 36,
      expected_task_finish_time: Date.now(),
      expected_task_name: 'judger.interprettask.Interpret',

      // Comparison results
      correct_answer: allPassed,
      compare_result: compareResult, // '111' = all passed, '101' = 2 passed 1 failed
      total_correct: totalCorrect,
      total_testcases: totalTestcases,
      runtime_percentile: null,
      status_memory: statusMemory,
      memory_percentile: null,
      pretty_lang: lang.charAt(0).toUpperCase() + lang.slice(1),
      submission_id: submissionId,
      status_msg: statusMsg,
      state: allPassed ? 'SUCCESS' : (hasError ? 'RUNTIME_ERROR' : 'WRONG_ANSWER'),
      
      // Detailed results for debugging
      testcases: results,
    };

    console.log(`[${submissionId}] 📊 Results: ${totalCorrect}/${totalTestcases} passed - ${statusMsg}`);
    console.log(`[${submissionId}] 🐳 Container ${containerId} completed execution`);

    return leetcodeResponse;
  } catch (error) {
    console.log(`[${submissionId}] ❌ System error in container ${containerId}: ${error.message}`);
    const errorDetails = extractFirstError(error.message);
    return {
      status: 'System Error',
      status_code: -1,
      lang: lang,
      run_success: false,
      status_msg: 'System Error',
      state: 'SYSTEM_ERROR',
      compile_error: errorDetails.short,
      full_compile_error: errorDetails.full,
      error: error.message,
      testcases: [],
      total_testcases: 0,
      total_correct: 0,
      submission_id: submissionId,
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
