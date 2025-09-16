-- Migration: Reshape playbook_hints staging table for new OpenAI extraction
-- Purpose: Add columns for rich procedure data structure
-- Date: 2025-01-16
-- Author: OpenAI Playbook Extraction

-- Add new columns for rich procedure structure
ALTER TABLE playbook_hints 
ADD COLUMN IF NOT EXISTS procedure_id text,
ADD COLUMN IF NOT EXISTS procedure_title text,
ADD COLUMN IF NOT EXISTS procedure_category text CHECK (procedure_category IN ('installation', 'operation', 'troubleshooting', 'maintenance', 'safety')),
ADD COLUMN IF NOT EXISTS procedure_preconditions jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS procedure_steps jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS procedure_expected_outcome text,
ADD COLUMN IF NOT EXISTS procedure_error_codes jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS procedure_related_procedures jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS procedure_page_references jsonb DEFAULT '[]'::jsonb;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_playbook_hints_procedure_id ON playbook_hints(procedure_id);
CREATE INDEX IF NOT EXISTS idx_playbook_hints_procedure_category ON playbook_hints(procedure_category);

-- Clear existing old format data to start fresh
DELETE FROM playbook_hints WHERE procedure_id IS NULL;

-- Add comment to clarify this is now the final destination
COMMENT ON TABLE playbook_hints IS 'Final destination for rich playbook procedure data from OpenAI extraction';
