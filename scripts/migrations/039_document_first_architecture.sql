-- Migration 039: Document-First Architecture
-- Combined migration for v5 pipeline changes (see code updates/97, 98)
--
-- Includes:
-- 1. document_systems junction table (many-to-many)
-- 2. applies_to_models columns on all DIP tables
-- 3. systems.source column
-- 4. troubleshooting.possible_causes JSONB
--
-- Run in Supabase SQL Editor

-- ============================================
-- PART 1: Document-Systems Junction Table
-- ============================================
-- Replaces 1:1 documents.asset_uid with many-to-many relationship

CREATE TABLE IF NOT EXISTS document_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id TEXT NOT NULL,
  asset_uid UUID NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(doc_id, asset_uid)
);

-- Add FK constraints separately (more robust)
DO $$
BEGIN
  -- FK to documents
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'document_systems_doc_id_fkey') THEN
    ALTER TABLE document_systems
      ADD CONSTRAINT document_systems_doc_id_fkey
      FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE;
  END IF;

  -- FK to systems
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                 WHERE constraint_name = 'document_systems_asset_uid_fkey') THEN
    ALTER TABLE document_systems
      ADD CONSTRAINT document_systems_asset_uid_fkey
      FOREIGN KEY (asset_uid) REFERENCES systems(asset_uid) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_document_systems_doc ON document_systems(doc_id);
CREATE INDEX IF NOT EXISTS idx_document_systems_asset ON document_systems(asset_uid);
CREATE INDEX IF NOT EXISTS idx_document_systems_primary ON document_systems(is_primary) WHERE is_primary = true;

-- Migrate existing data from documents.asset_uid to junction table
INSERT INTO document_systems (doc_id, asset_uid, is_primary)
SELECT doc_id, asset_uid, true
FROM documents
WHERE asset_uid IS NOT NULL
ON CONFLICT (doc_id, asset_uid) DO NOTHING;

COMMENT ON TABLE document_systems IS 'Junction table linking documents to systems (many-to-many). Replaces documents.asset_uid 1:1 relationship.';
COMMENT ON COLUMN document_systems.is_primary IS 'True if this document is the primary manual FOR this system, false if it only references the system';

ALTER TABLE document_systems ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to document_systems" ON document_systems;
CREATE POLICY "Allow read access to document_systems" ON document_systems FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow service role full access to document_systems" ON document_systems;
CREATE POLICY "Allow service role full access to document_systems" ON document_systems FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- PART 2: applies_to_models Columns
-- ============================================
-- Add to all DIP production tables for model-specific filtering

-- spec_suggestions
ALTER TABLE spec_suggestions ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];
CREATE INDEX IF NOT EXISTS idx_spec_suggestions_applies_to_models ON spec_suggestions USING gin(applies_to_models);
COMMENT ON COLUMN spec_suggestions.applies_to_models IS 'Model names this spec applies to, e.g., ["4JH57"]. Empty or ["all"] = universal.';

-- playbook_hints
ALTER TABLE playbook_hints ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];
CREATE INDEX IF NOT EXISTS idx_playbook_hints_applies_to_models ON playbook_hints USING gin(applies_to_models);
COMMENT ON COLUMN playbook_hints.applies_to_models IS 'Model names this procedure applies to.';

-- golden_tests
ALTER TABLE golden_tests ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];
CREATE INDEX IF NOT EXISTS idx_golden_tests_applies_to_models ON golden_tests USING gin(applies_to_models);
COMMENT ON COLUMN golden_tests.applies_to_models IS 'Model names this test applies to.';

-- intent_router
ALTER TABLE intent_router ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];
ALTER TABLE intent_router ADD COLUMN IF NOT EXISTS doc_id TEXT;
ALTER TABLE intent_router ADD COLUMN IF NOT EXISTS question TEXT;
ALTER TABLE intent_router ADD COLUMN IF NOT EXISTS question_variations TEXT[];
ALTER TABLE intent_router ADD COLUMN IF NOT EXISTS answer TEXT;
CREATE INDEX IF NOT EXISTS idx_intent_router_applies_to_models ON intent_router USING gin(applies_to_models);
CREATE INDEX IF NOT EXISTS idx_intent_router_doc_id ON intent_router(doc_id);
COMMENT ON COLUMN intent_router.applies_to_models IS 'Model names this Q&A applies to.';

-- troubleshooting (already has 'models' column, add applies_to_models for consistency)
ALTER TABLE troubleshooting ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];
UPDATE troubleshooting SET applies_to_models = models WHERE models IS NOT NULL AND applies_to_models IS NULL;
CREATE INDEX IF NOT EXISTS idx_troubleshooting_applies_to_models ON troubleshooting USING gin(applies_to_models);
COMMENT ON COLUMN troubleshooting.applies_to_models IS 'Model names this entry applies to. Replaces legacy "models" column.';

-- Staging tables (backwards compat)
ALTER TABLE staging_spec_suggestions ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];
ALTER TABLE staging_playbook_hints ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];
ALTER TABLE staging_golden_tests ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];
ALTER TABLE staging_intent_router ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];
ALTER TABLE staging_intent_router ADD COLUMN IF NOT EXISTS question TEXT;
ALTER TABLE staging_intent_router ADD COLUMN IF NOT EXISTS question_variations TEXT[];
ALTER TABLE staging_intent_router ADD COLUMN IF NOT EXISTS answer TEXT;
ALTER TABLE staging_troubleshooting ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];
UPDATE staging_troubleshooting SET applies_to_models = models WHERE models IS NOT NULL AND applies_to_models IS NULL;

-- Helper function for filtering
CREATE OR REPLACE FUNCTION filter_by_user_models(
  user_models TEXT[],
  content_models TEXT[]
) RETURNS BOOLEAN AS $$
BEGIN
  IF content_models IS NULL OR array_length(content_models, 1) IS NULL THEN
    RETURN true;
  END IF;
  IF 'all' = ANY(content_models) THEN
    RETURN true;
  END IF;
  RETURN content_models && user_models;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION filter_by_user_models IS 'Returns true if content applies to any of user''s models.';

-- ============================================
-- PART 3: systems.source Column
-- ============================================
-- Track how system entries were created

ALTER TABLE systems ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual_entry';
ALTER TABLE systems ADD COLUMN IF NOT EXISTS detected_from_doc_id TEXT;

-- Add constraint (drop first if exists to avoid duplicate)
ALTER TABLE systems DROP CONSTRAINT IF EXISTS systems_valid_source;
ALTER TABLE systems ADD CONSTRAINT systems_valid_source
  CHECK (source IS NULL OR source IN ('document', 'manual_entry', 'imported', 'api'));

UPDATE systems SET source = 'manual_entry' WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS idx_systems_source ON systems(source);

COMMENT ON COLUMN systems.source IS 'How created: document (PDF upload), manual_entry (form), imported, api';
COMMENT ON COLUMN systems.detected_from_doc_id IS 'For source=document: doc_id this system was detected from';

-- ============================================
-- PART 4: troubleshooting.possible_causes
-- ============================================
-- Multi-cause structure: 1 symptom → N possible causes

ALTER TABLE troubleshooting ADD COLUMN IF NOT EXISTS possible_causes JSONB;
ALTER TABLE staging_troubleshooting ADD COLUMN IF NOT EXISTS possible_causes JSONB;

-- Migrate existing single cause to array structure
UPDATE troubleshooting
SET possible_causes = jsonb_build_array(
  jsonb_build_object(
    'cause', cause,
    'likelihood', 'unknown',
    'fix', resolution,
    'fix_steps', ARRAY[]::TEXT[]
  )
)
WHERE possible_causes IS NULL AND cause IS NOT NULL;

UPDATE staging_troubleshooting
SET possible_causes = jsonb_build_array(
  jsonb_build_object(
    'cause', cause,
    'likelihood', 'unknown',
    'fix', resolution,
    'fix_steps', ARRAY[]::TEXT[]
  )
)
WHERE possible_causes IS NULL AND cause IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_troubleshooting_possible_causes ON troubleshooting USING gin(possible_causes);
CREATE INDEX IF NOT EXISTS idx_staging_troubleshooting_possible_causes ON staging_troubleshooting USING gin(possible_causes);

COMMENT ON COLUMN troubleshooting.possible_causes IS 'Array of {cause, likelihood, fix, fix_steps}. Multiple causes per symptom.';

-- Search helper
CREATE OR REPLACE FUNCTION search_troubleshooting_causes(search_term TEXT)
RETURNS TABLE (id UUID, symptom TEXT, cause_text TEXT, likelihood TEXT, fix TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.symptom, (c->>'cause')::TEXT, (c->>'likelihood')::TEXT, (c->>'fix')::TEXT
  FROM troubleshooting t, jsonb_array_elements(t.possible_causes) AS c
  WHERE t.symptom ILIKE '%' || search_term || '%'
     OR c->>'cause' ILIKE '%' || search_term || '%';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VERIFICATION
-- ============================================
DO $$
DECLARE
  junction_count INTEGER;
  systems_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO junction_count FROM document_systems;
  SELECT COUNT(*) INTO systems_count FROM systems;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 039 (Document-First Architecture) COMPLETE';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'PART 1: document_systems junction table';
  RAISE NOTICE '  - Created table with % existing relationships migrated', junction_count;
  RAISE NOTICE '';
  RAISE NOTICE 'PART 2: applies_to_models columns';
  RAISE NOTICE '  - Added to: spec_suggestions, playbook_hints, golden_tests';
  RAISE NOTICE '  - Added to: intent_router (+ question, answer fields)';
  RAISE NOTICE '  - Added to: troubleshooting, all staging_* tables';
  RAISE NOTICE '  - Created filter_by_user_models() function';
  RAISE NOTICE '';
  RAISE NOTICE 'PART 3: systems.source column';
  RAISE NOTICE '  - % systems marked as manual_entry', systems_count;
  RAISE NOTICE '  - Added detected_from_doc_id for traceability';
  RAISE NOTICE '';
  RAISE NOTICE 'PART 4: troubleshooting.possible_causes';
  RAISE NOTICE '  - Added JSONB column for multi-cause structure';
  RAISE NOTICE '  - Migrated existing cause/resolution data';
  RAISE NOTICE '  - Created search_troubleshooting_causes() function';
  RAISE NOTICE '';
  RAISE NOTICE 'Ready for document-first pipeline implementation!';
END $$;
