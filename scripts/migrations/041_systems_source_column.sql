-- Migration 041: Add source column to systems table
-- Part of Document-First Architecture (see code updates/97)
-- Tracks how a system entry was created
--
-- Two entry paths:
-- 1. 'document' - System created via document upload flow (user selected from detected models)
-- 2. 'manual_entry' - System created via systems.html (user entered manually, no PDF)
--
-- Run in Supabase SQL Editor

-- ============================================
-- 1. Add source column to systems table
-- ============================================
ALTER TABLE systems
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual_entry';

-- ============================================
-- 2. Add constraint for valid values
-- ============================================
ALTER TABLE systems DROP CONSTRAINT IF EXISTS systems_valid_source;
ALTER TABLE systems ADD CONSTRAINT systems_valid_source
  CHECK (source IN ('document', 'manual_entry', 'imported', 'api'));

-- Values:
-- 'document' = Created via document-first upload flow
-- 'manual_entry' = Created via systems.html form (default for existing data)
-- 'imported' = Bulk imported from external source
-- 'api' = Created via API integration

-- ============================================
-- 3. Set existing records to manual_entry
-- ============================================
UPDATE systems
SET source = 'manual_entry'
WHERE source IS NULL;

-- ============================================
-- 4. Add index
-- ============================================
CREATE INDEX IF NOT EXISTS idx_systems_source ON systems(source);

-- ============================================
-- 5. Add comment
-- ============================================
COMMENT ON COLUMN systems.source IS 'How this system entry was created: document (from PDF upload), manual_entry (from systems.html), imported (bulk), api (integration)';

-- ============================================
-- 6. Add detected_models column for document-first flow
-- ============================================
-- Stores the raw LLM detection results before user confirmation
ALTER TABLE systems
ADD COLUMN IF NOT EXISTS detected_from_doc_id TEXT;

COMMENT ON COLUMN systems.detected_from_doc_id IS 'For source=document: The doc_id that this system was detected from during upload';

-- ============================================
-- 7. Helper view: Systems by source
-- ============================================
CREATE OR REPLACE VIEW v_systems_by_source AS
SELECT
  source,
  COUNT(*) as count,
  array_agg(DISTINCT manufacturer_norm) as manufacturers
FROM systems
GROUP BY source;

COMMENT ON VIEW v_systems_by_source IS 'Summary of systems grouped by creation source';

-- ============================================
-- Verification
-- ============================================
DO $$
DECLARE
  manual_count INTEGER;
  doc_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO manual_count FROM systems WHERE source = 'manual_entry';
  SELECT COUNT(*) INTO doc_count FROM systems WHERE source = 'document';

  RAISE NOTICE 'Migration 041 complete: systems.source column added';
  RAISE NOTICE '  - % systems marked as manual_entry (existing data)', manual_count;
  RAISE NOTICE '  - % systems marked as document (new entries)', doc_count;
  RAISE NOTICE '  - Valid sources: document, manual_entry, imported, api';
  RAISE NOTICE '  - Added detected_from_doc_id for traceability';
END $$;
