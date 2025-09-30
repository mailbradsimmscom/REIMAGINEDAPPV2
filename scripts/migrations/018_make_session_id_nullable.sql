-- Migration: Remove session_id from chat_threads table
-- Purpose: Remove session concept entirely - threads are now independent
-- Date: 2025-09-28
-- Related: Conversation memory refactor

BEGIN;

-- Drop the foreign key constraint if it exists
ALTER TABLE chat_threads
DROP CONSTRAINT IF EXISTS chat_threads_session_id_fkey;

-- Drop the index if it exists
DROP INDEX IF EXISTS idx_chat_threads_session_id;

-- Remove session_id column entirely
ALTER TABLE chat_threads
DROP COLUMN IF EXISTS session_id;

COMMIT;

-- Verification - should return no rows
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'chat_threads'
    AND column_name = 'session_id';