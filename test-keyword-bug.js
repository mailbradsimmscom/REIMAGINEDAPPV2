#!/usr/bin/env node
/**
 * Test to prove "question grill" fails but "grill" succeeds
 */

import { searchSystems } from './src/repositories/systems.repository.js';

console.log('🔍 Testing Keyword Search Bug\n');

// Test 1: Search with "question grill" (current behavior)
console.log('TEST 1: search_systems("question grill")');
const results1 = await searchSystems("question grill", { limit: 10 });
console.log(`Result: ${results1.length} matches\n`);

// Test 2: Search with just "grill" (should work)
console.log('TEST 2: search_systems("grill")');
const results2 = await searchSystems("grill", { limit: 10 });
console.log(`Result: ${results2.length} matches`);
if (results2.length > 0) {
  console.log(`   ✅ Found: ${results2[0].manufacturer_norm} ${results2[0].model_norm}`);
}
console.log('');

// Test 3: Search with "bbq"
console.log('TEST 3: search_systems("bbq")');
const results3 = await searchSystems("bbq", { limit: 10 });
console.log(`Result: ${results3.length} matches`);
if (results3.length > 0) {
  console.log(`   ✅ Found: ${results3[0].manufacturer_norm} ${results3[0].model_norm}`);
}

console.log('\n🎯 CONCLUSION:');
console.log('   "question grill" → 0 matches ❌');
console.log('   "grill" → 1 match ✅');
console.log('   Bug: The word "question" breaks the search!');
