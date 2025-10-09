import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function addColloquialColumn() {
  try {
    console.log('Adding colloquial_keywords column to systems table...');

    // First, check if the column already exists
    const { data: columns, error: checkError } = await supabase.rpc('get_column_info', {
      table_name: 'systems',
      column_name: 'colloquial_keywords'
    }).maybeSingle();

    if (columns) {
      console.log('Column colloquial_keywords already exists in systems table');
      return;
    }

    // Since we can't run ALTER TABLE directly through Supabase JS client,
    // we need to use the SQL editor in Supabase dashboard or create a migration
    console.log('\nPlease execute the following SQL in your Supabase SQL Editor:');
    console.log('=' * 60);
    console.log(`
ALTER TABLE systems
ADD COLUMN IF NOT EXISTS colloquial_keywords text;

COMMENT ON COLUMN systems.colloquial_keywords IS
'Colloquial terms extracted from manuals that users might use to refer to this equipment';
    `);
    console.log('=' * 60);

    // Let's test if we can at least query the systems table
    const { data, error } = await supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, canonical_model_id')
      .limit(1);

    if (error) {
      console.error('Error accessing systems table:', error);
    } else {
      console.log('\n✅ Successfully connected to Supabase');
      console.log('Sample record from systems table:', data[0]);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

addColloquialColumn();