/**
 * Add item_type column to supplies table
 * Simplified approach - guides user to run SQL manually
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';
import { getEnv } from '../src/config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SQL_FILE = path.join(__dirname, '../migrations/002_add_item_type_to_supplies.sql');

async function checkIfMigrated() {
  const supabase = await getSupabaseClient();

  const { data, error } = await supabase
    .from('supplies')
    .select('id, item_name, item_type')
    .limit(1);

  if (error) {
    // Check if error is about missing column
    if (error.message && error.message.includes('item_type')) {
      return false;
    }
    throw error;
  }

  // If we got data and item_type exists, migration is done
  return data && data.length > 0 && 'item_type' in data[0];
}

async function main() {
  console.log('🔍 Checking if migration is needed...\n');

  try {
    const isMigrated = await checkIfMigrated();

    if (isMigrated) {
      console.log('✅ Migration already completed!');
      console.log('   item_type column exists in supplies table\n');

      // Show sample
      const supabase = await getSupabaseClient();
      const { data } = await supabase
        .from('supplies')
        .select('id, item_name, item_type')
        .limit(3);

      console.log('Sample rows:');
      data.forEach(row => {
        console.log(`  - ${row.item_name}: item_type="${row.item_type}"`);
      });
      return;
    }

    console.log('⚠️  Migration needed: item_type column not found\n');
    console.log('📋 Please run the following SQL in Supabase Dashboard:\n');
    console.log('-----------------------------------------------------------');
    console.log('1. Open: https://supabase.com/dashboard/project/eriquneakfcfmeecqyof/sql/new');
    console.log(`2. Copy the SQL from: ${SQL_FILE}`);
    console.log('3. Paste into SQL Editor');
    console.log('4. Click "Run"');
    console.log('5. Re-run this script to verify');
    console.log('-----------------------------------------------------------\n');

    // Also print the SQL
    const sql = fs.readFileSync(SQL_FILE, 'utf-8');
    console.log('Or copy/paste this SQL:\n');
    console.log(sql);
    console.log('\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
