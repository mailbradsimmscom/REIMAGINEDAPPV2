#!/usr/bin/env node

/**
 * Schema verification script for Step 7: Fact-First Retrieval
 * Checks the actual structure of tables we'll use in the materialized view
 */

import { createClient } from '@supabase/supabase-js';

async function verifySchema() {
  console.log('🔍 Verifying Schema for Step 7: Fact-First Retrieval...\n');

  try {
    const supabaseUrl = 'https://eriquneakfcfmeecqyof.supabase.co';
    const supabaseKey = 'sb_secret_VYgTw3lmc1DNcFxrQNaV-w_tDqqxiyR';
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✅ Supabase client initialized');

    // Test 1: Check spec_suggestions table structure
    console.log('\n1️⃣ Checking spec_suggestions table structure...');
    try {
      const { data: specData, error: specError } = await supabase
        .from('spec_suggestions')
        .select('*')
        .limit(1);
      
      if (specError) {
        console.log(`❌ spec_suggestions table error: ${specError.message}`);
      } else {
        console.log('✅ spec_suggestions table exists');
        if (specData && specData.length > 0) {
          console.log('   Columns:', Object.keys(specData[0]));
        } else {
          console.log('   Table is empty (no sample data)');
        }
      }
    } catch (error) {
      console.log(`❌ Error checking spec_suggestions: ${error.message}`);
    }

    // Test 2: Check intent_hints table structure
    console.log('\n2️⃣ Checking intent_hints table structure...');
    try {
      const { data: intentData, error: intentError } = await supabase
        .from('intent_hints')
        .select('*')
        .limit(1);
      
      if (intentError) {
        console.log(`❌ intent_hints table error: ${intentError.message}`);
      } else {
        console.log('✅ intent_hints table exists');
        if (intentData && intentData.length > 0) {
          console.log('   Columns:', Object.keys(intentData[0]));
        } else {
          console.log('   Table is empty (no sample data)');
        }
      }
    } catch (error) {
      console.log(`❌ Error checking intent_hints: ${error.message}`);
    }

    // Test 3: Check golden_tests table structure
    console.log('\n3️⃣ Checking golden_tests table structure...');
    try {
      const { data: goldenData, error: goldenError } = await supabase
        .from('golden_tests')
        .select('*')
        .limit(1);
      
      if (goldenError) {
        console.log(`❌ golden_tests table error: ${goldenError.message}`);
      } else {
        console.log('✅ golden_tests table exists');
        if (goldenData && goldenData.length > 0) {
          console.log('   Columns:', Object.keys(goldenData[0]));
        } else {
          console.log('   Table is empty (no sample data)');
        }
      }
    } catch (error) {
      console.log(`❌ Error checking golden_tests: ${error.message}`);
    }

    // Test 4: Check document_chunks table structure (for fallback)
    console.log('\n4️⃣ Checking document_chunks table structure...');
    try {
      const { data: chunksData, error: chunksError } = await supabase
        .from('document_chunks')
        .select('*')
        .limit(1);
      
      if (chunksError) {
        console.log(`❌ document_chunks table error: ${chunksError.message}`);
      } else {
        console.log('✅ document_chunks table exists');
        if (chunksData && chunksData.length > 0) {
          console.log('   Columns:', Object.keys(chunksData[0]));
        } else {
          console.log('   Table is empty (no sample data)');
        }
      }
    } catch (error) {
      console.log(`❌ Error checking document_chunks: ${error.message}`);
    }

    // Test 5: Check if we have any approved data
    console.log('\n5️⃣ Checking for approved data...');
    
    // Check spec_suggestions with approved_at
    const { data: approvedSpecs, error: approvedSpecsError } = await supabase
      .from('spec_suggestions')
      .select('count')
      .not('approved_at', 'is', null);
    
    if (!approvedSpecsError) {
      console.log(`✅ Approved spec suggestions: ${approvedSpecs?.length || 0}`);
    }

    // Check intent_hints with approved_at
    const { data: approvedIntents, error: approvedIntentsError } = await supabase
      .from('intent_hints')
      .select('count')
      .not('approved_at', 'is', null);
    
    if (!approvedIntentsError) {
      console.log(`✅ Approved intent hints: ${approvedIntents?.length || 0}`);
    }

    // Check golden_tests with approved_at
    const { data: approvedGolden, error: approvedGoldenError } = await supabase
      .from('golden_tests')
      .select('count')
      .not('approved_at', 'is', null);
    
    if (!approvedGoldenError) {
      console.log(`✅ Approved golden tests: ${approvedGolden?.length || 0}`);
    }

    console.log('\n📋 Schema verification complete!');
    console.log('\n🎯 Next steps:');
    console.log('   - Create materialized view with correct column mappings');
    console.log('   - Implement knowledge repository');
    console.log('   - Integrate with existing chat/search flow');

  } catch (error) {
    console.error('❌ Schema verification failed:', error.message);
    process.exit(1);
  }
}

// Run the verification
verifySchema();
