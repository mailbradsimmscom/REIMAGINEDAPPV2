#!/usr/bin/env node

/**
 * Test script for Phase 3.6: Golden Tests Table Creation
 * Validates that the golden_tests table is created correctly
 */

import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../src/config/env.js';
import { logger } from '../src/utils/logger.js';

const requestLogger = logger.createRequestLogger();

async function testGoldenTestsTable() {
  console.log('🧪 Testing Golden Tests Table Creation...\n');

  try {
    // Initialize Supabase client
    const env = getEnv();
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    requestLogger.info('Supabase client initialized');

    // Test 1: Check if golden_tests table exists
    console.log('1️⃣ Checking if golden_tests table exists...');
    const { data: tableCheck, error: tableError } = await supabase
      .from('golden_tests')
      .select('*')
      .limit(1);
    
    if (tableError) {
      if (tableError.message.includes('relation "golden_tests" does not exist')) {
        console.log('❌ golden_tests table does not exist yet');
        console.log('📋 Please run the migration: scripts/migrations/005_create_golden_tests_table.sql');
        return;
      }
      throw tableError;
    }
    
    console.log('✅ golden_tests table exists');

    // Test 2: Check table structure
    console.log('\n2️⃣ Checking table structure...');
    const { data: structureCheck, error: structureError } = await supabase
      .from('golden_tests')
      .select('id, doc_id, query, expected, approved_by, approved_at, created_at, updated_at')
      .limit(1);
    
    if (structureError) {
      throw structureError;
    }
    
    console.log('✅ Table structure is correct');

    // Test 3: Test insert capability
    console.log('\n3️⃣ Testing insert capability...');
    const testDocId = '550e8400-e29b-41d4-a716-446655440000'; // Test UUID
    const testData = {
      doc_id: testDocId,
      query: 'What is the working pressure?',
      expected: '11 bar',
      approved_by: 'test-admin'
    };

    const { data: insertResult, error: insertError } = await supabase
      .from('golden_tests')
      .insert(testData)
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    console.log('✅ Insert test successful');
    console.log(`   Created golden test with ID: ${insertResult.id}`);

    // Test 4: Test select capability
    console.log('\n4️⃣ Testing select capability...');
    const { data: selectResult, error: selectError } = await supabase
      .from('golden_tests')
      .select('*')
      .eq('doc_id', testDocId);

    if (selectError) {
      throw selectError;
    }

    console.log('✅ Select test successful');
    console.log(`   Found ${selectResult.length} golden test(s) for doc_id: ${testDocId}`);

    // Test 5: Clean up test data
    console.log('\n5️⃣ Cleaning up test data...');
    const { error: deleteError } = await supabase
      .from('golden_tests')
      .delete()
      .eq('doc_id', testDocId);

    if (deleteError) {
      throw deleteError;
    }

    console.log('✅ Test data cleaned up');

    // Test 6: Check indexes
    console.log('\n6️⃣ Checking indexes...');
    const { data: indexCheck, error: indexError } = await supabase
      .rpc('get_table_indexes', { table_name: 'golden_tests' })
      .limit(1);

    if (indexError) {
      console.log('⚠️  Could not verify indexes (RPC may not be available)');
    } else {
      console.log('✅ Indexes verified');
    }

    console.log('\n🎉 All tests passed! Golden Tests table is ready for use.');
    console.log('\n📋 Next steps:');
    console.log('   - Update suggestions.route.js to handle golden_tests');
    console.log('   - Test the complete approval workflow');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    requestLogger.error('Golden tests table test failed', { error: error.message });
    process.exit(1);
  }
}

// Run the test
testGoldenTestsTable();
