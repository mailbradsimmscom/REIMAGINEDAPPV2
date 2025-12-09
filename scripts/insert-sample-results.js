#!/usr/bin/env node

/**
 * Insert sample test results into Supabase for dashboard demo.
 * Creates the table if it doesn't exist.
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';

// Load env
config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function insertSampleResults() {
  console.log('Inserting sample test results...');

  const runId = randomUUID();
  const now = new Date().toISOString();

  // Sample data based on actual test runs
  const sampleResult = {
    run_id: runId,
    run_type: 'manual',
    run_started_at: now,
    run_completed_at: now,
    total_tests: 125,
    passed: 113,
    failed: 5,
    skipped: 7,
    git_branch: 'Stable-v4-Working',
    git_commit: 'phase6-demo',
    environment: 'local',
    results: {
      unit: {
        passed: 25,
        failed: 4,
        skipped: 7,
        tests: [
          { name: 'extractKeywords - extracts meaningful keywords', status: 'passed' },
          { name: 'extractKeywords - handles null/undefined', status: 'passed' },
          { name: 'Environment schema parsing in dev mode', status: 'passed' },
          { name: 'Admin auth - missing token', status: 'failed', error: 'expected 401, got 404' }
        ]
      },
      python: {
        passed: 67,
        failed: 1,
        skipped: 0,
        tests: [
          { name: 'test_chunking - SemanticChunker init', status: 'passed' },
          { name: 'test_api_schemas - health endpoint', status: 'passed' },
          { name: 'test_performance - reasonable time', status: 'failed', error: 'Timeout exceeded' }
        ]
      },
      e2e: {
        passed: 33,
        failed: 0,
        skipped: 1,
        tests: [
          { name: 'Chat Interface - page loads', status: 'passed' },
          { name: 'Admin Dashboard - loads successfully', status: 'passed' },
          { name: 'Chat Response - content validation', status: 'skipped' }
        ]
      }
    },
    failures: [
      {
        category: 'unit',
        name: 'Admin auth - missing token',
        error: 'expected 401, got 404',
        fix_hint: 'Check admin route registration'
      },
      {
        category: 'python',
        name: 'test_performance - reasonable time',
        error: 'Timeout exceeded',
        fix_hint: 'Service may be slow. Check Render logs.'
      }
    ]
  };

  // Try to insert
  const { data, error } = await supabase
    .from('test_results')
    .insert(sampleResult)
    .select();

  if (error) {
    console.error('Insert error:', error.message);

    if (error.message.includes('does not exist')) {
      console.log('\nTable does not exist. Run this SQL in Supabase SQL Editor:');
      console.log('-- See sql/test_results_table.sql');
    }
    process.exit(1);
  }

  console.log('Sample results inserted!');
  console.log('Run ID:', runId);
  console.log('View dashboard at: /public/test-results.html');
}

insertSampleResults().catch(console.error);
