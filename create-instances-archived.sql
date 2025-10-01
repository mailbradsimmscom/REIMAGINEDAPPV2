-- Create instances_archived table for soft deletes
-- This table stores instances that have been deleted (archived) rather than hard-deleted

CREATE TABLE IF NOT EXISTS instances_archived (
    instance_uid UUID PRIMARY KEY,
    asset_uid UUID NOT NULL,
    serial_number TEXT,
    location TEXT,
    instance_index INTEGER,

    -- Additional fields from instances table for complete record
    system_norm TEXT,
    subsystem_norm TEXT,
    manufacturer_norm TEXT,
    model_norm TEXT,
    canonical_model_id TEXT,
    serial_canon TEXT,

    -- Archive metadata
    archived_at TIMESTAMPTZ DEFAULT NOW(),
    archived_by TEXT,
    original_data JSONB
);

-- Create index on asset_uid for faster lookups
CREATE INDEX IF NOT EXISTS idx_instances_archived_asset_uid ON instances_archived(asset_uid);

-- Create index on archived_at for retention/cleanup queries
CREATE INDEX IF NOT EXISTS idx_instances_archived_archived_at ON instances_archived(archived_at);
