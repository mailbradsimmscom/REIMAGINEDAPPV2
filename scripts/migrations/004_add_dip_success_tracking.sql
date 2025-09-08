-- Migration: Add DIP success tracking to jobs table
-- Purpose: Track DIP processing success/failure separately from job completion
-- Date: 2025-01-09
-- Author: Phase 3.1 - Database Migrations

-- Add DIP success tracking column
ALTER TABLE jobs
ADD COLUMN IF NOT EXISTS dip_success BOOLEAN DEFAULT FALSE;

-- Add index for DIP success filtering
CREATE INDEX IF NOT EXISTS idx_jobs_dip_success ON jobs(dip_success);

-- Add comment for documentation
COMMENT ON COLUMN jobs.dip_success IS 'Indicates whether DIP processing completed successfully';

-- Update existing DIP jobs to have dip_success = false (unknown status)
-- This is safe since we don't know the historical DIP status
UPDATE jobs
SET dip_success = FALSE
WHERE job_type = 'DIP'
  AND dip_success IS NULL;
