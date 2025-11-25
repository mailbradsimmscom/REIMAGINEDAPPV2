/**
 * Run Migration 002: Add item_type to supplies table
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getEnv } from '../src/config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATION_FILE = path.join(__dirname, '../migrations/002_add_item_type_to_supplies.sql');

async function main() {
  console.log('🚀 Running Migration 002: Add item_type to supplies table\n');

  const env = getEnv();
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.PY_SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
  }

  // Read SQL file
  console.log('📖 Reading migration file...');
  const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8');
  console.log(`   ✅ Loaded ${sql.split('\n').length} lines of SQL\n`);

  console.log('📝 Migration SQL:');
  console.log('---');
  console.log(sql);
  console.log('---\n');

  // Execute via Supabase REST API
  console.log('⚙️  Executing migration...\n');

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ query: sql })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Migration failed via REST API');
      console.error('   Response:', error);
      console.log('\n⚠️  FALLBACK: Please run the SQL manually:\n');
      console.log('   1. Go to Supabase Dashboard > SQL Editor');
      console.log(`   2. Paste the contents of: ${MIGRATION_FILE}`);
      console.log('   3. Click "Run"\n');
      process.exit(1);
    }

    console.log('✅ Migration executed successfully via REST API!\n');

    // Verify migration
    console.log('🔍 Verifying migration...');
    const verifyResponse = await fetch(`${supabaseUrl}/rest/v1/supplies?select=id,item_name,item_type&limit=3`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });

    if (verifyResponse.ok) {
      const samples = await verifyResponse.json();
      console.log(`   ✅ Verified! Sample rows:`);
      samples.forEach(row => {
        console.log(`   - ${row.item_name}: item_type="${row.item_type}"`);
      });
    }

    console.log('\n🎉 Migration completed successfully!\n');
    console.log('Summary:');
    console.log('  ✅ Added item_type column (VARCHAR(10), default "supply")');
    console.log('  ✅ Added check constraint (supply, tool, item)');
    console.log('  ✅ Added index on item_type');
    console.log('  ✅ All existing rows defaulted to "supply"\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\n⚠️  FALLBACK: Please run the SQL manually:\n');
    console.log('   1. Go to Supabase Dashboard > SQL Editor');
    console.log(`   2. Paste the contents of: ${MIGRATION_FILE}`);
    console.log('   3. Click "Run"\n');
    process.exit(1);
  }
}

main();
