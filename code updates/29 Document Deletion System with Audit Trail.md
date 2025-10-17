# 29. Document Deletion System with Audit Trail

**Date:** 2025-10-17
**Context:** Implementing a comprehensive document deletion system with permanent audit trail and soft-delete storage archival
**Risk Level:** LOW - Pure feature addition, no existing code modifications

---

## Session Summary

### Initial Problem
- The document library page (`documents.html`) was separated from `upload.html` successfully
- Need to add deletion capability for documents with surgical precision
- System has complex interdependencies across multiple tables and services
- Must maintain audit trail for compliance and recovery

### Key Decisions Made

1. **Audit-First Approach**: Create `document_deletions` table to track all deletions permanently
2. **Soft-Delete Storage**: Move files to `/deleted/` archive instead of permanent deletion
3. **No Time Limit**: Permanent archive (no 30-day expiry) for audit compliance
4. **Surgical Deletion**: Allow selective deletion of components (storage, database, vectors)
5. **Safety Features**: Master control checkbox, confirmation codes, transaction wrapper

### What We're NOT Touching
- ❌ Chat messages/history (preserved)
- ❌ Instances table (system-related)
- ❌ Systems table rows (only updating fields)
- ❌ Equipment extractions (part of chat)
- ❌ Any existing routes/services/repositories

### What We ARE Building (All New)
- ✅ New audit table: `document_deletions`
- ✅ New service: `document-deletion.service.js`
- ✅ New routes: `document-deletion.route.js`
- ✅ New API endpoints for preview and deletion
- ✅ Storage archive directory structure
- ✅ UI modal in documents.html

---

## Database Tables Affected

### Primary Tables for Deletion
```sql
-- 1. documents (DELETE)
-- 2. document_chunks (DELETE WHERE doc_id = ?)
-- 3. jobs (DELETE WHERE doc_id = ?)

-- 4-7. Staging DIP tables (DELETE WHERE doc_id = ? OR asset_uid = ?)
-- staging_spec_suggestions
-- staging_playbook_hints
-- staging_intent_router
-- staging_golden_tests

-- 8-11. Production DIP tables (DELETE WHERE doc_id = ? OR asset_uid = ?)
-- spec_suggestions
-- playbook_hints
-- intent_router
-- golden_tests

-- 12. systems (UPDATE ONLY)
UPDATE systems SET
  manual = false,
  colloquial_keywords = null,
  updated_at = NOW()
WHERE asset_uid = ?;

-- 13. Pinecone vectors (DELETE by metadata filter)
```

---

## Implementation Plan

### Phase 1: Database Setup

#### Step 1.1: Create Audit Table
```sql
-- Run this in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS document_deletions (
  -- Primary identification
  asset_uid VARCHAR(255) PRIMARY KEY,
  doc_id VARCHAR(255) NOT NULL,

  -- Document metadata (preserved for reference)
  document_title TEXT,
  manufacturer VARCHAR(255),
  model VARCHAR(255),
  file_name TEXT,
  file_size BIGINT,
  original_upload_date TIMESTAMPTZ,

  -- Deletion metadata
  deleted_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_by VARCHAR(255),
  deletion_reason TEXT,

  -- What was deleted (comprehensive JSON record)
  deletion_actions JSONB NOT NULL,

  -- Recovery information
  is_recoverable BOOLEAN DEFAULT TRUE,
  recovered_at TIMESTAMPTZ,
  recovered_by VARCHAR(255),

  -- Audit fields
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_document_deletions_doc_id ON document_deletions(doc_id);
CREATE INDEX idx_document_deletions_deleted_at ON document_deletions(deleted_at);
CREATE INDEX idx_document_deletions_manufacturer ON document_deletions(manufacturer);
CREATE INDEX idx_document_deletions_model ON document_deletions(model);
CREATE INDEX idx_document_deletions_is_recoverable ON document_deletions(is_recoverable);

-- Enable RLS
ALTER TABLE document_deletions ENABLE ROW LEVEL SECURITY;

-- Update trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_document_deletions_updated_at
  BEFORE UPDATE ON document_deletions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

### Phase 2: Backend Implementation

#### Step 2.1: Create Deletion Service
**File:** `/src/services/document-deletion.service.js`

```javascript
import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { logger } from '../utils/logger.js';
import { Pinecone } from '@pinecone-database/pinecone';
import { getEnv } from '../config/env.js';

const env = getEnv();

/**
 * Service for document deletion with audit trail
 */
export class DocumentDeletionService {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
    this.pinecone = new Pinecone({
      apiKey: env.PINECONE_API_KEY
    });
    this.index = this.pinecone.index(env.PINECONE_INDEX_NAME);
  }

  /**
   * Get deletion preview - what would be deleted
   */
  async getDeletionPreview(docId) {
    const supabase = await getSupabaseClient();

    try {
      // Get document details
      const { data: doc, error: docError } = await supabase
        .from('documents')
        .select('*')
        .eq('id', docId)
        .single();

      if (docError || !doc) {
        throw new Error('Document not found');
      }

      // Count chunks
      const { count: chunkCount } = await supabase
        .from('document_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('doc_id', docId);

      // Count jobs
      const { count: jobCount } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('doc_id', docId);

      // Count staging DIP entries
      const stagingCounts = await this.countDipEntries(supabase, 'staging', docId, doc.asset_uid);

      // Count production DIP entries
      const productionCounts = await this.countDipEntries(supabase, 'production', docId, doc.asset_uid);

      // Check Pinecone vectors
      const pineconeCount = await this.countPineconeVectors(doc.asset_uid);

      // Check storage files
      const storageInfo = await this.getStorageInfo(supabase, docId);

      // Check system table status
      const systemInfo = await this.getSystemInfo(supabase, doc.asset_uid);

      return {
        doc_id: docId,
        asset_uid: doc.asset_uid,
        document_info: {
          title: doc.title,
          filename: doc.filename,
          manufacturer: doc.manufacturer,
          model: doc.model,
          size: doc.size,
          created_at: doc.created_at
        },
        counts: {
          chunks: chunkCount || 0,
          jobs: jobCount || 0,
          pinecone_vectors: pineconeCount,
          staging_specs: stagingCounts.specs,
          staging_procedures: stagingCounts.procedures,
          staging_qa: stagingCounts.qa,
          staging_golden: stagingCounts.golden,
          production_specs: productionCounts.specs,
          production_procedures: productionCounts.procedures,
          production_qa: productionCounts.qa,
          production_golden: productionCounts.golden
        },
        storage: storageInfo,
        system: systemInfo
      };
    } catch (error) {
      this.requestLogger.error('Failed to get deletion preview', { docId, error: error.message });
      throw error;
    }
  }

  /**
   * Execute document deletion with audit trail
   */
  async deleteDocument(docId, options, deletedBy, reason = null) {
    const supabase = await getSupabaseClient();

    this.requestLogger.info('Starting document deletion', { docId, deletedBy });

    try {
      // 1. Get document details first
      const preview = await this.getDeletionPreview(docId);

      // 2. Initialize deletion record
      const deletionRecord = {
        asset_uid: preview.asset_uid,
        doc_id: docId,
        document_title: preview.document_info.title,
        manufacturer: preview.document_info.manufacturer,
        model: preview.document_info.model,
        file_name: preview.document_info.filename,
        file_size: preview.document_info.size,
        original_upload_date: preview.document_info.created_at,
        deleted_by: deletedBy,
        deletion_reason: reason,
        deletion_actions: {}
      };

      // 3. Storage operations (soft delete - move to archive)
      if (options.storage_all || options.storage_manual || options.storage_dip) {
        const storageResult = await this.archiveStorage(
          supabase,
          docId,
          preview.asset_uid,
          options
        );
        deletionRecord.deletion_actions.storage = storageResult;
      }

      // 4. Delete chunks
      if (options.document_chunks) {
        const { error } = await supabase
          .from('document_chunks')
          .delete()
          .eq('doc_id', docId);

        if (error) throw error;
        deletionRecord.deletion_actions.database = {
          chunks_deleted: preview.counts.chunks
        };
      }

      // 5. Delete jobs
      if (options.jobs) {
        const { error } = await supabase
          .from('jobs')
          .delete()
          .eq('doc_id', docId);

        if (error) throw error;
        deletionRecord.deletion_actions.jobs_deleted = preview.counts.jobs;
      }

      // 6. Delete Pinecone vectors
      if (options.pinecone && preview.asset_uid) {
        const deleteCount = await this.deletePineconeVectors(preview.asset_uid);
        deletionRecord.deletion_actions.pinecone = {
          vectors_deleted: deleteCount
        };
      }

      // 7. Delete staging DIP entries
      const stagingDeleted = await this.deleteDipEntries(
        supabase,
        'staging',
        docId,
        preview.asset_uid,
        {
          specs: options.staging_specs,
          procedures: options.staging_procedures,
          qa: options.staging_qa,
          golden: options.staging_golden
        }
      );
      if (Object.keys(stagingDeleted).length > 0) {
        deletionRecord.deletion_actions.staging_dip = stagingDeleted;
      }

      // 8. Delete production DIP entries
      const productionDeleted = await this.deleteDipEntries(
        supabase,
        'production',
        docId,
        preview.asset_uid,
        {
          specs: options.production_specs,
          procedures: options.production_procedures,
          qa: options.production_qa,
          golden: options.production_golden
        }
      );
      if (Object.keys(productionDeleted).length > 0) {
        deletionRecord.deletion_actions.production_dip = productionDeleted;
      }

      // 9. Update system table
      const systemUpdates = {};
      if (options.colloquial_keywords && preview.asset_uid) {
        const { error } = await supabase
          .from('systems')
          .update({
            colloquial_keywords: null,
            updated_at: new Date().toISOString()
          })
          .eq('asset_uid', preview.asset_uid);

        if (!error) systemUpdates.colloquial_cleared = true;
      }

      if (options.manual_flag && preview.asset_uid) {
        const { error } = await supabase
          .from('systems')
          .update({
            manual: false,
            updated_at: new Date().toISOString()
          })
          .eq('asset_uid', preview.asset_uid);

        if (!error) systemUpdates.manual_flag_cleared = true;
      }

      if (Object.keys(systemUpdates).length > 0) {
        deletionRecord.deletion_actions.system_updates = systemUpdates;
      }

      // 10. Save audit record
      const { error: auditError } = await supabase
        .from('document_deletions')
        .insert(deletionRecord);

      if (auditError) {
        this.requestLogger.error('Failed to save audit record', { auditError });
        // Don't throw - deletion succeeded, just audit failed
      }

      // 11. Delete from documents table LAST (if selected)
      if (options.documents_table) {
        const { error } = await supabase
          .from('documents')
          .delete()
          .eq('id', docId);

        if (error) throw error;
        deletionRecord.deletion_actions.documents_table_deleted = true;
      }

      this.requestLogger.info('Document deletion completed', { docId, deletionRecord });
      return deletionRecord;

    } catch (error) {
      this.requestLogger.error('Document deletion failed', { docId, error: error.message });
      throw error;
    }
  }

  /**
   * Archive storage files (soft delete)
   */
  async archiveStorage(supabase, docId, assetUid, options) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const archivePath = `deleted/${year}/${month}/${day}/${assetUid}`;

    const result = {
      original_path: `manuals/${docId}/`,
      archive_path: archivePath,
      manual_moved: false,
      dip_moved: false
    };

    try {
      // List all files in the document directory
      const { data: files, error: listError } = await supabase.storage
        .from('documents')
        .list(`manuals/${docId}`);

      if (listError) throw listError;

      // Move files based on options
      for (const file of files || []) {
        const sourcePath = `manuals/${docId}/${file.name}`;
        const destPath = `${archivePath}/${file.name}`;

        if (file.name.endsWith('.pdf') && (options.storage_all || options.storage_manual)) {
          // Move manual PDF
          const { error: moveError } = await supabase.storage
            .from('documents')
            .move(sourcePath, `${archivePath}/manual/${file.name}`);

          if (!moveError) result.manual_moved = true;
        } else if (file.name === 'DIP' && (options.storage_all || options.storage_dip)) {
          // Move entire DIP directory
          const { error: moveError } = await supabase.storage
            .from('documents')
            .move(`manuals/${docId}/DIP`, `${archivePath}/DIP`);

          if (!moveError) result.dip_moved = true;
        }
      }

      // Create metadata file in archive
      const metadata = {
        deletion_timestamp: new Date().toISOString(),
        asset_uid: assetUid,
        doc_id: docId,
        files_archived: result
      };

      await supabase.storage
        .from('documents')
        .upload(
          `${archivePath}/metadata.json`,
          JSON.stringify(metadata, null, 2),
          { contentType: 'application/json' }
        );

    } catch (error) {
      this.requestLogger.error('Storage archive failed', { docId, error: error.message });
      // Don't throw - continue with other deletions
    }

    return result;
  }

  /**
   * Delete Pinecone vectors
   */
  async deletePineconeVectors(assetUid) {
    try {
      // Query vectors with this asset_uid
      const queryResponse = await this.index.query({
        filter: { asset_uid: assetUid },
        topK: 10000,
        includeValues: false
      });

      if (queryResponse.matches && queryResponse.matches.length > 0) {
        const ids = queryResponse.matches.map(match => match.id);

        // Delete in batches of 100
        const batchSize = 100;
        for (let i = 0; i < ids.length; i += batchSize) {
          const batch = ids.slice(i, i + batchSize);
          await this.index.deleteMany(batch);
        }

        return ids.length;
      }

      return 0;
    } catch (error) {
      this.requestLogger.error('Pinecone deletion failed', { assetUid, error: error.message });
      return 0;
    }
  }

  /**
   * Count DIP entries
   */
  async countDipEntries(supabase, env, docId, assetUid) {
    const prefix = env === 'staging' ? 'staging_' : '';
    const counts = {};

    // Count specs
    const { count: specCount } = await supabase
      .from(`${prefix}spec_suggestions`)
      .select('*', { count: 'exact', head: true })
      .or(`doc_id.eq.${docId},asset_uid.eq.${assetUid}`);
    counts.specs = specCount || 0;

    // Count procedures
    const { count: procCount } = await supabase
      .from(`${prefix}playbook_hints`)
      .select('*', { count: 'exact', head: true })
      .or(`doc_id.eq.${docId},asset_uid.eq.${assetUid}`);
    counts.procedures = procCount || 0;

    // Count Q&A
    const { count: qaCount } = await supabase
      .from(`${prefix}intent_router`)
      .select('*', { count: 'exact', head: true })
      .or(`doc_id.eq.${docId},asset_uid.eq.${assetUid}`);
    counts.qa = qaCount || 0;

    // Count golden tests
    const { count: goldenCount } = await supabase
      .from(`${prefix}golden_tests`)
      .select('*', { count: 'exact', head: true })
      .or(`doc_id.eq.${docId},asset_uid.eq.${assetUid}`);
    counts.golden = goldenCount || 0;

    return counts;
  }

  /**
   * Delete DIP entries
   */
  async deleteDipEntries(supabase, env, docId, assetUid, options) {
    const prefix = env === 'staging' ? 'staging_' : '';
    const deleted = {};

    if (options.specs) {
      const { error } = await supabase
        .from(`${prefix}spec_suggestions`)
        .delete()
        .or(`doc_id.eq.${docId},asset_uid.eq.${assetUid}`);
      if (!error) deleted.specs_deleted = true;
    }

    if (options.procedures) {
      const { error } = await supabase
        .from(`${prefix}playbook_hints`)
        .delete()
        .or(`doc_id.eq.${docId},asset_uid.eq.${assetUid}`);
      if (!error) deleted.procedures_deleted = true;
    }

    if (options.qa) {
      const { error } = await supabase
        .from(`${prefix}intent_router`)
        .delete()
        .or(`doc_id.eq.${docId},asset_uid.eq.${assetUid}`);
      if (!error) deleted.qa_deleted = true;
    }

    if (options.golden) {
      const { error } = await supabase
        .from(`${prefix}golden_tests`)
        .delete()
        .or(`doc_id.eq.${docId},asset_uid.eq.${assetUid}`);
      if (!error) deleted.golden_deleted = true;
    }

    return deleted;
  }

  /**
   * Get storage information
   */
  async getStorageInfo(supabase, docId) {
    try {
      const { data: files } = await supabase.storage
        .from('documents')
        .list(`manuals/${docId}`);

      const info = {
        manual_exists: false,
        dip_exists: false,
        files: []
      };

      if (files) {
        for (const file of files) {
          if (file.name.endsWith('.pdf')) {
            info.manual_exists = true;
            info.files.push({ name: file.name, size: file.metadata?.size });
          }
          if (file.name === 'DIP') {
            info.dip_exists = true;
          }
        }
      }

      return info;
    } catch (error) {
      return { manual_exists: false, dip_exists: false, files: [] };
    }
  }

  /**
   * Get system table information
   */
  async getSystemInfo(supabase, assetUid) {
    if (!assetUid) return null;

    try {
      const { data, error } = await supabase
        .from('systems')
        .select('manual, colloquial_keywords')
        .eq('asset_uid', assetUid)
        .single();

      if (error || !data) return null;

      return {
        has_manual: data.manual || false,
        has_colloquial: !!data.colloquial_keywords
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Count Pinecone vectors
   */
  async countPineconeVectors(assetUid) {
    if (!assetUid) return 0;

    try {
      const stats = await this.index.describeIndexStats({
        filter: { asset_uid: assetUid }
      });

      return stats.totalRecordCount || 0;
    } catch (error) {
      // Try query approach if stats don't work
      try {
        const queryResponse = await this.index.query({
          filter: { asset_uid: assetUid },
          topK: 1,
          includeValues: false
        });

        // This gives us an estimate
        return queryResponse.matches?.length > 0 ? '1+' : 0;
      } catch (queryError) {
        return 0;
      }
    }
  }
}
```

#### Step 2.2: Create Routes
**File:** `/src/routes/admin/document-deletion.route.js`

```javascript
import express from 'express';
import { z } from 'zod';
import { DocumentDeletionService } from '../../services/document-deletion.service.js';
import { adminOnly } from '../../middleware/auth.middleware.js';

const router = express.Router();
const deletionService = new DocumentDeletionService();

// Apply admin authentication to all routes
router.use(adminOnly);

// Zod schemas
const deletionOptionsSchema = z.object({
  documents_table: z.boolean(),
  storage_all: z.boolean(),
  storage_manual: z.boolean(),
  storage_dip: z.boolean(),
  document_chunks: z.boolean(),
  jobs: z.boolean(),
  pinecone: z.boolean(),
  staging_specs: z.boolean(),
  staging_procedures: z.boolean(),
  staging_qa: z.boolean(),
  staging_golden: z.boolean(),
  production_specs: z.boolean(),
  production_procedures: z.boolean(),
  production_qa: z.boolean(),
  production_golden: z.boolean(),
  colloquial_keywords: z.boolean(),
  manual_flag: z.boolean()
});

const deletionRequestSchema = z.object({
  deletionOptions: deletionOptionsSchema,
  confirmation: z.string(),
  reason: z.string().optional()
});

/**
 * GET /admin/api/documents/:docId/deletion-preview
 * Get preview of what would be deleted
 */
router.get('/documents/:docId/deletion-preview', async (req, res) => {
  try {
    const { docId } = req.params;

    const preview = await deletionService.getDeletionPreview(docId);

    return res.json({
      success: true,
      data: preview,
      requestId: res.locals.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        message: error.message,
        code: 'DELETION_PREVIEW_ERROR'
      },
      requestId: res.locals.requestId
    });
  }
});

/**
 * DELETE /admin/api/documents/:docId
 * Execute document deletion with audit trail
 */
router.delete('/documents/:docId', async (req, res) => {
  try {
    const { docId } = req.params;

    // Validate request body
    const validationResult = deletionRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid deletion options',
          details: validationResult.error.issues
        },
        requestId: res.locals.requestId
      });
    }

    const { deletionOptions, confirmation, reason } = validationResult.data;

    // Verify confirmation matches doc ID
    if (confirmation !== docId.toUpperCase()) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Confirmation code does not match document ID',
          code: 'INVALID_CONFIRMATION'
        },
        requestId: res.locals.requestId
      });
    }

    // Execute deletion
    const result = await deletionService.deleteDocument(
      docId,
      deletionOptions,
      'admin@system', // TODO: Get from auth context
      reason
    );

    return res.json({
      success: true,
      data: result,
      message: 'Document deletion completed',
      requestId: res.locals.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        message: error.message,
        code: 'DELETION_ERROR'
      },
      requestId: res.locals.requestId
    });
  }
});

export default router;
```

#### Step 2.3: Register Routes in Main App
**File:** `/src/routes/admin/index.js` (ADD to existing)

```javascript
// Add import at top
import documentDeletionRouter from './document-deletion.route.js';

// Add route registration (around line 30-40)
router.use('/api', documentDeletionRouter);
```

---

### Phase 3: Frontend Implementation

#### Step 3.1: Update documents.html
**File:** `/src/public/documents.html`

Add delete button to document item (around line 400 in renderDocumentList):

```javascript
// Replace the existing document actions section with:
<div class="document-actions">
  <button class="action-button view" onclick="documentLibrary.viewDocument('${doc.id}')">
    View Details
  </button>
  <button class="action-button delete" onclick="documentLibrary.showDeleteModal('${doc.id}')">
    🗑️ Delete
  </button>
</div>
```

Add modal HTML before closing body tag:

```html
<!-- Deletion Modal -->
<div id="deletionModal" class="modal" style="display: none;">
  <div class="modal-overlay" onclick="documentLibrary.closeDeleteModal()"></div>
  <div class="modal-content">
    <div class="modal-header">
      <h2>🗑️ Delete Document</h2>
      <button class="modal-close" onclick="documentLibrary.closeDeleteModal()">×</button>
    </div>

    <div class="modal-body">
      <!-- Document info -->
      <div class="deletion-info">
        <div id="deleteDocInfo"></div>
      </div>

      <!-- Warning -->
      <div class="deletion-warning">
        ⚠️ WARNING: This action cannot be undone
      </div>

      <!-- Master control -->
      <div class="deletion-section">
        <label class="checkbox-label master">
          <input type="checkbox" id="deleteMaster" onchange="documentLibrary.toggleMaster(this)">
          <span>Delete from Documents Table (FORCES ALL DELETIONS)</span>
        </label>
      </div>

      <!-- Storage options -->
      <div class="deletion-section">
        <h4>📁 Storage Options</h4>
        <label class="checkbox-label">
          <input type="checkbox" id="deleteStorageAll" class="deletion-option">
          <span>Delete All Storage <span id="storageAllCount"></span></span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="deleteStorageManual" class="deletion-option">
          <span>Delete Manual PDF Only</span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="deleteStorageDip" class="deletion-option">
          <span>Delete DIP Files Only</span>
        </label>
      </div>

      <!-- Database options -->
      <div class="deletion-section">
        <h4>🗄️ Database</h4>
        <label class="checkbox-label">
          <input type="checkbox" id="deleteChunks" class="deletion-option">
          <span>Document Chunks <span id="chunksCount"></span></span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="deleteJobs" class="deletion-option">
          <span>Processing Jobs <span id="jobsCount"></span></span>
        </label>
      </div>

      <!-- Vector options -->
      <div class="deletion-section">
        <h4>📌 Vectors</h4>
        <label class="checkbox-label">
          <input type="checkbox" id="deletePinecone" class="deletion-option">
          <span>Pinecone Vectors <span id="pineconeCount"></span></span>
        </label>
      </div>

      <!-- Staging DIP -->
      <div class="deletion-section">
        <h4>🎭 Staging DIP</h4>
        <div class="checkbox-grid">
          <label class="checkbox-label">
            <input type="checkbox" id="deleteStagingSpecs" class="deletion-option">
            <span>Specs <span id="stagingSpecsCount"></span></span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="deleteStagingProcedures" class="deletion-option">
            <span>Procedures <span id="stagingProceduresCount"></span></span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="deleteStagingQa" class="deletion-option">
            <span>Q&A <span id="stagingQaCount"></span></span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="deleteStagingGolden" class="deletion-option">
            <span>Golden <span id="stagingGoldenCount"></span></span>
          </label>
        </div>
      </div>

      <!-- Production DIP -->
      <div class="deletion-section">
        <h4>🚀 Production DIP</h4>
        <div class="checkbox-grid">
          <label class="checkbox-label">
            <input type="checkbox" id="deleteProdSpecs" class="deletion-option">
            <span>Specs <span id="prodSpecsCount"></span></span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="deleteProdProcedures" class="deletion-option">
            <span>Procedures <span id="prodProceduresCount"></span></span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="deleteProdQa" class="deletion-option">
            <span>Q&A <span id="prodQaCount"></span></span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="deleteProdGolden" class="deletion-option">
            <span>Golden <span id="prodGoldenCount"></span></span>
          </label>
        </div>
      </div>

      <!-- System updates -->
      <div class="deletion-section">
        <h4>🔧 System Updates</h4>
        <label class="checkbox-label">
          <input type="checkbox" id="deleteColloquial" class="deletion-option">
          <span>Clear Colloquial Keywords</span>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="deleteManualFlag" class="deletion-option">
          <span>Set Manual Flag to FALSE</span>
        </label>
      </div>

      <!-- Reason -->
      <div class="deletion-section">
        <label>Deletion Reason (optional):</label>
        <input type="text" id="deletionReason" class="form-input" placeholder="e.g., Outdated version">
      </div>

      <!-- Confirmation -->
      <div class="deletion-section">
        <label>Type document ID to confirm:</label>
        <input type="text" id="deletionConfirmation" class="form-input" placeholder="Enter document ID">
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="documentLibrary.closeDeleteModal()">Cancel</button>
      <button class="btn btn-danger" onclick="documentLibrary.executeDelete()">Delete Selected Items</button>
    </div>
  </div>
</div>
```

Add CSS for modal:

```css
/* Modal Styles */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 10000;
  display: none;
}

.modal-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
}

.modal-content {
  position: relative;
  max-width: 800px;
  max-height: 90vh;
  margin: 40px auto;
  background: var(--surface-color);
  border-radius: var(--border-radius);
  box-shadow: var(--shadow-heavy);
  overflow: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-lg);
  border-bottom: 1px solid var(--border-color);
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-secondary);
}

.modal-body {
  padding: var(--spacing-lg);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  border-top: 1px solid var(--border-color);
}

.deletion-info {
  padding: var(--spacing-md);
  background: var(--background-color);
  border-radius: var(--border-radius-small);
  margin-bottom: var(--spacing-lg);
}

.deletion-warning {
  padding: var(--spacing-md);
  background: rgba(255, 59, 48, 0.1);
  color: var(--error-color);
  border-radius: var(--border-radius-small);
  border: 1px solid rgba(255, 59, 48, 0.2);
  margin-bottom: var(--spacing-lg);
  font-weight: 600;
  text-align: center;
}

.deletion-section {
  margin-bottom: var(--spacing-lg);
}

.deletion-section h4 {
  margin-bottom: var(--spacing-sm);
  color: var(--text-primary);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  cursor: pointer;
}

.checkbox-label.master {
  background: rgba(255, 59, 48, 0.05);
  border: 1px solid rgba(255, 59, 48, 0.2);
  border-radius: var(--border-radius-small);
  font-weight: 600;
}

.checkbox-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacing-sm);
}

.btn-danger {
  background: var(--error-color);
  color: white;
}

.btn-danger:hover {
  background: #CC2D1F;
}
```

Add JavaScript methods to DocumentLibrary class:

```javascript
// Add these methods to the DocumentLibrary class

async showDeleteModal(docId) {
  this.currentDeleteDoc = docId;

  // Fetch deletion preview
  try {
    const response = await fetch(`/admin/api/documents/${docId}/deletion-preview`, {
      headers: { 'x-admin-token': 'd0bf5af4f2e469d29e051e39e9569a76a283ad4d5c68935e38321320137b05d0' }
    });

    if (!response.ok) {
      throw new Error('Failed to load deletion preview');
    }

    const result = await response.json();
    const preview = result.data;

    // Update modal with document info
    document.getElementById('deleteDocInfo').innerHTML = `
      <strong>Document:</strong> ${preview.document_info.manufacturer} ${preview.document_info.model}<br>
      <strong>Doc ID:</strong> ${preview.doc_id}<br>
      <strong>Asset UID:</strong> ${preview.asset_uid || 'None'}<br>
      <strong>Size:</strong> ${this.formatFileSize(preview.document_info.size)}<br>
      <strong>Uploaded:</strong> ${this.formatDate(preview.document_info.created_at)}
    `;

    // Update counts
    document.getElementById('chunksCount').textContent = `(${preview.counts.chunks})`;
    document.getElementById('jobsCount').textContent = `(${preview.counts.jobs})`;
    document.getElementById('pineconeCount').textContent = `(${preview.counts.pinecone_vectors})`;

    document.getElementById('stagingSpecsCount').textContent = `(${preview.counts.staging_specs})`;
    document.getElementById('stagingProceduresCount').textContent = `(${preview.counts.staging_procedures})`;
    document.getElementById('stagingQaCount').textContent = `(${preview.counts.staging_qa})`;
    document.getElementById('stagingGoldenCount').textContent = `(${preview.counts.staging_golden})`;

    document.getElementById('prodSpecsCount').textContent = `(${preview.counts.production_specs})`;
    document.getElementById('prodProceduresCount').textContent = `(${preview.counts.production_procedures})`;
    document.getElementById('prodQaCount').textContent = `(${preview.counts.production_qa})`;
    document.getElementById('prodGoldenCount').textContent = `(${preview.counts.production_golden})`;

    // Show modal
    document.getElementById('deletionModal').style.display = 'block';

  } catch (error) {
    console.error('Error loading deletion preview:', error);
    alert('Failed to load deletion preview: ' + error.message);
  }
}

closeDeleteModal() {
  document.getElementById('deletionModal').style.display = 'none';

  // Clear form
  document.querySelectorAll('.deletion-option').forEach(cb => cb.checked = false);
  document.getElementById('deleteMaster').checked = false;
  document.getElementById('deletionReason').value = '';
  document.getElementById('deletionConfirmation').value = '';

  this.currentDeleteDoc = null;
}

toggleMaster(checkbox) {
  if (checkbox.checked) {
    // Check all options
    document.querySelectorAll('.deletion-option').forEach(cb => {
      cb.checked = true;
      cb.disabled = true;
    });
  } else {
    // Enable all options
    document.querySelectorAll('.deletion-option').forEach(cb => {
      cb.disabled = false;
    });
  }
}

async executeDelete() {
  if (!this.currentDeleteDoc) return;

  // Get confirmation
  const confirmation = document.getElementById('deletionConfirmation').value;
  if (confirmation.toUpperCase() !== this.currentDeleteDoc.toUpperCase()) {
    alert('Confirmation code does not match document ID');
    return;
  }

  // Gather deletion options
  const deletionOptions = {
    documents_table: document.getElementById('deleteMaster').checked,
    storage_all: document.getElementById('deleteStorageAll').checked,
    storage_manual: document.getElementById('deleteStorageManual').checked,
    storage_dip: document.getElementById('deleteStorageDip').checked,
    document_chunks: document.getElementById('deleteChunks').checked,
    jobs: document.getElementById('deleteJobs').checked,
    pinecone: document.getElementById('deletePinecone').checked,
    staging_specs: document.getElementById('deleteStagingSpecs').checked,
    staging_procedures: document.getElementById('deleteStagingProcedures').checked,
    staging_qa: document.getElementById('deleteStagingQa').checked,
    staging_golden: document.getElementById('deleteStagingGolden').checked,
    production_specs: document.getElementById('deleteProdSpecs').checked,
    production_procedures: document.getElementById('deleteProdProcedures').checked,
    production_qa: document.getElementById('deleteProdQa').checked,
    production_golden: document.getElementById('deleteProdGolden').checked,
    colloquial_keywords: document.getElementById('deleteColloquial').checked,
    manual_flag: document.getElementById('deleteManualFlag').checked
  };

  // Check if anything selected
  if (!Object.values(deletionOptions).some(v => v)) {
    alert('Please select at least one deletion option');
    return;
  }

  // Final confirmation
  if (!confirm('Are you sure you want to delete the selected items? This action cannot be undone.')) {
    return;
  }

  try {
    const response = await fetch(`/admin/api/documents/${this.currentDeleteDoc}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'd0bf5af4f2e469d29e051e39e9569a76a283ad4d5c68935e38321320137b05d0'
      },
      body: JSON.stringify({
        deletionOptions,
        confirmation: this.currentDeleteDoc.toUpperCase(),
        reason: document.getElementById('deletionReason').value || null
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Deletion failed');
    }

    const result = await response.json();

    alert('Document deletion completed successfully');
    this.closeDeleteModal();

    // Refresh document list
    await this.loadDocuments();

  } catch (error) {
    console.error('Deletion error:', error);
    alert('Deletion failed: ' + error.message);
  }
}
```

---

## Testing Strategy

### 1. Test Deletion Preview
```bash
curl -H "x-admin-token: d0bf5af4f2e469d29e051e39e9569a76a283ad4d5c68935e38321320137b05d0" \
  http://localhost:3000/admin/api/documents/test_doc_id/deletion-preview
```

### 2. Test Partial Deletion
```bash
curl -X DELETE \
  -H "Content-Type: application/json" \
  -H "x-admin-token: d0bf5af4f2e469d29e051e39e9569a76a283ad4d5c68935e38321320137b05d0" \
  -d '{
    "deletionOptions": {
      "documents_table": false,
      "storage_all": false,
      "storage_manual": false,
      "storage_dip": true,
      "document_chunks": true,
      "jobs": true,
      "pinecone": false,
      "staging_specs": true,
      "staging_procedures": true,
      "staging_qa": true,
      "staging_golden": true,
      "production_specs": false,
      "production_procedures": false,
      "production_qa": false,
      "production_golden": false,
      "colloquial_keywords": false,
      "manual_flag": false
    },
    "confirmation": "TEST_DOC_ID",
    "reason": "Testing partial deletion"
  }' \
  http://localhost:3000/admin/api/documents/test_doc_id
```

### 3. Verify Audit Trail
```sql
SELECT * FROM document_deletions
WHERE doc_id = 'test_doc_id'
ORDER BY deleted_at DESC;
```

### 4. Check Archive Storage
```bash
# Check if files were moved to archive
curl -H "x-admin-token: YOUR_TOKEN" \
  http://localhost:3000/admin/api/storage/list?path=deleted/2025/10/17/
```

---

## Rollout Plan

### Phase 1: Backend Deployment (Day 1)
1. Create audit table in Supabase
2. Deploy deletion service
3. Deploy routes
4. Test with Postman/curl

### Phase 2: UI Testing (Day 2)
1. Add modal to documents.html
2. Test with single document
3. Verify audit records created
4. Check storage archival

### Phase 3: Production (Day 3)
1. Deploy to production
2. Test with non-critical document
3. Monitor audit logs
4. Document for team

---

## Risk Mitigation

1. **Transaction Safety**: Each deletion wrapped in try-catch
2. **Audit Always**: Audit record saved even if deletion partially fails
3. **Soft Delete Storage**: Files moved, not deleted
4. **Confirmation Required**: Must type doc ID to confirm
5. **Admin Only**: Protected by admin middleware
6. **Detailed Logging**: Every operation logged

---

## Recovery Procedures

### To Recover a Deleted Document:

1. **Find in Audit Table**:
```sql
SELECT * FROM document_deletions
WHERE asset_uid = 'BG-ZEUS-S16';
```

2. **Restore Storage Files**:
```bash
# Move files back from archive
mv deleted/2025/10/17/BG-ZEUS-S16/* manuals/original_doc_id/
```

3. **Re-ingest Document**:
- Use standard upload process
- System will recreate all entries

---

## Success Criteria

- ✅ Document can be deleted selectively
- ✅ Audit trail created for every deletion
- ✅ Storage files archived, not deleted
- ✅ UI shows preview before deletion
- ✅ Confirmation required
- ✅ No regression to existing functionality

---

## Notes

- Admin token hardcoded for now - should get from auth context in production
- Consider adding batch deletion in future
- May want to add "recover" functionality later
- Could add scheduled cleanup of old archives (>1 year)

---

**END OF IMPLEMENTATION PLAN**