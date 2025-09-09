-- Migration: Add JSONB columns to systems table for suggestion merging
-- Purpose: Enable merging approved suggestions into production tables
-- Date: 2025-01-09
-- Author: Phase 3 - Backend Completion

-- Add JSONB columns to systems table for storing merged suggestions
ALTER TABLE systems 
ADD COLUMN IF NOT EXISTS spec_keywords_jsonb JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS synonyms_jsonb JSONB DEFAULT '{}';

-- Add indexes for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_systems_spec_keywords_jsonb ON systems USING GIN (spec_keywords_jsonb);
CREATE INDEX IF NOT EXISTS idx_systems_synonyms_jsonb ON systems USING GIN (synonyms_jsonb);

-- Add comments for documentation
COMMENT ON COLUMN systems.spec_keywords_jsonb IS 'JSONB storage for merged spec suggestions from DIP processing';
COMMENT ON COLUMN systems.synonyms_jsonb IS 'JSONB storage for merged entity synonyms from DIP processing';

-- Verify the migration worked
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'systems' 
    AND column_name IN ('spec_keywords_jsonb', 'synonyms_jsonb')
ORDER BY column_name;
