import { extractEquipmentName } from './src/services/equipment-extraction.service.js';

const testQuery = process.argv[2] || 'tell me the models of harken winches I have?';

console.log(`\n🤖 Testing LLM extraction with query: "${testQuery}"\n`);

try {
  console.log('⏳ Calling LLM...\n');
  const result = await extractEquipmentName(testQuery);

  console.log('✅ LLM Response:\n');
  console.log(JSON.stringify(result, null, 2));

  if (result.equipment && result.equipment.length > 0) {
    console.log('\n📊 Extracted Equipment:');
    result.equipment.forEach((eq, i) => {
      console.log(`\n${i + 1}. Name: "${eq.name}"`);
      console.log(`   Confidence: ${eq.confidence}`);
      console.log(`   Role: ${eq.role || 'N/A'}`);
    });
  } else {
    console.log('\n❌ No equipment extracted');
  }

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('Stack:', error.stack);
}

process.exit(0);