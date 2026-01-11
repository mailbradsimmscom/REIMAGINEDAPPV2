-- Migration: Add 'unhinged' style to season_recaps
-- Purpose: Allow a third recap style (unhinged = over-the-top dramatic)
-- Date: 2026-01-11

-- Drop the existing CHECK constraint on style
ALTER TABLE season_recaps DROP CONSTRAINT IF EXISTS season_recaps_style_check;

-- Add new CHECK constraint that includes 'unhinged'
ALTER TABLE season_recaps ADD CONSTRAINT season_recaps_style_check
  CHECK (style IN ('boring', 'exciting', 'unhinged'));

-- Update comment
COMMENT ON COLUMN season_recaps.style IS 'Type of recap: boring (factual), exciting (dramatic), or unhinged (over-the-top legendary)';
