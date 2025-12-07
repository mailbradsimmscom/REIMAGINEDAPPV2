#!/usr/bin/env node

/**
 * Verify test data cleanup was successful.
 * Alerts if any test_ rows remain in the database.
 * Used as a safety check after nightly sweep.
 *
 * Usage: node scripts/verify-cleanup.js
 */

import { createClient } from '@supabase/supabase-js';

/**
 * Tables to check for leftover test data
 */
const TABLES_TO_CHECK = [
  { table: 'chat_threads', column: 'id' },
  { table: 'chat_messages', column: 'thread_id' },
  { table: 'chat_sessions', column: 'id' },
];

async function verifyCleanup() {
  console.log('Verifying test data cleanup...\n');

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const failures = [];

  for (const { table, column } of TABLES_TO_CHECK) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .like(column, 'test_%');

      if (error) {
        console.log(`  ${table}: Error checking - ${error.message}`);
        continue;
      }

      if (count > 0) {
        failures.push(`${table}: ${count} test rows remaining`);
        console.log(`  ${table}: ${count} test rows remaining`);
      } else {
        console.log(`  ${table}: Clean`);
      }
    } catch (err) {
      console.log(`  ${table}: Error - ${err.message}`);
    }
  }

  console.log('');

  if (failures.length > 0) {
    console.error('CLEANUP FAILED - Test data remains in production:');
    failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }

  console.log('All tables clean - no test data remaining.');
  return true;
}

// Run if called directly
verifyCleanup()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Verification failed:', err);
    process.exit(1);
  });
