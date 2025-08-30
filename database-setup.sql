-- Chat Database Setup for Supabase
-- Run this in your Supabase SQL editor

-- Create chat_sessions table
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL DEFAULT 'New Chat',
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create chat_threads table
CREATE TABLE IF NOT EXISTS chat_threads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL DEFAULT 'New Thread',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create chat_messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_threads_session_id ON chat_threads(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_threads_updated_at ON chat_threads(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_id ON chat_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at ASC);

-- Enable Row Level Security (RLS) - optional but recommended
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (basic public access for now)
-- You can customize these based on your authentication needs

-- Allow all operations on chat_sessions (for demo purposes)
CREATE POLICY "Allow all operations on chat_sessions" ON chat_sessions
    FOR ALL USING (true);

-- Allow all operations on chat_threads (for demo purposes)
CREATE POLICY "Allow all operations on chat_threads" ON chat_threads
    FOR ALL USING (true);

-- Allow all operations on chat_messages (for demo purposes)
CREATE POLICY "Allow all operations on chat_messages" ON chat_messages
    FOR ALL USING (true);

-- Insert a sample chat session for testing
INSERT INTO chat_sessions (name, description) 
VALUES ('Welcome Chat', 'Your first chat session to get started')
ON CONFLICT DO NOTHING;

-- Get the session ID for the sample thread
DO $$
DECLARE
    session_id UUID;
BEGIN
    SELECT id INTO session_id FROM chat_sessions WHERE name = 'Welcome Chat' LIMIT 1;
    
    IF session_id IS NOT NULL THEN
        -- Insert a sample thread
        INSERT INTO chat_threads (session_id, name) 
        VALUES (session_id, 'Getting Started')
        ON CONFLICT DO NOTHING;
    END IF;
END $$;
