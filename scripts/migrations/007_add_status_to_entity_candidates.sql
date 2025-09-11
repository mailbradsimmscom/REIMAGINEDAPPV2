ALTER TABLE entity_candidates ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected'));
CREATE INDEX IF NOT EXISTS idx_entity_candidates_status ON entity_candidates(status);
