-- ============================================================================
-- Migration 020 Seed Data: Supply Categories and Units
-- ============================================================================
-- Created: 2024-11-24
-- Description: Default categories and units for supplies management
--
-- Must run AFTER 020_create_supplies_tables.sql
--
-- Structure:
-- - 4 root categories (level 0)
-- - ~8 main categories (level 1)
-- - ~20 sub categories (level 2)
-- - ~18 standard units
--
-- Run this in Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- SUPPLY UNITS
-- Standard measurement units for inventory
-- ============================================================================

INSERT INTO supply_units (unit_name, unit_type, abbreviation, is_default, display_order, is_active) VALUES
  -- Countable
  ('piece', 'countable', 'pc', true, 1, true),
  ('pair', 'countable', 'pr', false, 2, true),
  ('set', 'countable', 'set', false, 3, true),
  ('kit', 'countable', 'kit', false, 4, true),
  ('item', 'countable', 'item', false, 5, true),

  -- Volume
  ('liter', 'volume', 'L', true, 10, true),
  ('milliliter', 'volume', 'mL', false, 11, true),
  ('gallon', 'volume', 'gal', false, 12, true),
  ('ounce', 'volume', 'oz', false, 13, true),

  -- Length
  ('meter', 'length', 'm', true, 20, true),
  ('foot', 'length', 'ft', false, 21, true),
  ('inch', 'length', 'in', false, 22, true),

  -- Weight
  ('kilogram', 'weight', 'kg', true, 30, true),
  ('gram', 'weight', 'g', false, 31, true),
  ('pound', 'weight', 'lb', false, 32, true),

  -- Container
  ('bottle', 'container', 'btl', false, 40, true),
  ('can', 'container', 'can', false, 41, true),
  ('tube', 'container', 'tube', false, 42, true),
  ('box', 'container', 'box', false, 43, true),
  ('bag', 'container', 'bag', false, 44, true),
  ('pack', 'container', 'pack', false, 45, true),
  ('roll', 'container', 'roll', false, 46, true),

  -- Special
  ('cartridge', 'special', 'cart', false, 50, true),
  ('spool', 'special', 'spool', false, 51, true)
ON CONFLICT (unit_name) DO NOTHING;

-- ============================================================================
-- SUPPLY CATEGORIES
-- Hierarchical structure for organizing supplies
-- ============================================================================

-- Use a CTE to build hierarchy with proper parent references
WITH

-- Level 0: ROOT categories
root_cats AS (
  INSERT INTO supply_categories (category_name, category_path, level, display_order, icon, is_active) VALUES
    ('SYSTEMS & EQUIPMENT', 'SYSTEMS & EQUIPMENT', 0, 1, '⚙️', true),
    ('CONSUMABLES & SUPPLIES', 'CONSUMABLES & SUPPLIES', 0, 2, '📦', true),
    ('TOOLS & EQUIPMENT', 'TOOLS & EQUIPMENT', 0, 3, '🔧', true),
    ('TENDER & AUXILIARY', 'TENDER & AUXILIARY', 0, 4, '🚤', true)
  ON CONFLICT (parent_id, category_name) DO NOTHING
  RETURNING id, category_name, category_path
),

-- Level 1: MAIN categories under SYSTEMS & EQUIPMENT
main_systems AS (
  INSERT INTO supply_categories (parent_id, category_name, category_path, level, display_order, icon, is_active)
  SELECT
    r.id,
    cat.name,
    r.category_path || '/' || cat.name,
    1,
    cat.ord,
    cat.icon,
    true
  FROM root_cats r
  CROSS JOIN (VALUES
    ('Plumbing & Water Systems', 1, '💧'),
    ('Electrical & Electronics', 2, '⚡'),
    ('Propulsion & Steering', 3, '🚢'),
    ('Sails & Rigging', 4, '⛵')
  ) AS cat(name, ord, icon)
  WHERE r.category_name = 'SYSTEMS & EQUIPMENT'
  ON CONFLICT (parent_id, category_name) DO NOTHING
  RETURNING id, category_name, category_path
),

-- Level 2: SUB categories under Plumbing & Water Systems
sub_plumbing AS (
  INSERT INTO supply_categories (parent_id, category_name, category_path, level, display_order, is_active)
  SELECT
    m.id,
    cat.name,
    m.category_path || '/' || cat.name,
    2,
    cat.ord,
    true
  FROM main_systems m
  CROSS JOIN (VALUES
    ('Freshwater System', 1),
    ('Blackwater System', 2),
    ('Bilge & Pumps', 3),
    ('Watermaker', 4),
    ('General Plumbing', 5)
  ) AS cat(name, ord)
  WHERE m.category_name = 'Plumbing & Water Systems'
  ON CONFLICT (parent_id, category_name) DO NOTHING
  RETURNING id, category_name
),

-- Level 2: SUB categories under Electrical & Electronics
sub_electrical AS (
  INSERT INTO supply_categories (parent_id, category_name, category_path, level, display_order, is_active)
  SELECT
    m.id,
    cat.name,
    m.category_path || '/' || cat.name,
    2,
    cat.ord,
    true
  FROM main_systems m
  CROSS JOIN (VALUES
    ('Wiring & Connectors', 1),
    ('Batteries & Charging', 2),
    ('Navigation Electronics', 3),
    ('Fuses & Breakers', 4)
  ) AS cat(name, ord)
  WHERE m.category_name = 'Electrical & Electronics'
  ON CONFLICT (parent_id, category_name) DO NOTHING
  RETURNING id, category_name
),

-- Level 2: SUB categories under Propulsion & Steering
sub_propulsion AS (
  INSERT INTO supply_categories (parent_id, category_name, category_path, level, display_order, is_active)
  SELECT
    m.id,
    cat.name,
    m.category_path || '/' || cat.name,
    2,
    cat.ord,
    true
  FROM main_systems m
  CROSS JOIN (VALUES
    ('Engine Parts & Service', 1),
    ('Gori Props & Anodes', 2),
    ('Steering Components', 3),
    ('Throttle & Controls', 4)
  ) AS cat(name, ord)
  WHERE m.category_name = 'Propulsion & Steering'
  ON CONFLICT (parent_id, category_name) DO NOTHING
  RETURNING id, category_name
),

-- Level 2: SUB categories under Sails & Rigging
sub_sails AS (
  INSERT INTO supply_categories (parent_id, category_name, category_path, level, display_order, is_active)
  SELECT
    m.id,
    cat.name,
    m.category_path || '/' || cat.name,
    2,
    cat.ord,
    true
  FROM main_systems m
  CROSS JOIN (VALUES
    ('Sail Repair', 1),
    ('Running & Standing Rigging', 2)
  ) AS cat(name, ord)
  WHERE m.category_name = 'Sails & Rigging'
  ON CONFLICT (parent_id, category_name) DO NOTHING
  RETURNING id, category_name
),

-- Level 1: MAIN categories under CONSUMABLES & SUPPLIES
main_consumables AS (
  INSERT INTO supply_categories (parent_id, category_name, category_path, level, display_order, icon, is_active)
  SELECT
    r.id,
    cat.name,
    r.category_path || '/' || cat.name,
    1,
    cat.ord,
    cat.icon,
    true
  FROM root_cats r
  CROSS JOIN (VALUES
    ('Fluids & Chemicals', 1, '🧪'),
    ('Hardware & Fasteners', 2, '🔩'),
    ('General Supplies', 3, '📦')
  ) AS cat(name, ord, icon)
  WHERE r.category_name = 'CONSUMABLES & SUPPLIES'
  ON CONFLICT (parent_id, category_name) DO NOTHING
  RETURNING id, category_name, category_path
),

-- Level 2: SUB categories under Fluids & Chemicals
sub_fluids AS (
  INSERT INTO supply_categories (parent_id, category_name, category_path, level, display_order, is_active)
  SELECT
    m.id,
    cat.name,
    m.category_path || '/' || cat.name,
    2,
    cat.ord,
    true
  FROM main_consumables m
  CROSS JOIN (VALUES
    ('Oils & Lubricants', 1),
    ('Adhesives & Sealants', 2),
    ('Cleaning Products', 3)
  ) AS cat(name, ord)
  WHERE m.category_name = 'Fluids & Chemicals'
  ON CONFLICT (parent_id, category_name) DO NOTHING
  RETURNING id, category_name
),

-- Level 2: SUB categories under Hardware & Fasteners
sub_hardware AS (
  INSERT INTO supply_categories (parent_id, category_name, category_path, level, display_order, is_active)
  SELECT
    m.id,
    cat.name,
    m.category_path || '/' || cat.name,
    2,
    cat.ord,
    true
  FROM main_consumables m
  CROSS JOIN (VALUES
    ('Nuts, Bolts & Screws', 1),
    ('Pins & Clips', 2),
    ('Clamps & Ties', 3),
    ('Hose Clamps', 4)
  ) AS cat(name, ord)
  WHERE m.category_name = 'Hardware & Fasteners'
  ON CONFLICT (parent_id, category_name) DO NOTHING
  RETURNING id, category_name
),

-- Level 2: SUB categories under General Supplies
sub_general AS (
  INSERT INTO supply_categories (parent_id, category_name, category_path, level, display_order, is_active)
  SELECT
    m.id,
    cat.name,
    m.category_path || '/' || cat.name,
    2,
    cat.ord,
    true
  FROM main_consumables m
  CROSS JOIN (VALUES
    ('Tapes & Films', 1),
    ('Paper Products', 2),
    ('Safety Equipment', 3),
    ('Miscellaneous', 4)
  ) AS cat(name, ord)
  WHERE m.category_name = 'General Supplies'
  ON CONFLICT (parent_id, category_name) DO NOTHING
  RETURNING id, category_name
),

-- Level 1: MAIN categories under TOOLS & EQUIPMENT
main_tools AS (
  INSERT INTO supply_categories (parent_id, category_name, category_path, level, display_order, is_active)
  SELECT
    r.id,
    cat.name,
    r.category_path || '/' || cat.name,
    1,
    cat.ord,
    true
  FROM root_cats r
  CROSS JOIN (VALUES
    ('Hand Tools', 1),
    ('Power Tools', 2),
    ('Specialty Tools', 3),
    ('Testing Equipment', 4)
  ) AS cat(name, ord)
  WHERE r.category_name = 'TOOLS & EQUIPMENT'
  ON CONFLICT (parent_id, category_name) DO NOTHING
  RETURNING id, category_name
),

-- Level 1: MAIN categories under TENDER & AUXILIARY
main_tender AS (
  INSERT INTO supply_categories (parent_id, category_name, category_path, level, display_order, is_active)
  SELECT
    r.id,
    cat.name,
    r.category_path || '/' || cat.name,
    1,
    cat.ord,
    true
  FROM root_cats r
  CROSS JOIN (VALUES
    ('Dinghy Parts', 1),
    ('Outboard Service', 2)
  ) AS cat(name, ord)
  WHERE r.category_name = 'TENDER & AUXILIARY'
  ON CONFLICT (parent_id, category_name) DO NOTHING
  RETURNING id, category_name
)

-- Final select to show what was inserted
SELECT 'Categories seeded successfully' AS result;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Count categories by level
-- SELECT level, COUNT(*) as count FROM supply_categories GROUP BY level ORDER BY level;

-- Show full hierarchy
-- SELECT
--   REPEAT('  ', level) || category_name as hierarchy,
--   level,
--   category_path
-- FROM supply_categories
-- ORDER BY category_path;

-- Count units by type
-- SELECT unit_type, COUNT(*) as count FROM supply_units GROUP BY unit_type ORDER BY unit_type;

-- ============================================================================
-- End of Seed Data
-- ============================================================================
