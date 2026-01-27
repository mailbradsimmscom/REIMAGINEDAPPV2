-- Migration 029: Reference Tables for v5 Schema
-- Part of Document Foundation Crisis fix (see code updates/96b)
-- Creates lookup tables for manufacturers, product types, and categories
--
-- Run in Supabase SQL Editor

-- ============================================
-- 1. ref_manufacturers
-- ============================================
CREATE TABLE IF NOT EXISTS ref_manufacturers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,              -- "B&G", "Yanmar", "Victron"
  display_name TEXT,                      -- "B&G (Navico)" for display
  website TEXT,                           -- "https://www.bandg.com"
  logo_url TEXT,                          -- URL to logo image
  parent_company TEXT,                    -- "Navico", "Garmin" (for corporate ownership)
  is_oem BOOLEAN DEFAULT false,           -- true if primarily an OEM (Airmar, Hy-ProDrive)
  synonyms TEXT[] DEFAULT '{}',           -- ["Brookes and Gatehouse", "B and G"]
  notes TEXT,                             -- Any relevant notes
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_ref_manufacturers_name ON ref_manufacturers(name);
CREATE INDEX IF NOT EXISTS idx_ref_manufacturers_synonyms ON ref_manufacturers USING gin(synonyms);

-- ============================================
-- 2. ref_product_types
-- ============================================
CREATE TABLE IF NOT EXISTS ref_product_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,              -- "Transducer", "Autopilot Computer", "Engine"
  description TEXT,
  synonyms TEXT[] DEFAULT '{}',           -- ["DST", "depth sensor", "thru-hull sensor"]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_ref_product_types_name ON ref_product_types(name);
CREATE INDEX IF NOT EXISTS idx_ref_product_types_synonyms ON ref_product_types USING gin(synonyms);

-- ============================================
-- 3. ref_system_categories
-- ============================================
CREATE TABLE IF NOT EXISTS ref_system_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,              -- "Navigation", "Propulsion", "Electrical (DC)"
  description TEXT,
  display_order INTEGER,                  -- For UI sorting
  icon TEXT,                              -- Icon name for UI
  synonyms TEXT[] DEFAULT '{}',           -- ["nav", "electronics", "instruments"]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ref_system_categories_name ON ref_system_categories(name);
CREATE INDEX IF NOT EXISTS idx_ref_system_categories_synonyms ON ref_system_categories USING gin(synonyms);

-- ============================================
-- 4. ref_subsystem_categories
-- ============================================
CREATE TABLE IF NOT EXISTS ref_subsystem_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id UUID REFERENCES ref_system_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                     -- "Autopilot", "Engines", "Batteries"
  description TEXT,
  display_order INTEGER,
  synonyms TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(system_id, name)
);

CREATE INDEX IF NOT EXISTS idx_ref_subsystem_categories_system ON ref_subsystem_categories(system_id);
CREATE INDEX IF NOT EXISTS idx_ref_subsystem_categories_name ON ref_subsystem_categories(name);

-- ============================================
-- 5. Updated_at triggers
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
DROP TRIGGER IF EXISTS update_ref_manufacturers_updated_at ON ref_manufacturers;
CREATE TRIGGER update_ref_manufacturers_updated_at
  BEFORE UPDATE ON ref_manufacturers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ref_product_types_updated_at ON ref_product_types;
CREATE TRIGGER update_ref_product_types_updated_at
  BEFORE UPDATE ON ref_product_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ref_system_categories_updated_at ON ref_system_categories;
CREATE TRIGGER update_ref_system_categories_updated_at
  BEFORE UPDATE ON ref_system_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ref_subsystem_categories_updated_at ON ref_subsystem_categories;
CREATE TRIGGER update_ref_subsystem_categories_updated_at
  BEFORE UPDATE ON ref_subsystem_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 6. RLS Policies (read-only for anon, full for service)
-- ============================================
ALTER TABLE ref_manufacturers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ref_product_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE ref_system_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ref_subsystem_categories ENABLE ROW LEVEL SECURITY;

-- Allow read access for all
CREATE POLICY "Allow read access to ref_manufacturers" ON ref_manufacturers FOR SELECT USING (true);
CREATE POLICY "Allow read access to ref_product_types" ON ref_product_types FOR SELECT USING (true);
CREATE POLICY "Allow read access to ref_system_categories" ON ref_system_categories FOR SELECT USING (true);
CREATE POLICY "Allow read access to ref_subsystem_categories" ON ref_subsystem_categories FOR SELECT USING (true);

-- Allow full access for service role
CREATE POLICY "Allow service role full access to ref_manufacturers" ON ref_manufacturers FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role full access to ref_product_types" ON ref_product_types FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role full access to ref_system_categories" ON ref_system_categories FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Allow service role full access to ref_subsystem_categories" ON ref_subsystem_categories FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- Verification
-- ============================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 029 complete: Reference tables created';
  RAISE NOTICE '  - ref_manufacturers';
  RAISE NOTICE '  - ref_product_types';
  RAISE NOTICE '  - ref_system_categories';
  RAISE NOTICE '  - ref_subsystem_categories';
END $$;
