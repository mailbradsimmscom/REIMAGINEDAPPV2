-- Migration: Add last seen tracking to ais_friends
-- Date: 2026-01-26

ALTER TABLE ais_friends
ADD COLUMN IF NOT EXISTS last_latitude DECIMAL(9,6),
ADD COLUMN IF NOT EXISTS last_longitude DECIMAL(9,6),
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

COMMENT ON COLUMN ais_friends.last_latitude IS 'Last known latitude when friend was in AIS range';
COMMENT ON COLUMN ais_friends.last_longitude IS 'Last known longitude when friend was in AIS range';
COMMENT ON COLUMN ais_friends.last_seen_at IS 'Timestamp when friend was last seen in AIS range';
