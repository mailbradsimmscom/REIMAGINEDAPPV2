-- Migration: Create season_recaps table
-- Purpose: Store generated season recap content (boring and exciting versions)
-- Date: 2026-01-11

-- Create season_recaps table
CREATE TABLE IF NOT EXISTS season_recaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Recap type
  style text NOT NULL CHECK (style IN ('boring', 'exciting')),

  -- Content (HTML formatted)
  content text NOT NULL,

  -- Generation metadata
  model_used text,                      -- OpenAI model that generated this
  trips_count integer,                  -- Number of trips included
  anchorages_count integer,             -- Number of anchorages included

  -- Timestamps
  generated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Unique constraint: only one recap per style
CREATE UNIQUE INDEX IF NOT EXISTS idx_season_recaps_style ON season_recaps(style);

-- Comments
COMMENT ON TABLE season_recaps IS 'Stores generated season recap content for boring and exciting styles';
COMMENT ON COLUMN season_recaps.style IS 'Type of recap: boring (factual) or exciting (dramatic)';
COMMENT ON COLUMN season_recaps.content IS 'HTML formatted recap content';
