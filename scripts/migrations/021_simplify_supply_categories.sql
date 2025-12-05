-- ============================================================================
-- Migration 021: Simplify Supply Categories (Flat List)
-- ============================================================================
-- Created: 2025-12-05
-- Description: Remove hierarchy from supply_categories, keep only categories in use
--
-- Changes:
-- 1. Delete categories with 0 items (unused hierarchy levels)
-- 2. Drop hierarchy columns (parent_id, category_path, level)
-- 3. Drop hierarchy constraints
-- 4. Result: Simple flat list of categories
--
-- Run this in Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop ALL constraints and triggers FIRST
-- ============================================================================

-- Drop the trigger that prevents deletion
DROP TRIGGER IF EXISTS block_category_delete_with_items ON supply_categories;
DROP FUNCTION IF EXISTS prevent_category_delete_with_items();

-- Drop the hierarchy validation constraint (requires level=0 when parent_id is null)
ALTER TABLE supply_categories DROP CONSTRAINT IF EXISTS valid_category_path;

-- Drop the unique constraint on parent_id + category_name
ALTER TABLE supply_categories DROP CONSTRAINT IF EXISTS supply_categories_parent_id_category_name_key;

-- ============================================================================
-- STEP 2: Break parent-child links (set all parent_id to NULL)
-- ============================================================================

UPDATE supply_categories SET parent_id = NULL;

-- ============================================================================
-- STEP 3: Delete unused categories (those with 0 supplies linked)
-- ============================================================================

-- Delete categories with no items
DELETE FROM supply_categories
WHERE id NOT IN (
  SELECT DISTINCT category_id FROM supplies WHERE category_id IS NOT NULL
);

-- ============================================================================
-- STEP 4: Drop hierarchy columns
-- ============================================================================

ALTER TABLE supply_categories
  DROP COLUMN IF EXISTS parent_id,
  DROP COLUMN IF EXISTS category_path,
  DROP COLUMN IF EXISTS level;

-- ============================================================================
-- STEP 5: Add simple unique constraint on category_name
-- ============================================================================

-- Ensure category names are unique (flat list)
ALTER TABLE supply_categories
  ADD CONSTRAINT supply_categories_name_unique UNIQUE (category_name);

-- ============================================================================
-- STEP 6: Clean up display_order (renumber 1, 2, 3...)
-- ============================================================================

WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY category_name) as new_order
  FROM supply_categories
)
UPDATE supply_categories
SET display_order = numbered.new_order
FROM numbered
WHERE supply_categories.id = numbered.id;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Show final categories
SELECT id, category_name, display_order, is_active,
  (SELECT COUNT(*) FROM supplies WHERE category_id = supply_categories.id) as item_count
FROM supply_categories
ORDER BY display_order;

-- ============================================================================
-- End of Migration 021
-- ============================================================================
