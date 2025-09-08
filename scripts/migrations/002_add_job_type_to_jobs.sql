-- Migration: Add job_type column to jobs table
-- Purpose: Support DIP job classification and filtering
-- Date: 2025-01-09
-- Author: Phase 1.1 - Database Schema Updates

-- Add job_type column to jobs table
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS job_type VARCHAR(50) DEFAULT 'GENERIC';

-- Add index for performance on job_type filtering
CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs(job_type);

-- Add check constraint to ensure valid job types
ALTER TABLE jobs 
ADD CONSTRAINT chk_jobs_job_type 
CHECK (job_type IN ('GENERIC', 'DIP', 'PARSING', 'VECTOR_UPSERT'));

-- Update existing jobs to have appropriate job_type based on their purpose
-- DIP jobs are those that process documents for DIP generation
UPDATE jobs 
SET job_type = 'DIP' 
WHERE doc_id IS NOT NULL 
  AND status IN ('queued', 'parsing', 'completed', 'failed')
  AND job_type = 'GENERIC';

-- Add comment for documentation
COMMENT ON COLUMN jobs.job_type IS 'Type of job: GENERIC, DIP, PARSING, VECTOR_UPSERT';

-- Verify the migration
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'jobs' 
    AND column_name = 'job_type';

-- Show sample of updated jobs
SELECT 
    job_id,
    job_type,
    status,
    doc_id,
    created_at
FROM jobs 
ORDER BY created_at DESC 
LIMIT 10;
