-- Migration 035: Centroids Tables
-- Part of Document Foundation Crisis fix (see code updates/96b)
-- Operational groupings of systems (Engine Starting, Autopilot, Charging, etc.)
--
-- Run in Supabase SQL Editor

-- ============================================
-- 1. Create centroids table
-- ============================================
CREATE TABLE IF NOT EXISTS centroids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,              -- "Engine Starting (Port)", "Autopilot (Primary)"
  description TEXT,                       -- "Systems involved in starting the port engine"
  synonyms TEXT[] DEFAULT '{}',           -- ["start port engine", "port engine start"]
  icon TEXT,                              -- Icon name for UI
  display_order INTEGER,                  -- For UI sorting
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. Create centroid_members junction table
-- ============================================
CREATE TABLE IF NOT EXISTS centroid_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  centroid_id UUID REFERENCES centroids(id) ON DELETE CASCADE,
  asset_uid UUID REFERENCES systems(asset_uid) ON DELETE CASCADE,
  role TEXT,                              -- 'primary', 'secondary', 'power_source', 'controller'
  is_critical BOOLEAN DEFAULT false,      -- true if system is critical for centroid function
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(centroid_id, asset_uid)
);

-- ============================================
-- 3. Create indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_centroids_name ON centroids(name);
CREATE INDEX IF NOT EXISTS idx_centroids_synonyms ON centroids USING gin(synonyms);

CREATE INDEX IF NOT EXISTS idx_centroid_members_centroid ON centroid_members(centroid_id);
CREATE INDEX IF NOT EXISTS idx_centroid_members_asset ON centroid_members(asset_uid);
CREATE INDEX IF NOT EXISTS idx_centroid_members_role ON centroid_members(role);

-- ============================================
-- 4. Add constraints
-- ============================================
ALTER TABLE centroid_members DROP CONSTRAINT IF EXISTS centroid_members_valid_role;
ALTER TABLE centroid_members ADD CONSTRAINT centroid_members_valid_role
  CHECK (role IS NULL OR role IN (
    'primary',          -- Main system in the group
    'secondary',        -- Supporting system
    'controller',       -- Controls other systems
    'power_source',     -- Provides power
    'sensor',           -- Provides feedback/monitoring
    'actuator',         -- Performs physical action
    'interface',        -- User interface component
    'protection',       -- Safety/protection system
    'backup'            -- Backup/redundant system
  ));

-- ============================================
-- 5. Helper function to get systems for a centroid
-- ============================================
CREATE OR REPLACE FUNCTION get_centroid_systems(p_centroid_name TEXT)
RETURNS TABLE (
  asset_uid UUID,
  system_name TEXT,
  manufacturer TEXT,
  model TEXT,
  role TEXT,
  is_critical BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.asset_uid,
    COALESCE(s.description, s.model_norm) as system_name,
    s.manufacturer_norm as manufacturer,
    s.model_norm as model,
    cm.role,
    cm.is_critical
  FROM centroids c
  JOIN centroid_members cm ON cm.centroid_id = c.id
  JOIN systems s ON s.asset_uid = cm.asset_uid
  WHERE c.name = p_centroid_name
  ORDER BY cm.is_critical DESC, cm.role, s.manufacturer_norm;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. Helper function to find centroid by synonym
-- ============================================
CREATE OR REPLACE FUNCTION find_centroid_by_query(p_query TEXT)
RETURNS TABLE (
  centroid_id UUID,
  centroid_name TEXT,
  match_type TEXT,
  match_score NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id as centroid_id,
    c.name as centroid_name,
    CASE
      WHEN lower(c.name) = lower(p_query) THEN 'exact'
      WHEN lower(c.name) LIKE '%' || lower(p_query) || '%' THEN 'partial'
      WHEN lower(p_query) = ANY(SELECT lower(unnest(c.synonyms))) THEN 'synonym'
      ELSE 'fuzzy'
    END as match_type,
    CASE
      WHEN lower(c.name) = lower(p_query) THEN 1.0
      WHEN lower(c.name) LIKE '%' || lower(p_query) || '%' THEN 0.8
      WHEN lower(p_query) = ANY(SELECT lower(unnest(c.synonyms))) THEN 0.9
      ELSE 0.5
    END as match_score
  FROM centroids c
  WHERE lower(c.name) LIKE '%' || lower(p_query) || '%'
     OR lower(p_query) = ANY(SELECT lower(unnest(c.synonyms)))
  ORDER BY match_score DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. Add comments
-- ============================================
COMMENT ON TABLE centroids IS 'Operational groupings of systems. E.g., "Engine Starting" includes engine, batteries, isolator, saildrive.';
COMMENT ON COLUMN centroids.name IS 'Display name for the centroid, e.g., "Engine Starting (Port)"';
COMMENT ON COLUMN centroids.synonyms IS 'Alternative ways to refer to this centroid in queries';
COMMENT ON TABLE centroid_members IS 'Junction table linking systems to centroids with role information';
COMMENT ON COLUMN centroid_members.role IS 'Role of this system in the centroid: primary, controller, power_source, etc.';
COMMENT ON COLUMN centroid_members.is_critical IS 'True if this system must function for the centroid to work';
COMMENT ON FUNCTION get_centroid_systems IS 'Get all systems belonging to a centroid by name';
COMMENT ON FUNCTION find_centroid_by_query IS 'Find centroids matching a query (checks name and synonyms)';

-- ============================================
-- 8. RLS Policies
-- ============================================
ALTER TABLE centroids ENABLE ROW LEVEL SECURITY;
ALTER TABLE centroid_members ENABLE ROW LEVEL SECURITY;

-- Allow read access for all
CREATE POLICY "Allow read access to centroids" ON centroids FOR SELECT USING (true);
CREATE POLICY "Allow read access to centroid_members" ON centroid_members FOR SELECT USING (true);

-- Allow full access for service role
CREATE POLICY "Allow service role full access to centroids" ON centroids FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role full access to centroid_members" ON centroid_members FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- 9. Updated_at trigger
-- ============================================
DROP TRIGGER IF EXISTS update_centroids_updated_at ON centroids;
CREATE TRIGGER update_centroids_updated_at
  BEFORE UPDATE ON centroids
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Verification
-- ============================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 035 complete: Centroids tables created';
  RAISE NOTICE '  - centroids (operational groupings)';
  RAISE NOTICE '  - centroid_members (junction table with roles)';
  RAISE NOTICE '  - get_centroid_systems() function';
  RAISE NOTICE '  - find_centroid_by_query() function';
END $$;
