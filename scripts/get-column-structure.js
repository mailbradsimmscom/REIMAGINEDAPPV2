#!/usr/bin/env node

/**
 * Get actual column structure by inserting test data
 */

import { createClient } from '@supabase/supabase-js';

async function getColumnStructure() {
  console.log('🔍 Getting actual column structure...\n');

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

    // Test spec_suggestions structure
    console.log('\n1️⃣ Testing spec_suggestions structure...');
    const { data: specResult, error: specError } = await supabase
      .from('spec_suggestions')
      .insert({
        doc_id: testDocId,
        hint_type: 'test_hint',
        value: 'test_value',
        unit: 'test_unit',
        page: 1,
        context: 'test context',
        confidence: 0.8,
        approved_by: 'test-admin',
        approved_at: new Date().toISOString()
      })
      .select()
      .single();

    if (specError) {
      console.log(`❌ Spec insertion failed: ${specError.message}`);
    } else {
      console.log('✅ Spec suggestions columns:', Object.keys(specResult));
      // Clean up
      await supabase.from('spec_suggestions').delete().eq('id', specResult.id);
    }

    // Test intent_hints structure
    console.log('\n2️⃣ Testing intent_hints structure...');
    const { data: intentResult, error: intentError } = await supabase
      .from('intent_hints')
      .insert({
        doc_id: testDocId,
        intent_type: 'test_intent',
        prompt: 'test prompt',
        context: 'test context',
        page: 1,
        confidence: 0.8,
        approved_by: 'test-admin',
        approved_at: new Date().toISOString()
      })
      .select()
      .single();

    if (intentError) {
      console.log(`❌ Intent insertion failed: ${intentError.message}`);
    } else {
      console.log('✅ Intent hints columns:', Object.keys(intentResult));
      // Clean up
      await supabase.from('intent_hints').delete().eq('id', intentResult.id);
    }

    // Test golden_tests structure
    console.log('\n3️⃣ Testing golden_tests structure...');
    const { data: goldenResult, error: goldenError } = await supabase
      .from('golden_tests')
      .insert({
        doc_id: testDocId,
        query: 'test query',
        expected: 'test expected',
        approved_by: 'test-admin',
        approved_at: new Date().toISOString()
      })
      .select()
      .single();

    if (goldenError) {
      console.log(`❌ Golden test insertion failed: ${goldenError.message}`);
    } else {
      console.log('✅ Golden tests columns:', Object.keys(goldenResult));
      // Clean up
      await supabase.from('golden_tests').delete().eq('id', goldenResult.id);
    }

    // Test document_chunks structure
    console.log('\n4️⃣ Testing document_chunks structure...');
    const { data: chunksResult, error: chunksError } = await supabase
      .from('document_chunks')
      .insert({
        doc_id: testDocId,
        content: 'test content',
        page_start: 1,
        page_end: 1,
        chunk_index: 1
      })
      .select()
      .single();

    if (chunksError) {
      console.log(`❌ Document chunks insertion failed: ${chunksError.message}`);
    } else {
      console.log('✅ Document chunks columns:', Object.keys(chunksResult));
      // Clean up
      await supabase.from('document_chunks').delete().eq('id', chunksResult.id);
    }

    console.log('\n📋 Column structure verification complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

getColumnStructure();
