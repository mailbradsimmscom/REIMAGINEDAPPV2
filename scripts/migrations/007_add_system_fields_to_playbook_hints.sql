-- Migration: Add system grouping fields to playbook_hints table
-- Purpose: Enable playbook generation by grouping hints by system/subsystem
-- Date: 2025-01-09
-- Author: Step 8 - Schema Alignment

-- Add system grouping fields to playbook_hints
ALTER TABLE playbook_hints 
ADD COLUMN IF NOT EXISTS doc_id text REFERENCES documents(doc_id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS system_norm text,
ADD COLUMN IF NOT EXISTS subsystem_norm text;

-- Add indexes for efficient grouping queries
CREATE INDEX IF NOT EXISTS idx_playbook_hints_doc_id ON playbook_hints(doc_id);
CREATE INDEX IF NOT EXISTS idx_playbook_hints_system_norm ON playbook_hints(system_norm);
CREATE INDEX IF NOT EXISTS idx_playbook_hints_subsystem_norm ON playbook_hints(subsystem_norm);
CREATE INDEX IF NOT EXISTS idx_playbook_hints_system_group ON playbook_hints(doc_id, system_norm, subsystem_norm);

-- Add comments for documentation
COMMENT ON COLUMN playbook_hints.doc_id IS 'Reference to the document that generated this playbook hint';
COMMENT ON COLUMN playbook_hints.system_norm IS 'Normalized system name for grouping playbook hints';
COMMENT ON COLUMN playbook_hints.subsystem_norm IS 'Normalized subsystem name for grouping playbook hints';

-- Backfill existing data with system information from documents
-- This will populate the new fields for existing approved hints
UPDATE playbook_hints 
SET 
  system_norm = COALESCE(d.system_norm, d.manufacturer, 'unknown'),
  subsystem_norm = COALESCE(d.subsystem_norm, d.model, 'general')
FROM documents d
WHERE playbook_hints.doc_id = d.doc_id
  AND playbook_hints.system_norm IS NULL;

-- Set default values for any remaining NULL entries
UPDATE playbook_hints 
SET 
  system_norm = 'unknown',
  subsystem_norm = 'general'
WHERE system_norm IS NULL OR subsystem_norm IS NULL;
