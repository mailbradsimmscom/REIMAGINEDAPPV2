-- Migration 034: Documents Table Updates
-- Part of Document Foundation Crisis fix (see code updates/96b)
-- Adds model coverage tracking and OEM manual flags
--
-- Run in Supabase SQL Editor

-- ============================================
-- 1. Add models_covered column
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'documents' AND column_name = 'models_covered') THEN
    ALTER TABLE documents ADD COLUMN models_covered TEXT[];
    RAISE NOTICE 'Added models_covered column';
  ELSE
    RAISE NOTICE 'models_covered column already exists';
  END IF;
END $$;

-- ============================================
-- 2. Add OEM manual tracking
-- ============================================
DO $$
BEGIN
  -- is_oem_manual - true if this is an OEM manual (not branded)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'documents' AND column_name = 'is_oem_manual') THEN
    ALTER TABLE documents ADD COLUMN is_oem_manual BOOLEAN DEFAULT false;
    RAISE NOTICE 'Added is_oem_manual column';
  ELSE
    RAISE NOTICE 'is_oem_manual column already exists';
  END IF;

  -- oem_for_asset_uid - links OEM manual to the branded system it applies to
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'documents' AND column_name = 'oem_for_asset_uid') THEN
    ALTER TABLE documents ADD COLUMN oem_for_asset_uid UUID REFERENCES systems(asset_uid);
    RAISE NOTICE 'Added oem_for_asset_uid column';
  ELSE
    RAISE NOTICE 'oem_for_asset_uid column already exists';
  END IF;
END $$;

-- ============================================
-- 3. Add is_multi_model flag
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'documents' AND column_name = 'is_multi_model') THEN
    ALTER TABLE documents ADD COLUMN is_multi_model BOOLEAN DEFAULT false;
    RAISE NOTICE 'Added is_multi_model column';
  ELSE
    RAISE NOTICE 'is_multi_model column already exists';
  END IF;
END $$;

-- ============================================
-- 4. Add processing metadata
-- ============================================
DO $$
BEGIN
  -- vision_processed - true if Vision LLM has analyzed this document
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'documents' AND column_name = 'vision_processed') THEN
    ALTER TABLE documents ADD COLUMN vision_processed BOOLEAN DEFAULT false;
    RAISE NOTICE 'Added vision_processed column';
  ELSE
    RAISE NOTICE 'vision_processed column already exists';
  END IF;

  -- vision_processed_at - when Vision analysis was completed
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'documents' AND column_name = 'vision_processed_at') THEN
    ALTER TABLE documents ADD COLUMN vision_processed_at TIMESTAMPTZ;
    RAISE NOTICE 'Added vision_processed_at column';
  ELSE
    RAISE NOTICE 'vision_processed_at column already exists';
  END IF;

  -- page_count - total pages in document
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'documents' AND column_name = 'page_count') THEN
    ALTER TABLE documents ADD COLUMN page_count INTEGER;
    RAISE NOTICE 'Added page_count column';
  ELSE
    RAISE NOTICE 'page_count column already exists';
  END IF;

  -- figure_count - number of figures extracted
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'documents' AND column_name = 'figure_count') THEN
    ALTER TABLE documents ADD COLUMN figure_count INTEGER DEFAULT 0;
    RAISE NOTICE 'Added figure_count column';
  ELSE
    RAISE NOTICE 'figure_count column already exists';
  END IF;
END $$;

-- ============================================
-- 5. Create indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_documents_models_covered ON documents USING gin(models_covered);
CREATE INDEX IF NOT EXISTS idx_documents_is_oem ON documents(is_oem_manual);
CREATE INDEX IF NOT EXISTS idx_documents_oem_for ON documents(oem_for_asset_uid);
CREATE INDEX IF NOT EXISTS idx_documents_is_multi_model ON documents(is_multi_model);
CREATE INDEX IF NOT EXISTS idx_documents_vision_processed ON documents(vision_processed);

-- ============================================
-- 6. Add comments
-- ============================================
COMMENT ON COLUMN documents.models_covered IS 'Array of model numbers this manual covers, e.g., ["4JH45", "4JH57", "4JH80"]';
COMMENT ON COLUMN documents.is_oem_manual IS 'True if this is an OEM manual (e.g., Hy-ProDrive for B&G autopilot ram)';
COMMENT ON COLUMN documents.oem_for_asset_uid IS 'If is_oem_manual=true, links to the branded system this manual applies to';
COMMENT ON COLUMN documents.is_multi_model IS 'True if this manual covers multiple model variants';
COMMENT ON COLUMN documents.vision_processed IS 'True if Vision LLM has analyzed this document for figures/diagrams';
COMMENT ON COLUMN documents.vision_processed_at IS 'Timestamp when Vision analysis was completed';
COMMENT ON COLUMN documents.page_count IS 'Total number of pages in the document';
COMMENT ON COLUMN documents.figure_count IS 'Number of figures/diagrams extracted by Vision';

-- ============================================
-- Verification
-- ============================================
DO $$
DECLARE
  col_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_name = 'documents'
    AND column_name IN ('models_covered', 'is_oem_manual', 'oem_for_asset_uid',
                        'is_multi_model', 'vision_processed', 'vision_processed_at',
                        'page_count', 'figure_count');

  RAISE NOTICE 'Migration 034 complete: % columns added/verified on documents table', col_count;
  RAISE NOTICE '  - models_covered[] for multi-model manuals';
  RAISE NOTICE '  - is_oem_manual, oem_for_asset_uid for OEM tracking';
  RAISE NOTICE '  - is_multi_model flag';
  RAISE NOTICE '  - vision_processed, vision_processed_at for Vision tracking';
  RAISE NOTICE '  - page_count, figure_count for stats';
END $$;
