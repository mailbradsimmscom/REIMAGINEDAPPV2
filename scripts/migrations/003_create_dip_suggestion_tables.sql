-- Migration: Create DIP suggestion tables
-- Purpose: Support DIP suggestion review and approval workflow
-- Date: 2025-01-09
-- Author: Phase 3.1 - Database Migrations

-- Table: spec_suggestions
-- Stores approved specification hints from DIP processing
CREATE TABLE IF NOT EXISTS spec_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id VARCHAR(255) NOT NULL,
    hint_type VARCHAR(100) NOT NULL,
    value TEXT NOT NULL,
    unit VARCHAR(50),
    page INTEGER,
    context TEXT,
    confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
    bbox JSONB, -- Bounding box coordinates
    approved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    approved_by VARCHAR(255), -- Admin user who approved
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: entity_candidates
-- Stores extracted entity suggestions from DIP processing
CREATE TABLE IF NOT EXISTS entity_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id VARCHAR(255) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    value TEXT NOT NULL,
    page INTEGER,
    context TEXT,
    confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
    bbox JSONB, -- Bounding box coordinates
    approved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    approved_by VARCHAR(255), -- Admin user who approved
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: playbook_hints
-- Stores approved golden test cases for playbook generation
CREATE TABLE IF NOT EXISTS playbook_hints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id VARCHAR(255) NOT NULL,
    test_name VARCHAR(255) NOT NULL,
    test_type VARCHAR(100) NOT NULL,
    description TEXT,
    steps JSONB, -- Array of step descriptions
    expected_result TEXT,
    page INTEGER,
    confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
    bbox JSONB, -- Bounding box coordinates
    approved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    approved_by VARCHAR(255), -- Admin user who approved
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: intent_hints
-- Stores natural language prompts for routing and intent detection
CREATE TABLE IF NOT EXISTS intent_hints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id VARCHAR(255) NOT NULL,
    intent_type VARCHAR(100) NOT NULL,
    prompt TEXT NOT NULL,
    context TEXT,
    page INTEGER,
    confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
    bbox JSONB, -- Bounding box coordinates
    approved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    approved_by VARCHAR(255), -- Admin user who approved
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_spec_suggestions_doc_id ON spec_suggestions(doc_id);
CREATE INDEX IF NOT EXISTS idx_spec_suggestions_hint_type ON spec_suggestions(hint_type);
CREATE INDEX IF NOT EXISTS idx_spec_suggestions_approved_at ON spec_suggestions(approved_at);

CREATE INDEX IF NOT EXISTS idx_entity_candidates_doc_id ON entity_candidates(doc_id);
CREATE INDEX IF NOT EXISTS idx_entity_candidates_entity_type ON entity_candidates(entity_type);
CREATE INDEX IF NOT EXISTS idx_entity_candidates_approved_at ON entity_candidates(approved_at);

CREATE INDEX IF NOT EXISTS idx_playbook_hints_doc_id ON playbook_hints(doc_id);
CREATE INDEX IF NOT EXISTS idx_playbook_hints_test_type ON playbook_hints(test_type);
CREATE INDEX IF NOT EXISTS idx_playbook_hints_approved_at ON playbook_hints(approved_at);

CREATE INDEX IF NOT EXISTS idx_intent_hints_doc_id ON intent_hints(doc_id);
CREATE INDEX IF NOT EXISTS idx_intent_hints_intent_type ON intent_hints(intent_type);
CREATE INDEX IF NOT EXISTS idx_intent_hints_approved_at ON intent_hints(approved_at);

-- Add foreign key constraints to documents table (if it exists)
-- Note: This assumes the documents table has a doc_id column
-- ALTER TABLE spec_suggestions ADD CONSTRAINT fk_spec_suggestions_doc_id 
--     FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE;
-- ALTER TABLE entity_candidates ADD CONSTRAINT fk_entity_candidates_doc_id 
--     FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE;
-- ALTER TABLE playbook_hints ADD CONSTRAINT fk_playbook_hints_doc_id 
--     FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE;
-- ALTER TABLE intent_hints ADD CONSTRAINT fk_intent_hints_doc_id 
--     FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE;

-- Add comments for documentation
COMMENT ON TABLE spec_suggestions IS 'Approved specification hints from DIP processing';
COMMENT ON TABLE entity_candidates IS 'Extracted entity suggestions from DIP processing';
COMMENT ON TABLE playbook_hints IS 'Approved golden test cases for playbook generation';
COMMENT ON TABLE intent_hints IS 'Natural language prompts for routing and intent detection';
