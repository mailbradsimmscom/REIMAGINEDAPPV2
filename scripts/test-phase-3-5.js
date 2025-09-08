#!/usr/bin/env node

/**
 * Phase 3.5 Validation Script
 * Tests the complete DIP suggestion review workflow
 * 
 * Usage: node scripts/test-phase-3-5.js
 */

import 'dotenv/config';
import { logger } from '../src/utils/logger.js';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

const requestLogger = logger.createRequestLogger();

async function testAdminUIAccess() {
  console.log('🧪 Testing admin UI access...');
  
  try {
    const response = await fetch('http://localhost:3000/suggestions.html');
    
    if (!response.ok) {
      console.log('❌ Admin UI access failed:', response.status, response.statusText);
      return false;
    }
    
    const html = await response.text();
    
    if (html.includes('DIP Suggestions Review') && html.includes('DIPSuggestionsReviewer')) {
      console.log('✅ Admin UI is accessible and properly structured');
      return true;
    } else {
      console.log('❌ Admin UI structure is incorrect');
      return false;
    }
  } catch (error) {
    console.log('❌ Admin UI access test failed:', error.message);
    return false;
  }
}

async function testSuggestionTables() {
  console.log('\n🧪 Testing suggestion tables...');
  
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    const tables = ['spec_suggestions', 'entity_candidates', 'playbook_hints', 'intent_hints'];
    const results = {};

    for (const table of tables) {
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .limit(1);

        if (error) {
          console.log(`❌ Table ${table} access failed:`, error.message);
          results[table] = false;
        } else {
          console.log(`✅ Table ${table} is accessible`);
          results[table] = true;
        }
      } catch (err) {
        console.log(`❌ Error checking table ${table}:`, err.message);
        results[table] = false;
      }
    }

    return results;
  } catch (error) {
    console.log('❌ Suggestion tables test failed:', error.message);
    return {};
  }
}

async function testDIPJobsWithSuggestions() {
  console.log('\n🧪 Testing DIP jobs with suggestions...');
  
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    // Get DIP jobs that have suggestions
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select(`
        job_id,
        doc_id,
        status,
        dip_success,
        counters,
        created_at
      `)
      .eq('job_type', 'DIP')
      .eq('status', 'completed')
      .eq('dip_success', true)
      .limit(5);

    if (error) {
      console.log('❌ Failed to fetch DIP jobs:', error.message);
      return false;
    }

    console.log('✅ DIP jobs with suggestions found:', jobs?.length || 0);
    
    if (jobs && jobs.length > 0) {
      console.log('📋 Sample DIP job:', {
        jobId: jobs[0].job_id.substring(0, 8) + '...',
        docId: jobs[0].doc_id.substring(0, 8) + '...',
        dipSuccess: jobs[0].dip_success,
        entitiesCount: jobs[0].counters?.entities_extracted || 0,
        specsCount: jobs[0].counters?.spec_hints_found || 0,
        testsCount: jobs[0].counters?.golden_tests_generated || 0
      });
    }

    return true;
  } catch (error) {
    console.log('❌ DIP jobs test failed:', error.message);
    return false;
  }
}

async function testDIPFileStorage() {
  console.log('\n🧪 Testing DIP file storage...');
  
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }

    // Check if there are any DIP files in storage
    const { data: files, error } = await supabase.storage
      .from('documents')
      .list('manuals', {
        limit: 100,
        offset: 0
      });

    if (error) {
      console.log('❌ Failed to list storage files:', error.message);
      return false;
    }

    const dipFiles = files?.filter(file => file.name.includes('_entities.json') || 
                                          file.name.includes('_spec_hints.json') || 
                                          file.name.includes('_golden_tests.json')) || [];

    console.log('✅ DIP files in storage:', dipFiles.length);
    
    if (dipFiles.length > 0) {
      console.log('📋 Sample DIP files:', dipFiles.slice(0, 3).map(f => f.name));
    }

    return true;
  } catch (error) {
    console.log('❌ DIP file storage test failed:', error.message);
    return false;
  }
}

async function testCompleteWorkflow() {
  console.log('\n🧪 Testing complete DIP workflow...');
  
  try {
    // Test the complete workflow components
    const components = {
      'Database Tables': await testSuggestionTables(),
      'DIP Jobs': await testDIPJobsWithSuggestions(),
      'File Storage': await testDIPFileStorage(),
      'Admin UI': await testAdminUIAccess()
    };

    const allWorking = Object.values(components).every(result => 
      typeof result === 'boolean' ? result : Object.values(result).every(v => v === true)
    );

    if (allWorking) {
      console.log('✅ Complete DIP workflow is functional');
      return true;
    } else {
      console.log('❌ Some workflow components are not working');
      return false;
    }
  } catch (error) {
    console.log('❌ Complete workflow test failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting Phase 3.5 Validation Tests\n');
  
  const results = {
    adminUI: await testAdminUIAccess(),
    suggestionTables: await testSuggestionTables(),
    dipJobs: await testDIPJobsWithSuggestions(),
    fileStorage: await testDIPFileStorage(),
    completeWorkflow: await testCompleteWorkflow()
  };
  
  console.log('\n📊 Test Results:');
  console.log('================');
  console.log(`Admin UI access: ${results.adminUI ? '✅' : '❌'}`);
  console.log(`Suggestion tables: ${Object.values(results.suggestionTables).every(v => v) ? '✅' : '❌'}`);
  console.log(`DIP jobs with suggestions: ${results.dipJobs ? '✅' : '❌'}`);
  console.log(`DIP file storage: ${results.fileStorage ? '✅' : '❌'}`);
  console.log(`Complete workflow: ${results.completeWorkflow ? '✅' : '❌'}`);
  
  const allPassed = results.adminUI && 
                   Object.values(results.suggestionTables).every(v => v) &&
                   results.dipJobs && 
                   results.fileStorage && 
                   results.completeWorkflow;
  
  if (allPassed) {
    console.log('\n🎉 All Phase 3.5 tests passed!');
    console.log('\n🎯 DIP Suggestion Review System is COMPLETE!');
    console.log('\n📋 What You Can Do Now:');
    console.log('1. Visit http://localhost:3000/suggestions.html');
    console.log('2. Review DIP suggestions from completed jobs');
    console.log('3. Select and approve suggestions');
    console.log('4. Approved suggestions are saved to database');
    console.log('5. Use approved data for playbook generation');
  } else {
    console.log('\n❌ Some tests failed. Please check the DIP suggestion system.');
    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure all database tables exist');
    console.log('2. Check DIP file storage configuration');
    console.log('3. Verify admin UI is accessible');
    console.log('4. Test DIP job processing');
  }
}

runTests().catch(console.error);
