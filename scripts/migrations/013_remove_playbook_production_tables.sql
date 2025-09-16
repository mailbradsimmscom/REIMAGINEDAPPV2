-- Migration: Remove playbook production tables
-- Purpose: Playbook_hints is now the final destination - no migration needed
-- Date: 2025-01-16
-- Author: Playbook cleanup removal

-- Drop playbook_steps table first (due to foreign key constraints)
DROP TABLE IF EXISTS playbook_steps CASCADE;

-- Drop playbooks table
DROP TABLE IF EXISTS playbooks CASCADE;

-- Remove any remaining indexes
DROP INDEX IF EXISTS idx_playbooks_system_norm;
DROP INDEX IF EXISTS idx_playbooks_subsystem_norm;
DROP INDEX IF EXISTS idx_playbooks_doc_id;
DROP INDEX IF EXISTS idx_playbooks_system_group;
DROP INDEX IF EXISTS idx_playbook_steps_playbook_id;
DROP INDEX IF EXISTS idx_playbook_steps_step_number;
DROP INDEX IF EXISTS idx_playbook_steps_source_hint_id;
DROP INDEX IF EXISTS idx_playbook_steps_doc_id;

-- Add comment to playbook_hints table to clarify it's now the final destination
COMMENT ON TABLE playbook_hints IS 'Final destination for playbook data - no migration to production tables';
