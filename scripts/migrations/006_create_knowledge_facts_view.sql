-- Migration: Create knowledge_facts materialized view for Step 7: Fact-First Retrieval
-- Purpose: Unified fact layer for intelligent retrieval from approved DIP suggestions
-- Date: 2025-01-09
-- Author: Step 7 - Fact-First Retrieval

-- Create materialized view that unifies approved facts from all DIP suggestion tables
CREATE MATERIALIZED VIEW IF NOT EXISTS knowledge_facts AS
SELECT
  doc_id,
  'spec' AS fact_type,
  hint_type AS key,
  value,
  unit,
  NULL AS intent,
  NULL AS query,
  NULL AS expected,
  approved_at,
  page,
  context,
  confidence
FROM spec_suggestions
WHERE approved_at IS NOT NULL

UNION ALL

SELECT
  doc_id,
  'intent_hint' AS fact_type,
  NULL AS key,
  NULL AS value,
  NULL AS unit,
  prompt AS intent,
  NULL AS query,
  NULL AS expected,
  approved_at,
  page,
  context,
  confidence
FROM intent_hints
WHERE approved_at IS NOT NULL

UNION ALL

SELECT
  doc_id,
  'golden_test' AS fact_type,
  NULL AS key,
  NULL AS value,
  NULL AS unit,
  NULL AS intent,
  query,
  expected,
  approved_at,
  NULL AS page,
  NULL AS context,
  NULL AS confidence
FROM golden_tests
WHERE approved_at IS NOT NULL;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_knowledge_facts_key ON knowledge_facts (key);
CREATE INDEX IF NOT EXISTS idx_knowledge_facts_intent ON knowledge_facts (intent);
CREATE INDEX IF NOT EXISTS idx_knowledge_facts_query ON knowledge_facts (query);
CREATE INDEX IF NOT EXISTS idx_knowledge_facts_fact_type ON knowledge_facts (fact_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_facts_doc_id ON knowledge_facts (doc_id);

-- Add comment for documentation
COMMENT ON MATERIALIZED VIEW knowledge_facts IS 'Unified fact layer for fact-first retrieval (Step 7) - combines approved specs, intents, and golden tests';

-- Refresh the materialized view to populate it with existing data
REFRESH MATERIALIZED VIEW knowledge_facts;
