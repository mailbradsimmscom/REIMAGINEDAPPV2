#!/usr/bin/env node
/**
 * Query test_results table from Supabase
 * Usage: node scripts/query-test-results.js [--limit N] [--run-type TYPE]
 */

import { getSupabaseClient } from '../src/repositories/supabaseClient.js';
import { getEnv } from '../src/config/env.js';

async function queryTestResults() {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1]) : 10;
  
  const runTypeIndex = args.indexOf('--run-type');
  const runType = runTypeIndex !== -1 ? args[runTypeIndex + 1] : null;

  console.log('\n=== Test Results Query ===\n');

  try {
    const supabase = await getSupabaseClient();
    
    if (!supabase) {
      console.error('❌ Failed to initialize Supabase client');
      console.error('Check your SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
      process.exit(1);
    }

    let query = supabase
      .from('test_results')
      .select('*')
      .order('created_at', { ascending: false });

    if (runType) {
      query = query.eq('run_type', runType);
      console.log(`Filtering by run_type: ${runType}\n`);
    }

    query = query.limit(limit);

    const { data, error } = await query;

    if (error) {
      console.error('❌ Query failed:', error);
      process.exit(1);
    }

    if (!data || data.length === 0) {
      console.log('⚠️  No test results found');
      return;
    }

    console.log(`Found ${data.length} test result(s):\n`);

    data.forEach((result, index) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Result #${index + 1}`);
      console.log(`${'='.repeat(80)}`);
      console.log(`ID: ${result.id}`);
      console.log(`Run ID: ${result.run_id}`);
      console.log(`Run Type: ${result.run_type}`);
      console.log(`Environment: ${result.environment || 'N/A'}`);
      console.log(`Git Branch: ${result.git_branch || 'N/A'}`);
      console.log(`Git Commit: ${result.git_commit ? result.git_commit.substring(0, 8) : 'N/A'}`);
      console.log(`Started: ${result.run_started_at || 'N/A'}`);
      console.log(`Completed: ${result.run_completed_at || 'N/A'}`);
      console.log(`\nSummary:`);
      console.log(`  Total Tests: ${result.total_tests || 0}`);
      console.log(`  Passed: ${result.passed || 0}`);
      console.log(`  Failed: ${result.failed || 0}`);
      console.log(`  Skipped: ${result.skipped || 0}`);
      
      if (result.results && Object.keys(result.results).length > 0) {
        console.log(`\nResults by Category:`);
        Object.entries(result.results).forEach(([category, stats]) => {
          if (typeof stats === 'object' && stats !== null) {
            console.log(`  ${category}:`);
            if (stats.passed !== undefined) console.log(`    Passed: ${stats.passed}`);
            if (stats.failed !== undefined) console.log(`    Failed: ${stats.failed}`);
            if (stats.skipped !== undefined) console.log(`    Skipped: ${stats.skipped}`);
            if (stats.total !== undefined) console.log(`    Total: ${stats.total}`);
          }
        });
      }

      if (result.failures && Array.isArray(result.failures) && result.failures.length > 0) {
        console.log(`\nFailures (${result.failures.length}):`);
        result.failures.forEach((failure, i) => {
          console.log(`\n  ${i + 1}. [${failure.category || 'unknown'}] ${failure.name || 'unnamed'}`);
          if (failure.error) {
            console.log(`     Error: ${failure.error}`);
          }
          if (failure.fix_hint) {
            console.log(`     Fix Hint: ${failure.fix_hint}`);
          }
        });
      }

      if (result.chat_timing) {
        console.log(`\nChat Timing:`);
        if (result.chat_timing.summary) {
          const summary = result.chat_timing.summary;
          console.log(`  Average Full Stack: ${summary.avgFullStackMs || 'N/A'}ms`);
          console.log(`  Average Node.js: ${summary.avgNodeMs || 'N/A'}ms`);
          console.log(`  Average Python: ${summary.avgPythonMs || 'N/A'}ms`);
          if (summary.avgClassificationMs) console.log(`  Average Classification: ${summary.avgClassificationMs}ms`);
          if (summary.avgPineconeMs) console.log(`  Average Pinecone: ${summary.avgPineconeMs}ms`);
          if (summary.avgLLMSynthesisMs) console.log(`  Average LLM Synthesis: ${summary.avgLLMSynthesisMs}ms`);
        }
      }

      console.log(`\nCreated: ${result.created_at}`);
    });

    console.log(`\n${'='.repeat(80)}\n`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

queryTestResults();

