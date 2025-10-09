// Debug V100 search response
import { searchSystems } from './src/repositories/systems.repository.js';

console.log('🔍 Testing V100 search with full data...\n');

const results = await searchSystems('V100', { limit: 10 });
console.log(`Found: ${results.length} systems\n`);
console.log('Full result data:');
console.log(JSON.stringify(results, null, 2));

process.exit(0);
