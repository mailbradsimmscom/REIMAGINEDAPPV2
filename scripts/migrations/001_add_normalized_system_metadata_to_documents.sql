-- Migration: Add normalized system metadata columns to documents table
-- Purpose: Support linking documents to systems via normalized manufacturer/model names
-- Date: 2025-01-09
-- Author: Document Upload Refactor

-- Add normalized system metadata columns to documents table
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS asset_uid uuid,
ADD COLUMN IF NOT EXISTS manufacturer_norm text,
ADD COLUMN IF NOT EXISTS model_norm text,
ADD COLUMN IF NOT EXISTS system_norm text,
ADD COLUMN IF NOT EXISTS subsystem_norm text;

-- Add indexes for performance on lookup operations
CREATE INDEX IF NOT EXISTS idx_documents_asset_uid ON documents(asset_uid);
CREATE INDEX IF NOT EXISTS idx_documents_manufacturer_model ON documents(manufacturer_norm, model_norm);

-- Add foreign key constraint to link documents to systems
-- Note: This assumes the systems table has asset_uid as primary key
ALTER TABLE documents 
ADD CONSTRAINT fk_documents_asset_uid 
FOREIGN KEY (asset_uid) REFERENCES systems(asset_uid) 
ON DELETE SET NULL ON UPDATE CASCADE;

-- Add comments for documentation
COMMENT ON COLUMN documents.asset_uid IS 'Foreign key linking to systems table';
COMMENT ON COLUMN documents.manufacturer_norm IS 'Normalized manufacturer name from systems table';
COMMENT ON COLUMN documents.model_norm IS 'Normalized model name from systems table';
COMMENT ON COLUMN documents.system_norm IS 'Normalized system name from systems table';
COMMENT ON COLUMN documents.subsystem_norm IS 'Normalized subsystem name from systems table';

-- Verify the migration
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'documents' 
    AND column_name IN ('asset_uid', 'manufacturer_norm', 'model_norm', 'system_norm', 'subsystem_norm')
ORDER BY column_name;
