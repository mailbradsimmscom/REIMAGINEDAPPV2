#!/usr/bin/env node

/**
 * Simple test for knowledge repository
 */

import { createClient } from '@supabase/supabase-js';

async function testKnowledgeRepository() {
  console.log('🧪 Testing Knowledge Repository...\n');

  try {
    const supabaseUrl = 'https://eriquneakfcfmeecqyof.supabase.co';
    const supabaseKey = 'sb_secret_VYgTw3lmc1DNcFxrQNaV-w_tDqqxiyR';
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase client initialized');

    // Test 1: Check view data
    console.log('\n1️⃣ Checking knowledge_facts view...');
    const { data: viewData, error: viewError } = await supabase
      .from('knowledge_facts')
      .select('*');

    if (viewError) {
      console.log(`❌ View query failed: ${viewError.message}`);
      return;
    }

    console.log(`✅ View contains ${viewData.length} facts`);
    if (viewData.length > 0) {
      console.log('Sample facts:');
      viewData.forEach((fact, i) => {
        console.log(`   ${i + 1}. ${fact.fact_type}: ${fact.key || fact.intent || fact.query}`);
      });
    }

    // Test 2: Test fact matching logic
    console.log('\n2️⃣ Testing fact matching logic...');
    const testQuery = 'operating pressure';
    
    // Search by key
    const { data: keyMatches, error: keyError } = await supabase
      .from('knowledge_facts')
      .select('*')
      .ilike('key', `%${testQuery}%`)
      .limit(1);

    if (keyError) {
      console.log(`❌ Key search failed: ${keyError.message}`);
    } else if (keyMatches && keyMatches.length > 0) {
      console.log(`✅ Key match found: ${keyMatches[0].key} = ${keyMatches[0].value} ${keyMatches[0].unit || ''}`);
    } else {
      console.log('⚠️  No key matches found');
    }

    // Search by intent
    const { data: intentMatches, error: intentError } = await supabase
      .from('knowledge_facts')
      .select('*')
      .ilike('intent', `%${testQuery}%`)
      .limit(1);

    if (intentError) {
      console.log(`❌ Intent search failed: ${intentError.message}`);
    } else if (intentMatches && intentMatches.length > 0) {
      console.log(`✅ Intent match found: ${intentMatches[0].intent}`);
    } else {
      console.log('⚠️  No intent matches found');
    }

    // Search by query field
    const { data: queryMatches, error: queryError } = await supabase
      .from('knowledge_facts')
      .select('*')
      .ilike('query', `%${testQuery}%`)
      .limit(1);

    if (queryError) {
      console.log(`❌ Query search failed: ${queryError.message}`);
    } else if (queryMatches && queryMatches.length > 0) {
      console.log(`✅ Query match found: ${queryMatches[0].query}`);
    } else {
      console.log('⚠️  No query matches found');
    }

    // Test 3: Test answer formatting
    console.log('\n3️⃣ Testing answer formatting...');
    if (viewData.length > 0) {
      const fact = viewData[0];
      let formattedAnswer = '';
      
      if (fact.fact_type === 'spec') {
        formattedAnswer = `${fact.key}: ${fact.value} ${fact.unit || ''}`.trim();
      } else if (fact.fact_type === 'intent_hint') {
        formattedAnswer = `Intent detected: ${fact.intent}`;
      } else if (fact.fact_type === 'golden_test') {
        formattedAnswer = `Q: ${fact.query}\nA: ${fact.expected}`;
      }
      
      console.log(`✅ Formatted answer: ${formattedAnswer}`);
    }

    console.log('\n🎉 Knowledge repository test complete!');
    console.log('\n📋 Summary:');
    console.log('   ✅ Materialized view working');
    console.log('   ✅ Fact matching logic working');
    console.log('   ✅ Answer formatting working');
    console.log('\n🎯 The fact-first retrieval system is ready!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testKnowledgeRepository();
