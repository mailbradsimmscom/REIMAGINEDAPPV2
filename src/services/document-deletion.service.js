import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';

const env = getEnv();

/**
 * Service for document deletion with audit trail
 */
export class DocumentDeletionService {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
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
        .eq('doc_id', docId)
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
      const pineconeCount = await this.countPineconeVectors(docId);

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
          manufacturer: doc.manufacturer_norm,
          model: doc.model_norm,
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

      // 4.5. Clear last_job_id reference BEFORE deleting jobs (to avoid FK constraint violation)
      if (options.jobs) {
        const { error: clearError } = await supabase
          .from('documents')
          .update({ last_job_id: null })
          .eq('doc_id', docId);

        if (clearError) {
          this.requestLogger.warn('Failed to clear last_job_id before job deletion', {
            docId,
            error: clearError.message
          });
          // Don't throw - let jobs deletion attempt proceed and fail with better error
        } else {
          this.requestLogger.info('Cleared last_job_id reference', { docId });
        }
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
      if (options.pinecone) {
        const deleteCount = await this.deletePineconeVectors(docId);
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
          .eq('doc_id', docId);

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
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = `deleted/${assetUid}-${timestamp}`;

    const result = {
      original_path: `manuals/${docId}/`,
      archive_path: archivePath,
      manual_moved: false,
      dip_moved: { total: 0, moved: 0, failed: 0 }
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
          // List all files inside DIP directory
          const { data: dipFiles, error: listError } = await supabase.storage
            .from('documents')
            .list(`manuals/${docId}/DIP`);

          if (listError) {
            this.requestLogger.error('Failed to list DIP files', { docId, error: listError.message });
          } else if (dipFiles && dipFiles.length > 0) {
            result.dip_moved.total = dipFiles.length;

            // Move each file individually
            for (const dipFile of dipFiles) {
              const sourcePath = `manuals/${docId}/DIP/${dipFile.name}`;
              const destPath = `${archivePath}/DIP/${dipFile.name}`;

              const { error: moveError } = await supabase.storage
                .from('documents')
                .move(sourcePath, destPath);

              if (moveError) {
                this.requestLogger.error('Failed to move DIP file', {
                  docId,
                  file: dipFile.name,
                  error: moveError.message
                });
                result.dip_moved.failed++;
              } else {
                result.dip_moved.moved++;
              }
            }
          }
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
  async deletePineconeVectors(docId) {
    try {
      const namespace = env.PINECONE_NAMESPACE || 'REIMAGINEDDOCS';
      const pythonUrl = env.PYTHON_SIDECAR_URL || 'http://localhost:8000';

      // Query vectors with this doc_id using Python sidecar
      const searchResponse = await fetch(`${pythonUrl}/v1/pinecone/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'test',
          topK: 10000,
          namespace: namespace,
          filter: { doc_id: docId },
          includeMetadata: false,
          includeValues: false
        })
      });

      const searchData = await searchResponse.json();

      if (searchData.matches && searchData.matches.length > 0) {
        const ids = searchData.matches.map(match => match.id);

        // Delete using Python sidecar
        await fetch(`${pythonUrl}/v1/pinecone/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids: ids,
            namespace: namespace
          })
        });

        return ids.length;
      }

      return 0;
    } catch (error) {
      this.requestLogger.error('Pinecone deletion failed', { docId, error: error.message });
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
  async countPineconeVectors(docId) {
    if (!docId) return 0;

    try {
      const namespace = env.PINECONE_NAMESPACE || 'REIMAGINEDDOCS';
      const pythonUrl = env.PYTHON_SIDECAR_URL || 'http://localhost:8000';

      // Query to get all matching vectors (up to 10k) using Python sidecar
      const response = await fetch(`${pythonUrl}/v1/pinecone/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'test',
          topK: 10000,
          namespace: namespace,
          filter: { doc_id: docId },
          includeMetadata: false,
          includeValues: false
        })
      });

      const data = await response.json();
      return data.matches?.length || 0;
    } catch (error) {
      this.requestLogger.error('Pinecone count failed', { docId, error: error.message });
      return 0;
    }
  }
}