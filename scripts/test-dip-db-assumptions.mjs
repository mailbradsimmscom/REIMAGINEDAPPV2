#!/usr/bin/env node
/**
 * Test DB assumptions for DIP integration plan
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://eriquneakfcfmeecqyof.supabase.co',
  'sb_secret_VYgTw3lmc1DNcFxrQNaV-w_tDqqxiyR'
);

const docId = '0409b82f230dae2b3550a1ffc3c60b10ba1b364120fbc85358b8bee7a012cdaa';

console.log('=== DB ASSUMPTION TESTS ===\n');

// Test 1: Does troubleshooting.applies_to_models exist? (migration 040)
console.log('1) Migration 040: applies_to_models on troubleshooting');
try {
  const { data, error } = await supabase
    .from('troubleshooting')
    .select('applies_to_models')
    .limit(0);
  console.log(error ? '   ❌ Column missing: ' + error.message : '   ✅ Column exists');
} catch (e) {
  console.log('   ❌ Error: ' + e.message);
}

// Test 2: Does troubleshooting.possible_causes exist? (migration 042)
console.log('\n2) Migration 042: possible_causes JSONB on troubleshooting');
try {
  const { data, error } = await supabase
    .from('troubleshooting')
    .select('possible_causes')
    .limit(0);
  console.log(error ? '   ❌ Column missing: ' + error.message : '   ✅ Column exists');
} catch (e) {
  console.log('   ❌ Error: ' + e.message);
}

// Test 3: applies_to_models on other DIP tables
console.log('\n3) Migration 040: applies_to_models on other DIP tables');
const tables = ['spec_suggestions', 'playbook_hints', 'golden_tests', 'intent_router'];
for (const table of tables) {
  try {
    const { data, error } = await supabase
      .from(table)
      .select('applies_to_models')
      .limit(0);
    console.log('   ' + table + ': ' + (error ? '❌ Missing: ' + error.message : '✅ Exists'));
  } catch (e) {
    console.log('   ' + table + ': ❌ Error');
  }
}

// Test 4: document_referenced_systems for test doc
console.log('\n4) document_referenced_systems for test doc');
const { data: refs, error: refErr } = await supabase
  .from('document_referenced_systems')
  .select('canonical_model, source')
  .eq('doc_id', docId);
if (refErr) {
  console.log('   ❌ Query error: ' + refErr.message);
} else if (refs === null || refs.length === 0) {
  console.log('   ⚠️  No detected references for this doc (exclude list will be empty)');
} else {
  console.log('   ✅ Found ' + refs.length + ' references:');
  refs.forEach(r => console.log('      - ' + r.canonical_model + ' (source: ' + r.source + ')'));
}

// Test 5: LlamaParse artifact exists in storage
console.log('\n5) LlamaParse artifact in storage');
try {
  const { data, error } = await supabase.storage
    .from('documents')
    .download('manuals/' + docId + '/llamaparse_raw.json');
  if (error) {
    console.log('   ❌ Not found: ' + error.message);
  } else {
    const text = await data.text();
    const parsed = JSON.parse(text);
    console.log('   ✅ Exists, ' + (parsed.pages?.length || 0) + ' pages');
  }
} catch (e) {
  console.log('   ❌ Error: ' + e.message);
}

// Test 6: Current row counts in DIP tables (global, not just test doc)
console.log('\n6) Current DIP table row counts (global)');
const dipTables = ['troubleshooting', 'spec_suggestions', 'playbook_hints', 'golden_tests', 'intent_router', 'system_relationships'];
for (const table of dipTables) {
  try {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    console.log('   ' + table + ': ' + (error ? '❌ ' + error.message : (count || 0) + ' rows'));
  } catch (e) {
    console.log('   ' + table + ': ❌ Error');
  }
}

// Test 7: Check documents.models_covered for test doc
console.log('\n7) documents.models_covered for test doc');
const { data: doc, error: docErr } = await supabase
  .from('documents')
  .select('models_covered, is_multi_model')
  .eq('doc_id', docId)
  .single();
if (docErr) {
  console.log('   ❌ Query error: ' + docErr.message);
} else if (doc.models_covered === null || doc.models_covered.length === 0) {
  console.log('   ⚠️  models_covered is empty (DIP will fail MODELS_COVERED_MISSING)');
} else {
  console.log('   ✅ models_covered: ' + JSON.stringify(doc.models_covered));
  console.log('   is_multi_model: ' + doc.is_multi_model);
}

console.log('\n=== END TESTS ===');
