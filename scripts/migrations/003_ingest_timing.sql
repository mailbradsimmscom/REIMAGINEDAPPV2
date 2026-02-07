-- Migration: Create ingest_timing table for storing per-step timing data
-- Phase B of Document Ingest Status Redesign

CREATE TABLE IF NOT EXISTS ingest_timing (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    ingest_run_id   text        NOT NULL,
    doc_id          text        NOT NULL REFERENCES documents(doc_id),
    step_name       text        NOT NULL,
    started_at      timestamptz NOT NULL,
    ended_at        timestamptz,
    duration_ms     integer,
    status          text        NOT NULL DEFAULT 'pending',
    metadata        jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Index for querying all timing rows for a document
CREATE INDEX IF NOT EXISTS idx_ingest_timing_doc_id ON ingest_timing(doc_id);

-- Index for querying a specific ingest run
CREATE INDEX IF NOT EXISTS idx_ingest_timing_run_id ON ingest_timing(ingest_run_id);

-- Composite index for doc + run queries
CREATE INDEX IF NOT EXISTS idx_ingest_timing_doc_run ON ingest_timing(doc_id, ingest_run_id);

-- Constraint: step_name must be one of the canonical names
ALTER TABLE ingest_timing ADD CONSTRAINT chk_ingest_timing_step_name
    CHECK (step_name IN (
        'upload', 'parse', 'detect', 'document', 'vision', 'indexing',
        'dip_specs', 'dip_troubleshooting', 'dip_procedures',
        'dip_golden_rules', 'dip_intent_router'
    ));

-- Constraint: status must be valid
ALTER TABLE ingest_timing ADD CONSTRAINT chk_ingest_timing_status
    CHECK (status IN ('pending', 'running', 'complete', 'error', 'skipped'));
