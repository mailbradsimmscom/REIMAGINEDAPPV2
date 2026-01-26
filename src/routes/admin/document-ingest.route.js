import express from 'express';
import { createHash } from 'crypto';
import Busboy from 'busboy';
import {
  lookupReferenceIds,
  findOrCreateSystem,
  createInstanceForSystem,
  createDocumentSystemLink,
  saveReferencedSystems,
  upsertDocumentRecord,
  saveDetectionResults,
  validateInstalledPrimary,
  generateDocId
} from '../../services/document-ingest.service.js';
import { runVisionPipeline, getDocumentAssets, getDocumentAssetSummary } from '../../services/vision-pipeline.service.js';
import { VisionPipelineRequestSchema } from '../../schemas/document.schema.js';
import { logger } from '../../utils/logger.js';
import { getSupabaseStorageClient, getSupabaseClient } from '../../repositories/supabaseClient.js';

const router = express.Router();
const log = logger.createRequestLogger();

/**
 * POST /admin/api/documents
 * Save a parsed document and create associated systems
 *
 * Document-First Architecture:
 * 1. Create document FIRST (other tables have FK to it)
 * 2. Create/find system
 * 3. Create instance(s)
 * 4. Create document_systems link
 * 5. Create referenced_systems
 */
router.post('/', async (req, res) => {
  try {
    const {
      doc_id: providedDocId, // From upload-storage endpoint (preferred)
      filename,
      markdown_content,
      manufacturer,
      product_type,
      system_category,
      subsystem_category,
      models_detected,
      referenced_products,
      installed_primary,
      referenced_selections,
      storage_path, // From upload-storage endpoint
      systems // LEGACY: For backwards compatibility
    } = req.body;

    log.info('Document ingest request', {
      filename,
      providedDocId: providedDocId ? `${providedDocId.substring(0, 16)}...` : null,
      contentLength: markdown_content?.length,
      modelsCount: models_detected?.length,
      installedPrimary: installed_primary?.model_norm,
      referencedCount: referenced_selections?.length || 0,
      storagePath: storage_path || null
    });

    // ========================================================================
    // Step 1: Validate inputs
    // ========================================================================
    const validation = validateInstalledPrimary(installed_primary, systems);

    if (!validation.valid) {
      log.error('Validation failed', { error: validation.error });
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    const primaryToCreate = validation.primary;
    // Use provided doc_id from storage upload if available, otherwise generate from content
    const docId = providedDocId || generateDocId(markdown_content, filename);

    // ========================================================================
    // Step 2: Look up reference table IDs
    // ========================================================================
    const refLookup = await lookupReferenceIds({
      manufacturer,
      product_type,
      system_category,
      subsystem_category
    });

    if (!refLookup.success) {
      return res.status(500).json({
        success: false,
        error: refLookup.error
      });
    }

    const refIds = refLookup.data;

    // ========================================================================
    // Step 3: CREATE DOCUMENT FIRST (other tables have FK to doc_id)
    // ========================================================================
    const refsToSave = referenced_selections ||
      (referenced_products || []).map(rp => typeof rp === 'string' ? rp : rp.model).filter(Boolean);

    let primaryAssetUid = null;
    let primaryModelNorm = primaryToCreate?.model_norm || null;

    const docResult = await upsertDocumentRecord({
      docId,
      manufacturer,
      primaryModelNorm,
      primaryAssetUid: null, // Will update after system creation
      modelsDetected: models_detected,
      referencedModels: refsToSave,
      storagePath: storage_path
    });

    if (!docResult.success) {
      return res.status(500).json({
        success: false,
        error: docResult.error
      });
    }

    log.info('Document record created', { docId });

    // ========================================================================
    // Step 4: Create/find system (if primary selected)
    // ========================================================================
    let totalInstancesCreated = 0;

    if (primaryToCreate) {
      const manufacturerNorm = primaryToCreate.manufacturer_norm || manufacturer;

      // Find or create the system
      const systemResult = await findOrCreateSystem({
        manufacturerNorm,
        modelNorm: primaryModelNorm,
        refIds,
        docId
      });

      if (!systemResult.success) {
        return res.status(500).json({
          success: false,
          error: systemResult.error
        });
      }

      primaryAssetUid = systemResult.data.asset_uid;
      log.info('System ready', { assetUid: primaryAssetUid, reused: systemResult.data.reused });

      // ========================================================================
      // Step 5: Create instance(s)
      // ========================================================================

      // Get all primary items from systems array (may have multiple instances)
      const allPrimaryItems = systems?.filter(s => s.is_primary === true) || [];

      // If no items in array but we have primaryToCreate, use that
      const itemsToProcess = allPrimaryItems.length > 0
        ? allPrimaryItems
        : [primaryToCreate];

      for (const item of itemsToProcess) {
        const instanceResult = await createInstanceForSystem({
          assetUid: primaryAssetUid,
          serialNumber: item.serial_number || null,
          location: item.location || null,
          manufacturerNorm,
          modelNorm: primaryModelNorm,
          systemNorm: refIds.systemNorm,
          subsystemNorm: refIds.subsystemNorm
        });

        if (instanceResult.success) {
          totalInstancesCreated++;
          log.info('Instance created', { instanceUid: instanceResult.data.instance_uid });
        } else {
          log.warn('Failed to create instance', { error: instanceResult.error });
        }
      }

      // ========================================================================
      // Step 6: Create document_systems link
      // ========================================================================
      const linkResult = await createDocumentSystemLink({
        docId,
        assetUid: primaryAssetUid,
        isPrimary: true
      });

      if (!linkResult.success) {
        log.warn('Failed to create document-system link', { error: linkResult.error });
      }

      // Update document with asset_uid now that we have it
      await upsertDocumentRecord({
        docId,
        manufacturer,
        primaryModelNorm,
        primaryAssetUid,
        modelsDetected: models_detected,
        referencedModels: refsToSave,
        storagePath: storage_path
      });
    }

    // ========================================================================
    // Step 7: Save referenced systems
    // ========================================================================
    const referencedResult = await saveReferencedSystems({
      docId,
      referencedSelections: refsToSave,
      referencedProducts: referenced_products,
      filename
    });

    if (!referencedResult.success) {
      return res.status(500).json({
        success: false,
        error: referencedResult.error
      });
    }

    // ========================================================================
    // Step 8: Save detection results (non-blocking debug data)
    // ========================================================================
    await saveDetectionResults({
      docId,
      filename,
      manufacturer,
      modelsDetected: models_detected,
      referencedProducts: referenced_products,
      markdownLength: markdown_content?.length
    });

    // ========================================================================
    // Build response
    // ========================================================================
    const response = {
      success: true,
      data: {
        doc_id: docId,
        filename,
        installed_system: primaryAssetUid ? {
          asset_uid: primaryAssetUid,
          model_norm: primaryModelNorm
        } : null,
        referenced_systems_saved: referencedResult.data?.count || 0,
        systems_created: primaryAssetUid ? 1 : 0,
        instances_created: totalInstancesCreated,
        document_links_created: primaryAssetUid ? 1 : 0
      }
    };

    if (referencedResult.warnings?.length > 0) {
      response.warnings = referencedResult.warnings.map(w => ({
        code: w.error.code,
        message: w.error.message,
        model: w.model
      }));
    }

    return res.json(response);

  } catch (error) {
    log.error('Document ingest failed', { error: error.message, stack: error.stack });

    return res.status(500).json({
      success: false,
      error: {
        code: 'INGEST_FAILED',
        message: error.message,
        context: 'unexpected_error'
      }
    });
  }
});

/**
 * POST /admin/api/documents/:docId/vision
 * Run Vision Stage 6-7 on a document
 *
 * Standalone validation flow:
 * - Analyzes pages with Claude Vision (Stage 6)
 * - Crops figures/tables and uploads to Storage (Stage 7)
 * - Upserts assets to doc_assets table
 * - Does NOT trigger chunking or embedding
 */
router.post('/:docId/vision', async (req, res) => {
  try {
    const { docId } = req.params;
    const validation = VisionPipelineRequestSchema.safeParse({
      doc_id: docId,
      ...req.body
    });

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: validation.error.issues
        }
      });
    }

    const { storage_path, selected_models, referenced_selections, pages, context } = validation.data;

    log.info('Vision pipeline request', {
      docId,
      storagePath: storage_path,
      selectedModels: selected_models,
      referencedSelections: referenced_selections,
      pages
    });

    const result = await runVisionPipeline({
      docId,
      storagePath: storage_path,
      selectedModels: selected_models,
      referencedSelections: referenced_selections,
      pages,
      context
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'VISION_PIPELINE_FAILED',
          message: result.error,
          context: 'vision_pipeline'
        },
        data: {
          pages_analyzed: result.pages_analyzed,
          figures_cropped: result.figures_cropped,
          tables_cropped: result.tables_cropped,
          assets_saved: result.assets_saved,
          warnings: result.warnings
        }
      });
    }

    return res.json({
      success: true,
      data: {
        pages_analyzed: result.pages_analyzed,
        figures_cropped: result.figures_cropped,
        tables_cropped: result.tables_cropped,
        assets_saved: result.assets_saved,
        manifest_path: result.manifest_path,
        warnings: result.warnings,
        processing_time: result.processing_time
      }
    });

  } catch (error) {
    log.error('Vision pipeline failed', { error: error.message, stack: error.stack });

    return res.status(500).json({
      success: false,
      error: {
        code: 'VISION_PIPELINE_ERROR',
        message: error.message,
        context: 'unexpected_error'
      }
    });
  }
});

/**
 * GET /admin/api/documents/:docId/assets
 * Get all extracted assets for a document
 */
router.get('/:docId/assets', async (req, res) => {
  try {
    const { docId } = req.params;

    const assets = await getDocumentAssets(docId);

    return res.json({
      success: true,
      data: {
        doc_id: docId,
        assets,
        count: assets.length
      }
    });

  } catch (error) {
    log.error('Failed to get document assets', { error: error.message });

    return res.status(500).json({
      success: false,
      error: {
        code: 'GET_ASSETS_FAILED',
        message: error.message,
        context: 'get_assets'
      }
    });
  }
});

/**
 * GET /admin/api/documents/:docId/assets/summary
 * Get asset count summary for a document
 */
router.get('/:docId/assets/summary', async (req, res) => {
  try {
    const { docId } = req.params;

    const summary = await getDocumentAssetSummary(docId);

    return res.json({
      success: true,
      data: {
        doc_id: docId,
        ...summary
      }
    });

  } catch (error) {
    log.error('Failed to get asset summary', { error: error.message });

    return res.status(500).json({
      success: false,
      error: {
        code: 'GET_SUMMARY_FAILED',
        message: error.message,
        context: 'get_summary'
      }
    });
  }
});

/**
 * POST /admin/api/documents/upload-storage
 * Upload PDF to Supabase Storage (before LlamaParse)
 *
 * Returns doc_id and storage_path for use in subsequent document creation.
 * This separates storage from parsing so vision pipeline has access to the PDF.
 */
router.post('/upload-storage', async (req, res) => {
  try {
    const busboy = Busboy({
      headers: req.headers,
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit
        files: 1
      }
    });

    let fileBuffer = null;
    let fileName = null;
    let hasError = false;

    const busboyPromise = new Promise((resolve, reject) => {
      busboy.on('file', (fieldname, file, info) => {
        if (fieldname !== 'file') {
          file.resume();
          return;
        }

        fileName = info.filename;
        const chunks = [];

        file.on('data', (chunk) => {
          chunks.push(chunk);
        });

        file.on('end', () => {
          fileBuffer = Buffer.concat(chunks);
        });

        file.on('error', (error) => {
          hasError = true;
          reject(error);
        });
      });

      busboy.on('finish', () => {
        resolve();
      });

      busboy.on('error', (error) => {
        hasError = true;
        reject(error);
      });
    });

    req.pipe(busboy);
    await busboyPromise;

    if (hasError || !fileBuffer) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'UPLOAD_FAILED',
          message: 'No file provided or upload failed',
          context: 'upload_storage'
        }
      });
    }

    // Generate doc_id from file hash (same as old flow)
    const docId = createHash('sha256').update(fileBuffer).digest('hex');

    // Build storage path (same pattern as document.service.js)
    const filePath = `manuals/${docId}/${fileName}`;

    log.info('Uploading PDF to storage', { docId, fileName, filePath, fileSize: fileBuffer.length });

    // Upload to Supabase Storage
    const supabase = await getSupabaseStorageClient();
    const { data, error } = await supabase.storage
      .from('documents')
      .upload(filePath, fileBuffer, {
        contentType: 'application/pdf',
        upsert: true // Allow re-upload of same file
      });

    if (error) {
      log.error('Storage upload failed', { error: error.message, docId, filePath });
      return res.status(500).json({
        success: false,
        error: {
          code: 'STORAGE_UPLOAD_FAILED',
          message: error.message,
          context: 'supabase_storage'
        }
      });
    }

    log.info('PDF uploaded to storage', { docId, storagePath: data.path });

    // Create initial document row (will be updated later with full metadata)
    const supabaseDb = await getSupabaseClient();
    const { error: docError } = await supabaseDb
      .from('documents')
      .upsert([{
        doc_id: docId,
        storage_path: data.path
      }], { onConflict: 'doc_id' });

    if (docError) {
      log.error('Failed to create document row', { error: docError.message, docId });
      // Don't fail the whole request - file is uploaded, row creation is secondary
      // The confirm step will create/update the row anyway
      log.warn('Continuing without document row - will be created at confirm', { docId });
    } else {
      log.info('Document row created', { docId, storagePath: data.path });
    }

    return res.json({
      success: true,
      data: {
        doc_id: docId,
        storage_path: data.path,
        filename: fileName,
        file_size: fileBuffer.length
      }
    });

  } catch (error) {
    log.error('Upload storage failed', { error: error.message, stack: error.stack });

    return res.status(500).json({
      success: false,
      error: {
        code: 'UPLOAD_STORAGE_ERROR',
        message: error.message,
        context: 'unexpected_error'
      }
    });
  }
});

export default router;
