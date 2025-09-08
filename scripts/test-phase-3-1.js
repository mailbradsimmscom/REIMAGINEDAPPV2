#!/usr/bin/env node

/**
 * Phase 3.1 Validation Script
 * Tests the database migrations for DIP suggestion tables
 * 
 * Usage: node scripts/test-phase-3-1.js
 */

import 'dotenv/config';
import { logger } from '../src/utils/logger.js';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

const requestLogger = logger.createRequestLogger();

async function testSuggestionTables() {
  console.log('🧪 Testing DIP suggestion tables...');
  
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    const tables = [
      'spec_suggestions',
      'entity_candidates', 
      'playbook_hints',
      'intent_hints'
    ];

    const results = {};

    for (const table of tables) {
      try {
        // Test if table exists by trying to select from it
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .limit(1);

        if (error) {
          console.log(`❌ Table ${table} does not exist:`, error.message);
          results[table] = false;
        } else {
          console.log(`✅ Table ${table} exists and is queryable`);
          results[table] = true;
        }
      } catch (err) {
        console.log(`❌ Error checking table ${table}:`, err.message);
        results[table] = false;
      }
    }

    return results;
  } catch (error) {
    console.log('❌ Error testing suggestion tables:', error.message);
    return {};
  }
}

async function testDIPSuccessColumn() {
  console.log('\n🧪 Testing DIP success tracking column...');
  
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    // Test if dip_success column exists by trying to select it
    const { data, error } = await supabase
      .from('jobs')
      .select('dip_success')
      .limit(1);

    if (error) {
      console.log('❌ dip_success column does not exist:', error.message);
      return false;
    } else {
      console.log('✅ dip_success column exists and is queryable');
      return true;
    }
  } catch (error) {
    console.log('❌ Error checking dip_success column:', error.message);
    return false;
  }
}

async function testTableStructure() {
  console.log('\n🧪 Testing table structure...');
  
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    // Test inserting a sample record into each table
    const testData = {
      spec_suggestions: {
        doc_id: 'test-doc-123',
        hint_type: 'pressure',
        value: '20 psi',
        unit: 'psi',
        page: 1,
        context: 'Operating pressure specification',
        confidence: 0.95
      },
      entity_candidates: {
        doc_id: 'test-doc-123',
        entity_type: 'manufacturer',
        value: 'TestManufacturer',
        page: 1,
        context: 'Manufacturer name',
        confidence: 0.90
      },
      playbook_hints: {
        doc_id: 'test-doc-123',
        test_name: 'Pressure Test',
        test_type: 'procedure',
        description: 'Test operating pressure',
        steps: ['Step 1: Check pressure', 'Step 2: Verify reading'],
        expected_result: 'Pressure within range',
        page: 1,
        confidence: 0.85
      },
      intent_hints: {
        doc_id: 'test-doc-123',
        intent_type: 'maintenance',
        prompt: 'How to maintain the system',
        context: 'Maintenance instructions',
        page: 1,
        confidence: 0.80
      }
    };

    const results = {};

    for (const [table, data] of Object.entries(testData)) {
      try {
        // Try to insert test data
        const { data: insertData, error: insertError } = await supabase
          .from(table)
          .insert(data)
          .select();

        if (insertError) {
          console.log(`❌ Insert test failed for ${table}:`, insertError.message);
          results[table] = false;
        } else {
          console.log(`✅ Insert test passed for ${table}`);
          results[table] = true;

          // Clean up test data
          if (insertData && insertData.length > 0) {
            await supabase
              .from(table)
              .delete()
              .eq('id', insertData[0].id);
          }
        }
      } catch (err) {
        console.log(`❌ Error testing ${table} structure:`, err.message);
        results[table] = false;
      }
    }

    return results;
  } catch (error) {
    console.log('❌ Error testing table structure:', error.message);
    return {};
  }
}

async function runTests() {
  console.log('🚀 Starting Phase 3.1 Validation Tests\n');
  
  const results = {
    suggestionTables: await testSuggestionTables(),
    dipSuccessColumn: await testDIPSuccessColumn(),
    tableStructure: await testTableStructure()
  };
  
  console.log('\n📊 Test Results:');
  console.log('================');
  
  console.log('\n📋 Suggestion Tables:');
  Object.entries(results.suggestionTables).forEach(([table, exists]) => {
    console.log(`  ${table}: ${exists ? '✅' : '❌'}`);
  });
  
  console.log(`\n🎯 DIP Success Tracking: ${results.dipSuccessColumn ? '✅' : '❌'}`);
  
  console.log('\n🔧 Table Structure Tests:');
  Object.entries(results.tableStructure).forEach(([table, works]) => {
    console.log(`  ${table}: ${works ? '✅' : '❌'}`);
  });
  
  const allTablesExist = Object.values(results.suggestionTables).every(exists => exists);
  const allStructuresWork = Object.values(results.tableStructure).every(works => works);
  const dipSuccessWorks = results.dipSuccessColumn;
  
  const allPassed = allTablesExist && allStructuresWork && dipSuccessWorks;
  
  if (allPassed) {
    console.log('\n🎉 All Phase 3.1 tests passed!');
    console.log('\n📋 Next Steps:');
    console.log('1. Proceed to Phase 3.2: DIP File Persistence');
    console.log('2. Implement Supabase Storage upload for DIP files');
    console.log('3. Test DIP file storage and retrieval');
  } else {
    console.log('\n❌ Some tests failed. Please run the database migrations.');
    console.log('\n🔧 Required Actions:');
    console.log('1. Run migration 003_create_dip_suggestion_tables.sql');
    console.log('2. Run migration 004_add_dip_success_tracking.sql');
    console.log('3. Verify table creation in Supabase');
  }
}

runTests().catch(console.error);
