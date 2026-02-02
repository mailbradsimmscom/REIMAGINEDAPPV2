-- Migration 044: Add user_selected flag to document_referenced_systems
-- Required for DIP exclude list computation
--
-- Current problem:
--   We only store user-selected referenced systems, losing the full detected list.
--   DIP needs: exclude_refs = detected_refs - user_selections
--
-- Solution:
--   Store ALL detected referenced systems from model detection.
--   Mark which ones the user selected with user_selected=true.
--
-- Run in Supabase SQL Editor

-- ============================================
-- 1. Add user_selected column
-- ============================================
ALTER TABLE document_referenced_systems
ADD COLUMN IF NOT EXISTS user_selected BOOLEAN DEFAULT false;

COMMENT ON COLUMN document_referenced_systems.user_selected IS 'True if user selected this system as installed on their boat. False = detected but not selected.';

-- ============================================
-- 2. Mark existing rows as user_selected (they were all user selections)
-- ============================================
UPDATE document_referenced_systems
SET user_selected = true
WHERE user_selected IS NULL OR user_selected = false;

-- ============================================
-- 3. Add index for filtering
-- ============================================
CREATE INDEX IF NOT EXISTS idx_doc_ref_systems_user_selected
  ON document_referenced_systems(doc_id, user_selected);

-- ============================================
-- 4. Helper view for DIP exclude list computation
-- ============================================
CREATE OR REPLACE VIEW v_dip_exclude_referenced AS
SELECT
  doc_id,
  ARRAY_AGG(canonical_model ORDER BY canonical_model) AS exclude_models
FROM document_referenced_systems
WHERE user_selected = false
GROUP BY doc_id;

COMMENT ON VIEW v_dip_exclude_referenced IS 'Referenced systems detected but NOT selected by user - used for DIP exclude list';

-- ============================================
-- Verification
-- ============================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 044 complete: document_referenced_systems.user_selected added';
  RAISE NOTICE '  - Existing rows marked user_selected=true';
  RAISE NOTICE '  - New detected-but-not-selected refs will have user_selected=false';
  RAISE NOTICE '  - Created v_dip_exclude_referenced view for exclude list queries';
END $$;
