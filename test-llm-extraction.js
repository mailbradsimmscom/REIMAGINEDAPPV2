#!/usr/bin/env node
/**
 * Test LLM extraction to see why "grill" returns 0 equipment
 */

import { extractEquipmentName } from './src/services/equipment-extraction.service.js';

console.log('🤖 Testing LLM Equipment Extraction\n');
console.log('='.repeat(80));

const testQueries = [
  'have a question about my grill',
  'tell me about my grill',
  'my grill is not working',
  'grill',
  'BBQ grill',
  'marine grill',
  'Kenyon grill',
  'question about the Marco pump'  // Known to work
];

for (const query of testQueries) {
  console.log(`\n📝 Query: "${query}"`);
  console.log('-'.repeat(80));

  try {
    const result = await extractEquipmentName(query);

    if (result.equipment && result.equipment.length > 0) {
      console.log(`✅ Extracted ${result.equipment.length} equipment:`);
      for (const eq of result.equipment) {
        console.log(`   - ${eq.name} (confidence: ${eq.confidence}, role: ${eq.role})`);
      }
    } else {
      console.log(`❌ No equipment extracted (returned empty array)`);
    }
  } catch (err) {
    console.log(`❌ ERROR: ${err.message}`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('✅ Test complete\n');
