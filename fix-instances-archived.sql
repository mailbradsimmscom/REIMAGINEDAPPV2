-- Drop and recreate instances_archived table with simplified structure
-- Only store essential fields + original_data JSONB for complete record

DROP TABLE IF EXISTS instances_archived;

CREATE TABLE instances_archived (
    instance_uid UUID PRIMARY KEY,
    asset_uid UUID NOT NULL,
    serial_number TEXT,
    location TEXT,
    instance_index INTEGER,
    archived_at TIMESTAMPTZ DEFAULT NOW(),
    archived_by TEXT,
    original_data JSONB
);

-- Create indexes
CREATE INDEX idx_instances_archived_asset_uid ON instances_archived(asset_uid);
CREATE INDEX idx_instances_archived_archived_at ON instances_archived(archived_at);
