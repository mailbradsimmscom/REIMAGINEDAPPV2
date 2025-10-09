/**
 * Manual test script for colloquial keyword extraction
 * Runs extraction for a specific asset and updates the systems table
 */

import documentService from './src/services/document.service.js';

const assetUid = 'e4739797-4204-fe58-4abf-1867b0fd57ff';
const manufacturer = 'B&G';
const model = 'zeus_s_16_mfd';

console.log('='.repeat(80));
console.log('MANUAL COLLOQUIAL KEYWORD EXTRACTION');
console.log('='.repeat(80));
console.log(`Asset UID: ${assetUid}`);
console.log(`Manufacturer: ${manufacturer}`);
console.log(`Model: ${model}`);
console.log('='.repeat(80));

try {
  console.log('\n🔄 Starting colloquial keyword extraction...\n');

  await documentService.extractAndUpdateColloquialKeywords(
    assetUid,
    manufacturer,
    model
  );

  console.log('\n' + '='.repeat(80));
  console.log('✅ SUCCESS: Colloquial keywords extracted and updated');
  console.log('='.repeat(80));

  process.exit(0);
} catch (error) {
  console.error('\n' + '='.repeat(80));
  console.error('❌ FAILED:', error.message);
  console.error('='.repeat(80));
  console.error(error);
  process.exit(1);
}
