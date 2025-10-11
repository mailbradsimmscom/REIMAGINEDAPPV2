import { searchSystems } from './src/repositories/systems.repository.js';

const testQuery = process.argv[2] || 'GPS';

console.log(`\n🔍 Testing keyword search with query: "${testQuery}"\n`);

try {
  const results = await searchSystems(testQuery, { limit: 10 });

  console.log(`✅ Found ${results.length} results:\n`);

  results.forEach((result, i) => {
    console.log(`${i + 1}. ${result.manufacturer_norm || 'Unknown'} ${result.model_norm || 'Unknown'}`);
    console.log(`   asset_uid: ${result.asset_uid}`);
    console.log(`   rank: ${result.rank}`);
    console.log(`   canonical_model_id: ${result.canonical_model_id || 'N/A'}`);
    console.log(`   system_norm: ${result.system_norm || 'N/A'}`);
    console.log(`   subsystem_norm: ${result.subsystem_norm || 'N/A'}`);
    console.log(`   description: ${result.description?.substring(0, 60) || 'N/A'}...\n`);
  });

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('Stack:', error.stack);
}

process.exit(0);
