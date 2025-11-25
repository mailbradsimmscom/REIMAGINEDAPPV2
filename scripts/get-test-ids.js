// Quick script to get category and unit IDs for testing
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

async function getTestIds() {
  const supabase = await getSupabaseClient();

  // Get a category ID (General Plumbing)
  const { data: categories, error: catError } = await supabase
    .from('supply_categories')
    .select('id, category_name, category_path')
    .eq('category_name', 'General Plumbing')
    .single();

  if (catError) {
    console.error('Error getting category:', catError.message);
  } else {
    console.log('\n✅ CATEGORY ID (General Plumbing):');
    console.log('   ID:', categories.id);
    console.log('   Path:', categories.category_path);
  }

  // Get a unit ID (piece)
  const { data: units, error: unitError } = await supabase
    .from('supply_units')
    .select('id, unit_name, abbreviation')
    .eq('unit_name', 'piece')
    .single();

  if (unitError) {
    console.error('Error getting unit:', unitError.message);
  } else {
    console.log('\n✅ UNIT ID (piece):');
    console.log('   ID:', units.id);
    console.log('   Abbreviation:', units.abbreviation);
  }

  // Show all categories for reference
  const { data: allCategories } = await supabase
    .from('supply_categories')
    .select('id, category_name, level')
    .order('category_path');

  console.log('\n📋 All Categories Available:');
  allCategories?.forEach(cat => {
    console.log(`   ${' '.repeat(cat.level * 2)}${cat.category_name}`);
  });

  // Show all units for reference
  const { data: allUnits } = await supabase
    .from('supply_units')
    .select('id, unit_name, abbreviation, unit_type')
    .order('unit_type, display_order');

  console.log('\n📋 All Units Available:');
  let currentType = '';
  allUnits?.forEach(unit => {
    if (unit.unit_type !== currentType) {
      currentType = unit.unit_type;
      console.log(`\n   ${currentType.toUpperCase()}:`);
    }
    console.log(`     ${unit.unit_name} (${unit.abbreviation})`);
  });

  console.log('\n✅ Copy the IDs above for testing!\n');
}

getTestIds().catch(console.error);
