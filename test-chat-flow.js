#!/usr/bin/env node
/**
 * Test to simulate the exact chat flow for "grill" query
 * This will show us which code path is taken and why equipment search fails
 */

import { searchSystems } from './src/repositories/systems.repository.js';
import { extractEquipmentName } from './src/services/equipment-extraction.service.js';
import { quickReferenceCheck } from './src/services/equipment-relationship-inference.service.js';

console.log('🧪 Simulating Chat Flow for "have a question about my grill"\n');
console.log('='.repeat(80));

const query = 'have a question about my grill';
const conversationContext = {
  message_summary: [],
  equipment_discussed: []
};

// Step 1: Quick reference check (line 73-77 in chat-proxy.service.js)
console.log('\n📋 STEP 1: Quick Reference Check');
console.log('-'.repeat(80));

const quickCheck = quickReferenceCheck(query, conversationContext);
console.log(`Result: ${JSON.stringify(quickCheck, null, 2)}`);

if (quickCheck.hasReference) {
  console.log('✅ Quick reference found - would use existing equipment context');
  console.log('   (This path skips new equipment search)');
} else {
  console.log('❌ No quick reference - needs new equipment search');

  // Step 2: Extract keywords (line 182 in chat-proxy.service.js)
  console.log('\n📋 STEP 2: Extract Keywords');
  console.log('-'.repeat(80));

  const stopWords = new Set(['tell', 'me', 'about', 'my', 'the', 'a', 'an', 'is', 'are', 'what', 'how', 'when', 'where', 'why', 'which', 'who', 'can', 'could', 'would', 'should', 'will', 'do', 'does', 'did', 'has', 'have', 'had', 'be', 'been', 'being', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'from', 'by', 'it', 'its', 'this', 'that', 'these', 'those']);

  const words = query.toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !stopWords.has(w));

  const searchQuery = words.join(' ');

  console.log(`Original query: "${query}"`);
  console.log(`Keywords extracted: "${searchQuery}"`);
  console.log(`Words kept: ${JSON.stringify(words)}`);

  // Step 3: Parallel search (keyword + LLM)
  console.log('\n📋 STEP 3: Parallel Search (Keyword + LLM)');
  console.log('-'.repeat(80));

  console.log('\n🔎 Path 1: Keyword Search');
  console.log(`   Searching for: "${searchQuery}"`);

  try {
    const keywordResults = await searchSystems(searchQuery, { limit: 10 });
    console.log(`   ✅ Keyword search returned ${keywordResults.length} results`);

    if (keywordResults.length > 0) {
      for (const result of keywordResults) {
        console.log(`      - ${result.manufacturer_norm} ${result.model_norm} (rank: ${result.rank || 'N/A'})`);
      }
    }
  } catch (err) {
    console.log(`   ❌ Keyword search ERROR: ${err.message}`);
  }

  console.log('\n🤖 Path 2: LLM Equipment Extraction');
  console.log(`   Extracting equipment from: "${query}"`);

  try {
    const extraction = await extractEquipmentName(query);
    console.log(`   ✅ LLM extracted ${extraction.equipment?.length || 0} equipment`);

    if (extraction.equipment && extraction.equipment.length > 0) {
      for (const eq of extraction.equipment) {
        console.log(`      - ${eq.name} (confidence: ${eq.confidence}, role: ${eq.role})`);

        // Search for each extracted equipment
        console.log(`      🔍 Searching systems for "${eq.name}"...`);
        const results = await searchSystems(eq.name, { limit: 10 });
        console.log(`         Found ${results.length} matches`);

        if (results.length > 0) {
          for (const r of results) {
            console.log(`            - ${r.manufacturer_norm} ${r.model_norm}`);
          }
        }
      }
    }
  } catch (err) {
    console.log(`   ❌ LLM extraction ERROR: ${err.message}`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('✅ Test complete\n');
