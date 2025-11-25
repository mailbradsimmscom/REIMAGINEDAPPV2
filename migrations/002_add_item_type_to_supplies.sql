-- Migration 002: Add item_type column to supplies table
-- Date: 2025-11-24
-- Purpose: Support differentiating between supplies, tools, and items

-- Add item_type column with default 'supply'
ALTER TABLE supplies
ADD COLUMN IF NOT EXISTS item_type VARCHAR(10) DEFAULT 'supply';

-- Add check constraint to ensure valid item types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supplies_item_type_check'
  ) THEN
    ALTER TABLE supplies
    ADD CONSTRAINT supplies_item_type_check
    CHECK (item_type IN ('supply', 'tool', 'item'));
  END IF;
END $$;

-- Add index for filtering by item_type
CREATE INDEX IF NOT EXISTS idx_supplies_item_type ON supplies(item_type);

-- Add comment
COMMENT ON COLUMN supplies.item_type IS 'Type of inventory item: supply (consumable), tool (reusable equipment), or item (trackable asset)';
