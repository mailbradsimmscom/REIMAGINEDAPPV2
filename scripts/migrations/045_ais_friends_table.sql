-- Migration: Create ais_friends table for tracking favorite vessels
-- Date: 2026-01-26

CREATE TABLE IF NOT EXISTS ais_friends (
  mmsi TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ship_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comment for documentation
COMMENT ON TABLE ais_friends IS 'Vessels marked as friends/favorites by the user';
COMMENT ON COLUMN ais_friends.mmsi IS 'Maritime Mobile Service Identity - unique vessel identifier';
COMMENT ON COLUMN ais_friends.name IS 'Vessel name';
COMMENT ON COLUMN ais_friends.ship_type IS 'Type of vessel (Sailing, Pleasure, etc.)';
