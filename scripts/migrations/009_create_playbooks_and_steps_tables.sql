-- Migration: Create playbooks and playbook_steps tables with FK to playbook_hints
-- Purpose: Enable structured playbook generation from approved hints
-- Date: 2025-01-09
-- Author: Step 8 - Schema Alignment

-- Create playbooks table
CREATE TABLE IF NOT EXISTS playbooks (
  playbook_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  system_norm text,
  subsystem_norm text,
  doc_id text REFERENCES documents(doc_id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by text DEFAULT 'system'
);

-- Create playbook_steps table with FK to playbook_hints
CREATE TABLE IF NOT EXISTS playbook_steps (
  step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id uuid REFERENCES playbooks(playbook_id) ON DELETE CASCADE,
  step_number int NOT NULL,
  instruction text NOT NULL,
  source_hint_id uuid REFERENCES playbook_hints(id) ON DELETE SET NULL,
  doc_id text REFERENCES documents(doc_id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_playbooks_system_norm ON playbooks(system_norm);
CREATE INDEX IF NOT EXISTS idx_playbooks_subsystem_norm ON playbooks(subsystem_norm);
CREATE INDEX IF NOT EXISTS idx_playbooks_doc_id ON playbooks(doc_id);
CREATE INDEX IF NOT EXISTS idx_playbooks_system_group ON playbooks(system_norm, subsystem_norm);

CREATE INDEX IF NOT EXISTS idx_playbook_steps_playbook_id ON playbook_steps(playbook_id);
CREATE INDEX IF NOT EXISTS idx_playbook_steps_step_number ON playbook_steps(playbook_id, step_number);
CREATE INDEX IF NOT EXISTS idx_playbook_steps_source_hint_id ON playbook_steps(source_hint_id);
CREATE INDEX IF NOT EXISTS idx_playbook_steps_doc_id ON playbook_steps(doc_id);

-- Add comments for documentation
COMMENT ON TABLE playbooks IS 'Structured playbooks generated from approved playbook hints';
COMMENT ON COLUMN playbooks.title IS 'Human-readable title for the playbook';
COMMENT ON COLUMN playbooks.system_norm IS 'Normalized system name for grouping';
COMMENT ON COLUMN playbooks.subsystem_norm IS 'Normalized subsystem name for grouping';
COMMENT ON COLUMN playbooks.doc_id IS 'Reference to the source document';

COMMENT ON TABLE playbook_steps IS 'Individual steps within a playbook, linked to source hints';
COMMENT ON COLUMN playbook_steps.step_number IS 'Order of execution within the playbook';
COMMENT ON COLUMN playbook_steps.instruction IS 'Human-readable instruction text';
COMMENT ON COLUMN playbook_steps.source_hint_id IS 'Reference to the original playbook hint';
COMMENT ON COLUMN playbook_steps.doc_id IS 'Reference to the source document';

-- Add constraints to ensure data integrity
ALTER TABLE playbook_steps ADD CONSTRAINT chk_playbook_steps_step_number CHECK (step_number > 0);
ALTER TABLE playbooks ADD CONSTRAINT chk_playbooks_title_not_empty CHECK (length(trim(title)) > 0);
ALTER TABLE playbook_steps ADD CONSTRAINT chk_playbook_steps_instruction_not_empty CHECK (length(trim(instruction)) > 0);
