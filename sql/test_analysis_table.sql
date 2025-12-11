-- Test Analysis Table
-- Stores AI-powered analysis of test failures from the Test Failure Analysis Agent
--
-- Run this in Supabase SQL Editor:
-- 1. Go to Supabase Dashboard > SQL Editor
-- 2. Paste this SQL and run it
--
-- Prerequisites: test_results table must exist

-- Ensure UUID extension exists (usually already enabled in Supabase)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS test_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Links to test_results.run_id (not FK since run_id isn't unique PK there)
  run_id UUID NOT NULL,

  -- Unique identifier for the failure: "category:test_name"
  failure_key TEXT NOT NULL,

  -- Classification computed deterministically from history (NOT by LLM)
  -- Values: 'always_passes', 'always_fails', 'flaky', 'recent_regression', 'new_failure'
  classification TEXT,

  -- Root cause type for dashboard filtering
  -- Values: 'code_logic', 'test_bug', 'env_config', 'external_service'
  root_cause_type TEXT,

  -- Investigation details
  -- Structure: { "files_examined": [...], "git_commits_reviewed": [...], "pattern_observed": "..." }
  investigation JSONB,

  -- Array of hypothesis attempts with results
  -- Structure: [{ "hypothesis": "...", "change_type": "code_change|test_change|config_change|no_change",
  --               "target_files": [...], "proposed_diff": "...", "test_result": "PASSED|FAILED_ASSERTION|TIMED_OUT|INFRA_ERROR",
  --               "confidence": "low|medium|high" }, ...]
  hypotheses_tested JSONB,

  -- Final recommendation
  -- Structure: { "type": "code_change|test_change|config_change|manual_review",
  --              "description": "...", "files": [...], "confidence": "low|medium|high" }
  recommendation JSONB,

  -- Performance tracking
  analysis_duration_ms INTEGER,

  -- Status flags
  resolved BOOLEAN DEFAULT false,
  human_review_needed BOOLEAN DEFAULT false,

  -- Model tracking for debugging prompt changes
  model_used TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate analysis for same failure in same run
  UNIQUE(run_id, failure_key)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_test_analysis_run_id ON test_analysis(run_id);
CREATE INDEX IF NOT EXISTS idx_test_analysis_failure_key ON test_analysis(failure_key);
CREATE INDEX IF NOT EXISTS idx_test_analysis_created_at ON test_analysis(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_analysis_classification ON test_analysis(classification);
CREATE INDEX IF NOT EXISTS idx_test_analysis_root_cause ON test_analysis(root_cause_type);
CREATE INDEX IF NOT EXISTS idx_test_analysis_human_review ON test_analysis(human_review_needed) WHERE human_review_needed = true;

-- Comments
COMMENT ON TABLE test_analysis IS 'AI-powered analysis of test failures from the Test Failure Analysis Agent';
COMMENT ON COLUMN test_analysis.run_id IS 'UUID linking to test_results.run_id';
COMMENT ON COLUMN test_analysis.failure_key IS 'Unique identifier: "category:test_name"';
COMMENT ON COLUMN test_analysis.classification IS 'Deterministic classification: always_passes, always_fails, flaky, recent_regression, new_failure';
COMMENT ON COLUMN test_analysis.root_cause_type IS 'Root cause category: code_logic, test_bug, env_config, external_service';
COMMENT ON COLUMN test_analysis.investigation IS 'Files examined, git history, patterns observed';
COMMENT ON COLUMN test_analysis.hypotheses_tested IS 'Array of hypothesis attempts with test results';
COMMENT ON COLUMN test_analysis.recommendation IS 'Final fix recommendation with confidence level';
COMMENT ON COLUMN test_analysis.model_used IS 'Claude model used for analysis (e.g., claude-sonnet-4-20250514)';

-- Retention: delete analysis older than 30 days
-- Run this via cron/scheduled function:
-- DELETE FROM test_analysis WHERE created_at < NOW() - INTERVAL '30 days';
