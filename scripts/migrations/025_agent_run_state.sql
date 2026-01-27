-- Migration 025: Agent Run State Tracking
-- Adds tables for batch run tracking, locking, and idempotency

-- Track batch runs (for locking and observability)
CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type text NOT NULL,
  status text NOT NULL DEFAULT 'running',  -- running | completed | failed
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,

  -- Stats
  items_processed integer DEFAULT 0,
  llm_calls integer DEFAULT 0,
  auto_approved integer DEFAULT 0,
  auto_rejected integer DEFAULT 0,
  escalated integer DEFAULT 0,
  pre_filtered integer DEFAULT 0,
  errors integer DEFAULT 0,

  -- Config used for this run
  config jsonb,

  -- Error details (if failed)
  error_message text
);

-- Index for finding running batches (lock check)
CREATE INDEX IF NOT EXISTS idx_agent_runs_status
  ON agent_runs(agent_type, status)
  WHERE status = 'running';

-- Index for recent runs
CREATE INDEX IF NOT EXISTS idx_agent_runs_started
  ON agent_runs(agent_type, started_at DESC);

-- Add processing state to staging tables for idempotency
-- This tracks which run is processing each item to prevent double-processing

ALTER TABLE staging_spec_suggestions
  ADD COLUMN IF NOT EXISTS processing_run_id uuid,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

ALTER TABLE staging_playbook_hints
  ADD COLUMN IF NOT EXISTS processing_run_id uuid,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

ALTER TABLE staging_intent_router
  ADD COLUMN IF NOT EXISTS processing_run_id uuid,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

ALTER TABLE staging_golden_tests
  ADD COLUMN IF NOT EXISTS processing_run_id uuid,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

-- Indexes for finding stuck items (items marked for processing but not completed)
CREATE INDEX IF NOT EXISTS idx_spec_processing
  ON staging_spec_suggestions(processing_run_id)
  WHERE processing_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_playbook_processing
  ON staging_playbook_hints(processing_run_id)
  WHERE processing_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_intent_processing
  ON staging_intent_router(processing_run_id)
  WHERE processing_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_golden_processing
  ON staging_golden_tests(processing_run_id)
  WHERE processing_run_id IS NOT NULL;

-- Add 'pre_filter' as a valid decision_source
-- (existing values: 'human', 'agent', 'telegram')
-- No schema change needed - it's just a text field
-- But let's add a comment for documentation
COMMENT ON COLUMN agent_training_decisions.decision_source IS
  'Source of decision: human | agent | telegram | pre_filter';
