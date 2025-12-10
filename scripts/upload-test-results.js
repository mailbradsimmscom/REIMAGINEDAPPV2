#!/usr/bin/env node

/**
 * Upload test results to Supabase for the test dashboard.
 *
 * Usage: node scripts/upload-test-results.js
 *
 * Environment variables:
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_KEY - Supabase service key
 *   RUN_TYPE - Type of run (push, nightly, manual)
 *   RUN_STARTED_AT - ISO timestamp when run started
 *   GITHUB_REF_NAME - Git branch name
 *   GITHUB_SHA - Git commit hash
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Load .env file for local development (noop if env vars already set)
config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

/**
 * Generate a fix hint based on error message
 */
function generateFixHint(category, test) {
  const error = test.error || test.message || '';

  if (error.includes('Timeout')) {
    return 'Service may be slow or down. Check Render logs.';
  }
  if (error.includes('401') || error.includes('403')) {
    return 'Authentication issue. Check ADMIN_TOKEN env var.';
  }
  if (error.includes('404')) {
    return 'Route not found. Check if endpoint exists or was renamed.';
  }
  if (error.includes('500')) {
    return 'Server error. Check application logs for stack trace.';
  }
  if (error.includes('ECONNREFUSED')) {
    return 'Service not reachable. Check if Render service is running.';
  }
  if (error.includes('EPIPE') || error.includes('socket')) {
    return 'Connection reset. Service may have restarted.';
  }

  return 'Review test file and error message for details.';
}

/**
 * Parse Node.js test output (TAP format)
 * Handles nested subtests (indented with spaces)
 * NOW CAPTURES ERROR MESSAGES from YAML blocks
 */
function parseNodeTestOutput(content) {
  const lines = content.split('\n');
  const tests = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // First, try to parse the summary line (most accurate)
  // Format: "# pass 12" "# fail 0" "# skipped 0"
  let foundSummary = false;
  for (const line of lines) {
    const passMatch = line.match(/^# pass (\d+)/);
    const failMatch = line.match(/^# fail (\d+)/);
    const skipMatch = line.match(/^# skipped (\d+)/);

    if (passMatch) { passed = parseInt(passMatch[1], 10); foundSummary = true; }
    if (failMatch) { failed = parseInt(failMatch[1], 10); foundSummary = true; }
    if (skipMatch) { skipped = parseInt(skipMatch[1], 10); foundSummary = true; }
  }

  // Parse individual test lines with error capture
  let currentTest = null;
  let inYamlBlock = false;
  let errorLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match "ok N - name" or "    ok N - name" (with optional leading spaces)
    const okMatch = line.match(/^\s*ok \d+ - (.+)/);
    const notOkMatch = line.match(/^\s*not ok \d+ - (.+)/);

    if (okMatch) {
      // Save previous failed test with error if any
      if (currentTest && currentTest.status === 'failed' && errorLines.length > 0) {
        currentTest.error = errorLines.join('\n').trim();
      }

      const name = okMatch[1].trim();
      if (!name.startsWith('duration_ms') && !name.startsWith('location')) {
        currentTest = { name, status: 'passed' };
        tests.push(currentTest);
      }
      inYamlBlock = false;
      errorLines = [];
    } else if (notOkMatch) {
      // Save previous failed test with error if any
      if (currentTest && currentTest.status === 'failed' && errorLines.length > 0) {
        currentTest.error = errorLines.join('\n').trim();
      }

      const name = notOkMatch[1].trim();
      if (!name.startsWith('duration_ms') && !name.startsWith('location')) {
        currentTest = { name, status: 'failed' };
        tests.push(currentTest);
      }
      inYamlBlock = false;
      errorLines = [];
    } else if (line.match(/^\s+---\s*$/)) {
      // Start of YAML block
      inYamlBlock = true;
    } else if (line.match(/^\s+\.\.\.\s*$/)) {
      // End of YAML block
      inYamlBlock = false;
    } else if (inYamlBlock && currentTest && currentTest.status === 'failed') {
      // Capture error-related lines from YAML block
      const errorMatch = line.match(/^\s+error:\s*['"]?(.+?)['"]?\s*$/);
      const stackMatch = line.match(/^\s+stack:\s*\|?\-?\s*$/);
      const actualMatch = line.match(/^\s+actual:\s*(.+)/);
      const expectedMatch = line.match(/^\s+expected:\s*(.+)/);
      const codeMatch = line.match(/^\s+code:\s*['"]?(.+?)['"]?\s*$/);

      if (errorMatch) {
        errorLines.push(`Error: ${errorMatch[1]}`);
      } else if (actualMatch) {
        errorLines.push(`Actual: ${actualMatch[1]}`);
      } else if (expectedMatch) {
        errorLines.push(`Expected: ${expectedMatch[1]}`);
      } else if (codeMatch) {
        errorLines.push(`Code: ${codeMatch[1]}`);
      } else if (line.match(/^\s{6,}/) && errorLines.length > 0) {
        // Stack trace lines (deeply indented)
        errorLines.push(line.trim());
      }
    }
  }

  // Don't forget the last test
  if (currentTest && currentTest.status === 'failed' && errorLines.length > 0) {
    currentTest.error = errorLines.join('\n').trim();
  }

  // If no summary found, count from parsed tests (fallback)
  if (!foundSummary && tests.length > 0) {
    passed = tests.filter(t => t.status === 'passed').length;
    failed = tests.filter(t => t.status === 'failed').length;
  }

  return { passed, failed, skipped, tests };
}

/**
 * Parse pytest verbose output
 */
function parsePytestOutput(content) {
  const lines = content.split('\n');
  const tests = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const line of lines) {
    // Match pytest verbose output: test_file.py::test_name PASSED/FAILED/SKIPPED
    const match = line.match(/^([\w\/\.\-]+::\S+)\s+(PASSED|FAILED|SKIPPED|ERROR)/);
    if (match) {
      const name = match[1];
      const status = match[2].toLowerCase();

      if (status === 'passed') passed++;
      else if (status === 'failed' || status === 'error') failed++;
      else if (status === 'skipped') skipped++;

      tests.push({ name, status: status === 'error' ? 'failed' : status });
    }
  }

  return { passed, failed, skipped, tests };
}

/**
 * Parse chat timing results
 */
function parseChatTiming(jsonPath) {
  if (!existsSync(jsonPath)) {
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    return {
      timestamp: data.timestamp,
      summary: data.summary,
      tests: (data.tests || []).map(t => ({
        name: t.name,
        duration: t.duration,
        success: t.success,
        type: t.type || t.category
      }))
    };
  } catch (e) {
    console.error('Error parsing chat timing:', e.message);
    return null;
  }
}

/**
 * Parse Playwright JSON report (handles nested suites)
 */
function parsePlaywrightReport(content) {
  const report = JSON.parse(content);
  const tests = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  function processSuite(suite, parentTitle = '') {
    const suiteTitle = parentTitle ? `${parentTitle} > ${suite.title}` : suite.title;

    // Process specs in this suite
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const result = test.results?.[0];
        const status = result?.status || 'unknown';

        if (status === 'passed') passed++;
        else if (status === 'failed') failed++;
        else if (status === 'skipped') skipped++;

        tests.push({
          name: `${suiteTitle} > ${spec.title}`,
          status,
          error: result?.error?.message
        });
      }
    }

    // Recursively process nested suites
    for (const nestedSuite of suite.suites || []) {
      processSuite(nestedSuite, suiteTitle);
    }
  }

  // Process all top-level suites
  for (const suite of report.suites || []) {
    processSuite(suite);
  }

  return { passed, failed, skipped, tests };
}

async function uploadResults() {
  console.log('Uploading test results...\n');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const runId = randomUUID();
  const results = {};
  const failures = [];
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // Parse chat timing separately (special structure)
  const chatTimingPath = join(projectRoot, 'results', 'chat-timing.json');
  const chatTiming = parseChatTiming(chatTimingPath);
  if (chatTiming) {
    console.log('  chat-timing: parsed successfully');
  }

  // Check for results directory
  const resultsDir = join(projectRoot, 'results');
  if (!existsSync(resultsDir)) {
    console.log('No results directory found. Creating empty result.');
    // Still upload so dashboard shows a run happened
  } else {
    // Read all result files (.json and .txt)
    // Skip chat-timing.json as it's handled separately
    const files = readdirSync(resultsDir).filter(f => 
      (f.endsWith('.json') || f.endsWith('.txt')) && f !== 'chat-timing.json'
    );

    for (const file of files) {
      const category = file.replace('.json', '').replace('.txt', '');
      const content = readFileSync(join(resultsDir, file), 'utf-8');

      // Skip empty files
      if (!content || content.trim().length === 0) {
        console.log(`  ${category}: skipped (empty file)`);
        continue;
      }

      let data;
      try {
        if (file.includes('playwright')) {
          data = parsePlaywrightReport(content);
        } else if (file.includes('python')) {
          // Pytest verbose output
          data = parsePytestOutput(content);
        } else {
          data = JSON.parse(content);
          // If it's raw JSON, try to extract stats
          if (!data.passed && data.tests) {
            data = {
              passed: data.tests.filter(t => t.status === 'passed').length,
              failed: data.tests.filter(t => t.status === 'failed').length,
              skipped: data.tests.filter(t => t.status === 'skipped').length,
              tests: data.tests
            };
          }
        }
      } catch (e) {
        // Might be TAP format (Node.js tests)
        data = parseNodeTestOutput(content);
      }

      results[category] = {
        passed: data.passed || 0,
        failed: data.failed || 0,
        skipped: data.skipped || 0,
        tests: data.tests || []
      };

      total += (data.passed || 0) + (data.failed || 0);
      passed += data.passed || 0;
      failed += data.failed || 0;
      skipped += data.skipped || 0;

      // Extract failures with fix hints
      const failedTests = (data.tests || []).filter(t => t.status === 'failed');
      for (const test of failedTests) {
        failures.push({
          category,
          name: test.name,
          error: test.error || test.message,
          file: test.file,
          fix_hint: generateFixHint(category, test)
        });
      }

      console.log(`  ${category}: ${data.passed}/${(data.passed || 0) + (data.failed || 0)} passed`);
    }
  }

  // Upload to Supabase
  const { error } = await supabase.from('test_results').insert({
    run_id: runId,
    run_type: process.env.RUN_TYPE || 'manual',
    run_started_at: process.env.RUN_STARTED_AT || new Date().toISOString(),
    run_completed_at: new Date().toISOString(),
    total_tests: total,
    passed,
    failed,
    skipped,
    git_branch: process.env.GITHUB_REF_NAME || 'local',
    git_commit: process.env.GITHUB_SHA || 'unknown',
    environment: process.env.ENVIRONMENT || 'ci',
    results,
    chat_timing: chatTiming,
    failures
  });

  if (error) {
    console.error('Failed to upload results:', error);
    process.exit(1);
  }

  console.log(`\nUploaded results: ${passed}/${total} passed, ${failed} failed`);
  console.log(`Run ID: ${runId}`);
}

// Run if called directly
uploadResults()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Upload failed:', err);
    process.exit(1);
  });
