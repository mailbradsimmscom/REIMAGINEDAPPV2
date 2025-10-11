// Test weighted rank scores for "harken winches" query
import { createClient } from '@supabase/supabase-js';
import { getEnv } from './src/config/env.js';

const env = getEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log('🔍 Testing Weighted Rank Scores');
console.log('Query: "harken winches"\n');
console.log('='.repeat(80));

const { data, error } = await supabase.rpc('search_systems', {
  q: 'harken winches',
  top_n: 10
});

if (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}

// Get full details
const assetUids = data.map(r => r.asset_uid);
const { data: systems } = await supabase
  .from('systems')
  .select('asset_uid, manufacturer_norm, model_norm, description')
  .in('asset_uid', assetUids);

const results = data.map(result => {
  const system = systems.find(s => s.asset_uid === result.asset_uid);
  return { ...result, ...system };
});

console.log(`\nFound ${results.length} results:\n`);

results.forEach((r, i) => {
  console.log(`${i+1}. ${r.manufacturer_norm} ${r.model_norm}`);
  console.log(`   rank: ${r.rank.toFixed(6)} ${getRankLabel(r.rank)}`);
  console.log(`   description: ${(r.description || '').substring(0, 60)}...`);
  console.log('');
});

console.log('='.repeat(80));
console.log('\n📊 Rank Distribution:');
console.log(`   0.90 - 1.00 (EXCELLENT):  ${results.filter(r => r.rank >= 0.90).length}`);
console.log(`   0.70 - 0.89 (GOOD):       ${results.filter(r => r.rank >= 0.70 && r.rank < 0.90).length}`);
console.log(`   0.50 - 0.69 (MODERATE):   ${results.filter(r => r.rank >= 0.50 && r.rank < 0.70).length}`);
console.log(`   0.00 - 0.49 (LOW):        ${results.filter(r => r.rank < 0.50).length}`);

console.log('\n📈 Score Comparison:');
console.log('   Highest: ' + results[0].rank.toFixed(6));
console.log('   Lowest:  ' + results[results.length - 1].rank.toFixed(6));
console.log('   Average: ' + (results.reduce((sum, r) => sum + r.rank, 0) / results.length).toFixed(6));

function getRankLabel(rank) {
  if (rank >= 0.90) return '⭐⭐⭐ EXCELLENT';
  if (rank >= 0.70) return '⭐⭐ GOOD';
  if (rank >= 0.50) return '⭐ MODERATE';
  return '· LOW';
}

process.exit(0);
