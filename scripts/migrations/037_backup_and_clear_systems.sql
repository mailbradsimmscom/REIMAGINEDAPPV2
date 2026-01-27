-- Migration 037: Backup and Clear Systems/Instances
-- Creates backup copies then clears for fresh start with new schema
--
-- Run in Supabase SQL Editor

-- ============================================
-- 1. Create backup tables
-- ============================================

-- Backup systems table
DROP TABLE IF EXISTS systems_old;
CREATE TABLE systems_old AS SELECT * FROM systems;

-- Backup instances table
DROP TABLE IF EXISTS instances_old;
CREATE TABLE instances_old AS SELECT * FROM instances;

-- Verify backups
DO $$
DECLARE
  sys_count INTEGER;
  inst_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO sys_count FROM systems_old;
  SELECT COUNT(*) INTO inst_count FROM instances_old;
  RAISE NOTICE 'Backup complete:';
  RAISE NOTICE '  - systems_old: % rows', sys_count;
  RAISE NOTICE '  - instances_old: % rows', inst_count;
END $$;

-- ============================================
-- 2. Clear ALL tables with FK to systems
-- ============================================

-- maintenance_agent_memory references systems.asset_uid
TRUNCATE TABLE maintenance_agent_memory CASCADE;

-- staging tables reference systems.asset_uid
TRUNCATE TABLE staging_systems CASCADE;
TRUNCATE TABLE staging_instances CASCADE;

-- New v5 tables that reference systems (may be empty)
TRUNCATE TABLE system_photos CASCADE;
TRUNCATE TABLE staging_troubleshooting CASCADE;
TRUNCATE TABLE troubleshooting CASCADE;
TRUNCATE TABLE staging_system_relationships CASCADE;
TRUNCATE TABLE system_relationships CASCADE;
TRUNCATE TABLE centroid_members CASCADE;

-- ============================================
-- 3. Clear instances (references systems)
-- ============================================
TRUNCATE TABLE instances CASCADE;

-- ============================================
-- 4. Clear systems
-- ============================================
DELETE FROM systems;

-- ============================================
-- Verification
-- ============================================
DO $$
DECLARE
  sys_count INTEGER;
  inst_count INTEGER;
  sys_old_count INTEGER;
  inst_old_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO sys_count FROM systems;
  SELECT COUNT(*) INTO inst_count FROM instances;
  SELECT COUNT(*) INTO sys_old_count FROM systems_old;
  SELECT COUNT(*) INTO inst_old_count FROM instances_old;

  RAISE NOTICE '';
  RAISE NOTICE 'Migration 037 complete:';
  RAISE NOTICE '  - systems: % rows (cleared)', sys_count;
  RAISE NOTICE '  - instances: % rows (cleared)', inst_count;
  RAISE NOTICE '  - systems_old: % rows (backup)', sys_old_count;
  RAISE NOTICE '  - instances_old: % rows (backup)', inst_old_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Ready to add first system via admin UI!';
END $$;
