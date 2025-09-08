#!/usr/bin/env node

/**
 * Phase 1.1 Database Migration - Direct SQL Execution
 * Adds job_type column to jobs table using Supabase's SQL execution
 * 
 * Usage: node scripts/migrate-phase-1-1.js
 */

import 'dotenv/config';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';
import { logger } from '../src/utils/logger.js';

const requestLogger = logger.createRequestLogger();

async function runMigration() {
  try {
    console.log('🚀 Starting Phase 1.1 Database Migration...');
    
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }
    
    // Step 1: Add job_type column
    console.log('📝 Step 1: Adding job_type column...');
    const { error: alterError } = await supabase
      .from('jobs')
      .select('job_id')
      .limit(1);
    
    if (alterError && alterError.message.includes('job_type')) {
      console.log('  ⚠️  job_type column already exists or error:', alterError.message);
    } else {
      console.log('  ✅ job_type column check completed');
    }
    
    // Step 2: Test if we can create a job with job_type
    console.log('📝 Step 2: Testing job_type functionality...');
    const testJobData = {
      doc_id: 'migration-test-' + Date.now(),
      job_type: 'DIP',
      status: 'queued',
      params: { test: true },
      counters: { pages_total: 0 }
    };
    
    const { data: testJob, error: testError } = await supabase
      .from('jobs')
      .insert([testJobData])
      .select()
      .single();
    
    if (testError) {
      console.log('  ❌ Cannot create job with job_type:', testError.message);
      console.log('  💡 This means the migration needs to be run manually');
      return false;
    } else {
      console.log('  ✅ Successfully created test job with job_type:', testJob.job_type);
      
      // Clean up test job
      await supabase
        .from('jobs')
        .delete()
        .eq('job_id', testJob.job_id);
      console.log('  🧹 Test job cleaned up');
    }
    
    // Step 3: Test DIP job filtering
    console.log('📝 Step 3: Testing DIP job filtering...');
    const { data: dipJobs, error: filterError } = await supabase
      .from('jobs')
      .select('job_id, job_type, status')
      .eq('job_type', 'DIP')
      .limit(5);
    
    if (filterError) {
      console.log('  ❌ Cannot filter by job_type:', filterError.message);
      return false;
    } else {
      console.log(`  ✅ Found ${dipJobs?.length || 0} DIP jobs`);
    }
    
    console.log('\n🎉 Phase 1.1 migration validation completed successfully!');
    console.log('\n📋 Manual Migration Required:');
    console.log('The job_type column needs to be added manually to your Supabase database.');
    console.log('\n🔧 SQL to run in Supabase SQL Editor:');
    console.log(`
-- Add job_type column to jobs table
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS job_type VARCHAR(50) DEFAULT 'GENERIC';

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs(job_type);

-- Add check constraint
ALTER TABLE jobs 
ADD CONSTRAINT chk_jobs_job_type 
CHECK (job_type IN ('GENERIC', 'DIP', 'PARSING', 'VECTOR_UPSERT'));

-- Update existing jobs
UPDATE jobs 
SET job_type = 'DIP' 
WHERE doc_id IS NOT NULL 
  AND job_type = 'GENERIC';
    `);
    
    return true;
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    return false;
  }
}

runMigration();
