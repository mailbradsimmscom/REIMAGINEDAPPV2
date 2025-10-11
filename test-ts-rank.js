// Test ts_rank() values for different queries
import { createClient } from '@supabase/supabase-js';
import { getEnv } from './src/config/env.js';

const env = getEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log('🔍 Testing ts_rank() values for different search queries\n');

const testQueries = [
  'harken winches',
  'harken',
  'winches',
  'fortress anchor',
  'anchor',
  'gps',
  'simrad gps',
  'random text that wont match anything'
];

for (const query of testQueries) {
  console.log(`\n📊 Query: "${query}"`);
  console.log('─'.repeat(60));

  const { data, error } = await supabase.rpc('search_systems', {
    q: query,
    top_n: 5
  });

  if (error) {
    console.error(`   ❌ Error: ${error.message}`);
    continue;
  }

  if (!data || data.length === 0) {
    console.log('   ⚠️  No results found');
    continue;
  }

  // Get full system details for the results
  const assetUids = data.map(r => r.asset_uid);
  const { data: systems, error: sysError } = await supabase
    .from('systems')
    .select('asset_uid, manufacturer_norm, model_norm, description')
    .in('asset_uid', assetUids);

  if (sysError) {
    console.error(`   ❌ Error fetching systems: ${sysError.message}`);
    continue;
  }

  // Merge rank with system details
  const results = data.map(result => {
    const system = systems.find(s => s.asset_uid === result.asset_uid);
    return {
      ...result,
      ...system
    };
  });

  console.log(`   Found ${results.length} results:\n`);

  results.forEach((r, i) => {
    console.log(`   ${i+1}. ${r.manufacturer_norm} ${r.model_norm}`);
    console.log(`      rank: ${r.rank.toFixed(6)}`);
    console.log(`      Ownership Display: ${getOwnershipLabel(r.rank)}`);
    console.log('');
  });
}

function getOwnershipLabel(rank) {
  if (rank >= 0.90) return '✅ CONFIRMED (rank >= 0.90)';
  if (rank >= 0.70) return '⚠️  LIKELY (rank >= 0.70)';
  return '❌ POSSIBLE (rank < 0.70)';
}

console.log('\n' + '='.repeat(60));
console.log('📚 ts_rank() Explanation:');
console.log('─'.repeat(60));
console.log('ts_rank() calculates relevance by comparing:');
console.log('  • Query terms: "harken winches"');
console.log('  • System fields: manufacturer, model, system, subsystem, keywords, description');
console.log('');
console.log('Higher rank = better match = more confident ownership');
console.log('  • 0.90-1.0  = Excellent match → "CONFIRMED"');
console.log('  • 0.70-0.89 = Good match → "LIKELY"');
console.log('  • 0.0-0.69  = Poor match → "POSSIBLE"');
console.log('='.repeat(60));

process.exit(0);
