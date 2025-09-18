-- Migration: Transform staging_spec_suggestions to match full JSON structure
-- Purpose: Align staging table with complete specifications extraction format
-- Date: 2025-01-16
-- Author: Specifications Extraction Alignment

-- Step 1: Create staging_spec_suggestions table (if it doesn't exist)
CREATE TABLE IF NOT EXISTS staging_spec_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_id VARCHAR(255) NOT NULL,
    spec_name VARCHAR(255) NOT NULL,
    spec_value DECIMAL,
    spec_unit VARCHAR(50),
    page INTEGER,
    context TEXT,
    confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
    bbox JSONB,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 2: Add new columns for full JSON structure
ALTER TABLE staging_spec_suggestions 
ADD COLUMN IF NOT EXISTS manufacturer_norm text,
ADD COLUMN IF NOT EXISTS model_norm text,
ADD COLUMN IF NOT EXISTS asset_uid uuid,
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS parameter text,
ADD COLUMN IF NOT EXISTS normalized_parameter text,
ADD COLUMN IF NOT EXISTS parameter_aliases jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS value text,
ADD COLUMN IF NOT EXISTS range text,
ADD COLUMN IF NOT EXISTS units text,
ADD COLUMN IF NOT EXISTS normalized_units text,
ADD COLUMN IF NOT EXISTS converted_value text,
ADD COLUMN IF NOT EXISTS category text,
ADD COLUMN IF NOT EXISTS search_terms jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS concept_group text,
ADD COLUMN IF NOT EXISTS "references" jsonb DEFAULT '[]'::jsonb;

-- Step 3: Drop old columns
ALTER TABLE staging_spec_suggestions 
DROP COLUMN IF EXISTS spec_name,
DROP COLUMN IF EXISTS spec_value,
DROP COLUMN IF EXISTS spec_unit,
DROP COLUMN IF EXISTS page,
DROP COLUMN IF EXISTS context,
DROP COLUMN IF EXISTS bbox;

-- Step 4: Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_staging_spec_suggestions_manufacturer_norm 
    ON staging_spec_suggestions(manufacturer_norm);
CREATE INDEX IF NOT EXISTS idx_staging_spec_suggestions_model_norm 
    ON staging_spec_suggestions(model_norm);
CREATE INDEX IF NOT EXISTS idx_staging_spec_suggestions_asset_uid 
    ON staging_spec_suggestions(asset_uid);
CREATE INDEX IF NOT EXISTS idx_staging_spec_suggestions_normalized_parameter 
    ON staging_spec_suggestions(normalized_parameter);
CREATE INDEX IF NOT EXISTS idx_staging_spec_suggestions_category 
    ON staging_spec_suggestions(category);
CREATE INDEX IF NOT EXISTS idx_staging_spec_suggestions_concept_group 
    ON staging_spec_suggestions(concept_group);

-- Step 5: Add foreign key constraint for asset_uid
ALTER TABLE staging_spec_suggestions 
ADD CONSTRAINT fk_staging_spec_suggestions_asset_uid 
FOREIGN KEY (asset_uid) REFERENCES systems(asset_uid) 
ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 6: Add column comments
COMMENT ON COLUMN staging_spec_suggestions.manufacturer_norm IS 'Normalized manufacturer name from systems table';
COMMENT ON COLUMN staging_spec_suggestions.model_norm IS 'Normalized model name from systems table';
COMMENT ON COLUMN staging_spec_suggestions.asset_uid IS 'Foreign key linking to systems table';
COMMENT ON COLUMN staging_spec_suggestions.description IS 'Description mapped from models JSON array';
COMMENT ON COLUMN staging_spec_suggestions.parameter IS 'Original parameter name from manual';
COMMENT ON COLUMN staging_spec_suggestions.normalized_parameter IS 'Standardized parameter name (lowercase, underscores)';
COMMENT ON COLUMN staging_spec_suggestions.parameter_aliases IS 'Alternative names/terms for same concept';
COMMENT ON COLUMN staging_spec_suggestions.value IS 'Numeric value or text as stated';
COMMENT ON COLUMN staging_spec_suggestions.range IS 'Min/max if applicable';
COMMENT ON COLUMN staging_spec_suggestions.units IS 'Original units from document';
COMMENT ON COLUMN staging_spec_suggestions.normalized_units IS 'Standard SI or common units';
COMMENT ON COLUMN staging_spec_suggestions.converted_value IS 'Value in normalized units if conversion needed';
COMMENT ON COLUMN staging_spec_suggestions.category IS 'Power/Electrical/Dimensions/Performance/Environmental/Installation';
COMMENT ON COLUMN staging_spec_suggestions.search_terms IS 'All possible ways users might ask about this';
COMMENT ON COLUMN staging_spec_suggestions.concept_group IS 'Related specifications group';
COMMENT ON COLUMN staging_spec_suggestions."references" IS 'Page numbers or section names';

-- Step 7: Update table comment
COMMENT ON TABLE staging_spec_suggestions IS 'Staging table for complete specifications extraction data matching JSON structure';
