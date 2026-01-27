-- Migration 030: Systems Table Updates for v5 Schema
-- Part of Document Foundation Crisis fix (see code updates/96b)
-- Adds FK columns to reference tables, OEM tracking, and model synonyms
--
-- PREREQUISITE: Run 029_reference_tables.sql first
-- Run in Supabase SQL Editor

-- ============================================
-- 1. Add FK columns for reference tables
-- ============================================

-- Check if columns exist before adding
DO $$
BEGIN
  -- manufacturer_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'systems' AND column_name = 'manufacturer_id') THEN
    ALTER TABLE systems ADD COLUMN manufacturer_id UUID REFERENCES ref_manufacturers(id);
    RAISE NOTICE 'Added manufacturer_id column';
  ELSE
    RAISE NOTICE 'manufacturer_id column already exists';
  END IF;

  -- product_type_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'systems' AND column_name = 'product_type_id') THEN
    ALTER TABLE systems ADD COLUMN product_type_id UUID REFERENCES ref_product_types(id);
    RAISE NOTICE 'Added product_type_id column';
  ELSE
    RAISE NOTICE 'product_type_id column already exists';
  END IF;

  -- system_category_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'systems' AND column_name = 'system_category_id') THEN
    ALTER TABLE systems ADD COLUMN system_category_id UUID REFERENCES ref_system_categories(id);
    RAISE NOTICE 'Added system_category_id column';
  ELSE
    RAISE NOTICE 'system_category_id column already exists';
  END IF;

  -- subsystem_category_id
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'systems' AND column_name = 'subsystem_category_id') THEN
    ALTER TABLE systems ADD COLUMN subsystem_category_id UUID REFERENCES ref_subsystem_categories(id);
    RAISE NOTICE 'Added subsystem_category_id column';
  ELSE
    RAISE NOTICE 'subsystem_category_id column already exists';
  END IF;
END $$;

-- ============================================
-- 2. Add OEM tracking columns
-- ============================================

DO $$
BEGIN
  -- oem_manufacturer_id (FK to ref_manufacturers for OEM like Airmar, Hy-ProDrive)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'systems' AND column_name = 'oem_manufacturer_id') THEN
    ALTER TABLE systems ADD COLUMN oem_manufacturer_id UUID REFERENCES ref_manufacturers(id);
    RAISE NOTICE 'Added oem_manufacturer_id column';
  ELSE
    RAISE NOTICE 'oem_manufacturer_id column already exists';
  END IF;

  -- oem_model
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'systems' AND column_name = 'oem_model') THEN
    ALTER TABLE systems ADD COLUMN oem_model TEXT;
    RAISE NOTICE 'Added oem_model column';
  ELSE
    RAISE NOTICE 'oem_model column already exists';
  END IF;

  -- oem_part_number
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'systems' AND column_name = 'oem_part_number') THEN
    ALTER TABLE systems ADD COLUMN oem_part_number TEXT;
    RAISE NOTICE 'Added oem_part_number column';
  ELSE
    RAISE NOTICE 'oem_part_number column already exists';
  END IF;
END $$;

-- ============================================
-- 3. Add serial_number column (for single-instance systems)
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'systems' AND column_name = 'serial_number') THEN
    ALTER TABLE systems ADD COLUMN serial_number TEXT;
    RAISE NOTICE 'Added serial_number column';
  ELSE
    RAISE NOTICE 'serial_number column already exists';
  END IF;
END $$;

-- ============================================
-- 4. Add model_synonyms array
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'systems' AND column_name = 'model_synonyms') THEN
    ALTER TABLE systems ADD COLUMN model_synonyms TEXT[] DEFAULT '{}';
    RAISE NOTICE 'Added model_synonyms column';
  ELSE
    RAISE NOTICE 'model_synonyms column already exists';
  END IF;
END $$;

-- ============================================
-- 5. Create indexes for new columns
-- ============================================

CREATE INDEX IF NOT EXISTS idx_systems_manufacturer ON systems(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_systems_product_type ON systems(product_type_id);
CREATE INDEX IF NOT EXISTS idx_systems_system_category ON systems(system_category_id);
CREATE INDEX IF NOT EXISTS idx_systems_subsystem_category ON systems(subsystem_category_id);
CREATE INDEX IF NOT EXISTS idx_systems_oem_manufacturer ON systems(oem_manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_systems_model_synonyms ON systems USING gin(model_synonyms);

-- ============================================
-- 6. Add comment documentation
-- ============================================

COMMENT ON COLUMN systems.manufacturer_id IS 'FK to ref_manufacturers - the branded manufacturer (B&G, Yanmar)';
COMMENT ON COLUMN systems.product_type_id IS 'FK to ref_product_types - universal product type (Engine, Transducer)';
COMMENT ON COLUMN systems.system_category_id IS 'FK to ref_system_categories - functional category (Navigation, Propulsion)';
COMMENT ON COLUMN systems.subsystem_category_id IS 'FK to ref_subsystem_categories - functional subcategory (Autopilot, Engines)';
COMMENT ON COLUMN systems.oem_manufacturer_id IS 'FK to ref_manufacturers - the OEM if different from branded (Airmar for B&G transducers)';
COMMENT ON COLUMN systems.oem_model IS 'OEM model number if different from branded model';
COMMENT ON COLUMN systems.oem_part_number IS 'OEM part number for ordering spares';
COMMENT ON COLUMN systems.serial_number IS 'Serial number for single-instance systems (use instances table for multiples)';
COMMENT ON COLUMN systems.model_synonyms IS 'Array of alternative model names for search matching';

-- ============================================
-- Verification
-- ============================================
DO $$
DECLARE
  col_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_name = 'systems'
    AND column_name IN ('manufacturer_id', 'product_type_id', 'system_category_id',
                        'subsystem_category_id', 'oem_manufacturer_id', 'oem_model',
                        'oem_part_number', 'serial_number', 'model_synonyms');

  RAISE NOTICE 'Migration 030 complete: % new columns added to systems table', col_count;
  RAISE NOTICE '  - manufacturer_id, product_type_id';
  RAISE NOTICE '  - system_category_id, subsystem_category_id';
  RAISE NOTICE '  - oem_manufacturer_id, oem_model, oem_part_number';
  RAISE NOTICE '  - serial_number, model_synonyms';
END $$;
