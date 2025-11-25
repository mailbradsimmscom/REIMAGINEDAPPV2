/**
 * Database Migration: Add item_type column to supplies table
 *
 * This migration adds support for differentiating between:
 * - Supplies: Consumables that need reordering
 * - Tools: Reusable equipment
 * - Items: Assets to track
 */

import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

async function main() {
  console.log('🚀 Starting supplies table migration...\n');

  const supabase = await getSupabaseClient();

  try {
    // Step 1: Add item_type column
    console.log('📝 Step 1: Adding item_type column...');

    const { error: addColumnError } = await supabase.rpc('exec_sql', {
      sql: `
        -- Add item_type column with default 'supply'
        ALTER TABLE supplies
        ADD COLUMN IF NOT EXISTS item_type VARCHAR(10) DEFAULT 'supply';
      `
    });

    if (addColumnError) {
      console.error('❌ Error adding column:', addColumnError);
      throw addColumnError;
    }

    console.log('   ✅ item_type column added');

    // Step 2: Add constraint
    console.log('\n📝 Step 2: Adding check constraint...');

    const { error: constraintError } = await supabase.rpc('exec_sql', {
      sql: `
        -- Add constraint to ensure valid item types
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'supplies_item_type_check'
          ) THEN
            ALTER TABLE supplies
            ADD CONSTRAINT supplies_item_type_check
            CHECK (item_type IN ('supply', 'tool', 'item'));
          END IF;
        END $$;
      `
    });

    if (constraintError) {
      console.error('❌ Error adding constraint:', constraintError);
      throw constraintError;
    }

    console.log('   ✅ Check constraint added');

    // Step 3: Verify migration
    console.log('\n📝 Step 3: Verifying migration...');

    const { data: sample, error: verifyError } = await supabase
      .from('supplies')
      .select('id, item_name, item_type')
      .limit(3);

    if (verifyError) {
      console.error('❌ Error verifying migration:', verifyError);
      throw verifyError;
    }

    console.log('   ✅ Migration verified');
    console.log(`   Sample rows (item_type defaults to 'supply'):`);
    sample.forEach(row => {
      console.log(`   - ${row.item_name}: ${row.item_type}`);
    });

    console.log('\n🎉 Migration completed successfully!\n');
    console.log('Summary:');
    console.log('  ✅ Added item_type column (VARCHAR(10), default "supply")');
    console.log('  ✅ Added check constraint (supply, tool, item)');
    console.log('  ✅ All existing rows defaulted to "supply"');
    console.log('\nNext steps:');
    console.log('  1. Delete existing test data');
    console.log('  2. Import cleaned CSV with proper item_type values');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

main();
