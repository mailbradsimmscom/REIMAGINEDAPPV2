-- Migration 040: Cleanup Unused Columns
-- Part of Document-First Architecture cleanup (see code updates/99)
--
-- This migration:
-- 1. Updates dependent views and functions to remove references to columns being dropped
-- 2. Drops unused columns from documents and systems tables
-- 3. Populates missing denormalized fields
--
-- IMPORTANT: Run AFTER verifying code changes are deployed
-- Run in Supabase SQL Editor

-- ============================================
-- PART 1: Drop dependent views
-- ============================================
-- These views reference columns we're dropping

-- systems_to_fetch: uses manual_url, oem_page - obsolete, just drop
DROP VIEW IF EXISTS systems_to_fetch;

-- v_systems_with_instances: uses canonical_model_id, manual_url, oem_page - recreate without them
DROP VIEW IF EXISTS v_systems_with_instances;

CREATE VIEW v_systems_with_instances AS
SELECT
  s.asset_uid,
  s.system_norm,
  s.subsystem_norm,
  s.manufacturer_norm,
  s.model_norm,
  s.description,
  s.spec_keywords,
  s.synonyms_fts,
  s.synonyms_human,
  s.search,
  count(i.instance_uid) AS instance_count,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'instance_uid', i.instance_uid,
        'serial_number', i.serial_number,
        'location', i.location
      ) ORDER BY i.serial_number
    ) FILTER (WHERE i.instance_uid IS NOT NULL),
    '[]'::jsonb
  ) AS instances
FROM systems s
LEFT JOIN instances i USING (asset_uid)
GROUP BY s.asset_uid;

-- ============================================
-- PART 2: Update search_systems function
-- ============================================
-- Remove canonical_model_id from search function

CREATE OR REPLACE FUNCTION search_systems(q text, top_n integer DEFAULT 10)
RETURNS TABLE (
  asset_uid text,
  rank real
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.asset_uid::text as asset_uid,
    ts_rank(
      -- Weighted fields (higher weight = more important)
      setweight(to_tsvector('english', COALESCE(s.model_norm, '')), 'A') ||           -- Weight A (1.0)
      setweight(to_tsvector('english', COALESCE(s.description, '')), 'A') ||          -- Weight A (1.0)
      setweight(to_tsvector('english', COALESCE(s.manufacturer_norm, '')), 'B') ||    -- Weight B (0.4)
      setweight(to_tsvector('english', COALESCE(s.system_norm, '')), 'C') ||          -- Weight C (0.2)
      setweight(to_tsvector('english', COALESCE(s.subsystem_norm, '')), 'C') ||       -- Weight C (0.2)
      setweight(to_tsvector('english', COALESCE(s.spec_keywords, '')), 'D'),          -- Weight D (0.1)
      plainto_tsquery('english', q)
    ) as rank
  FROM systems s
  WHERE
    to_tsvector('english',
      COALESCE(s.manufacturer_norm, '') || ' ' ||
      COALESCE(s.model_norm, '') || ' ' ||
      COALESCE(s.system_norm, '') || ' ' ||
      COALESCE(s.subsystem_norm, '') || ' ' ||
      COALESCE(s.spec_keywords, '') || ' ' ||
      COALESCE(s.synonyms_fts, '') || ' ' ||
      COALESCE(s.description, '')
    ) @@ plainto_tsquery('english', q)
  ORDER BY rank DESC
  LIMIT top_n;
END;
$$;

COMMENT ON FUNCTION search_systems IS 'Weighted full-text search. Priority: model_norm/description (A=1.0) > manufacturer_norm (B=0.4) > system_norm/subsystem_norm (C=0.2) > spec_keywords (D=0.1)';

-- ============================================
-- PART 3: Documents Table Cleanup
-- ============================================
-- Delete columns replaced by _norm versions or unused

ALTER TABLE documents DROP COLUMN IF EXISTS manufacturer;
ALTER TABLE documents DROP COLUMN IF EXISTS model;
ALTER TABLE documents DROP COLUMN IF EXISTS source_url;

-- ============================================
-- PART 4: Systems Table Cleanup
-- ============================================
-- Now safe to drop columns since dependent objects are updated

ALTER TABLE systems DROP COLUMN IF EXISTS canonical_model_id;
ALTER TABLE systems DROP COLUMN IF EXISTS manual_url;
ALTER TABLE systems DROP COLUMN IF EXISTS oem_page;
ALTER TABLE systems DROP COLUMN IF EXISTS local_manual_file_name;
ALTER TABLE systems DROP COLUMN IF EXISTS serial_number;

-- ============================================
-- PART 5: Update existing systems with category names
-- ============================================
-- Populate system_norm and subsystem_norm from reference tables

UPDATE systems s
SET system_norm = rc.name
FROM ref_system_categories rc
WHERE s.system_category_id = rc.id
  AND s.system_norm IS NULL;

UPDATE systems s
SET subsystem_norm = rsc.name
FROM ref_subsystem_categories rsc
WHERE s.subsystem_category_id = rsc.id
  AND s.subsystem_norm IS NULL;

-- ============================================
-- PART 6: Update existing instances with denormalized fields
-- ============================================
-- Populate manufacturer_norm, model_norm, system_norm, subsystem_norm from parent system

UPDATE instances i
SET
  manufacturer_norm = s.manufacturer_norm,
  model_norm = s.model_norm,
  system_norm = s.system_norm,
  subsystem_norm = s.subsystem_norm
FROM systems s
WHERE i.asset_uid = s.asset_uid
  AND (i.manufacturer_norm IS NULL OR i.model_norm IS NULL);

-- ============================================
-- VERIFICATION
-- ============================================
DO $$
DECLARE
  doc_cols TEXT[];
  sys_cols TEXT[];
BEGIN
  -- Check documents columns
  SELECT array_agg(column_name) INTO doc_cols
  FROM information_schema.columns
  WHERE table_name = 'documents'
    AND column_name IN ('manufacturer', 'model', 'source_url');

  IF doc_cols IS NOT NULL AND array_length(doc_cols, 1) > 0 THEN
    RAISE WARNING 'Documents: Some columns still exist: %', doc_cols;
  ELSE
    RAISE NOTICE 'Documents: All targeted columns dropped successfully';
  END IF;

  -- Check systems columns
  SELECT array_agg(column_name) INTO sys_cols
  FROM information_schema.columns
  WHERE table_name = 'systems'
    AND column_name IN ('canonical_model_id', 'manual_url', 'oem_page', 'local_manual_file_name', 'serial_number');

  IF sys_cols IS NOT NULL AND array_length(sys_cols, 1) > 0 THEN
    RAISE WARNING 'Systems: Some columns still exist: %', sys_cols;
  ELSE
    RAISE NOTICE 'Systems: All targeted columns dropped successfully';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 040 Complete';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'View v_systems_with_instances updated';
  RAISE NOTICE 'Function search_systems updated';
  RAISE NOTICE 'DOCUMENTS: Dropped manufacturer, model, source_url';
  RAISE NOTICE 'SYSTEMS: Dropped canonical_model_id, manual_url, oem_page, local_manual_file_name, serial_number';
  RAISE NOTICE 'SYSTEMS: Populated system_norm, subsystem_norm from reference tables';
  RAISE NOTICE 'INSTANCES: Populated denormalized fields from parent systems';
END $$;
