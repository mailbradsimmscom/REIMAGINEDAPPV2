#!/usr/bin/env node

import { ingestDipOutputsToDb } from './src/services/dip.ingest.service.js';

async function testDipIngest() {
  try {
    const docId = '90d444545130375e9f3b430e12c352cb8fa18db493d6f9774b05e337c2093bae';
    
    console.log(`🧪 Testing DIP ingestion for document: ${docId}`);
    console.log('📁 Available JSON files in DIP folder:');
    console.log('  - spec_suggestions_an.json');
    console.log('  - golden_rules_an.json');
    console.log('  - intent_router_an.json');
    console.log('  - playbook_hints_an.json');
    
    // System metadata for the CZone Touch 7
    const systemMetadata = {
      manufacturer_norm: 'czone',
      model_norm: 'touch_7',
      asset_uid: null,
      system_norm: null,
      subsystem_norm: null
    };
    
    console.log('\n🚀 Starting DIP ingestion...');
    
    const result = await ingestDipOutputsToDb({
      docId,
      systemMetadata
    });
    
    console.log('\n✅ DIP ingestion completed successfully!');
    console.log('📊 Results:');
    console.log(`  - Spec Suggestions: ${result.inserted.spec_suggestions} records`);
    console.log(`  - Playbook Hints: ${result.inserted.playbook_hints} records`);
    console.log(`  - Intent Router: ${result.inserted.intent_router} records`);
    console.log(`  - Golden Tests: ${result.inserted.golden_tests} records`);
    
    const totalRecords = Object.values(result.inserted).reduce((sum, count) => sum + count, 0);
    console.log(`\n🎯 Total records inserted: ${totalRecords}`);
    
  } catch (error) {
    console.error('❌ DIP ingestion failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

testDipIngest();
