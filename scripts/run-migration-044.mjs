#!/usr/bin/env node
/**
 * Run migration 044: Add user_selected to document_referenced_systems
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function runMigration() {
  console.log('Running migration 044...\n');

  // Step 1: Add column
  console.log('1) Adding user_selected column...');
  const { error: e1 } = await supabase.rpc('exec_sql', {
    sql: `ALTER TABLE document_referenced_systems ADD COLUMN IF NOT EXISTS user_selected BOOLEAN DEFAULT false`
  });
  // If rpc doesn't exist, we'll check column directly

  // Verify column exists by querying
  const { data: check, error: checkErr } = await supabase
    .from('document_referenced_systems')
    .select('user_selected')
    .limit(0);

  if (checkErr && checkErr.message.includes('user_selected')) {
    console.log('   Column does not exist - need to run SQL manually');
    console.log('   Run this in Supabase SQL Editor:');
    console.log('   ALTER TABLE document_referenced_systems ADD COLUMN IF NOT EXISTS user_selected BOOLEAN DEFAULT false;');
    return;
  }

  console.log('   ✅ Column exists');

  // Step 2: Update existing rows
  console.log('\n2) Marking existing rows as user_selected=true...');
  const { data: updated, error: e2 } = await supabase
    .from('document_referenced_systems')
    .update({ user_selected: true })
    .is('user_selected', null)
    .select('canonical_model');

  if (e2) {
    // Try updating where user_selected = false
    const { data: updated2, error: e2b } = await supabase
      .from('document_referenced_systems')
      .update({ user_selected: true })
      .eq('user_selected', false)
      .select('canonical_model');

    console.log('   Updated ' + (updated2?.length || 0) + ' rows');
  } else {
    console.log('   Updated ' + (updated?.length || 0) + ' rows');
  }

  // Step 3: Verify
  console.log('\n3) Verification...');
  const { data: rows, error: e3 } = await supabase
    .from('document_referenced_systems')
    .select('doc_id, canonical_model, user_selected');

  if (e3) {
    console.log('   Query error: ' + e3.message);
  } else {
    console.log('   Total rows: ' + rows.length);
    console.log('   user_selected=true: ' + rows.filter(r => r.user_selected === true).length);
    console.log('   user_selected=false: ' + rows.filter(r => r.user_selected === false).length);
    console.log('   user_selected=null: ' + rows.filter(r => r.user_selected === null).length);
  }

  console.log('\n✅ Migration 044 complete');
}

runMigration().catch(console.error);
