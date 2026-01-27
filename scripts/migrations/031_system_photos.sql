-- Migration 031: System Photos Table
-- Part of Document Foundation Crisis fix (see code updates/96b)
-- For attaching photos to systems (photo-based equipment discovery)
--
-- Run in Supabase SQL Editor

-- ============================================
-- 1. Create system_photos table
-- ============================================
CREATE TABLE IF NOT EXISTS system_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Links to system/instance
  asset_uid UUID REFERENCES systems(asset_uid) ON DELETE CASCADE,
  instance_uid UUID REFERENCES instances(instance_uid) ON DELETE CASCADE,

  -- Photo info
  photo_path TEXT NOT NULL,               -- Storage path in Supabase
  photo_type TEXT,                        -- 'nameplate', 'installed', 'serial', 'overview'
  photo_filename TEXT,                    -- Original filename

  -- Vision extraction results
  extracted_text JSONB,                   -- Raw Vision LLM output
  extracted_manufacturer TEXT,            -- Parsed manufacturer from Vision
  extracted_model TEXT,                   -- Parsed model from Vision
  extracted_serial TEXT,                  -- Parsed serial number from Vision
  extraction_confidence NUMERIC,          -- Vision confidence score

  -- Metadata
  captured_at TIMESTAMPTZ,                -- When photo was taken (from EXIF)
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. Create indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_system_photos_asset ON system_photos(asset_uid);
CREATE INDEX IF NOT EXISTS idx_system_photos_instance ON system_photos(instance_uid);
CREATE INDEX IF NOT EXISTS idx_system_photos_type ON system_photos(photo_type);
CREATE INDEX IF NOT EXISTS idx_system_photos_extracted ON system_photos(extracted_manufacturer, extracted_model);

-- ============================================
-- 3. Add constraints
-- ============================================

-- Ensure at least one of asset_uid or instance_uid is set
ALTER TABLE system_photos DROP CONSTRAINT IF EXISTS system_photos_has_parent;
ALTER TABLE system_photos ADD CONSTRAINT system_photos_has_parent
  CHECK (asset_uid IS NOT NULL OR instance_uid IS NOT NULL);

-- Valid photo types
ALTER TABLE system_photos DROP CONSTRAINT IF EXISTS system_photos_valid_type;
ALTER TABLE system_photos ADD CONSTRAINT system_photos_valid_type
  CHECK (photo_type IS NULL OR photo_type IN ('nameplate', 'installed', 'serial', 'overview', 'detail', 'wiring'));

-- ============================================
-- 4. Add comments
-- ============================================
COMMENT ON TABLE system_photos IS 'Photos attached to systems/instances for equipment discovery and documentation';
COMMENT ON COLUMN system_photos.asset_uid IS 'FK to systems table (for system-level photos)';
COMMENT ON COLUMN system_photos.instance_uid IS 'FK to instances table (for instance-specific photos, e.g., port vs stbd engine)';
COMMENT ON COLUMN system_photos.photo_type IS 'Type of photo: nameplate, installed, serial, overview, detail, wiring';
COMMENT ON COLUMN system_photos.extracted_text IS 'Full JSON output from Vision LLM analysis';
COMMENT ON COLUMN system_photos.extracted_manufacturer IS 'Manufacturer name extracted by Vision (for matching to ref_manufacturers)';
COMMENT ON COLUMN system_photos.extracted_model IS 'Model number extracted by Vision';
COMMENT ON COLUMN system_photos.extracted_serial IS 'Serial number extracted by Vision';
COMMENT ON COLUMN system_photos.extraction_confidence IS 'Overall confidence score from Vision (0.0 to 1.0)';

-- ============================================
-- 5. RLS Policies
-- ============================================
ALTER TABLE system_photos ENABLE ROW LEVEL SECURITY;

-- Allow read access for all
CREATE POLICY "Allow read access to system_photos" ON system_photos FOR SELECT USING (true);

-- Allow full access for service role
CREATE POLICY "Allow service role full access to system_photos" ON system_photos FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- Verification
-- ============================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 031 complete: system_photos table created';
  RAISE NOTICE '  - Links to systems and instances';
  RAISE NOTICE '  - Vision extraction fields for auto-detection';
  RAISE NOTICE '  - Photo types: nameplate, installed, serial, overview, detail, wiring';
END $$;
