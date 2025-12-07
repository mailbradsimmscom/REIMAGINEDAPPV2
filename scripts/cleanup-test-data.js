#!/usr/bin/env node

/**
 * Cleanup test data from Supabase.
 * Removes all rows with test_ prefix from specified tables.
 *
 * Usage: node scripts/cleanup-test-data.js
 */

import { createClient } from '@supabase/supabase-js';

/**
 * Tables that may contain test data
 */
const TEST_TABLES = [
  { table: 'chat_threads', column: 'id' },
  { table: 'chat_messages', column: 'thread_id' },
  { table: 'chat_sessions', column: 'id' },
];

async function cleanupTestData() {
  console.log('Cleaning up test data...\n');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let totalDeleted = 0;

  for (const { table, column } of TEST_TABLES) {
    try {
      // First count how many rows match
      const { count, error: countError } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .like(column, 'test_%');

      if (countError) {
        console.log(`  ${table}: Error counting - ${countError.message}`);
        continue;
      }

      if (count === 0) {
        console.log(`  ${table}: No test data found`);
        continue;
      }

      // Delete matching rows
      const { error: deleteError } = await supabase
        .from(table)
        .delete()
        .like(column, 'test_%');

      if (deleteError) {
        console.log(`  ${table}: Error deleting - ${deleteError.message}`);
        continue;
      }

      console.log(`  ${table}: Deleted ${count} rows`);
      totalDeleted += count;
    } catch (err) {
      console.log(`  ${table}: Error - ${err.message}`);
    }
  }

  console.log(`\nTotal deleted: ${totalDeleted} rows`);
  return totalDeleted;
}

// Run if called directly
cleanupTestData()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  });
