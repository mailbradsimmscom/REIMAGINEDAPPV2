/**
 * Check current supplies table schema and units
 */

import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

async function main() {
  console.log('📊 Checking supplies schema and data...\n');

  const supabase = await getSupabaseClient();

  // Get current units
  console.log('🔍 Current supply_units:');
  const { data: units, error: unitsError } = await supabase
    .from('supply_units')
    .select('*')
    .order('unit_name');

  if (unitsError) {
    console.error('❌ Error fetching units:', unitsError);
  } else {
    console.log(`   Found ${units.length} units:`);
    units.forEach(u => console.log(`   - ${u.unit_name} (${u.abbreviation})`));
  }

  // Count supplies
  console.log('\n🔍 Current supplies count:');
  const { count, error: countError } = await supabase
    .from('supplies')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('❌ Error counting supplies:', countError);
  } else {
    console.log(`   Total supplies: ${count}`);
  }

  // Check for item_type column
  console.log('\n🔍 Checking for item_type column:');
  const { data: sample, error: sampleError } = await supabase
    .from('supplies')
    .select('*')
    .limit(1);

  if (sampleError) {
    console.error('❌ Error fetching sample:', sampleError);
  } else {
    const hasItemType = sample[0] && 'item_type' in sample[0];
    console.log(`   item_type column exists: ${hasItemType ? '✅ YES' : '❌ NO'}`);

    if (sample[0]) {
      console.log(`\n📋 Current schema columns (${Object.keys(sample[0]).length}):`);
      Object.keys(sample[0]).sort().forEach(col => {
        console.log(`   - ${col}`);
      });
    }
  }
}

main().catch(console.error);
