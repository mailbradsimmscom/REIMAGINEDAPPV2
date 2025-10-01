-- ============================================================================
-- Phase 2: Database Discovery Queries
-- Purpose: Understand table structure, constraints, and validation rules
-- ============================================================================

-- 1. Systems table structure and constraints
-- This shows all columns, their types, max lengths, nullability, and defaults
SELECT
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name = 'systems'
ORDER BY ordinal_position;

-- 2. Check for unique constraints and indexes on systems
-- This reveals which fields must be unique (important for validation)
SELECT
    con.conname AS constraint_name,
    con.contype AS constraint_type,
    ARRAY_AGG(att.attname ORDER BY u.attposition) AS columns
FROM pg_constraint con
JOIN LATERAL UNNEST(con.conkey) WITH ORDINALITY AS u(attnum, attposition) ON TRUE
JOIN pg_attribute att ON att.attnum = u.attnum AND att.attrelid = con.conrelid
WHERE con.conrelid = 'public.systems'::regclass
    AND con.contype IN ('p', 'u', 'c')
GROUP BY con.conname, con.contype;

-- 3. Instances table structure
-- Shows all instance fields and their constraints
SELECT
    column_name,
    data_type,
    character_maximum_length,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
    AND table_name = 'instances'
ORDER BY ordinal_position;

-- 4. Check for foreign keys between instances and systems
-- Confirms the relationship and cascade behavior
SELECT
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name = 'instances'
    AND tc.table_schema = 'public';

-- 5. Check if instances_archived table exists
-- Returns 't' if exists, 'f' if not
SELECT EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'instances_archived'
) AS instances_archived_exists;

-- 6. If instances_archived doesn't exist, run this CREATE statement:
-- (Uncomment and run if query #5 returns 'f')
/*
CREATE TABLE IF NOT EXISTS instances_archived (
    instance_uid UUID PRIMARY KEY,
    asset_uid UUID NOT NULL,
    serial_number TEXT,
    location TEXT,
    instance_index INTEGER,
    archived_at TIMESTAMPTZ DEFAULT NOW(),
    archived_by TEXT,
    original_data JSONB
);
*/

-- 7. Sample data from systems to understand field patterns
-- Shows real examples of how fields are populated
SELECT
    asset_uid,
    system_norm,
    subsystem_norm,
    manufacturer_norm,
    model_norm,
    canonical_model_id,
    description,
    manual_url,
    oem_page
FROM systems
LIMIT 5;

-- 8. Check what fields are commonly NULL vs populated
-- This helps determine which fields are optional vs required in practice
SELECT
    COUNT(*) as total_rows,
    COUNT(system_norm) as has_system_norm,
    COUNT(subsystem_norm) as has_subsystem_norm,
    COUNT(manufacturer_norm) as has_manufacturer_norm,
    COUNT(model_norm) as has_model_norm,
    COUNT(canonical_model_id) as has_canonical_model_id,
    COUNT(description) as has_description,
    COUNT(manual_url) as has_manual_url,
    COUNT(oem_page) as has_oem_page,
    COUNT(spec_keywords) as has_spec_keywords
FROM systems;

-- 9. Check instances table relationship patterns
-- Shows how many instances are typically associated with systems
SELECT
    s.manufacturer_norm,
    s.model_norm,
    COUNT(i.instance_uid) as instance_count
FROM systems s
LEFT JOIN instances i ON s.asset_uid = i.asset_uid
GROUP BY s.manufacturer_norm, s.model_norm
HAVING COUNT(i.instance_uid) > 0
ORDER BY instance_count DESC
LIMIT 10;

-- 10. Validate manufacturer_norm + model_norm uniqueness
-- Shows if manufacturer+model combinations are unique or can have duplicates
SELECT
    manufacturer_norm,
    model_norm,
    COUNT(*) as duplicate_count
FROM systems
WHERE manufacturer_norm IS NOT NULL
    AND model_norm IS NOT NULL
GROUP BY manufacturer_norm, model_norm
HAVING COUNT(*) > 1;

-- ============================================================================
-- INSTRUCTIONS:
-- 1. Run each query in your PostgreSQL client (psql, pgAdmin, etc.)
-- 2. Save the results
-- 3. Share the results so validation rules can be designed
-- ============================================================================
