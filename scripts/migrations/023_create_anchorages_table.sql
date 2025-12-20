-- Migration: Create anchorages table
-- Purpose: Track anchorage and mooring history with GPS position, wind data, and trip links
-- Date: 2025-12-20

-- Create anchorages table
CREATE TABLE IF NOT EXISTS anchorages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Location
  location_name text,                    -- User-editable (e.g., "Soufrière", "Rodney Bay")
  latitude double precision NOT NULL,    -- Average boat position (decimal degrees)
  longitude double precision NOT NULL,   -- Average boat position (decimal degrees)

  -- Timing
  arrived_at timestamptz NOT NULL,
  departed_at timestamptz,
  duration_hours integer,                -- Computed: hours anchored/moored

  -- Wind conditions (averaged during stay)
  avg_wind_speed double precision,       -- knots
  avg_wind_direction double precision,   -- degrees (0-360)

  -- Type and scope
  anchorage_type text DEFAULT 'anchor' CHECK (anchorage_type IN ('anchor', 'mooring')),
  scope_meters double precision,         -- User-entered rode/chain length

  -- Inferred anchor/mooring position (computed when scope is saved)
  anchor_lat double precision,           -- Computed: upwind of boat position
  anchor_lon double precision,           -- Computed: upwind of boat position

  -- Trip links
  arrival_trip_id uuid REFERENCES trips(id) ON DELETE SET NULL,
  departure_trip_id uuid REFERENCES trips(id) ON DELETE SET NULL,

  -- Metadata
  notes text,
  auto_detected boolean DEFAULT true,    -- Was this auto-detected from GPS history?
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_anchorages_arrived ON anchorages(arrived_at DESC);
CREATE INDEX IF NOT EXISTS idx_anchorages_location ON anchorages(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_anchorages_type ON anchorages(anchorage_type);

-- Comments
COMMENT ON TABLE anchorages IS 'Tracks anchorage and mooring history with GPS, wind, and trip data';
COMMENT ON COLUMN anchorages.latitude IS 'Average boat position during stay (decimal degrees)';
COMMENT ON COLUMN anchorages.longitude IS 'Average boat position during stay (decimal degrees)';
COMMENT ON COLUMN anchorages.scope_meters IS 'Length of rode/chain deployed (meters)';
COMMENT ON COLUMN anchorages.anchor_lat IS 'Inferred anchor position (upwind of boat, computed from scope)';
COMMENT ON COLUMN anchorages.anchor_lon IS 'Inferred anchor position (upwind of boat, computed from scope)';
COMMENT ON COLUMN anchorages.arrival_trip_id IS 'Trip that brought us to this anchorage';
COMMENT ON COLUMN anchorages.departure_trip_id IS 'Trip that took us away from this anchorage';
