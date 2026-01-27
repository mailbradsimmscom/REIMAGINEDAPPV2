-- Migration 039: Document-Systems Junction Table
-- Part of Document-First Architecture (see code updates/97)
-- Replaces 1:1 documents.asset_uid with many-to-many relationship
--
-- One document can cover MULTIPLE systems (e.g., Yanmar manual covers 5 engine models)
-- One system can have MULTIPLE documents (e.g., install guide + service manual + user manual)
--
-- Run in Supabase SQL Editor

-- ============================================
-- 1. Create document_systems junction table
-- ============================================
CREATE TABLE IF NOT EXISTS document_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  doc_id TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  asset_uid UUID NOT NULL REFERENCES systems(asset_uid) ON DELETE CASCADE,

  -- Relationship type
  is_primary BOOLEAN NOT NULL DEFAULT true,
  -- is_primary = true: This document is the PRIMARY manual FOR this system
  -- is_primary = false: This document REFERENCES this system but isn't the main manual

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicates
  UNIQUE(doc_id, asset_uid)
);

-- ============================================
-- 2. Create indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_document_systems_doc ON document_systems(doc_id);
CREATE INDEX IF NOT EXISTS idx_document_systems_asset ON document_systems(asset_uid);
CREATE INDEX IF NOT EXISTS idx_document_systems_primary ON document_systems(is_primary) WHERE is_primary = true;

-- ============================================
-- 3. Migrate existing data from documents.asset_uid
-- ============================================
-- Copy existing 1:1 relationships to junction table
INSERT INTO document_systems (doc_id, asset_uid, is_primary)
SELECT doc_id, asset_uid, true
FROM documents
WHERE asset_uid IS NOT NULL
ON CONFLICT (doc_id, asset_uid) DO NOTHING;

-- ============================================
-- 4. Add comments
-- ============================================
COMMENT ON TABLE document_systems IS 'Junction table linking documents to systems (many-to-many). Replaces documents.asset_uid 1:1 relationship.';
COMMENT ON COLUMN document_systems.doc_id IS 'Foreign key to documents table';
COMMENT ON COLUMN document_systems.asset_uid IS 'Foreign key to systems table';
COMMENT ON COLUMN document_systems.is_primary IS 'True if this document is the primary manual FOR this system, false if it only references/mentions the system';

-- ============================================
-- 5. RLS Policies
-- ============================================
ALTER TABLE document_systems ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access to document_systems"
  ON document_systems FOR SELECT USING (true);

CREATE POLICY "Allow service role full access to document_systems"
  ON document_systems FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- 6. Helper view: Documents with their systems
-- ============================================
CREATE OR REPLACE VIEW v_documents_with_systems AS
SELECT
  d.doc_id,
  d.filename,
  d.manufacturer_norm,
  d.model_norm,
  d.storage_path,
  d.created_at,
  COALESCE(
    json_agg(
      json_build_object(
        'asset_uid', ds.asset_uid,
        'is_primary', ds.is_primary,
        'system_name', s.description,
        'model_norm', s.model_norm
      )
    ) FILTER (WHERE ds.asset_uid IS NOT NULL),
    '[]'::json
  ) AS linked_systems
FROM documents d
LEFT JOIN document_systems ds ON d.doc_id = ds.doc_id
LEFT JOIN systems s ON ds.asset_uid = s.asset_uid
GROUP BY d.doc_id, d.filename, d.manufacturer_norm, d.model_norm, d.storage_path, d.created_at;

COMMENT ON VIEW v_documents_with_systems IS 'Documents with their linked systems (via junction table)';

-- ============================================
-- 7. Helper view: Systems with their documents
-- ============================================
CREATE OR REPLACE VIEW v_systems_with_documents AS
SELECT
  s.asset_uid,
  s.manufacturer_norm,
  s.model_norm,
  s.description,
  s.serial_number,
  COALESCE(
    json_agg(
      json_build_object(
        'doc_id', ds.doc_id,
        'is_primary', ds.is_primary,
        'filename', d.filename,
        'storage_path', d.storage_path
      )
    ) FILTER (WHERE ds.doc_id IS NOT NULL),
    '[]'::json
  ) AS linked_documents
FROM systems s
LEFT JOIN document_systems ds ON s.asset_uid = ds.asset_uid
LEFT JOIN documents d ON ds.doc_id = d.doc_id
GROUP BY s.asset_uid, s.manufacturer_norm, s.model_norm, s.description, s.serial_number;

COMMENT ON VIEW v_systems_with_documents IS 'Systems with their linked documents (via junction table)';

-- ============================================
-- Verification
-- ============================================
DO $$
DECLARE
  migrated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO migrated_count FROM document_systems;

  RAISE NOTICE 'Migration 039 complete: document_systems junction table created';
  RAISE NOTICE '  - Migrated % existing document-system relationships', migrated_count;
  RAISE NOTICE '  - Created v_documents_with_systems view';
  RAISE NOTICE '  - Created v_systems_with_documents view';
  RAISE NOTICE '  - NOTE: documents.asset_uid column kept for backwards compatibility';
  RAISE NOTICE '  - Future: Remove documents.asset_uid after code migration complete';
END $$;
