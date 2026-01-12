-- Migration: Add photos column to anchorages table
-- Date: 2026-01-12
-- Purpose: Allow attaching photos to anchorages (e.g., anchor drop location)

ALTER TABLE anchorages
ADD COLUMN IF NOT EXISTS photos TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Add comment for documentation
COMMENT ON COLUMN anchorages.photos IS 'Array of public URLs for anchorage photos stored in Supabase Storage';
