-- Document Processing Pipeline Database Schema
-- Jobs, Documents, and Document Chunks tables

-- Jobs table - one row per ingest attempt
CREATE TABLE IF NOT EXISTS jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'parsing', 'embedding', 'upserting', 'completed', 'failed', 'canceled')),
    doc_id TEXT NOT NULL,
    upload_id TEXT,
    storage_path TEXT,
    params JSONB DEFAULT '{}',
    counters JSONB DEFAULT '{}',
    error JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Documents table - canonical manifest per unique doc_id
CREATE TABLE IF NOT EXISTS documents (
    doc_id TEXT PRIMARY KEY,
    manufacturer TEXT,
    model TEXT,
    revision_date DATE,
    language TEXT DEFAULT 'en',
    brand_family TEXT,
    source_url TEXT,
    last_ingest_version TEXT,
    last_job_id UUID REFERENCES jobs(job_id),
    last_ingested_at TIMESTAMPTZ,
    chunk_count INTEGER DEFAULT 0,
    table_count INTEGER DEFAULT 0,
    pages_total INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Document chunks table - metadata shadow for analytics/debug
CREATE TABLE IF NOT EXISTS document_chunks (
    chunk_id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL REFERENCES documents(doc_id),
    content_type TEXT NOT NULL CHECK (content_type IN ('text', 'table', 'figure', 'ocr')),
    section_path TEXT,
    page_start INTEGER,
    page_end INTEGER,
    bbox JSONB,
    checksum TEXT NOT NULL,
    ingest_version TEXT,
    parser_version TEXT,
    embed_model TEXT,
    part_numbers TEXT[],
    fault_codes TEXT[],
    standards TEXT[],
    related_ids TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_doc_id ON jobs(doc_id);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_manufacturer_model ON documents(manufacturer, model);
CREATE INDEX IF NOT EXISTS idx_documents_revision_date ON documents(revision_date DESC);
CREATE INDEX IF NOT EXISTS idx_documents_language ON documents(language);

CREATE INDEX IF NOT EXISTS idx_document_chunks_doc_id_page ON document_chunks(doc_id, page_start);
CREATE INDEX IF NOT EXISTS idx_document_chunks_content_type ON document_chunks(content_type);
CREATE INDEX IF NOT EXISTS idx_document_chunks_checksum ON document_chunks(checksum);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to get job status with progress
CREATE OR REPLACE FUNCTION get_job_status(job_uuid UUID)
RETURNS JSON AS $$
DECLARE
    job_record RECORD;
    result JSON;
BEGIN
    SELECT * INTO job_record FROM jobs WHERE job_id = job_uuid;
    
    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Job not found');
    END IF;
    
    result := json_build_object(
        'job_id', job_record.job_id,
        'status', job_record.status,
        'progress', job_record.counters,
        'summary', json_build_object(
            'namespace', 'REIMAGINEDDOCS',
            'doc_id', job_record.doc_id
        ),
        'errors', CASE 
            WHEN job_record.error IS NOT NULL THEN 
                json_build_array(job_record.error)
            ELSE 
                '[]'::json
        END,
        'created_at', job_record.created_at,
        'updated_at', job_record.updated_at,
        'completed_at', job_record.completed_at
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;
