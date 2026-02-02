#!/usr/bin/env node

/**
 * Test the knowledge_facts materialized view
 */

import { createClient } from '@supabase/supabase-js';

async function testKnowledgeFactsView() {
  console.log('🧪 Testing knowledge_facts materialized view...\n');

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase client initialized');

    // Test 1: Check if materialized view exists
    console.log('\n1️⃣ Checking if knowledge_facts view exists...');
    const { data: viewData, error: viewError } = await supabase
      .from('knowledge_facts')
      .select('*')
      .limit(1);
    
    if (viewError) {
      console.log(`❌ knowledge_facts view error: ${viewError.message}`);
      return;
    }
    
    console.log('✅ knowledge_facts materialized view exists');

    // Test 2: Check view structure
    if (viewData && viewData.length > 0) {
      console.log('✅ View structure:', Object.keys(viewData[0]));
    } else {
      console.log('⚠️  View is empty (no approved data yet)');
    }

    // Test 3: Check all fact types
    console.log('\n2️⃣ Checking fact types in view...');
    const { data: factTypes, error: factTypesError } = await supabase
      .from('knowledge_facts')
      .select('fact_type')
      .not('fact_type', 'is', null);
    
    if (!factTypesError && factTypes) {
      const uniqueTypes = [...new Set(factTypes.map(f => f.fact_type))];
      console.log(`✅ Fact types found: ${uniqueTypes.join(', ')}`);
    }

    // Test 4: Test querying by key
    console.log('\n3️⃣ Testing query by key...');
    const { data: keyResults, error: keyError } = await supabase
      .from('knowledge_facts')
      .select('*')
      .not('key', 'is', null)
      .limit(3);
    
    if (!keyError && keyResults) {
      console.log(`✅ Found ${keyResults.length} facts with keys`);
      keyResults.forEach((fact, i) => {
        console.log(`   ${i + 1}. ${fact.key}: ${fact.value} ${fact.unit || ''}`);
      });
    }

    // Test 5: Test querying by intent
    console.log('\n4️⃣ Testing query by intent...');
    const { data: intentResults, error: intentError } = await supabase
      .from('knowledge_facts')
      .select('*')
      .not('intent', 'is', null)
      .limit(3);
    
    if (!intentError && intentResults) {
      console.log(`✅ Found ${intentResults.length} facts with intents`);
      intentResults.forEach((fact, i) => {
        console.log(`   ${i + 1}. Intent: ${fact.intent}`);
      });
    }

    // Test 6: Test querying by query (golden tests)
    console.log('\n5️⃣ Testing query by query field...');
    const { data: queryResults, error: queryError } = await supabase
      .from('knowledge_facts')
      .select('*')
      .not('query', 'is', null)
      .limit(3);
    
    if (!queryError && queryResults) {
      console.log(`✅ Found ${queryResults.length} golden tests`);
      queryResults.forEach((fact, i) => {
        console.log(`   ${i + 1}. Q: ${fact.query}`);
        console.log(`      A: ${fact.expected}`);
      });
    }

    console.log('\n🎉 knowledge_facts materialized view test complete!');
    console.log('\n📋 Next steps:');
    console.log('   - Implement knowledge repository');
    console.log('   - Create fact matching logic');
    console.log('   - Integrate with chat/search flow');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testKnowledgeFactsView();
