#!/usr/bin/env node

/**
 * Create test data for knowledge_facts view testing
 */

import { createClient } from '@supabase/supabase-js';

async function createTestData() {
  console.log('🧪 Creating test data for knowledge_facts view...\n');

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get a real document ID
    const { data: documents } = await supabase
      .from('documents')
      .select('doc_id')
      .limit(1);
    
    if (!documents || documents.length === 0) {
      console.log('❌ No documents found');
      return;
    }

    const testDocId = documents[0].doc_id;
    console.log(`Using document ID: ${testDocId}`);

    // Create test spec suggestion
    console.log('\n1️⃣ Creating test spec suggestion...');
    const { data: specResult, error: specError } = await supabase
      .from('spec_suggestions')
      .insert({
        doc_id: testDocId,
        hint_type: 'operating_pressure',
        value: '11',
        unit: 'bar',
        page: 1,
        context: 'Working pressure specification',
        confidence: 0.9,
        approved_by: 'test-admin',
        approved_at: new Date().toISOString()
      })
      .select()
      .single();

    if (specError) {
      console.log(`❌ Spec suggestion creation failed: ${specError.message}`);
    } else {
      console.log(`✅ Spec suggestion created: ${specResult.hint_type} = ${specResult.value} ${specResult.unit}`);
    }

    // Create test intent hint
    console.log('\n2️⃣ Creating test intent hint...');
    const { data: intentResult, error: intentError } = await supabase
      .from('intent_hints')
      .insert({
        doc_id: testDocId,
        intent_type: 'pressure_check',
        prompt: 'check pressure',
        context: 'User wants to verify system pressure',
        page: 1,
        confidence: 0.8,
        approved_by: 'test-admin',
        approved_at: new Date().toISOString()
      })
      .select()
      .single();

    if (intentError) {
      console.log(`❌ Intent hint creation failed: ${intentError.message}`);
    } else {
      console.log(`✅ Intent hint created: ${intentResult.intent_type} - ${intentResult.prompt}`);
    }

    // Create test golden test
    console.log('\n3️⃣ Creating test golden test...');
    const { data: goldenResult, error: goldenError } = await supabase
      .from('golden_tests')
      .insert({
        doc_id: testDocId,
        query: 'What is the operating pressure?',
        expected: 'The operating pressure is 11 bar',
        approved_by: 'test-admin',
        approved_at: new Date().toISOString()
      })
      .select()
      .single();

    if (goldenError) {
      console.log(`❌ Golden test creation failed: ${goldenError.message}`);
    } else {
      console.log(`✅ Golden test created: Q: ${goldenResult.query}`);
    }

    // Refresh the materialized view
    console.log('\n4️⃣ Refreshing materialized view...');
    const { error: refreshError } = await supabase
      .rpc('refresh_materialized_view', { view_name: 'knowledge_facts' });

    if (refreshError) {
      console.log(`⚠️  Could not refresh view via RPC: ${refreshError.message}`);
      console.log('   You may need to refresh manually in Supabase SQL Editor:');
      console.log('   REFRESH MATERIALIZED VIEW knowledge_facts;');
    } else {
      console.log('✅ Materialized view refreshed');
    }

    // Test the view
    console.log('\n5️⃣ Testing the view...');
    const { data: viewData, error: viewError } = await supabase
      .from('knowledge_facts')
      .select('*');

    if (viewError) {
      console.log(`❌ View query failed: ${viewError.message}`);
    } else {
      console.log(`✅ View contains ${viewData.length} facts:`);
      viewData.forEach((fact, i) => {
        if (fact.fact_type === 'spec') {
          console.log(`   ${i + 1}. SPEC: ${fact.key} = ${fact.value} ${fact.unit || ''}`);
        } else if (fact.fact_type === 'intent_hint') {
          console.log(`   ${i + 1}. INTENT: ${fact.intent}`);
        } else if (fact.fact_type === 'golden_test') {
          console.log(`   ${i + 1}. GOLDEN: Q: ${fact.query}`);
        }
      });
    }

    console.log('\n🎉 Test data creation complete!');
    console.log('\n📋 Test data created:');
    console.log('   - Spec suggestion: operating_pressure = 11 bar');
    console.log('   - Intent hint: pressure_check - check pressure');
    console.log('   - Golden test: What is the operating pressure?');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

createTestData();
