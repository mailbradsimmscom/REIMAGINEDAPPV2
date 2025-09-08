-- MANUAL MIGRATION: Add normalized system metadata columns to documents table
-- Run this SQL directly in your Supabase SQL Editor or database interface

-- Step 1: Add the new columns
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS asset_uid uuid,
ADD COLUMN IF NOT EXISTS manufacturer_norm text,
ADD COLUMN IF NOT EXISTS model_norm text,
ADD COLUMN IF NOT EXISTS system_norm text,
ADD COLUMN IF NOT EXISTS subsystem_norm text;

-- Step 2: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_asset_uid ON documents(asset_uid);
CREATE INDEX IF NOT EXISTS idx_documents_manufacturer_model ON documents(manufacturer_norm, model_norm);

-- Step 3: Add foreign key constraint (optional - may need to be added later if systems table structure is different)
-- ALTER TABLE documents 
-- ADD CONSTRAINT fk_documents_asset_uid 
-- FOREIGN KEY (asset_uid) REFERENCES systems(asset_uid) 
-- ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 4: Add column comments
COMMENT ON COLUMN documents.asset_uid IS 'Foreign key linking to systems table';
COMMENT ON COLUMN documents.manufacturer_norm IS 'Normalized manufacturer name from systems table';
COMMENT ON COLUMN documents.model_norm IS 'Normalized model name from systems table';
COMMENT ON COLUMN documents.system_norm IS 'Normalized system name from systems table';
COMMENT ON COLUMN documents.subsystem_norm IS 'Normalized subsystem name from systems table';

-- Step 5: Verify the migration worked
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'documents' 
    AND column_name IN ('asset_uid', 'manufacturer_norm', 'model_norm', 'system_norm', 'subsystem_norm')
ORDER BY column_name;
