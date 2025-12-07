-- Test Results Table
-- Stores results from CI/CD test runs for the test dashboard
--
-- Run this in Supabase SQL Editor:
-- 1. Go to Supabase Dashboard > SQL Editor
-- 2. Paste this SQL and run it

CREATE TABLE IF NOT EXISTS test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  run_type TEXT NOT NULL CHECK (run_type IN ('push', 'nightly', 'manual', 'pr')),
  run_started_at TIMESTAMPTZ NOT NULL,
  run_completed_at TIMESTAMPTZ,

  -- Summary counts
  total_tests INTEGER DEFAULT 0,
  passed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,

  -- Git info
  git_branch TEXT,
  git_commit TEXT,

  -- Environment
  environment TEXT DEFAULT 'ci' CHECK (environment IN ('ci', 'production', 'local')),

  -- Detailed results by category (unit, integration, e2e, etc.)
  -- Structure: { "unit": { "passed": 98, "failed": 0, "tests": [...] }, ... }
  results JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Extracted failures for quick access
  -- Structure: [{ "category": "e2e", "name": "...", "error": "...", "fix_hint": "..." }, ...]
  failures JSONB DEFAULT '[]'::jsonb,

  -- Chat timing data (response time measurements)
  -- Structure: { "summary": { "avgFullStackMs": 20000, ... }, "tests": [...] }
  chat_timing JSONB DEFAULT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration: Add chat_timing column if table already exists
-- Run this if you already have the table:
-- ALTER TABLE test_results ADD COLUMN IF NOT EXISTS chat_timing JSONB DEFAULT NULL;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_test_results_run_type ON test_results(run_type);
CREATE INDEX IF NOT EXISTS idx_test_results_created ON test_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_results_run_id ON test_results(run_id);

-- Enable RLS (optional - depends on your security needs)
-- ALTER TABLE test_results ENABLE ROW LEVEL SECURITY;

-- Policy for admin access (if using RLS)
-- CREATE POLICY "Allow admin access" ON test_results FOR ALL USING (true);

-- Comment on table
COMMENT ON TABLE test_results IS 'Stores automated test results from CI/CD for the test dashboard';
COMMENT ON COLUMN test_results.run_id IS 'UUID grouping tests from the same run';
COMMENT ON COLUMN test_results.run_type IS 'Type of test run: push, nightly, manual, or pr';
COMMENT ON COLUMN test_results.results IS 'Detailed results by test category (unit, integration, e2e)';
COMMENT ON COLUMN test_results.failures IS 'Extracted failures with fix hints for quick dashboard display';
