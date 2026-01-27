-- Migration 040: Add applies_to_models to DIP Production Tables
-- Part of Document-First Architecture (see code updates/97)
-- Enables model-specific content filtering on all DIP extractions
--
-- DIP now writes directly to production tables (not staging) with model tags
-- Chat queries filter by user's models using this column
--
-- Run in Supabase SQL Editor

-- ============================================
-- 1. spec_suggestions - Add applies_to_models
-- ============================================
ALTER TABLE spec_suggestions
ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];

CREATE INDEX IF NOT EXISTS idx_spec_suggestions_applies_to_models
  ON spec_suggestions USING gin(applies_to_models);

COMMENT ON COLUMN spec_suggestions.applies_to_models IS 'Model names this spec applies to, e.g., ["4JH57", "4JH45"]. Empty array or ["all"] means universal.';

-- ============================================
-- 2. playbook_hints - Add applies_to_models
-- ============================================
ALTER TABLE playbook_hints
ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];

CREATE INDEX IF NOT EXISTS idx_playbook_hints_applies_to_models
  ON playbook_hints USING gin(applies_to_models);

COMMENT ON COLUMN playbook_hints.applies_to_models IS 'Model names this procedure applies to, e.g., ["4JH57"]. Empty array or ["all"] means universal.';

-- ============================================
-- 3. golden_tests - Add applies_to_models
-- ============================================
ALTER TABLE golden_tests
ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];

CREATE INDEX IF NOT EXISTS idx_golden_tests_applies_to_models
  ON golden_tests USING gin(applies_to_models);

COMMENT ON COLUMN golden_tests.applies_to_models IS 'Model names this test applies to, e.g., ["4JH57"]. Empty array or ["all"] means universal.';

-- ============================================
-- 4. intent_router - Add applies_to_models and other DIP fields
-- ============================================
ALTER TABLE intent_router
ADD COLUMN IF NOT EXISTS applies_to_models TEXT[],
ADD COLUMN IF NOT EXISTS doc_id TEXT,
ADD COLUMN IF NOT EXISTS question TEXT,
ADD COLUMN IF NOT EXISTS question_variations TEXT[],
ADD COLUMN IF NOT EXISTS answer TEXT;

CREATE INDEX IF NOT EXISTS idx_intent_router_applies_to_models
  ON intent_router USING gin(applies_to_models);

CREATE INDEX IF NOT EXISTS idx_intent_router_doc_id
  ON intent_router(doc_id);

COMMENT ON COLUMN intent_router.applies_to_models IS 'Model names this Q&A applies to, e.g., ["4JH57"]. Empty array or ["all"] means universal.';
COMMENT ON COLUMN intent_router.question IS 'The question this route handles';
COMMENT ON COLUMN intent_router.question_variations IS 'Alternative phrasings of the question';
COMMENT ON COLUMN intent_router.answer IS 'The answer to the question';

-- ============================================
-- 5. troubleshooting - Rename models to applies_to_models for consistency
-- ============================================
-- Note: troubleshooting table already has 'models TEXT[]' column
-- We'll add applies_to_models as alias and migrate data

ALTER TABLE troubleshooting
ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];

-- Copy data from models to applies_to_models
UPDATE troubleshooting
SET applies_to_models = models
WHERE models IS NOT NULL AND applies_to_models IS NULL;

CREATE INDEX IF NOT EXISTS idx_troubleshooting_applies_to_models
  ON troubleshooting USING gin(applies_to_models);

COMMENT ON COLUMN troubleshooting.applies_to_models IS 'Model names this troubleshooting entry applies to. Replaces legacy "models" column.';

-- ============================================
-- 6. Also update staging tables for backwards compatibility
-- ============================================
-- (Even though DIP will go direct to production, keep staging in sync)

ALTER TABLE staging_spec_suggestions
ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];

ALTER TABLE staging_playbook_hints
ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];

ALTER TABLE staging_golden_tests
ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];

ALTER TABLE staging_intent_router
ADD COLUMN IF NOT EXISTS applies_to_models TEXT[],
ADD COLUMN IF NOT EXISTS question TEXT,
ADD COLUMN IF NOT EXISTS question_variations TEXT[],
ADD COLUMN IF NOT EXISTS answer TEXT;

ALTER TABLE staging_troubleshooting
ADD COLUMN IF NOT EXISTS applies_to_models TEXT[];

-- Copy from models to applies_to_models in staging
UPDATE staging_troubleshooting
SET applies_to_models = models
WHERE models IS NOT NULL AND applies_to_models IS NULL;

-- ============================================
-- 7. Create helper function for model filtering
-- ============================================
CREATE OR REPLACE FUNCTION filter_by_user_models(
  user_models TEXT[],
  content_models TEXT[]
) RETURNS BOOLEAN AS $$
BEGIN
  -- If content has no model tags or is marked 'all', it's universal
  IF content_models IS NULL OR array_length(content_models, 1) IS NULL THEN
    RETURN true;
  END IF;

  IF 'all' = ANY(content_models) THEN
    RETURN true;
  END IF;

  -- Check if any user model matches any content model
  RETURN content_models && user_models;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION filter_by_user_models IS 'Returns true if content applies to any of the user''s models. Used for DIP content filtering.';

-- ============================================
-- Example usage:
-- ============================================
-- SELECT * FROM spec_suggestions
-- WHERE filter_by_user_models(ARRAY['4JH57', 'VC20', 'SD60'], applies_to_models);
--
-- Or using array overlap operator directly:
-- SELECT * FROM spec_suggestions
-- WHERE applies_to_models && ARRAY['4JH57', 'VC20', 'SD60']
--    OR applies_to_models IS NULL
--    OR 'all' = ANY(applies_to_models);

-- ============================================
-- Verification
-- ============================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 040 complete: applies_to_models columns added';
  RAISE NOTICE '  - spec_suggestions.applies_to_models';
  RAISE NOTICE '  - playbook_hints.applies_to_models';
  RAISE NOTICE '  - golden_tests.applies_to_models';
  RAISE NOTICE '  - intent_router.applies_to_models (+ question, answer fields)';
  RAISE NOTICE '  - troubleshooting.applies_to_models (migrated from models)';
  RAISE NOTICE '  - All staging tables updated for backwards compat';
  RAISE NOTICE '  - Created filter_by_user_models() helper function';
  RAISE NOTICE '  - GIN indexes created for array containment queries';
END $$;
