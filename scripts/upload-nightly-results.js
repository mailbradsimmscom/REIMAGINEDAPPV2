#!/usr/bin/env node

/**
 * Parse test results from multiple sources and upload to Supabase dashboard.
 *
 * Usage: node scripts/upload-nightly-results.js
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// Load env
config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Parse Playwright JSON results
 */
function parsePlaywrightResults(jsonPath) {
  if (!existsSync(jsonPath)) {
    return { passed: 0, failed: 0, skipped: 0, tests: [], failures: [] };
  }

  try {
    const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    const tests = [];
    const failures = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    function processSpecs(specs, suiteName = '') {
      for (const spec of specs) {
        for (const test of spec.tests || []) {
          const testName = suiteName ? `${suiteName} > ${spec.title}` : spec.title;
          const result = test.results?.[0];
          const status = result?.status || 'skipped';

          if (status === 'passed') {
            passed++;
            tests.push({ name: testName, status: 'passed' });
          } else if (status === 'failed') {
            failed++;
            const error = result?.error?.message || 'Unknown error';
            tests.push({ name: testName, status: 'failed', error });
            failures.push({
              category: 'e2e',
              name: testName,
              error: error.split('\n')[0],
              fix_hint: generateFixHint(error)
            });
          } else {
            skipped++;
            tests.push({ name: testName, status: 'skipped' });
          }
        }
      }
    }

    function processSuites(suites, parentName = '') {
      for (const suite of suites) {
        const suiteName = parentName ? `${parentName} > ${suite.title}` : suite.title;
        if (suite.specs) {
          processSpecs(suite.specs, suiteName);
        }
        if (suite.suites) {
          processSuites(suite.suites, suiteName);
        }
      }
    }

    if (data.suites) {
      processSuites(data.suites);
    }

    return { passed, failed, skipped, tests: tests.slice(0, 50), failures };
  } catch (e) {
    console.error('Error parsing Playwright results:', e.message);
    return { passed: 0, failed: 0, skipped: 0, tests: [], failures: [] };
  }
}

/**
 * Parse Node.js test output (text format)
 */
function parseNodeTestResults(txtPath) {
  if (!existsSync(txtPath)) {
    return { passed: 0, failed: 0, skipped: 0, tests: [], failures: [] };
  }

  try {
    const content = readFileSync(txtPath, 'utf-8');
    const lines = content.split('\n');
    const tests = [];
    const failures = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const line of lines) {
      if (line.includes('✔') || line.includes('ok ')) {
        passed++;
        const match = line.match(/(?:✔|ok \d+)\s+(.+?)(?:\s+\(\d+)/);
        if (match) {
          tests.push({ name: match[1].trim(), status: 'passed' });
        }
      } else if (line.includes('✖') || line.includes('not ok ')) {
        failed++;
        const match = line.match(/(?:✖|not ok \d+)\s+(.+?)(?:\s+\(\d+)?/);
        if (match) {
          const name = match[1].trim();
          tests.push({ name, status: 'failed' });
          failures.push({
            category: 'unit',
            name,
            error: 'Test failed',
            fix_hint: 'Check test output for details'
          });
        }
      } else if (line.includes('# skip') || line.includes('- SKIP')) {
        skipped++;
      }
    }

    // Extract summary from end of output
    const summaryMatch = content.match(/(\d+) pass(?:ed)?.*?(\d+) fail(?:ed)?/s);
    if (summaryMatch) {
      passed = parseInt(summaryMatch[1]) || passed;
      failed = parseInt(summaryMatch[2]) || failed;
    }

    return { passed, failed, skipped, tests: tests.slice(0, 30), failures };
  } catch (e) {
    console.error('Error parsing Node test results:', e.message);
    return { passed: 0, failed: 0, skipped: 0, tests: [], failures: [] };
  }
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
      tests: data.tests.map(t => ({
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
 * Parse pytest output (text format)
 */
function parsePytestResults(txtPath) {
  if (!existsSync(txtPath)) {
    return { passed: 0, failed: 0, skipped: 0, tests: [], failures: [] };
  }

  try {
    const content = readFileSync(txtPath, 'utf-8');
    const lines = content.split('\n');
    const tests = [];
    const failures = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const line of lines) {
      if (line.includes(' PASSED')) {
        passed++;
        const match = line.match(/(\S+::\S+)/);
        if (match) {
          tests.push({ name: match[1], status: 'passed' });
        }
      } else if (line.includes(' FAILED')) {
        failed++;
        const match = line.match(/(\S+::\S+)/);
        if (match) {
          const name = match[1];
          tests.push({ name, status: 'failed' });
          failures.push({
            category: 'python',
            name,
            error: 'Test failed',
            fix_hint: 'Check pytest output for details'
          });
        }
      } else if (line.includes(' SKIPPED')) {
        skipped++;
      }
    }

    // Extract summary
    const summaryMatch = content.match(/(\d+) passed.*?(\d+) failed/s);
    if (summaryMatch) {
      passed = parseInt(summaryMatch[1]) || passed;
      failed = parseInt(summaryMatch[2]) || failed;
    } else {
      const passedMatch = content.match(/(\d+) passed/);
      if (passedMatch) passed = parseInt(passedMatch[1]);
    }

    return { passed, failed, skipped, tests: tests.slice(0, 30), failures };
  } catch (e) {
    console.error('Error parsing pytest results:', e.message);
    return { passed: 0, failed: 0, skipped: 0, tests: [], failures: [] };
  }
}

/**
 * Generate fix hints based on error patterns
 */
function generateFixHint(error) {
  if (error.includes('Timeout')) return 'Service may be slow. Check server logs.';
  if (error.includes('401') || error.includes('403')) return 'Authentication issue. Check ADMIN_TOKEN.';
  if (error.includes('404')) return 'Route not found. Check if endpoint exists.';
  if (error.includes('500')) return 'Server error. Check application logs.';
  if (error.includes('ECONNREFUSED')) return 'Service not reachable. Check if server is running.';
  if (error.includes('null') && error.includes('addEventListener')) return 'DOM element not found. Check element selector.';
  if (error.includes('not visible')) return 'Element not visible. Check if page renders correctly.';
  return 'Review test file and error message for details.';
}

/**
 * Main upload function
 */
async function uploadResults() {
  console.log('Parsing test results...\n');

  // Parse all result files
  const unitResults = parseNodeTestResults(join(projectRoot, 'results/unit-full.txt'));
  const pythonResults = parsePytestResults(join(projectRoot, 'results/python-full.txt'));
  const e2eResults = parsePlaywrightResults(join(projectRoot, 'results/ui-full.json'));
  const chatTiming = parseChatTiming(join(projectRoot, 'results/chat-timing.json'));

  // Calculate totals
  const total = unitResults.passed + unitResults.failed + unitResults.skipped +
                pythonResults.passed + pythonResults.failed + pythonResults.skipped +
                e2eResults.passed + e2eResults.failed + e2eResults.skipped;

  const passed = unitResults.passed + pythonResults.passed + e2eResults.passed;
  const failed = unitResults.failed + pythonResults.failed + e2eResults.failed;
  const skipped = unitResults.skipped + pythonResults.skipped + e2eResults.skipped;

  // Collect all failures
  const allFailures = [
    ...unitResults.failures,
    ...pythonResults.failures,
    ...e2eResults.failures
  ];

  // Build result object
  const runId = randomUUID();
  const now = new Date().toISOString();

  const testResult = {
    run_id: runId,
    run_type: process.env.RUN_TYPE || 'nightly',
    run_started_at: process.env.RUN_STARTED_AT || now,
    run_completed_at: now,
    total_tests: total,
    passed,
    failed,
    skipped,
    git_branch: process.env.GITHUB_REF_NAME || 'Stable-v4-Working',
    git_commit: process.env.GITHUB_SHA || 'local',
    environment: process.env.NODE_ENV || 'local',
    results: {
      unit: unitResults,
      python: pythonResults,
      e2e: e2eResults
    },
    chat_timing: chatTiming,
    failures: allFailures
  };

  console.log('=== Test Results Summary ===');
  console.log(`Unit:   ${unitResults.passed} passed, ${unitResults.failed} failed`);
  console.log(`Python: ${pythonResults.passed} passed, ${pythonResults.failed} failed`);
  console.log(`E2E:    ${e2eResults.passed} passed, ${e2eResults.failed} failed`);
  console.log(`Total:  ${passed}/${total} passed (${((passed/total)*100).toFixed(1)}%)`);
  console.log('============================\n');

  // Upload to Supabase
  console.log('Uploading to Supabase...');
  const { data, error } = await supabase
    .from('test_results')
    .insert(testResult)
    .select();

  if (error) {
    console.error('Upload failed:', error.message);
    process.exit(1);
  }

  console.log('Results uploaded successfully!');
  console.log('Run ID:', runId);
  console.log('View at: /public/test-results.html');
}

uploadResults().catch(console.error);
