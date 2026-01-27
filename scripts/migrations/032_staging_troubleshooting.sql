-- Migration 032: Staging Troubleshooting Table
-- Part of Document Foundation Crisis fix (see code updates/96b)
-- New DIP category for symptom → cause → resolution mappings
-- KEY FEATURE: Cross-system linking solves the family/centroid problem
--
-- Run in Supabase SQL Editor

-- ============================================
-- 1. Create staging_troubleshooting table
-- ============================================
CREATE TABLE IF NOT EXISTS staging_troubleshooting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id TEXT NOT NULL,

  -- System link
  asset_uid UUID REFERENCES systems(asset_uid),

  -- Troubleshooting content
  symptom TEXT NOT NULL,                  -- "Engine won't start"
  symptom_variations TEXT[],              -- ["won't start", "no start", "fails to start"]
  symptom_category TEXT,                  -- 'wont_start', 'overheating', 'noise', 'leak', 'error_code'

  cause TEXT NOT NULL,                    -- "Battery isolator off"
  check_action TEXT,                      -- "Check battery isolator switch position"
  resolution TEXT,                        -- "Turn battery isolator to ON"

  -- Source tracking
  source_type TEXT,                       -- 'troubleshooting_table', 'procedure_prerequisite', 'safety_warning', 'error_code'
  source_ref TEXT,                        -- Page number, section reference

  -- Cross-system linking (KEY FEATURE - solves family/centroid problem!)
  related_system_uid UUID REFERENCES systems(asset_uid),
  related_system_name TEXT,               -- "Battery Isolator" (denormalized for display)
  relationship_type TEXT,                 -- 'requires', 'affects', 'blocks', 'depends_on'

  -- Model applicability (for multi-model manuals)
  models TEXT[],                          -- ["4JH45", "4JH57", "4JH80", "4JH110"]

  -- Processing
  priority INTEGER,                       -- For ordering troubleshooting steps (1 = check first)
  status TEXT DEFAULT 'pending',          -- 'pending', 'approved', 'rejected'
  processing_run_id UUID,

  -- Standard DIP fields
  manufacturer_norm TEXT,
  model_norm TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. Create production troubleshooting table (for approved items)
-- ============================================
CREATE TABLE IF NOT EXISTS troubleshooting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id TEXT,
  asset_uid UUID REFERENCES systems(asset_uid),

  symptom TEXT NOT NULL,
  symptom_variations TEXT[],
  symptom_category TEXT,

  cause TEXT NOT NULL,
  check_action TEXT,
  resolution TEXT,

  source_type TEXT,
  source_ref TEXT,

  related_system_uid UUID REFERENCES systems(asset_uid),
  related_system_name TEXT,
  relationship_type TEXT,

  models TEXT[],
  priority INTEGER,

  manufacturer_norm TEXT,
  model_norm TEXT,
  approved_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. Create indexes
-- ============================================

-- Staging indexes
CREATE INDEX IF NOT EXISTS idx_staging_troubleshooting_doc ON staging_troubleshooting(doc_id);
CREATE INDEX IF NOT EXISTS idx_staging_troubleshooting_asset ON staging_troubleshooting(asset_uid);
CREATE INDEX IF NOT EXISTS idx_staging_troubleshooting_status ON staging_troubleshooting(status);
CREATE INDEX IF NOT EXISTS idx_staging_troubleshooting_symptom_cat ON staging_troubleshooting(symptom_category);
CREATE INDEX IF NOT EXISTS idx_staging_troubleshooting_related ON staging_troubleshooting(related_system_uid);
CREATE INDEX IF NOT EXISTS idx_staging_troubleshooting_run ON staging_troubleshooting(processing_run_id);

-- Full-text search on symptom
CREATE INDEX IF NOT EXISTS idx_staging_troubleshooting_symptom_fts
  ON staging_troubleshooting USING gin(to_tsvector('english', symptom));

-- Production indexes
CREATE INDEX IF NOT EXISTS idx_troubleshooting_asset ON troubleshooting(asset_uid);
CREATE INDEX IF NOT EXISTS idx_troubleshooting_symptom_cat ON troubleshooting(symptom_category);
CREATE INDEX IF NOT EXISTS idx_troubleshooting_related ON troubleshooting(related_system_uid);
CREATE INDEX IF NOT EXISTS idx_troubleshooting_symptom_fts
  ON troubleshooting USING gin(to_tsvector('english', symptom));

-- ============================================
-- 4. Add constraints
-- ============================================

-- Valid symptom categories
ALTER TABLE staging_troubleshooting DROP CONSTRAINT IF EXISTS staging_troubleshooting_valid_symptom_cat;
ALTER TABLE staging_troubleshooting ADD CONSTRAINT staging_troubleshooting_valid_symptom_cat
  CHECK (symptom_category IS NULL OR symptom_category IN (
    'wont_start', 'wont_stop', 'overheating', 'overcooling',
    'noise', 'vibration', 'leak', 'smoke', 'smell',
    'error_code', 'warning', 'alarm',
    'low_performance', 'high_consumption', 'intermittent',
    'no_power', 'no_display', 'no_communication',
    'other'
  ));

-- Valid source types
ALTER TABLE staging_troubleshooting DROP CONSTRAINT IF EXISTS staging_troubleshooting_valid_source;
ALTER TABLE staging_troubleshooting ADD CONSTRAINT staging_troubleshooting_valid_source
  CHECK (source_type IS NULL OR source_type IN (
    'troubleshooting_table', 'procedure_prerequisite', 'safety_warning',
    'error_code', 'maintenance_note', 'installation_note', 'general_text'
  ));

-- Valid relationship types
ALTER TABLE staging_troubleshooting DROP CONSTRAINT IF EXISTS staging_troubleshooting_valid_rel;
ALTER TABLE staging_troubleshooting ADD CONSTRAINT staging_troubleshooting_valid_rel
  CHECK (relationship_type IS NULL OR relationship_type IN (
    'requires', 'affects', 'blocks', 'depends_on', 'controls', 'feeds'
  ));

-- Valid status
ALTER TABLE staging_troubleshooting DROP CONSTRAINT IF EXISTS staging_troubleshooting_valid_status;
ALTER TABLE staging_troubleshooting ADD CONSTRAINT staging_troubleshooting_valid_status
  CHECK (status IN ('pending', 'approved', 'rejected'));

-- ============================================
-- 5. Add comments
-- ============================================
COMMENT ON TABLE staging_troubleshooting IS 'DIP-extracted troubleshooting entries pending review. Symptom → Cause → Resolution with cross-system linking.';
COMMENT ON COLUMN staging_troubleshooting.symptom IS 'The problem description, e.g., "Engine won''t start"';
COMMENT ON COLUMN staging_troubleshooting.symptom_variations IS 'Alternative phrasings of the same symptom for matching';
COMMENT ON COLUMN staging_troubleshooting.symptom_category IS 'Category for grouping symptoms';
COMMENT ON COLUMN staging_troubleshooting.cause IS 'The cause of the symptom, e.g., "Battery isolator off"';
COMMENT ON COLUMN staging_troubleshooting.check_action IS 'How to verify this cause, e.g., "Check battery isolator switch position"';
COMMENT ON COLUMN staging_troubleshooting.resolution IS 'How to fix it, e.g., "Turn battery isolator to ON"';
COMMENT ON COLUMN staging_troubleshooting.related_system_uid IS 'FK to related system - KEY for cross-system troubleshooting';
COMMENT ON COLUMN staging_troubleshooting.related_system_name IS 'Denormalized name for display without join';
COMMENT ON COLUMN staging_troubleshooting.priority IS 'Order to check causes (1 = check first, basics before complex)';
COMMENT ON COLUMN staging_troubleshooting.models IS 'Which model variants this applies to (for multi-model manuals)';

COMMENT ON TABLE troubleshooting IS 'Approved troubleshooting entries for chat synthesis';

-- ============================================
-- 6. RLS Policies
-- ============================================
ALTER TABLE staging_troubleshooting ENABLE ROW LEVEL SECURITY;
ALTER TABLE troubleshooting ENABLE ROW LEVEL SECURITY;

-- Allow read access for all
CREATE POLICY "Allow read access to staging_troubleshooting" ON staging_troubleshooting FOR SELECT USING (true);
CREATE POLICY "Allow read access to troubleshooting" ON troubleshooting FOR SELECT USING (true);

-- Allow full access for service role
CREATE POLICY "Allow service role full access to staging_troubleshooting" ON staging_troubleshooting FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role full access to troubleshooting" ON troubleshooting FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- 7. Updated_at trigger for staging table
-- ============================================
DROP TRIGGER IF EXISTS update_staging_troubleshooting_updated_at ON staging_troubleshooting;
CREATE TRIGGER update_staging_troubleshooting_updated_at
  BEFORE UPDATE ON staging_troubleshooting
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Verification
-- ============================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 032 complete: Troubleshooting tables created';
  RAISE NOTICE '  - staging_troubleshooting (pending DIP extractions)';
  RAISE NOTICE '  - troubleshooting (approved production)';
  RAISE NOTICE '  - Cross-system linking via related_system_uid';
  RAISE NOTICE '  - Symptom categories for grouping';
  RAISE NOTICE '  - Full-text search on symptom field';
END $$;
