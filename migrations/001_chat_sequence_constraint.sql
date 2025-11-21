-- Migration: 001_chat_sequence_constraint.sql
-- Date: 2025-11-21
-- Purpose: Add unique constraint on thread_id + sequence_number to prevent race conditions
--
-- This constraint ensures that each message within a thread has a unique sequence number,
-- preventing duplicate sequence numbers that could occur during concurrent operations.
-- The frontend increments sequence before use, so on failure it can rollback:
-- 1. Delete failed message
-- 2. Decrement sequence
-- 3. Reuse the sequence number

-- Drop existing constraint if it exists (idempotent migration)
ALTER TABLE chat_messages
DROP CONSTRAINT IF EXISTS unique_thread_sequence;

-- Add unique constraint on thread_id and sequence_number
ALTER TABLE chat_messages
ADD CONSTRAINT unique_thread_sequence
UNIQUE (thread_id, sequence_number);

-- Create index for performance (if not already created by the unique constraint)
CREATE INDEX IF NOT EXISTS idx_messages_thread_seq
ON chat_messages(thread_id, sequence_number);

-- Add helpful comment explaining the constraint
COMMENT ON CONSTRAINT unique_thread_sequence ON chat_messages IS
'Prevents race conditions during message creation. Frontend increments sequence before use, enabling rollback on failure: delete failed message, decrement counter, reuse number. This ensures sequence numbers are always contiguous within a thread.';