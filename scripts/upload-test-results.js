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

  // Parse individual test lines (handles both root and indented subtests)
  for (const line of lines) {
    // Match "ok N - name" or "    ok N - name" (with optional leading spaces)
    const okMatch = line.match(/^\s*ok \d+ - (.+)/);
    const notOkMatch = line.match(/^\s*not ok \d+ - (.+)/);

    if (okMatch) {
      const name = okMatch[1].trim();
      // Skip YAML metadata lines that look like test names
      if (!name.startsWith('duration_ms') && !name.startsWith('location')) {
        tests.push({ name, status: 'passed' });
      }
    } else if (notOkMatch) {
      const name = notOkMatch[1].trim();
      if (!name.startsWith('duration_ms') && !name.startsWith('location')) {
        tests.push({ name, status: 'failed' });
      }
    }

    // Check for skipped tests in the test line itself (not summary)
    // Format: "ok 1 - test name # SKIP reason"
    if ((line.includes('# SKIP') || line.includes('# TODO')) && line.match(/^\s*(ok|not ok)/)) {
      // This specific test was skipped
      // Note: skipped count already handled by summary, this is for test details
    }
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

  // Check for results directory
  const resultsDir = join(projectRoot, 'results');
  if (!existsSync(resultsDir)) {
    console.log('No results directory found. Creating empty result.');
    // Still upload so dashboard shows a run happened
  } else {
    // Read all result files (.json and .txt)
    const files = readdirSync(resultsDir).filter(f => f.endsWith('.json') || f.endsWith('.txt'));

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
