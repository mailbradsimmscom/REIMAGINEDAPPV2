-- Migration 033: System Relationships Tables
-- Part of Document Foundation Crisis fix (see code updates/96b)
-- DIP-extracted relationships between systems (families emerge from this graph)
--
-- Run in Supabase SQL Editor

-- ============================================
-- 1. Create staging_system_relationships table
-- ============================================
CREATE TABLE IF NOT EXISTS staging_system_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id TEXT NOT NULL,

  -- Relationship
  source_system_uid UUID REFERENCES systems(asset_uid),
  source_system_name TEXT,                -- Denormalized for display
  target_system_uid UUID REFERENCES systems(asset_uid),
  target_system_name TEXT,                -- Denormalized for display

  relationship_type TEXT NOT NULL,        -- 'controls', 'powers', 'feeds', 'monitors', 'connects_to'
  relationship_text TEXT,                 -- Original text from manual

  -- Directionality
  is_bidirectional BOOLEAN DEFAULT false,

  -- Context
  context TEXT,                           -- Where in the manual this was found
  source_ref TEXT,                        -- Page/section reference

  -- Processing
  confidence NUMERIC,                     -- Extraction confidence (0.0 to 1.0)
  status TEXT DEFAULT 'pending',          -- 'pending', 'approved', 'rejected'
  processing_run_id UUID,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. Create production system_relationships table
-- ============================================
CREATE TABLE IF NOT EXISTS system_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  source_system_uid UUID REFERENCES systems(asset_uid) ON DELETE CASCADE,
  source_system_name TEXT,
  target_system_uid UUID REFERENCES systems(asset_uid) ON DELETE CASCADE,
  target_system_name TEXT,

  relationship_type TEXT NOT NULL,
  relationship_text TEXT,
  is_bidirectional BOOLEAN DEFAULT false,

  source_doc_id TEXT,                     -- Which document this came from
  approved_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate relationships
  UNIQUE(source_system_uid, target_system_uid, relationship_type)
);

-- ============================================
-- 3. Create indexes
-- ============================================

-- Staging indexes
CREATE INDEX IF NOT EXISTS idx_staging_relationships_source ON staging_system_relationships(source_system_uid);
CREATE INDEX IF NOT EXISTS idx_staging_relationships_target ON staging_system_relationships(target_system_uid);
CREATE INDEX IF NOT EXISTS idx_staging_relationships_status ON staging_system_relationships(status);
CREATE INDEX IF NOT EXISTS idx_staging_relationships_type ON staging_system_relationships(relationship_type);
CREATE INDEX IF NOT EXISTS idx_staging_relationships_doc ON staging_system_relationships(doc_id);
CREATE INDEX IF NOT EXISTS idx_staging_relationships_run ON staging_system_relationships(processing_run_id);

-- Production indexes
CREATE INDEX IF NOT EXISTS idx_system_relationships_source ON system_relationships(source_system_uid);
CREATE INDEX IF NOT EXISTS idx_system_relationships_target ON system_relationships(target_system_uid);
CREATE INDEX IF NOT EXISTS idx_system_relationships_type ON system_relationships(relationship_type);

-- ============================================
-- 4. Add constraints
-- ============================================

-- Valid relationship types for staging
ALTER TABLE staging_system_relationships DROP CONSTRAINT IF EXISTS staging_relationships_valid_type;
ALTER TABLE staging_system_relationships ADD CONSTRAINT staging_relationships_valid_type
  CHECK (relationship_type IN (
    'controls',           -- NAC-3 controls T2 Ram
    'powers',             -- Battery powers Chartplotter
    'monitors',           -- BMS monitors Battery
    'feeds',              -- Solar Panel feeds MPPT
    'connects_to',        -- VHF connects to AIS Splitter
    'provides_feedback',  -- RF25N provides feedback to NAC-3
    'requires',           -- Engine requires Battery Isolator ON
    'cools',              -- Raw Water Pump cools Engine
    'drives',             -- Saildrive drives Propeller
    'integrates_with',    -- CZone integrates with Victron
    'replaces',           -- Part A replaces Part B
    'supplements',        -- Backup system supplements Primary
    'protects',           -- Fuse protects Circuit
    'distributes'         -- Lynx distributes Power
  ));

-- Valid relationship types for production
ALTER TABLE system_relationships DROP CONSTRAINT IF EXISTS system_relationships_valid_type;
ALTER TABLE system_relationships ADD CONSTRAINT system_relationships_valid_type
  CHECK (relationship_type IN (
    'controls', 'powers', 'monitors', 'feeds', 'connects_to',
    'provides_feedback', 'requires', 'cools', 'drives',
    'integrates_with', 'replaces', 'supplements', 'protects', 'distributes'
  ));

-- Valid status for staging
ALTER TABLE staging_system_relationships DROP CONSTRAINT IF EXISTS staging_relationships_valid_status;
ALTER TABLE staging_system_relationships ADD CONSTRAINT staging_relationships_valid_status
  CHECK (status IN ('pending', 'approved', 'rejected'));

-- ============================================
-- 5. Helper function to get related systems
-- ============================================
CREATE OR REPLACE FUNCTION get_related_systems(
  p_asset_uid UUID,
  p_relationship_types TEXT[] DEFAULT NULL,
  p_include_reverse BOOLEAN DEFAULT true
)
RETURNS TABLE (
  related_asset_uid UUID,
  related_system_name TEXT,
  relationship_type TEXT,
  relationship_direction TEXT
) AS $$
BEGIN
  RETURN QUERY
  -- Outgoing relationships (this system is source)
  SELECT
    sr.target_system_uid,
    sr.target_system_name,
    sr.relationship_type,
    'outgoing'::TEXT as relationship_direction
  FROM system_relationships sr
  WHERE sr.source_system_uid = p_asset_uid
    AND (p_relationship_types IS NULL OR sr.relationship_type = ANY(p_relationship_types))

  UNION ALL

  -- Incoming relationships (this system is target) - only if include_reverse
  SELECT
    sr.source_system_uid,
    sr.source_system_name,
    sr.relationship_type,
    'incoming'::TEXT as relationship_direction
  FROM system_relationships sr
  WHERE p_include_reverse
    AND sr.target_system_uid = p_asset_uid
    AND (p_relationship_types IS NULL OR sr.relationship_type = ANY(p_relationship_types));
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. Helper function to get full relationship graph
-- ============================================
CREATE OR REPLACE FUNCTION get_system_family(
  p_asset_uid UUID,
  p_max_depth INTEGER DEFAULT 2
)
RETURNS TABLE (
  asset_uid UUID,
  system_name TEXT,
  depth INTEGER,
  path UUID[]
) AS $$
WITH RECURSIVE family AS (
  -- Start with the given system
  SELECT
    p_asset_uid as asset_uid,
    (SELECT COALESCE(description, model_norm) FROM systems WHERE systems.asset_uid = p_asset_uid) as system_name,
    0 as depth,
    ARRAY[p_asset_uid] as path

  UNION

  -- Add related systems
  SELECT
    CASE
      WHEN sr.source_system_uid = f.asset_uid THEN sr.target_system_uid
      ELSE sr.source_system_uid
    END,
    CASE
      WHEN sr.source_system_uid = f.asset_uid THEN sr.target_system_name
      ELSE sr.source_system_name
    END,
    f.depth + 1,
    f.path || CASE
      WHEN sr.source_system_uid = f.asset_uid THEN sr.target_system_uid
      ELSE sr.source_system_uid
    END
  FROM family f
  JOIN system_relationships sr ON (
    sr.source_system_uid = f.asset_uid OR sr.target_system_uid = f.asset_uid
  )
  WHERE f.depth < p_max_depth
    AND NOT (
      CASE
        WHEN sr.source_system_uid = f.asset_uid THEN sr.target_system_uid
        ELSE sr.source_system_uid
      END = ANY(f.path)
    )
)
SELECT DISTINCT ON (family.asset_uid) * FROM family ORDER BY family.asset_uid, family.depth;
$$ LANGUAGE sql;

-- ============================================
-- 7. Add comments
-- ============================================
COMMENT ON TABLE staging_system_relationships IS 'DIP-extracted relationships between systems, pending review';
COMMENT ON COLUMN staging_system_relationships.source_system_uid IS 'The system that is the subject of the relationship';
COMMENT ON COLUMN staging_system_relationships.target_system_uid IS 'The system that is the object of the relationship';
COMMENT ON COLUMN staging_system_relationships.relationship_type IS 'Type of relationship: controls, powers, monitors, feeds, etc.';
COMMENT ON COLUMN staging_system_relationships.is_bidirectional IS 'True if relationship goes both ways (A connects_to B and B connects_to A)';
COMMENT ON COLUMN staging_system_relationships.confidence IS 'Extraction confidence from 0.0 to 1.0';

COMMENT ON TABLE system_relationships IS 'Approved relationships between systems. Used to build family graphs for troubleshooting.';
COMMENT ON FUNCTION get_related_systems IS 'Get all systems related to a given system, optionally filtered by relationship type';
COMMENT ON FUNCTION get_system_family IS 'Get the family graph of related systems up to a given depth';

-- ============================================
-- 8. RLS Policies
-- ============================================
ALTER TABLE staging_system_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_relationships ENABLE ROW LEVEL SECURITY;

-- Allow read access for all
CREATE POLICY "Allow read access to staging_system_relationships" ON staging_system_relationships FOR SELECT USING (true);
CREATE POLICY "Allow read access to system_relationships" ON system_relationships FOR SELECT USING (true);

-- Allow full access for service role
CREATE POLICY "Allow service role full access to staging_system_relationships" ON staging_system_relationships FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role full access to system_relationships" ON system_relationships FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- 9. Updated_at trigger
-- ============================================
DROP TRIGGER IF EXISTS update_staging_system_relationships_updated_at ON staging_system_relationships;
CREATE TRIGGER update_staging_system_relationships_updated_at
  BEFORE UPDATE ON staging_system_relationships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Verification
-- ============================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 033 complete: System relationships tables created';
  RAISE NOTICE '  - staging_system_relationships (pending DIP extractions)';
  RAISE NOTICE '  - system_relationships (approved production)';
  RAISE NOTICE '  - get_related_systems() function';
  RAISE NOTICE '  - get_system_family() function for graph traversal';
  RAISE NOTICE '  - 14 relationship types supported';
END $$;
