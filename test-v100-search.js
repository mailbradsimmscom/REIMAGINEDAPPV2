// Test V100 search in systems table
import { searchSystems } from './src/repositories/systems.repository.js';

console.log('🔍 Testing V100 search...\n');

const tests = [
  'V100',
  'v100',
  'VHF V100',
  'Standard Horizon V100'
];

for (const query of tests) {
  console.log(`Query: "${query}"`);
  const results = await searchSystems(query, { limit: 10 });
  console.log(`  Found: ${results.length} systems`);
  if (results.length > 0) {
    results.forEach(r => {
      console.log(`    - ${r.manufacturer} ${r.model} (${r.description || 'no desc'})`);
    });
  }
  console.log('');
}

process.exit(0);
