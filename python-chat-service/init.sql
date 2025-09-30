-- Initialize chat message history tables for LangChain PostgresChatMessageHistory

CREATE TABLE IF NOT EXISTS message_store (
    session_id TEXT NOT NULL,
    message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_store_session_id ON message_store(session_id);
CREATE INDEX IF NOT EXISTS idx_message_store_created_at ON message_store(created_at);

-- Optional: Create a summary table for conversation summaries
CREATE TABLE IF NOT EXISTS conversation_summaries (
    session_id TEXT PRIMARY KEY,
    summary TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Optional: Create an entity extraction table
CREATE TABLE IF NOT EXISTS conversation_entities (
    session_id TEXT NOT NULL,
    entity_key TEXT NOT NULL,
    entity_value TEXT,
    entity_type TEXT DEFAULT 'equipment',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, entity_key)
);