-- Migration: Add sequence tracking to chat messages and thread message counts
-- Purpose: Enable sequential message numbering (1,2,3,4...) within threads
-- Date: 2025-09-28
-- Related: CHAT_ARCHITECTURE_PLAN.md Phase 1

-- Step 1: Add sequence_number column to chat_messages table
ALTER TABLE chat_messages
ADD COLUMN IF NOT EXISTS sequence_number INTEGER;

-- Step 2: Add message_count column to chat_threads table
ALTER TABLE chat_threads
ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0;

-- Step 3: Backfill sequence_number for existing messages (ordered by created_at)
WITH numbered_messages AS (
  SELECT
    id,
    thread_id,
    ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY created_at ASC) as seq_num
  FROM chat_messages
  WHERE sequence_number IS NULL
)
UPDATE chat_messages cm
SET sequence_number = nm.seq_num
FROM numbered_messages nm
WHERE cm.id = nm.id;

-- Step 4: Backfill message_count for existing threads
WITH thread_counts AS (
  SELECT
    thread_id,
    COUNT(*) as msg_count
  FROM chat_messages
  GROUP BY thread_id
)
UPDATE chat_threads ct
SET message_count = tc.msg_count
FROM thread_counts tc
WHERE ct.id = tc.thread_id;

-- Step 5: Make sequence_number NOT NULL after backfill
ALTER TABLE chat_messages
ALTER COLUMN sequence_number SET NOT NULL;

-- Step 6: Add unique constraint on (thread_id, sequence_number)
-- This prevents duplicate sequence numbers within a thread
ALTER TABLE chat_messages
ADD CONSTRAINT chat_messages_thread_sequence_unique
UNIQUE (thread_id, sequence_number);

-- Step 7: Add index on (thread_id, sequence_number) for fast lookups
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_sequence
ON chat_messages(thread_id, sequence_number);

-- Step 8: Add index on message_count for thread queries
CREATE INDEX IF NOT EXISTS idx_chat_threads_message_count
ON chat_threads(message_count);

-- Step 9: Add database function to get next sequence number for a thread
CREATE OR REPLACE FUNCTION get_next_message_sequence(p_thread_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_next_seq INTEGER;
BEGIN
  SELECT COALESCE(MAX(sequence_number), 0) + 1
  INTO v_next_seq
  FROM chat_messages
  WHERE thread_id = p_thread_id;

  RETURN v_next_seq;
END;
$$ LANGUAGE plpgsql;

-- Step 10: Add database function to increment thread message count
CREATE OR REPLACE FUNCTION increment_thread_message_count(p_thread_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE chat_threads
  SET message_count = COALESCE(message_count, 0) + 1
  WHERE id = p_thread_id
  RETURNING message_count INTO v_new_count;

  RETURN v_new_count;
END;
$$ LANGUAGE plpgsql;

-- Step 11: Add database function to decrement thread message count (for rollback)
CREATE OR REPLACE FUNCTION decrement_thread_message_count(p_thread_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE chat_threads
  SET message_count = GREATEST(COALESCE(message_count, 1) - 1, 0)
  WHERE id = p_thread_id
  RETURNING message_count INTO v_new_count;

  RETURN v_new_count;
END;
$$ LANGUAGE plpgsql;

-- Step 12: Add column comments
COMMENT ON COLUMN chat_messages.sequence_number IS 'Sequential number within thread (1,2,3,4...). User=odd, Assistant=even';
COMMENT ON COLUMN chat_threads.message_count IS 'Total number of messages in thread. Updated by increment/decrement functions';

-- Step 13: Verify the migration worked
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'chat_messages'
    AND column_name = 'sequence_number'
UNION ALL
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'chat_threads'
    AND column_name = 'message_count';

-- Step 14: Test the functions
DO $$
DECLARE
  test_thread_id UUID;
  next_seq INTEGER;
BEGIN
  -- Get a sample thread ID for testing (or create one)
  SELECT id INTO test_thread_id FROM chat_threads LIMIT 1;

  IF test_thread_id IS NOT NULL THEN
    -- Test get_next_message_sequence
    SELECT get_next_message_sequence(test_thread_id) INTO next_seq;
    RAISE NOTICE 'Next sequence for thread %: %', test_thread_id, next_seq;

    -- Test increment_thread_message_count
    PERFORM increment_thread_message_count(test_thread_id);
    RAISE NOTICE 'Incremented message count for thread %', test_thread_id;

    -- Test decrement_thread_message_count (rollback the increment)
    PERFORM decrement_thread_message_count(test_thread_id);
    RAISE NOTICE 'Decremented message count for thread % (rollback)', test_thread_id;
  ELSE
    RAISE NOTICE 'No threads found for testing. Functions created successfully.';
  END IF;
END $$;