-- Migration 026: Add embeddings for retrieval-based learning
-- Run this in Supabase SQL Editor

-- 1. Enable pgvector extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add embedding column to agent_training_decisions
ALTER TABLE agent_training_decisions
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- 3. Create index for fast similarity search (IVFFlat)
-- Using 100 lists is good for up to ~100k rows
CREATE INDEX IF NOT EXISTS idx_training_embedding
  ON agent_training_decisions
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- 4. Create function to find similar decisions
CREATE OR REPLACE FUNCTION match_training_decisions(
  query_embedding vector(1536),
  match_count int DEFAULT 4,
  filter_table text DEFAULT NULL,
  filter_decision text DEFAULT NULL,
  exclude_weak_labels boolean DEFAULT true
)
RETURNS TABLE (
  id uuid,
  source_table text,
  decision text,
  reasoning text,
  item_snapshot jsonb,
  confidence numeric,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    atd.id,
    atd.source_table,
    atd.decision,
    atd.reasoning,
    atd.item_snapshot,
    atd.confidence,
    1 - (atd.embedding <=> query_embedding) as similarity
  FROM agent_training_decisions atd
  WHERE atd.agent_type = 'dip'
    AND atd.embedding IS NOT NULL
    AND (filter_table IS NULL OR atd.source_table = filter_table)
    AND (filter_decision IS NULL OR atd.decision = filter_decision)
    AND (NOT exclude_weak_labels OR atd.is_weak_label = false)
  ORDER BY atd.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 5. Grant access to the function
GRANT EXECUTE ON FUNCTION match_training_decisions TO authenticated;
GRANT EXECUTE ON FUNCTION match_training_decisions TO service_role;
