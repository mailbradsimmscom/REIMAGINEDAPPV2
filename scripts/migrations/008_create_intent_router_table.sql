-- Migration: Create intent_router table with FK to intent_hints
-- Purpose: Enable intent-based routing with traceability to approved intents
-- Date: 2025-01-09
-- Author: Step 8 - Schema Alignment

-- Create intent_router table
CREATE TABLE IF NOT EXISTS intent_router (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern text NOT NULL,
  intent text NOT NULL,
  route_to text NOT NULL,
  intent_hint_id uuid REFERENCES intent_hints(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by text DEFAULT 'admin'
);

-- Add indexes for efficient routing queries
CREATE INDEX IF NOT EXISTS idx_intent_router_pattern ON intent_router(pattern);
CREATE INDEX IF NOT EXISTS idx_intent_router_intent ON intent_router(intent);
CREATE INDEX IF NOT EXISTS idx_intent_router_intent_hint_id ON intent_router(intent_hint_id);

-- Add unique constraint to prevent duplicate patterns
CREATE UNIQUE INDEX IF NOT EXISTS idx_intent_router_pattern_unique ON intent_router(pattern);

-- Add comments for documentation
COMMENT ON TABLE intent_router IS 'Intent-based routing table linking query patterns to application routes';
COMMENT ON COLUMN intent_router.pattern IS 'Query pattern to match against user input';
COMMENT ON COLUMN intent_router.intent IS 'Intent type for routing decision';
COMMENT ON COLUMN intent_router.route_to IS 'Application route to redirect to';
COMMENT ON COLUMN intent_router.intent_hint_id IS 'Reference to approved intent hint that inspired this route';

-- Insert some default routing patterns
INSERT INTO intent_router (pattern, intent, route_to, created_by) VALUES
  ('change filter', 'maintenance.interval', '/playbook/filter', 'system'),
  ('replace filter', 'maintenance.interval', '/playbook/filter', 'system'),
  ('check pressure', 'pressure.verification', '/playbook/pressure', 'system'),
  ('test pressure', 'pressure.verification', '/playbook/pressure', 'system'),
  ('flush system', 'maintenance.flush', '/playbook/flush', 'system'),
  ('drain system', 'maintenance.flush', '/playbook/flush', 'system')
ON CONFLICT (pattern) DO NOTHING;
