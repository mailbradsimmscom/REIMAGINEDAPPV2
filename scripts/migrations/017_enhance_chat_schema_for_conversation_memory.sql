-- Migration: Enhance chat schema for conversation memory system
-- This migration adds fields needed for equipment context tracking,
-- conversation memory weights, and enhanced metadata support.

BEGIN;

-- 1. Enhance chat_sessions table for conversation memory
ALTER TABLE "public"."chat_sessions"
ADD COLUMN IF NOT EXISTS "primary_equipment" jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS "equipment_history" jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "conversation_stats" jsonb DEFAULT '{
  "total_exchanges": 0,
  "equipment_mentions": 0,
  "last_activity": null
}'::jsonb;

COMMENT ON COLUMN "public"."chat_sessions"."primary_equipment" IS 'Primary equipment identified in this session (manufacturer, model, asset_uid)';
COMMENT ON COLUMN "public"."chat_sessions"."equipment_history" IS 'Array of all equipment mentioned in this session with weights';
COMMENT ON COLUMN "public"."chat_sessions"."conversation_stats" IS 'Statistics about the conversation (exchanges, mentions, activity)';

-- 2. Enhance chat_threads table for thread memory and auto-naming
ALTER TABLE "public"."chat_threads"
ADD COLUMN IF NOT EXISTS "auto_named" boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS "named_at" timestamp with time zone DEFAULT NULL,
ADD COLUMN IF NOT EXISTS "primary_topic" text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS "equipment_context" jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "thread_summary" text DEFAULT NULL;

COMMENT ON COLUMN "public"."chat_threads"."auto_named" IS 'Whether this thread was automatically named by the system';
COMMENT ON COLUMN "public"."chat_threads"."named_at" IS 'When the thread was last named (auto or manual)';
COMMENT ON COLUMN "public"."chat_threads"."primary_topic" IS 'Primary topic/intent of this thread (for memory context)';
COMMENT ON COLUMN "public"."chat_threads"."equipment_context" IS 'Equipment context for this thread with weights';
COMMENT ON COLUMN "public"."chat_threads"."thread_summary" IS 'Auto-generated summary of thread content for memory';

-- 3. Enhance chat_messages table for equipment tracking and processing metadata
ALTER TABLE "public"."chat_messages"
ADD COLUMN IF NOT EXISTS "equipment_mentioned" jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS "processing_metadata" jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS "memory_weight" decimal(3,2) DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS "conversation_turn" integer DEFAULT 0;

COMMENT ON COLUMN "public"."chat_messages"."equipment_mentioned" IS 'Equipment identified/mentioned in this message';
COMMENT ON COLUMN "public"."chat_messages"."processing_metadata" IS 'LLM processing metadata (classification, confidence, etc.)';
COMMENT ON COLUMN "public"."chat_messages"."memory_weight" IS 'Weight for conversation memory (1.0=current, 0.8=recent, 0.5=older, 0.2=old)';
COMMENT ON COLUMN "public"."chat_messages"."conversation_turn" IS 'Turn number in conversation for memory weighting';

-- 4. Create equipment_context table for detailed equipment tracking
CREATE TABLE IF NOT EXISTS "public"."chat_equipment_context" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "session_id" uuid NOT NULL,
    "thread_id" uuid,
    "message_id" uuid,
    "asset_uid" text NOT NULL,
    "manufacturer" text,
    "model" text,
    "mention_type" text DEFAULT 'direct', -- 'direct', 'inferred', 'related'
    "confidence" decimal(3,2) DEFAULT 1.0,
    "context_weight" decimal(3,2) DEFAULT 1.0,
    "first_mentioned_at" timestamp with time zone DEFAULT now(),
    "last_mentioned_at" timestamp with time zone DEFAULT now(),
    "mention_count" integer DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "chat_equipment_context_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_equipment_context_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE CASCADE,
    CONSTRAINT "chat_equipment_context_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE CASCADE,
    CONSTRAINT "chat_equipment_context_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE CASCADE,
    CONSTRAINT "chat_equipment_context_mention_type_check" CHECK (mention_type IN ('direct', 'inferred', 'related')),
    CONSTRAINT "chat_equipment_context_confidence_check" CHECK (confidence >= 0.0 AND confidence <= 1.0),
    CONSTRAINT "chat_equipment_context_context_weight_check" CHECK (context_weight >= 0.0 AND context_weight <= 1.0)
);

COMMENT ON TABLE "public"."chat_equipment_context" IS 'Detailed tracking of equipment mentions and context across conversations';
COMMENT ON COLUMN "public"."chat_equipment_context"."mention_type" IS 'How equipment was identified: direct (user mentioned), inferred (LLM inferred), related (contextually related)';
COMMENT ON COLUMN "public"."chat_equipment_context"."confidence" IS 'Confidence that this equipment is relevant to the conversation';
COMMENT ON COLUMN "public"."chat_equipment_context"."context_weight" IS 'Weight for conversation memory (decreases over time)';

-- 5. Create indexes for performance
CREATE INDEX IF NOT EXISTS "idx_chat_equipment_context_session_id" ON "public"."chat_equipment_context"("session_id");
CREATE INDEX IF NOT EXISTS "idx_chat_equipment_context_thread_id" ON "public"."chat_equipment_context"("thread_id");
CREATE INDEX IF NOT EXISTS "idx_chat_equipment_context_asset_uid" ON "public"."chat_equipment_context"("asset_uid");
CREATE INDEX IF NOT EXISTS "idx_chat_equipment_context_last_mentioned" ON "public"."chat_equipment_context"("last_mentioned_at");

CREATE INDEX IF NOT EXISTS "idx_chat_messages_equipment_mentioned" ON "public"."chat_messages" USING gin("equipment_mentioned");
CREATE INDEX IF NOT EXISTS "idx_chat_messages_conversation_turn" ON "public"."chat_messages"("conversation_turn");
CREATE INDEX IF NOT EXISTS "idx_chat_messages_memory_weight" ON "public"."chat_messages"("memory_weight");

CREATE INDEX IF NOT EXISTS "idx_chat_threads_auto_named" ON "public"."chat_threads"("auto_named");
CREATE INDEX IF NOT EXISTS "idx_chat_threads_equipment_context" ON "public"."chat_threads" USING gin("equipment_context");

CREATE INDEX IF NOT EXISTS "idx_chat_sessions_equipment_history" ON "public"."chat_sessions" USING gin("equipment_history");

-- 6. Create helper functions for conversation memory

-- Function to get weighted conversation context for a thread
CREATE OR REPLACE FUNCTION get_weighted_conversation_context(thread_uuid uuid, context_limit integer DEFAULT 10)
RETURNS TABLE(
    message_id uuid,
    role text,
    content text,
    equipment_mentioned jsonb,
    memory_weight decimal,
    conversation_turn integer,
    created_at timestamp with time zone
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.role,
        m.content,
        m.equipment_mentioned,
        m.memory_weight,
        m.conversation_turn,
        m.created_at
    FROM chat_messages m
    WHERE m.thread_id = thread_uuid
    ORDER BY m.created_at DESC
    LIMIT context_limit;
END;
$$;

-- Function to update equipment context weights (for fading memory)
CREATE OR REPLACE FUNCTION update_equipment_context_weights()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    -- Decrease weights based on age (fading memory)
    UPDATE chat_equipment_context
    SET context_weight = GREATEST(0.1, context_weight * 0.95)
    WHERE last_mentioned_at < now() - interval '1 day';

    -- Archive very old, low-weight entries
    DELETE FROM chat_equipment_context
    WHERE context_weight < 0.1
      AND last_mentioned_at < now() - interval '30 days';
END;
$$;

-- 7. Set up RLS (Row Level Security) policies if needed
-- Note: Assuming sessions are user-scoped, but this depends on your auth setup

-- 8. Grant permissions
ALTER TABLE "public"."chat_equipment_context" OWNER TO "postgres";
GRANT ALL ON TABLE "public"."chat_equipment_context" TO "postgres";
GRANT ALL ON TABLE "public"."chat_equipment_context" TO "anon";
GRANT ALL ON TABLE "public"."chat_equipment_context" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_equipment_context" TO "service_role";

COMMIT;

-- Migration completed: Enhanced chat schema for conversation memory system
-- New capabilities:
-- 1. Equipment context tracking across sessions/threads/messages
-- 2. Conversation memory with weights and fading
-- 3. Auto-thread naming support
-- 4. Enhanced metadata for LLM processing
-- 5. Helper functions for memory operations