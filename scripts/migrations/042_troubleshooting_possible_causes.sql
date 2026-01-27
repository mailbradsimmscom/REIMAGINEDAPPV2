-- Migration 042: Enhance troubleshooting table for multi-cause structure
-- Part of Document-First Architecture (see code updates/97)
-- DIP testing showed troubleshooting entries have MULTIPLE possible causes per symptom
--
-- Old structure: 1 symptom → 1 cause → 1 resolution
-- New structure: 1 symptom → N possible_causes [{cause, likelihood, fix, fix_steps}]
--
-- Run in Supabase SQL Editor

-- ============================================
-- 1. Add possible_causes JSONB column to troubleshooting
-- ============================================
ALTER TABLE troubleshooting
ADD COLUMN IF NOT EXISTS possible_causes JSONB;

-- Structure of possible_causes:
-- [
--   {
--     "cause": "Battery isolator off",
--     "likelihood": "common",          -- common, occasional, rare
--     "fix": "Turn battery isolator to ON",
--     "fix_steps": ["Locate battery isolator", "Turn to ON position", "Verify power"]
--   },
--   {
--     "cause": "Fuel tank empty",
--     "likelihood": "common",
--     "fix": "Refuel tank",
--     "fix_steps": ["Check fuel gauge", "Add fuel if low"]
--   }
-- ]

COMMENT ON COLUMN troubleshooting.possible_causes IS 'Array of {cause, likelihood, fix, fix_steps} objects. Multiple causes can explain one symptom.';

-- ============================================
-- 2. Add same column to staging_troubleshooting
-- ============================================
ALTER TABLE staging_troubleshooting
ADD COLUMN IF NOT EXISTS possible_causes JSONB;

COMMENT ON COLUMN staging_troubleshooting.possible_causes IS 'Array of {cause, likelihood, fix, fix_steps} objects. Multiple causes can explain one symptom.';

-- ============================================
-- 3. Migrate existing data to new structure
-- ============================================
-- Convert single cause/resolution to possible_causes array
UPDATE troubleshooting
SET possible_causes = jsonb_build_array(
  jsonb_build_object(
    'cause', cause,
    'likelihood', 'unknown',
    'fix', resolution,
    'fix_steps', ARRAY[]::TEXT[]
  )
)
WHERE possible_causes IS NULL
  AND cause IS NOT NULL;

UPDATE staging_troubleshooting
SET possible_causes = jsonb_build_array(
  jsonb_build_object(
    'cause', cause,
    'likelihood', 'unknown',
    'fix', resolution,
    'fix_steps', ARRAY[]::TEXT[]
  )
)
WHERE possible_causes IS NULL
  AND cause IS NOT NULL;

-- ============================================
-- 4. Create GIN index for JSONB queries
-- ============================================
CREATE INDEX IF NOT EXISTS idx_troubleshooting_possible_causes
  ON troubleshooting USING gin(possible_causes);

CREATE INDEX IF NOT EXISTS idx_staging_troubleshooting_possible_causes
  ON staging_troubleshooting USING gin(possible_causes);

-- ============================================
-- 5. Helper function to search causes
-- ============================================
CREATE OR REPLACE FUNCTION search_troubleshooting_causes(
  search_term TEXT
) RETURNS TABLE (
  id UUID,
  symptom TEXT,
  cause_text TEXT,
  likelihood TEXT,
  fix TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.symptom,
    (cause_obj->>'cause')::TEXT as cause_text,
    (cause_obj->>'likelihood')::TEXT as likelihood,
    (cause_obj->>'fix')::TEXT as fix
  FROM troubleshooting t,
       jsonb_array_elements(t.possible_causes) AS cause_obj
  WHERE t.symptom ILIKE '%' || search_term || '%'
     OR cause_obj->>'cause' ILIKE '%' || search_term || '%';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_troubleshooting_causes IS 'Search troubleshooting by symptom or cause text, returns flattened cause rows';

-- ============================================
-- 6. Add source_type for categorizing entries
-- ============================================
-- (Already exists in table from migration 032, just add comment)
COMMENT ON COLUMN troubleshooting.source_type IS 'Where this was extracted from: troubleshooting_table, warning_section, procedure_note, error_code';

-- ============================================
-- Example queries with new structure:
-- ============================================
-- Get all causes for a symptom:
-- SELECT symptom, jsonb_array_elements(possible_causes) as cause
-- FROM troubleshooting
-- WHERE symptom ILIKE '%engine%start%';

-- Count causes per symptom:
-- SELECT symptom, jsonb_array_length(possible_causes) as num_causes
-- FROM troubleshooting;

-- Filter by likelihood:
-- SELECT t.symptom, cause_obj
-- FROM troubleshooting t,
--      jsonb_array_elements(t.possible_causes) AS cause_obj
-- WHERE cause_obj->>'likelihood' = 'common';

-- ============================================
-- Verification
-- ============================================
DO $$
DECLARE
  migrated_count INTEGER;
  multi_cause_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO migrated_count
  FROM troubleshooting
  WHERE possible_causes IS NOT NULL;

  SELECT COUNT(*) INTO multi_cause_count
  FROM troubleshooting
  WHERE jsonb_array_length(possible_causes) > 1;

  RAISE NOTICE 'Migration 042 complete: troubleshooting.possible_causes added';
  RAISE NOTICE '  - % entries have possible_causes populated', migrated_count;
  RAISE NOTICE '  - % entries have multiple causes', multi_cause_count;
  RAISE NOTICE '  - Created search_troubleshooting_causes() function';
  RAISE NOTICE '  - Old cause/resolution columns kept for backwards compat';
END $$;
