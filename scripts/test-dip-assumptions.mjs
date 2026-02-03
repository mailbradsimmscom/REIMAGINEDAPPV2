#!/usr/bin/env node
/**
 * Quick & Dirty DIP Schema Assumption Tests
 *
 * Run with: node scripts/test-dip-assumptions.mjs
 *
 * Tests:
 * 1. PostgREST batch atomicity (partial insert failure)
 * 2. ["all"] sentinel with cs (contains) operator
 * 3. Migration A status check (referenced_systems column)
 * 4. ["all"] exclusivity with mixed arrays
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.PY_SUPABASE_SERVICE_KEY ||
                     process.env.SUPABASE_SERVICE_KEY ||
                     process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or service key in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TEST_DOC_ID = 'TEST_ASSUMPTION_DOC_' + Date.now();
let testDocCreated = false;

// ============================================
// HELPERS
// ============================================

async function setupTestDoc() {
  // Check if we need to create a test document for FK constraint
  console.log('\n📋 Setting up test document...');

  const { data: existing, error: checkErr } = await supabase
    .from('documents')
    .select('doc_id')
    .limit(1);

  if (checkErr) {
    console.error('  Error checking documents:', checkErr.message);
    return null;
  }

  if (existing && existing.length > 0) {
    console.log(`  ✓ Using existing doc_id: ${existing[0].doc_id}`);
    return existing[0].doc_id;
  }

  // Create a test document
  const { data: newDoc, error: insertErr } = await supabase
    .from('documents')
    .insert({ doc_id: TEST_DOC_ID, filename: 'test-assumption-doc.pdf', status: 'test' })
    .select()
    .single();

  if (insertErr) {
    console.error('  Error creating test document:', insertErr.message);
    return null;
  }

  testDocCreated = true;
  console.log(`  ✓ Created test doc_id: ${TEST_DOC_ID}`);
  return TEST_DOC_ID;
}

async function cleanup(docId) {
  console.log('\n🧹 Cleanup...');

  // Delete test rows from troubleshooting
  const { error: delErr } = await supabase
    .from('troubleshooting')
    .delete()
    .like('doc_id', 'TEST_%');

  if (delErr) {
    console.log(`  ⚠ Could not clean troubleshooting: ${delErr.message}`);
  } else {
    console.log('  ✓ Cleaned troubleshooting test rows');
  }

  // Delete test document if we created it
  if (testDocCreated) {
    const { error: docErr } = await supabase
      .from('documents')
      .delete()
      .eq('doc_id', TEST_DOC_ID);

    if (docErr) {
      console.log(`  ⚠ Could not clean test document: ${docErr.message}`);
    } else {
      console.log('  ✓ Cleaned test document');
    }
  }
}

// ============================================
// TEST 1: PostgREST Batch Atomicity
// ============================================

async function test1_BatchAtomicity(docId) {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: PostgREST Batch Atomicity');
  console.log('='.repeat(60));
  console.log('Hypothesis: If one row in a batch violates NOT NULL, entire batch fails');

  const rows = [
    { doc_id: docId, symptom: 'Good symptom 1', cause: 'Good cause 1' },
    { doc_id: docId, symptom: 'Good symptom 2', cause: null }, // violates NOT NULL
    { doc_id: docId, symptom: 'Good symptom 3', cause: 'Good cause 3' }
  ];

  console.log('\n  Inserting 3 rows (row 2 has cause: null)...');

  const { data, error } = await supabase
    .from('troubleshooting')
    .insert(rows)
    .select();

  if (error) {
    console.log(`  ✓ Batch INSERT failed as expected: ${error.code}`);
    console.log(`    Message: ${error.message}`);
  } else {
    console.log(`  ✗ Batch INSERT unexpectedly succeeded! Inserted ${data?.length} rows`);
  }

  // Verify no partial insert
  const { data: checkRows, error: checkErr } = await supabase
    .from('troubleshooting')
    .select('id, symptom')
    .eq('doc_id', docId)
    .like('symptom', 'Good symptom%');

  if (checkErr) {
    console.log(`  ⚠ Could not verify: ${checkErr.message}`);
    return false;
  }

  const count = checkRows?.length || 0;
  if (count === 0) {
    console.log(`  ✓ CONFIRMED: 0 rows inserted (no partial insert)`);
    console.log('\n  ✅ TEST 1 PASSED: PostgREST batches are atomic');
    return true;
  } else {
    console.log(`  ✗ FAILED: ${count} rows were inserted (partial insert occurred!)`);
    return false;
  }
}

// ============================================
// TEST 2: ["all"] Sentinel with cs Operator
// ============================================

async function test2_AllSentinelContains(docId) {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: ["all"] Sentinel with cs (contains) Operator');
  console.log('='.repeat(60));
  console.log('Hypothesis: .cs(applies_to_models, ["all"]) matches rows with applies_to_models = ["all"]');

  // Insert test row
  const testRow = {
    doc_id: docId,
    symptom: 'Test sentinel symptom',
    cause: 'Test sentinel cause',
    applies_to_models: ['all']
  };

  console.log('\n  Inserting row with applies_to_models: ["all"]...');

  const { data: inserted, error: insertErr } = await supabase
    .from('troubleshooting')
    .insert(testRow)
    .select()
    .single();

  if (insertErr) {
    console.log(`  ✗ Insert failed: ${insertErr.message}`);
    return false;
  }

  console.log(`  ✓ Inserted row id: ${inserted.id}`);

  // Query with contains
  console.log('  Querying with: applies_to_models cs {"all"}...');

  const { data: found, error: queryErr } = await supabase
    .from('troubleshooting')
    .select('id, applies_to_models')
    .contains('applies_to_models', ['all'])
    .eq('doc_id', docId);

  if (queryErr) {
    console.log(`  ✗ Query failed: ${queryErr.message}`);
    return false;
  }

  const matchCount = found?.length || 0;
  if (matchCount > 0) {
    console.log(`  ✓ Query returned ${matchCount} row(s)`);
    console.log(`    applies_to_models: ${JSON.stringify(found[0].applies_to_models)}`);
    console.log('\n  ✅ TEST 2 PASSED: cs operator works with ["all"] sentinel');
    return true;
  } else {
    console.log(`  ✗ Query returned 0 rows - sentinel not matched!`);
    return false;
  }
}

// ============================================
// TEST 3: Migration A Status Check
// ============================================

async function test3_MigrationAStatus() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: Migration A Status (referenced_systems column)');
  console.log('='.repeat(60));
  console.log('Checking if referenced_systems column exists on DIP tables...');

  const tables = ['troubleshooting', 'spec_suggestions', 'playbook_hints', 'golden_tests', 'intent_router'];
  const results = {};

  for (const table of tables) {
    // Query information_schema to check column existence
    const { data, error } = await supabase
      .rpc('get_column_info', { p_table: table, p_column: 'referenced_systems' })
      .single();

    // If RPC doesn't exist, try a different approach - insert with the column and see what happens
    if (error && error.message.includes('function')) {
      // Fallback: try to select the column
      const { data: selectData, error: selectErr } = await supabase
        .from(table)
        .select('referenced_systems')
        .limit(1);

      if (selectErr && selectErr.message.includes('referenced_systems')) {
        results[table] = { exists: false, error: selectErr.message };
      } else {
        results[table] = { exists: true, sample: selectData?.[0]?.referenced_systems };
      }
    } else if (error) {
      results[table] = { exists: false, error: error.message };
    } else {
      results[table] = { exists: true, info: data };
    }
  }

  console.log('\n  Column status per table:');
  let allExist = true;
  for (const [table, info] of Object.entries(results)) {
    if (info.exists) {
      console.log(`    ✓ ${table}: referenced_systems EXISTS`);
      if (info.sample !== undefined) {
        console.log(`      Sample value: ${JSON.stringify(info.sample)}`);
      }
    } else {
      allExist = false;
      console.log(`    ✗ ${table}: referenced_systems MISSING`);
      console.log(`      ${info.error}`);
    }
  }

  if (allExist) {
    console.log('\n  ✅ TEST 3 PASSED: Migration A already applied');
  } else {
    console.log('\n  ⚠️  TEST 3: Migration A needed - run the ALTER TABLE statements');
  }

  return allExist;
}

// ============================================
// TEST 4: ["all"] Exclusivity (Mixed Arrays)
// ============================================

async function test4_AllExclusivity(docId) {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: ["all"] Exclusivity (Mixed Arrays)');
  console.log('='.repeat(60));
  console.log('Testing behavior when applies_to_models = ["all", "4JH57"]');

  // Insert mixed array row
  const testRow = {
    doc_id: docId,
    symptom: 'Mixed array test symptom',
    cause: 'Mixed array test cause',
    applies_to_models: ['all', '4JH57']
  };

  console.log('\n  Inserting row with applies_to_models: ["all", "4JH57"]...');

  const { data: inserted, error: insertErr } = await supabase
    .from('troubleshooting')
    .insert(testRow)
    .select()
    .single();

  if (insertErr) {
    console.log(`  ✗ Insert failed: ${insertErr.message}`);
    return false;
  }

  console.log(`  ✓ Inserted row id: ${inserted.id}`);

  // Test 1: Does cs(["all"]) match?
  console.log('\n  Query A: applies_to_models cs {"all"}...');
  const { data: csAll, error: csAllErr } = await supabase
    .from('troubleshooting')
    .select('id, applies_to_models')
    .contains('applies_to_models', ['all'])
    .eq('id', inserted.id);

  const csAllMatches = !csAllErr && csAll?.length > 0;
  console.log(`    ${csAllMatches ? '✓' : '✗'} cs(["all"]) ${csAllMatches ? 'MATCHES' : 'does NOT match'}`);

  // Test 2: Does ov(["4JH57"]) match?
  console.log('  Query B: applies_to_models ov {"4JH57"}...');
  const { data: ovModel, error: ovModelErr } = await supabase
    .from('troubleshooting')
    .select('id, applies_to_models')
    .overlaps('applies_to_models', ['4JH57'])
    .eq('id', inserted.id);

  const ovModelMatches = !ovModelErr && ovModel?.length > 0;
  console.log(`    ${ovModelMatches ? '✓' : '✗'} ov(["4JH57"]) ${ovModelMatches ? 'MATCHES' : 'does NOT match'}`);

  // Test 3: Does ov(["all"]) match?
  console.log('  Query C: applies_to_models ov {"all"}...');
  const { data: ovAll, error: ovAllErr } = await supabase
    .from('troubleshooting')
    .select('id, applies_to_models')
    .overlaps('applies_to_models', ['all'])
    .eq('id', inserted.id);

  const ovAllMatches = !ovAllErr && ovAll?.length > 0;
  console.log(`    ${ovAllMatches ? '✓' : '✗'} ov(["all"]) ${ovAllMatches ? 'MATCHES' : 'does NOT match'}`);

  console.log('\n  📊 SUMMARY:');
  console.log(`    Mixed array ["all", "4JH57"] is matched by:`);
  console.log(`      - cs(["all"]):    ${csAllMatches ? 'YES' : 'NO'}`);
  console.log(`      - ov(["4JH57"]):  ${ovModelMatches ? 'YES' : 'NO'}`);
  console.log(`      - ov(["all"]):    ${ovAllMatches ? 'YES' : 'NO'}`);

  if (csAllMatches && ovModelMatches) {
    console.log('\n  ⚠️  IMPLICATION: Mixed arrays will appear in BOTH universal AND model-specific queries.');
    console.log('     Consider: insert-time enforcement to prevent ["all", "specific"] combinations.');
  }

  return true;
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('🔬 DIP Schema Assumption Tests');
  console.log('================================');
  console.log(`Supabase URL: ${SUPABASE_URL.split('//')[1]?.split('.')[0]}...`);

  const docId = await setupTestDoc();
  if (!docId) {
    console.error('❌ Could not get/create test doc_id. Aborting.');
    process.exit(1);
  }

  const results = {
    test1: false,
    test2: false,
    test3: false,
    test4: false
  };

  try {
    results.test1 = await test1_BatchAtomicity(docId);
    results.test2 = await test2_AllSentinelContains(docId);
    results.test3 = await test3_MigrationAStatus();
    results.test4 = await test4_AllExclusivity(docId);
  } finally {
    await cleanup(docId);
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Test 1 (Batch Atomicity):    ${results.test1 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Test 2 (["all"] sentinel):   ${results.test2 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Test 3 (Migration A):        ${results.test3 ? '✅ APPLIED' : '⚠️  NEEDED'}`);
  console.log(`  Test 4 (["all"] exclusivity): ${results.test4 ? '✅ DOCUMENTED' : '❌ FAIL'}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
