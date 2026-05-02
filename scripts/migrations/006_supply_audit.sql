-- Migration 006: Supply Audit Tables
-- Purpose: Fully isolated quick-add audit tool for capturing supplies with photos & locations
-- These tables have NO foreign keys to any production tables (supplies, supply_locations, etc.)

-- ============================================================
-- UP
-- ============================================================

-- Audit locations (separate from production supply_locations)
CREATE TABLE supply_audit_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit items (separate from production supplies)
CREATE TABLE supply_audit_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name TEXT NOT NULL,
  current_stock NUMERIC DEFAULT 1 CHECK (current_stock >= 0),
  location TEXT,
  photos TEXT[] DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_supply_audit_items_location ON supply_audit_items(location);
CREATE INDEX idx_supply_audit_items_created_at ON supply_audit_items(created_at);

-- Atomic rename: cascades location name change to audit items
CREATE OR REPLACE FUNCTION rename_audit_location(location_id UUID, new_name TEXT)
RETURNS JSON AS $$
DECLARE
  old_name TEXT;
  trimmed_name TEXT;
  audit_count INT;
BEGIN
  -- Trim and validate
  trimmed_name := TRIM(new_name);
  IF trimmed_name = '' OR trimmed_name IS NULL THEN
    RAISE EXCEPTION 'Location name cannot be empty';
  END IF;

  -- Check for duplicate name
  IF EXISTS (SELECT 1 FROM supply_audit_locations WHERE name = trimmed_name AND id != location_id) THEN
    RAISE EXCEPTION 'A location with that name already exists';
  END IF;

  -- Get current name
  SELECT name INTO old_name FROM supply_audit_locations WHERE id = location_id;
  IF old_name IS NULL THEN
    RAISE EXCEPTION 'Location not found';
  END IF;

  -- Rename in audit locations
  UPDATE supply_audit_locations SET name = trimmed_name, updated_at = NOW() WHERE id = location_id;

  -- Cascade to audit items
  UPDATE supply_audit_items SET location = trimmed_name, updated_at = NOW() WHERE location = old_name;
  GET DIAGNOSTICS audit_count = ROW_COUNT;

  RETURN json_build_object(
    'old_name', old_name,
    'new_name', trimmed_name,
    'audit_items_updated', audit_count
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- DOWN (rollback) — run these in order
-- ============================================================
-- DROP FUNCTION IF EXISTS rename_audit_location(UUID, TEXT);
-- DROP TABLE IF EXISTS supply_audit_items;
-- DROP TABLE IF EXISTS supply_audit_locations;
