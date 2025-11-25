-- ============================================================================
-- Migration 020: Supplies Management System
-- ============================================================================
-- Created: 2024-11-24
-- Description: Complete supplies inventory management for marine equipment
--
-- Architecture:
-- - Hierarchical categories (3 levels max: root > main > sub)
-- - Links to existing systems table via asset_uid
-- - Full-text search with tsvector
-- - Reorder tasks use existing user_tasks table
-- - One-time import from CSV, then UI-managed forever
--
-- Run this in Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- TABLE: supply_categories
-- Hierarchical category system (max 3 levels)
-- ============================================================================

CREATE TABLE IF NOT EXISTS supply_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id UUID REFERENCES supply_categories(id) ON DELETE RESTRICT,
  category_name TEXT NOT NULL,
  category_path TEXT NOT NULL, -- e.g., "SYSTEMS & EQUIPMENT/Plumbing & Water Systems/Freshwater"
  level INTEGER NOT NULL CHECK (level >= 0 AND level <= 2), -- 0=root, 1=main, 2=sub
  display_order INTEGER NOT NULL DEFAULT 0,
  icon TEXT, -- emoji or icon name
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  -- Ensure unique names at same level under same parent
  UNIQUE(parent_id, category_name),

  -- Ensure path matches hierarchy
  CONSTRAINT valid_category_path CHECK (
    CASE
      WHEN parent_id IS NULL THEN level = 0
      ELSE level > 0
    END
  )
);

-- Trigger: Prevent deletion if category has supplies
CREATE OR REPLACE FUNCTION prevent_category_delete_with_items()
RETURNS TRIGGER AS $$
BEGIN
  -- Check for existing supply items
  IF EXISTS (SELECT 1 FROM supplies WHERE category_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot delete category "%" - it has % supply items. Move or delete items first.',
      OLD.category_name,
      (SELECT COUNT(*) FROM supplies WHERE category_id = OLD.id);
  END IF;

  -- Check for child categories
  IF EXISTS (SELECT 1 FROM supply_categories WHERE parent_id = OLD.id) THEN
    RAISE EXCEPTION 'Cannot delete category "%" - it has subcategories. Delete subcategories first.',
      OLD.category_name;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER block_category_delete_with_items
  BEFORE DELETE ON supply_categories
  FOR EACH ROW
  EXECUTE FUNCTION prevent_category_delete_with_items();

-- ============================================================================
-- TABLE: supply_units
-- Standard units for quantity tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS supply_units (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_name TEXT NOT NULL UNIQUE,
  unit_type TEXT NOT NULL CHECK (unit_type IN ('countable', 'volume', 'weight', 'length', 'container', 'special')),
  abbreviation TEXT NOT NULL UNIQUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Unique partial index: Only one default per unit type
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_default_per_unit_type
  ON supply_units(unit_type)
  WHERE is_default = true;

-- ============================================================================
-- TABLE: supplies
-- Main inventory tracking table
-- ============================================================================

CREATE TABLE IF NOT EXISTS supplies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Core fields
  item_name TEXT NOT NULL,
  category_id UUID NOT NULL REFERENCES supply_categories(id) ON DELETE RESTRICT,

  -- Stock tracking (single field - user manages via transactions)
  current_stock DECIMAL(10,2) DEFAULT 0,
  unit_id UUID REFERENCES supply_units(id) ON DELETE SET NULL,

  -- Location tracking
  location TEXT,
  location_details TEXT,

  -- System connections
  system_asset_uid UUID REFERENCES systems(asset_uid) ON DELETE SET NULL,
  ai_suggested_systems JSONB DEFAULT '[]'::jsonb, -- [{asset_uid, confidence, reasoning}]
  ai_analysis_timestamp TIMESTAMPTZ,

  -- Inventory management
  reorder_threshold DECIMAL(10,2),
  reorder_quantity DECIMAL(10,2),
  auto_reorder_enabled BOOLEAN DEFAULT false,

  -- Expiry tracking
  best_before DATE,
  date_opened DATE,
  shelf_life_days INTEGER,

  -- Product details
  brand TEXT,
  supplier TEXT,
  part_number TEXT,
  barcode TEXT,
  purchase_url TEXT,
  typical_price DECIMAL(10,2),
  currency TEXT DEFAULT 'USD',

  -- Search enhancement
  colloquial_names TEXT[] DEFAULT ARRAY[]::TEXT[],
  keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  search_vector tsvector, -- Auto-populated by trigger

  -- Media (Supabase Storage paths)
  photos TEXT[] DEFAULT ARRAY[]::TEXT[],
  manual_pdf_url TEXT,

  -- Metadata
  notes TEXT,
  is_critical BOOLEAN DEFAULT false,
  is_hazmat BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  -- Constraints
  CONSTRAINT positive_stock CHECK (current_stock >= 0),
  CONSTRAINT positive_threshold CHECK (reorder_threshold IS NULL OR reorder_threshold >= 0)
);

-- Trigger: Auto-update search vector
CREATE OR REPLACE FUNCTION update_supplies_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.item_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.brand, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.part_number, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.colloquial_names, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.keywords, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.location, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_supplies_search_vector_trigger
  BEFORE INSERT OR UPDATE ON supplies
  FOR EACH ROW
  EXECUTE FUNCTION update_supplies_search_vector();

-- ============================================================================
-- TABLE: inventory_transactions
-- Audit trail for all stock changes
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  supply_id UUID NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,

  -- Transaction details
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('use', 'purchase', 'adjust', 'count', 'expire')),
  quantity DECIMAL(10,2) NOT NULL,
  unit_id UUID REFERENCES supply_units(id) ON DELETE SET NULL,

  -- Audit trail
  stock_before DECIMAL(10,2),
  stock_after DECIMAL(10,2),

  -- Context
  notes TEXT,
  cost DECIMAL(10,2),

  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES for Performance
-- ============================================================================

-- Supplies indexes
CREATE INDEX IF NOT EXISTS idx_supplies_category ON supplies(category_id);
CREATE INDEX IF NOT EXISTS idx_supplies_system ON supplies(system_asset_uid);
CREATE INDEX IF NOT EXISTS idx_supplies_search ON supplies USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_supplies_location ON supplies(location) WHERE location IS NOT NULL;

-- Low stock monitoring (for nightly reorder check)
CREATE INDEX IF NOT EXISTS idx_supplies_low_stock ON supplies(current_stock, reorder_threshold)
  WHERE auto_reorder_enabled = true AND current_stock <= reorder_threshold;

-- Category indexes
CREATE INDEX IF NOT EXISTS idx_categories_parent ON supply_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_active ON supply_categories(is_active) WHERE is_active = true;

-- Transaction indexes
CREATE INDEX IF NOT EXISTS idx_transactions_supply ON inventory_transactions(supply_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON inventory_transactions(transaction_type, created_at DESC);

-- ============================================================================
-- TIMESTAMP TRIGGERS
-- ============================================================================

-- Reuse existing trigger function (from maintenance-agent migrations)
-- If it doesn't exist, create it
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_supplies_updated_at
  BEFORE UPDATE ON supplies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_supply_categories_updated_at
  BEFORE UPDATE ON supply_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_supply_units_updated_at
  BEFORE UPDATE ON supply_units
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- COMMENTS for Documentation
-- ============================================================================

COMMENT ON TABLE supply_categories IS 'Hierarchical categories for supplies (max 3 levels: root > main > sub)';
COMMENT ON TABLE supply_units IS 'Standard units for quantity tracking';
COMMENT ON TABLE supplies IS 'Main inventory tracking table for boat supplies';
COMMENT ON TABLE inventory_transactions IS 'Audit trail for all stock changes';

COMMENT ON COLUMN supplies.current_stock IS 'Current quantity in stock - managed via transactions';
COMMENT ON COLUMN supplies.system_asset_uid IS 'Link to boat system (from systems table)';
COMMENT ON COLUMN supplies.ai_suggested_systems IS 'AI-recommended system connections with confidence scores';
COMMENT ON COLUMN supplies.auto_reorder_enabled IS 'If true, nightly job creates reorder task when stock <= threshold';
COMMENT ON COLUMN supplies.search_vector IS 'Auto-updated full-text search vector';

-- ============================================================================
-- VERIFICATION QUERIES (run after migration to verify)
-- ============================================================================

-- Check tables created
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'suppl%';

-- Check indexes
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename LIKE 'suppl%';

-- Check triggers
-- SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE event_object_table LIKE 'suppl%';

-- ============================================================================
-- End of Migration 020
-- ============================================================================
