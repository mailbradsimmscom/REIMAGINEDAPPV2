-- Migration 043: doc_assets table for Vision Stage 6-7
-- Queryable index for extracted figures/tables from document vision analysis
-- Supports filtering by applies_to_models and referenced_systems
--
-- Run in Supabase SQL Editor

-- ============================================
-- 1. Create doc_assets table
-- ============================================
CREATE TABLE IF NOT EXISTS doc_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign key to documents
  doc_id TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,

  -- Asset location
  page_number INT NOT NULL,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('figure', 'table')),
  asset_index INT NOT NULL, -- 0-based index within (doc_id, page_number, asset_kind), stable via bbox sort

  -- Asset metadata
  asset_type TEXT NULL, -- freeform: exploded_view, wiring_diagram, schematic, parts_list, specifications, etc.
  title TEXT NULL,
  description TEXT NULL,
  bbox JSONB NOT NULL, -- percentage bbox {x, y, width, height}

  -- Storage paths
  storage_path TEXT NOT NULL, -- path to cropped image in Supabase Storage
  analysis_path TEXT NOT NULL, -- path to per-page analysis JSON

  -- Model tagging (canonical)
  applies_to_models TEXT[] NOT NULL CHECK (cardinality(applies_to_models) > 0), -- non-empty subset of selected_models
  referenced_systems TEXT[] NOT NULL DEFAULT '{}'::text[], -- may be empty
  is_universal BOOLEAN NOT NULL DEFAULT false, -- true if applies_to_models covers ALL selected_models

  -- Full element payload (post-canonicalization)
  asset_json JSONB NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Idempotent upsert key
  UNIQUE (doc_id, page_number, asset_kind, asset_index)
);

-- ============================================
-- 3. Create indexes
-- ============================================
-- GIN indexes for array containment queries
CREATE INDEX IF NOT EXISTS idx_doc_assets_applies_to_models ON doc_assets USING GIN (applies_to_models);
CREATE INDEX IF NOT EXISTS idx_doc_assets_referenced_systems ON doc_assets USING GIN (referenced_systems);

-- Btree for doc_id + page_number lookups
CREATE INDEX IF NOT EXISTS idx_doc_assets_doc_page ON doc_assets (doc_id, page_number);

-- ============================================
-- 4. RLS Policies
-- ============================================
ALTER TABLE doc_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to doc_assets"
  ON doc_assets FOR SELECT USING (true);

CREATE POLICY "Allow service role full access to doc_assets"
  ON doc_assets FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- 5. Comments
-- ============================================
COMMENT ON TABLE doc_assets IS 'Queryable index for extracted figures/tables from Vision Stage 6-7. Supports filtering by applies_to_models and referenced_systems.';
COMMENT ON COLUMN doc_assets.doc_id IS 'Foreign key to documents table';
COMMENT ON COLUMN doc_assets.page_number IS 'Page number in the PDF (1-indexed)';
COMMENT ON COLUMN doc_assets.asset_kind IS 'Type of asset: figure or table';
COMMENT ON COLUMN doc_assets.asset_index IS '0-based index within (doc_id, page_number, asset_kind) after bbox sort (top-to-bottom, left-to-right)';
COMMENT ON COLUMN doc_assets.asset_type IS 'Freeform asset subtype: exploded_view, wiring_diagram, schematic, parts_list, specifications, etc.';
COMMENT ON COLUMN doc_assets.bbox IS 'Percentage bounding box {x, y, width, height} relative to page dimensions';
COMMENT ON COLUMN doc_assets.storage_path IS 'Supabase Storage path to cropped image (manuals/{doc_id}/vision/assets/...)';
COMMENT ON COLUMN doc_assets.analysis_path IS 'Supabase Storage path to per-page analysis JSON';
COMMENT ON COLUMN doc_assets.applies_to_models IS 'Canonical primary models this asset applies to (non-empty subset of selected_models)';
COMMENT ON COLUMN doc_assets.referenced_systems IS 'Canonical referenced systems mentioned in this asset (may be empty)';
COMMENT ON COLUMN doc_assets.is_universal IS 'True if applies_to_models covers ALL selected_models for the document';
COMMENT ON COLUMN doc_assets.asset_json IS 'Full Vision element payload after canonicalization';

-- ============================================
-- 6. Trigger for updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_doc_assets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER doc_assets_updated_at_trigger
  BEFORE UPDATE ON doc_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_doc_assets_updated_at();

-- ============================================
-- Verification
-- ============================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 043 complete: doc_assets table created';
  RAISE NOTICE '  - UNIQUE constraint on (doc_id, page_number, asset_kind, asset_index)';
  RAISE NOTICE '  - CHECK constraint: applies_to_models must be non-empty';
  RAISE NOTICE '  - GIN indexes on applies_to_models and referenced_systems';
  RAISE NOTICE '  - RLS enabled with read access and service role full access';
END $$;
