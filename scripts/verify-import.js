/**
 * Verify supplies import
 */

import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

async function main() {
  console.log('🔍 Verifying supplies import...\n');

  const supabase = await getSupabaseClient();

  // Get total count
  const { count: totalCount } = await supabase
    .from('supplies')
    .select('*', { count: 'exact', head: true });

  console.log(`📊 Total supplies: ${totalCount}\n`);

  // Get breakdown by type
  const { data: allSupplies, error } = await supabase
    .from('supplies')
    .select('item_type, is_critical');

  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  const typeBreakdown = {};
  let criticalCount = 0;

  allSupplies.forEach(item => {
    const type = item.item_type || 'unknown';
    typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;
    if (item.is_critical) criticalCount++;
  });

  console.log('📋 Breakdown by type:');
  Object.entries(typeBreakdown).forEach(([type, count]) => {
    const percentage = Math.round((count / totalCount) * 100);
    console.log(`   ${type}: ${count} (${percentage}%)`);
  });

  console.log(`\n⚠️  Critical items: ${criticalCount}\n`);

  // Sample a few of each type
  console.log('📦 Sample supplies:');
  const { data: supplies } = await supabase
    .from('supplies')
    .select('item_name, current_stock')
    .eq('item_type', 'supply')
    .limit(3);

  supplies?.forEach(s => console.log(`   - ${s.item_name} (qty: ${s.current_stock})`));

  console.log('\n🔧 Sample tools:');
  const { data: tools } = await supabase
    .from('supplies')
    .select('item_name, current_stock')
    .eq('item_type', 'tool')
    .limit(3);

  tools?.forEach(t => console.log(`   - ${t.item_name} (qty: ${t.current_stock})`));

  console.log('\n📦 Sample items:');
  const { data: items } = await supabase
    .from('supplies')
    .select('item_name, current_stock')
    .eq('item_type', 'item')
    .limit(3);

  items?.forEach(i => console.log(`   - ${i.item_name} (qty: ${i.current_stock})`));

  console.log('\n✅ Import verification complete!\n');
}

main();
