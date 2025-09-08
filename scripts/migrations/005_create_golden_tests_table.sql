-- Migration: Create golden_tests table for storing approved golden test suggestions
-- This table stores the golden tests that admins approve from DIP suggestions

CREATE TABLE IF NOT EXISTS golden_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id text NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  query text NOT NULL,
  expected text NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_golden_tests_doc_id ON golden_tests(doc_id);
CREATE INDEX IF NOT EXISTS idx_golden_tests_approved_by ON golden_tests(approved_by);
CREATE INDEX IF NOT EXISTS idx_golden_tests_approved_at ON golden_tests(approved_at);

-- Add comments for documentation
COMMENT ON TABLE golden_tests IS 'Stores approved golden test suggestions from DIP processing';
COMMENT ON COLUMN golden_tests.doc_id IS 'Reference to the document that generated this golden test';
COMMENT ON COLUMN golden_tests.query IS 'The test query/question that should be asked';
COMMENT ON COLUMN golden_tests.expected IS 'The expected answer/response for this query';
COMMENT ON COLUMN golden_tests.approved_by IS 'Admin user who approved this golden test';
COMMENT ON COLUMN golden_tests.approved_at IS 'Timestamp when this golden test was approved';
