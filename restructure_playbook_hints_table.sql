-- Migration: Restructure playbook_hints table to match OpenAI response format
-- Purpose: Align table schema with actual data structure from OpenAI API
-- Date: 2025-09-17
-- Note: No data in table, safe to restructure

-- Drop existing table and recreate with proper structure
DROP TABLE IF EXISTS playbook_hints CASCADE;

-- Create new playbook_hints table with proper field mapping
CREATE TABLE playbook_hints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id VARCHAR(255) NOT NULL,
    
    -- Core procedure fields (mapped from OpenAI response)
    title VARCHAR(255) NOT NULL,                    -- maps to procedure.title
    description TEXT,                              -- maps to models array as comma-separated string
    steps JSONB NOT NULL,                          -- maps to procedure.steps array
    expected_outcome TEXT,                         -- maps to procedure.expected_outcome
    preconditions JSONB,                           -- maps to procedure.preconditions array
    error_codes JSONB,                             -- maps to procedure.error_codes array
    
    -- Additional fields
    category VARCHAR(100),                        -- procedure type/category
    page INTEGER,                                 -- page reference
    confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
    bbox JSONB,                                   -- bounding box coordinates
    
    -- System grouping fields
    system_norm TEXT,
    subsystem_norm TEXT,
    manufacturer_norm TEXT,
    model_norm TEXT,
    asset_uid TEXT,
    
    -- Status and approval fields
    status TEXT DEFAULT 'pending',
    approved_at TIMESTAMP WITH TIME ZONE,
    approved_by VARCHAR(255),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX idx_playbook_hints_doc_id ON playbook_hints(doc_id);
CREATE INDEX idx_playbook_hints_title ON playbook_hints(title);
CREATE INDEX idx_playbook_hints_category ON playbook_hints(category);
CREATE INDEX idx_playbook_hints_status ON playbook_hints(status);
CREATE INDEX idx_playbook_hints_system_norm ON playbook_hints(system_norm);
CREATE INDEX idx_playbook_hints_subsystem_norm ON playbook_hints(subsystem_norm);
CREATE INDEX idx_playbook_hints_manufacturer_norm ON playbook_hints(manufacturer_norm);
CREATE INDEX idx_playbook_hints_model_norm ON playbook_hints(model_norm);
CREATE INDEX idx_playbook_hints_asset_uid ON playbook_hints(asset_uid);
CREATE INDEX idx_playbook_hints_approved_at ON playbook_hints(approved_at);

-- Add foreign key constraint to documents table
ALTER TABLE playbook_hints 
ADD CONSTRAINT fk_playbook_hints_doc_id 
FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE;

-- Add comments for documentation
COMMENT ON TABLE playbook_hints IS 'Playbook procedures extracted from technical manuals via OpenAI';
COMMENT ON COLUMN playbook_hints.title IS 'Procedure title from OpenAI response';
COMMENT ON COLUMN playbook_hints.description IS 'Models array converted to comma-separated string';
COMMENT ON COLUMN playbook_hints.steps IS 'Procedure steps array from OpenAI response';
COMMENT ON COLUMN playbook_hints.expected_outcome IS 'Expected outcome from OpenAI response';
COMMENT ON COLUMN playbook_hints.preconditions IS 'Preconditions array from OpenAI response';
COMMENT ON COLUMN playbook_hints.error_codes IS 'Error codes array from OpenAI response';
COMMENT ON COLUMN playbook_hints.system_norm IS 'Normalized system name for grouping';
COMMENT ON COLUMN playbook_hints.subsystem_norm IS 'Normalized subsystem name for grouping';
COMMENT ON COLUMN playbook_hints.manufacturer_norm IS 'Normalized manufacturer name';
COMMENT ON COLUMN playbook_hints.model_norm IS 'Normalized model name';
COMMENT ON COLUMN playbook_hints.asset_uid IS 'Asset unique identifier';
