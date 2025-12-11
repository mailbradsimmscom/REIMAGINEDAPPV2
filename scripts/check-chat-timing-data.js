#!/usr/bin/env node

/**
 * Diagnostic script to check if chat_timing data has node_timing
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLatestResults() {
  console.log('🔍 Checking latest test results for node_timing data...\n');

  const { data, error } = await supabase
    .from('test_results')
    .select('run_id, created_at, chat_timing')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('❌ Error:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('⚠️  No test results found');
    return;
  }

  const latest = data[0];
  console.log(`✅ Found latest result: ${latest.run_id}`);
  console.log(`   Created: ${latest.created_at}\n`);

  if (!latest.chat_timing) {
    console.log('❌ chat_timing is null or missing');
    return;
  }

  console.log('📊 Chat timing data structure:');
  console.log('   Has summary:', !!latest.chat_timing.summary);
  console.log('   Has node_timing:', !!latest.chat_timing.summary?.node_timing);
  console.log('   Has breakdown:', !!latest.chat_timing.summary?.breakdown);

  if (latest.chat_timing.summary?.node_timing) {
    const nodeTiming = latest.chat_timing.summary.node_timing;
    console.log('\n✅ Node.js timing found!');
    console.log('   Keys:', Object.keys(nodeTiming));
    console.log('   Values:', nodeTiming);
    
    const total = Object.values(nodeTiming).reduce((sum, val) => sum + (val || 0), 0);
    console.log(`   Total Node.js time: ${total}ms`);
  } else {
    console.log('\n❌ node_timing NOT found in summary');
    console.log('   Summary keys:', Object.keys(latest.chat_timing.summary || {}));
  }

  if (latest.chat_timing.tests) {
    const fullStackTests = latest.chat_timing.tests.filter(t => t.name?.includes('Full Stack'));
    const testsWithTiming = fullStackTests.filter(t => t.nodeTiming);
    console.log(`\n📋 Tests: ${latest.chat_timing.tests.length} total`);
    console.log(`   Full Stack tests: ${fullStackTests.length}`);
    console.log(`   Tests with nodeTiming: ${testsWithTiming.length}`);
    
    if (testsWithTiming.length > 0) {
      console.log('   ✅ Sample nodeTiming:', testsWithTiming[0].nodeTiming);
    }
  }
}

checkLatestResults().catch(console.error);
