-- Migration: 024_agent_training_tables
-- Creates tables for autonomous agent training
-- Run with: psql or via Supabase SQL Editor

-- Table: agent_training_decisions
-- Stores every human decision with reasoning for learning
CREATE TABLE IF NOT EXISTS agent_training_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What was reviewed
  agent_type text NOT NULL,           -- 'dip' or 'maintenance'
  source_table text NOT NULL,         -- e.g., 'staging_spec_suggestions'
  source_id uuid NOT NULL,            -- ID of the item reviewed

  -- Item snapshot (for reference even if source changes)
  item_snapshot jsonb NOT NULL,

  -- Decision
  decision text NOT NULL,             -- 'approved' | 'rejected'
  reasoning text,                     -- User's explanation of why

  -- Metadata
  decision_source text DEFAULT 'human', -- 'human' | 'agent' | 'telegram'
  confidence numeric,                 -- Agent confidence (null for human decisions)

  created_at timestamptz DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_training_agent_type ON agent_training_decisions(agent_type);
CREATE INDEX IF NOT EXISTS idx_training_source ON agent_training_decisions(source_table, source_id);
CREATE INDEX IF NOT EXISTS idx_training_decision ON agent_training_decisions(decision);
CREATE INDEX IF NOT EXISTS idx_training_created ON agent_training_decisions(created_at DESC);

-- Table: agent_config
-- Tracks agent readiness and learned criteria
CREATE TABLE IF NOT EXISTS agent_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type text UNIQUE NOT NULL,    -- 'dip' or 'maintenance'

  -- Learning state
  total_decisions integer DEFAULT 0,
  min_decisions_to_activate integer DEFAULT 50,
  is_active boolean DEFAULT false,

  -- Confidence thresholds
  auto_approve_threshold numeric DEFAULT 0.85,
  auto_reject_threshold numeric DEFAULT 0.85,
  escalate_below numeric DEFAULT 0.70,

  -- Learned criteria (built from training analysis)
  learned_criteria jsonb,             -- Extracted rules/patterns
  example_approvals jsonb,            -- Few-shot examples of approved items
  example_rejections jsonb,           -- Few-shot examples of rejected items

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Seed initial config for DIP agent
INSERT INTO agent_config (agent_type, min_decisions_to_activate)
VALUES ('dip', 50)
ON CONFLICT (agent_type) DO NOTHING;

-- Seed initial config for Maintenance agent (for later)
INSERT INTO agent_config (agent_type, min_decisions_to_activate)
VALUES ('maintenance', 50)
ON CONFLICT (agent_type) DO NOTHING;

-- Grant permissions (adjust role as needed)
-- GRANT ALL ON agent_training_decisions TO service_role;
-- GRANT ALL ON agent_config TO service_role;
