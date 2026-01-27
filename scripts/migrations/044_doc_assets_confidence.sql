-- Migration 044: Add confidence and attribution_warnings to doc_assets
-- For LlamaParse text-based model detection audit trail
--
-- ALREADY APPLIED: 2026-01-25
-- Run in Supabase SQL Editor

-- Add confidence column
ALTER TABLE doc_assets
ADD COLUMN IF NOT EXISTS confidence TEXT NOT NULL DEFAULT 'low'
CHECK (confidence IN ('high', 'medium', 'low'));

-- Add attribution_warnings column
ALTER TABLE doc_assets
ADD COLUMN IF NOT EXISTS attribution_warnings TEXT[] NOT NULL DEFAULT '{}'::text[];

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_doc_assets_confidence
ON doc_assets (confidence);

CREATE INDEX IF NOT EXISTS idx_doc_assets_warnings
ON doc_assets USING GIN (attribution_warnings);

-- Comments
COMMENT ON COLUMN doc_assets.confidence IS 'Model attribution confidence: high (heading), medium (table/body), low (defaulted)';
COMMENT ON COLUMN doc_assets.attribution_warnings IS 'Warning codes: MODEL_ATTRIBUTION_DEFAULTED, MODEL_CONFIDENCE_LOW, MODEL_FROM_TABLE_CELL';

-- Verification
DO $$
BEGIN
  RAISE NOTICE 'Migration 044 complete: confidence and attribution_warnings added to doc_assets';
END $$;
