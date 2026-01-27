-- Migration 038: Add v5 pipeline columns to jobs table
-- Purpose: Support model detection and selection in document processing pipeline

-- Add models_detected: Array of models detected by LLM analysis
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS models_detected text[] DEFAULT '{}';

-- Add selected_models: User-selected models for this job
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS selected_models text[] DEFAULT '{}';

-- Add is_multi_model: Flag indicating if document covers multiple models
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_multi_model boolean DEFAULT false;

-- Comment the columns
COMMENT ON COLUMN jobs.models_detected IS 'Array of model numbers detected by LLM during model_detection stage';
COMMENT ON COLUMN jobs.selected_models IS 'Array of model numbers selected by user during model_selection stage';
COMMENT ON COLUMN jobs.is_multi_model IS 'True if document covers multiple models, requiring user selection';
