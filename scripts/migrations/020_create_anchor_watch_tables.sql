-- Migration 020: Create Anchor Watch Tables
-- Date: 2025-11-15
-- Purpose: Add anchor watch functionality for monitoring GPS position and detecting anchor drag

-- Anchor Watch Zones Table
CREATE TABLE IF NOT EXISTS anchor_watch_zones (
    zone_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_active BOOLEAN DEFAULT false,
    center_lat DECIMAL(10, 8) NOT NULL,
    center_lng DECIMAL(11, 8) NOT NULL,
    radius_meters DECIMAL(10, 2) NOT NULL,
    activated_at TIMESTAMPTZ,
    deactivated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure only one active zone at a time
CREATE UNIQUE INDEX idx_one_active_anchor
ON anchor_watch_zones(is_active)
WHERE is_active = true;

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_anchor_watch_zones_updated_at
BEFORE UPDATE ON anchor_watch_zones
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Anchor Watch Alerts Table
CREATE TABLE IF NOT EXISTS anchor_watch_alerts (
    alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id UUID REFERENCES anchor_watch_zones(zone_id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('anchor_drag', 'zone_warning', 'gps_lost')),
    position_lat DECIMAL(10, 8) NOT NULL,
    position_lng DECIMAL(11, 8) NOT NULL,
    distance_meters DECIMAL(10, 2),
    details JSONB,
    acknowledged BOOLEAN DEFAULT false,
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for finding unacknowledged alerts quickly
CREATE INDEX idx_unacknowledged_alerts
ON anchor_watch_alerts(acknowledged, created_at DESC)
WHERE acknowledged = false;

-- Index for finding alerts by zone quickly (Performance optimization)
CREATE INDEX idx_alerts_by_zone
ON anchor_watch_alerts(zone_id, created_at DESC);

-- Grant permissions (adjust based on your Supabase roles)
GRANT ALL ON anchor_watch_zones TO authenticated;
GRANT ALL ON anchor_watch_alerts TO authenticated;
GRANT ALL ON anchor_watch_zones TO service_role;
GRANT ALL ON anchor_watch_alerts TO service_role;
