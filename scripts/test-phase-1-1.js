#!/usr/bin/env node

/**
 * Phase 1.1 Validation Script
 * Tests the job_type column addition and DIP job creation
 * 
 * Usage: node scripts/test-phase-1-1.js
 */

import 'dotenv/config';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';
import documentRepository from '../src/repositories/document.repository.js';
import { logger } from '../src/utils/logger.js';

const requestLogger = logger.createRequestLogger();

async function testJobTypeColumn() {
  console.log('🧪 Testing job_type column...');
  
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }
    
    // Test if we can query the job_type column by trying to select it
    const { data, error } = await supabase
      .from('jobs')
      .select('job_type')
      .limit(1);
    
    if (error) {
      console.log('❌ job_type column does not exist:', error.message);
      return false;
    } else {
      console.log('✅ job_type column exists and is queryable');
      return true;
    }
  } catch (error) {
    console.log('❌ Error checking job_type column:', error.message);
    return false;
  }
}

async function testDIPJobCreation() {
  console.log('\n🧪 Testing DIP job creation...');
  
  try {
    // Create a test DIP job
    const testJobData = {
      doc_id: 'test-doc-' + Date.now(),
      job_type: 'DIP',
      status: 'queued',
      params: {
        test: true,
        parser_version: '1.0.0'
      },
      counters: {
        pages_total: 0,
        chunks: 0
      }
    };
    
    const job = await documentRepository.createJob(testJobData);
    
    if (job && job.job_id) {
      console.log('✅ DIP job created successfully:', {
        job_id: job.job_id,
        job_type: job.job_type,
        status: job.status,
        doc_id: job.doc_id
      });
      
      // Clean up test job
      await documentRepository.updateJobStatus(job.job_id, 'failed', {
        error: { message: 'Test job - cleaned up' }
      });
      
      return true;
    } else {
      console.log('❌ Failed to create DIP job');
      return false;
    }
  } catch (error) {
    console.log('❌ Error creating DIP job:', error.message);
    return false;
  }
}

async function testDIPJobFiltering() {
  console.log('\n🧪 Testing DIP job filtering...');
  
  try {
    // Get DIP jobs specifically
    const dipJobs = await documentRepository.getDIPJobsByStatus('queued', 5);
    
    console.log(`✅ Found ${dipJobs.length} queued DIP jobs`);
    
    if (dipJobs.length > 0) {
      console.log('📋 Sample DIP job:', {
        job_id: dipJobs[0].job_id,
        job_type: dipJobs[0].job_type,
        status: dipJobs[0].status,
        doc_id: dipJobs[0].doc_id
      });
    }
    
    return true;
  } catch (error) {
    console.log('❌ Error filtering DIP jobs:', error.message);
    return false;
  }
}

async function testJobTypeConstraints() {
  console.log('\n🧪 Testing job_type constraints...');
  
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }
    
    // Try to create a job with invalid job_type
    const { data, error } = await supabase
      .from('jobs')
      .insert([{
        doc_id: 'test-invalid-job-type',
        job_type: 'INVALID_TYPE',
        status: 'queued',
        params: {},
        counters: {}
      }])
      .select();
    
    if (error) {
      console.log('✅ Invalid job_type correctly rejected:', error.message);
      return true;
    } else {
      console.log('❌ Invalid job_type was accepted (constraint not working)');
      return false;
    }
  } catch (error) {
    console.log('❌ Error testing job_type constraints:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting Phase 1.1 Validation Tests\n');
  
  const results = {
    jobTypeColumn: await testJobTypeColumn(),
    dipJobCreation: await testDIPJobCreation(),
    dipJobFiltering: await testDIPJobFiltering(),
    jobTypeConstraints: await testJobTypeConstraints()
  };
  
  console.log('\n📊 Test Results:');
  console.log('================');
  console.log(`job_type column exists: ${results.jobTypeColumn ? '✅' : '❌'}`);
  console.log(`DIP job creation: ${results.dipJobCreation ? '✅' : '❌'}`);
  console.log(`DIP job filtering: ${results.dipJobFiltering ? '✅' : '❌'}`);
  console.log(`job_type constraints: ${results.jobTypeConstraints ? '✅' : '❌'}`);
  
  const allPassed = Object.values(results).every(result => result === true);
  
  if (allPassed) {
    console.log('\n🎉 All Phase 1.1 tests passed!');
    console.log('\n📋 Next Steps:');
    console.log('1. Run the migration: node scripts/migrations/run-migration.js 002_add_job_type_to_jobs.sql');
    console.log('2. Proceed to Phase 1.2 (Python Sidecar DIP Endpoints)');
  } else {
    console.log('\n❌ Some tests failed. Please check the migration and try again.');
  }
}

runTests().catch(console.error);
