-- Migration: Add summary column to chat_threads table
-- Purpose: Store LLM-generated 6-word summaries for sidebar display
-- Date: 2025-09-28

BEGIN;

-- Add summary column to store LLM-generated summaries
ALTER TABLE chat_threads
ADD COLUMN IF NOT EXISTS summary TEXT DEFAULT NULL;

-- Add index for faster summary queries
CREATE INDEX IF NOT EXISTS idx_chat_threads_summary ON chat_threads(summary) WHERE summary IS NOT NULL;

-- Add column comment
COMMENT ON COLUMN chat_threads.summary IS 'LLM-generated 6-word summary of the first Q&A pair for sidebar display';

COMMIT;

-- Verification
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'chat_threads'
    AND column_name = 'summary';