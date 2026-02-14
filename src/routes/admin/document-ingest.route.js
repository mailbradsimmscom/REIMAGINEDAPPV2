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
import { runV5Indexing } from '../../services/v5-index.service.js';
import { runV5ColloquialKeywords } from '../../services/v5-colloquial.service.js';
import { runDipExtraction } from '../../services/v5-dip.service.js';
// storeDipRunParams, streamDipExtraction removed — dip/run + dip/stream endpoints removed
import { buildPipelineModelParams } from '../../services/alias-map.service.js';
import { startIngestRun, getIngestStatus } from '../../services/v5-ingest-runner.service.js';
import documentRepository from '../../repositories/document.repository.js';
import { VisionPipelineRequestSchema } from '../../schemas/document.schema.js';
import { logger } from '../../utils/logger.js';
import { getSupabaseStorageClient, getSupabaseClient } from '../../repositories/supabaseClient.js';
import { saveTimingPayload, getTimingForDocument, getTimingForRun } from '../../services/ingest-timing.service.js';

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
      systems, // LEGACY: For backwards compatibility
      // v2 detection fields (Phase B)
      family_aliases,
      primary_family_name,
      // Background runner fields
      start_background_run = false, // Set true to start Vision/Indexing/DIP in background
      selected_models: selectedModelsParam // User's selected primary models for indexing
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
      storagePath: storage_path,
      familyAliases: family_aliases,
      brandFamily: primary_family_name
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

      // Find or create the system — pass v2 detection fields if available
      const systemResult = await findOrCreateSystem({
        manufacturerNorm,
        modelNorm: primaryModelNorm,
        refIds,
        docId,
        description: primaryToCreate.description || null,
        modelSynonyms: primaryToCreate.aliases || null,
        userDisplayName: primaryToCreate.user_display_name || null
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
        storagePath: storage_path,
        familyAliases: family_aliases,
        brandFamily: primary_family_name
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
    // Start background runner (if requested)
    // ========================================================================
    let ingestRunResult = null;

    if (start_background_run) {
      // Derive selected_models from systems array if not provided
      const selectedModels = selectedModelsParam ||
        (systems || []).filter(s => s.is_primary).map(s => s.model_norm);

      if (selectedModels.length > 0) {
        log.info('Starting background ingest run', { docId, selectedModels });

        // Note: markdown_content may be null in review mode (user opened ?doc_id=xxx from todo).
        // doc_id must be provided in review mode. filename comes from req.body — frontend sends
        // storageResult.filename in review mode, currentFile.name in inline mode.
        ingestRunResult = await startIngestRun({
          docId,
          storagePath: storage_path,
          selectedModels,
          referencedSelections: refsToSave,
          installedAssetUid: primaryAssetUid,
          filename
        });

        if (!ingestRunResult.success) {
          log.warn('Background ingest start failed', {
            docId,
            error: ingestRunResult.error,
            existingJobId: ingestRunResult.existing_job_id
          });
        }
      } else {
        log.info('Skipping background run - no selected models', { docId });
      }
    }

    // ========================================================================
    // Auto-complete detection_complete todo (prevents stale "Review model selection" todos)
    // ========================================================================
    try {
      const { completeDocumentIngestTask } = await import('../../repositories/user-tasks.repository.js');
      await completeDocumentIngestTask(docId, 'detection_complete');
    } catch (todoErr) {
      log.warn('Failed to auto-complete detection todo', { docId, error: todoErr.message });
    }

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

    // Add background run info if started
    if (ingestRunResult) {
      response.data.ingest_run = {
        started: ingestRunResult.success,
        job_id: ingestRunResult.job_id || null,
        status_v2: ingestRunResult.status_v2 || null,
        error: ingestRunResult.error || null,
        existing_job_id: ingestRunResult.existing_job_id || null
      };
    }

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
 * GET /admin/api/documents/:docId/detection-result
 * Returns stored detection result + document metadata for the frontend review page.
 * Used when user opens /ingest?doc_id=xxx from a todo link.
 */
router.get('/:docId/detection-result', async (req, res) => {
  try {
    const { docId } = req.params;

    // Get document detection result
    const doc = await documentRepository.getDetectionResult(docId);
    if (!doc) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Document not found' }
      });
    }

    // Get latest parse-detect job for counters
    const job = await documentRepository.getLatestParseDetectJobForDoc(docId);

    return res.json({
      success: true,
      data: {
        doc_id: doc.doc_id,
        filename: doc.filename,
        storage_path: doc.storage_path,
        detection_result: doc.detection_result,
        parse_status: job?.status_v2 || null,
        job_counters: job?.counters || null
      }
    });

  } catch (err) {
    log.error('Failed to get detection result', { error: err.message, docId: req.params.docId });
    return res.status(500).json({
      success: false,
      error: { code: 'DETECTION_RESULT_ERROR', message: err.message }
    });
  }
});

/**
 * GET /admin/api/documents/:docId/parse-detect-status
 * Returns current status of the parse+detect background job.
 * Used by frontend to poll during parse/detect or check if detection is ready.
 */
router.get('/:docId/parse-detect-status', async (req, res) => {
  try {
    const { docId } = req.params;
    const { getParseDetectStatus } = await import('../../services/v5-parse-detect-runner.service.js');

    const status = await getParseDetectStatus(docId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No parse-detect job found for this document' }
      });
    }

    return res.json({
      success: true,
      data: status
    });

  } catch (err) {
    log.error('Failed to get parse-detect status', { error: err.message, docId: req.params.docId });
    return res.status(500).json({
      success: false,
      error: { code: 'PARSE_DETECT_STATUS_ERROR', message: err.message }
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

    // Check for active parse-detect job - reject if parse/detect is still running
    const parseDetectJob = await documentRepository.getActiveParseDetectJobForDoc(docId);
    if (parseDetectJob) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'ACTIVE_PARSE_DETECT_JOB',
          message: 'Parse/detect is still running for this document. Wait for detection to complete.',
          job_id: parseDetectJob.job_id,
          status_v2: parseDetectJob.status_v2
        }
      });
    }

    // Check for active background ingest job - reject manual call if one exists
    const activeJob = await documentRepository.getActiveIngestJobForDoc(docId);
    if (activeJob) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'ACTIVE_JOB_EXISTS',
          message: 'A background ingest job is running for this document. Use /ingest-status to monitor progress.',
          job_id: activeJob.job_id,
          status_v2: activeJob.status_v2
        }
      });
    }

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

    // Phase D: derive from DB if not provided by frontend
    // Phase E: always fetch dbParams for alias_map
    const dbParams = await buildPipelineModelParams(docId);
    let selectedModels = selected_models;
    let referencedSelections = referenced_selections;
    if (!selectedModels || selectedModels.length === 0) {
      selectedModels = dbParams.selected_models;
      referencedSelections = dbParams.referenced_selections;
      log.info('Vision: derived model arrays from DB', { docId, selectedModels, referencedSelections });
    }

    if (!selectedModels || selectedModels.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'No models found for this document' }
      });
    }

    log.info('Vision pipeline request', {
      docId,
      storagePath: storage_path,
      selectedModels,
      referencedSelections,
      pages
    });

    const result = await runVisionPipeline({
      docId,
      storagePath: storage_path,
      selectedModels,
      referencedSelections,
      aliasMap: dbParams.alias_map,
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

/**
 * POST /admin/api/documents/upload-and-parse
 * Upload PDF to storage + kick off background parse+detect.
 * Returns immediately with job_id for polling.
 *
 * IMPORTANT: This route must be defined BEFORE /:docId routes.
 */
router.post('/upload-and-parse', async (req, res) => {
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
          context: 'upload_and_parse'
        }
      });
    }

    // Generate doc_id from file hash
    const docId = createHash('sha256').update(fileBuffer).digest('hex');

    // Check for active parse-detect job BEFORE uploading
    const { startParseDetectRun } = await import('../../services/v5-parse-detect-runner.service.js');
    const existingJob = await documentRepository.getActiveParseDetectJobForDoc(docId);
    if (existingJob) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'ACTIVE_JOB_EXISTS',
          message: 'Parse/detect already running for this document',
          existing_job_id: existingJob.job_id,
          existing_doc_id: docId,
          existing_status: existingJob.status_v2
        }
      });
    }

    // Upload to Supabase Storage
    const filePath = `manuals/${docId}/${fileName}`;
    log.info('Uploading PDF to storage (upload-and-parse)', { docId, fileName, filePath, fileSize: fileBuffer.length });

    const supabase = await getSupabaseStorageClient();
    const { data, error } = await supabase.storage
      .from('documents')
      .upload(filePath, fileBuffer, {
        contentType: 'application/pdf',
        upsert: true
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

    const storagePath = data.path;
    log.info('PDF uploaded to storage', { docId, storagePath });

    // Create initial document row with doc_id, storage_path, and filename
    const supabaseDb = await getSupabaseClient();
    const { error: docError } = await supabaseDb
      .from('documents')
      .upsert([{
        doc_id: docId,
        storage_path: storagePath,
        filename: fileName
      }], { onConflict: 'doc_id' });

    if (docError) {
      log.error('Failed to create document row', { error: docError.message, docId });
      log.warn('Continuing without document row - runner will handle', { docId });
    }

    // Kick off background parse+detect — no fileBuffer; runner downloads from storage
    const runResult = await startParseDetectRun({
      docId,
      storagePath,
      filename: fileName
    });

    if (!runResult.success) {
      log.warn('Parse-detect run start failed', { docId, error: runResult.error });
      return res.status(409).json({
        success: false,
        error: {
          code: runResult.error,
          message: runResult.message,
          existing_job_id: runResult.existing_job_id
        }
      });
    }

    // Free the file buffer
    fileBuffer = null;

    return res.json({
      success: true,
      data: {
        doc_id: docId,
        job_id: runResult.job_id,
        status_v2: 'queued',
        storage_path: storagePath,
        filename: fileName
      }
    });

  } catch (error) {
    log.error('Upload-and-parse failed', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: {
        code: 'UPLOAD_AND_PARSE_ERROR',
        message: error.message,
        context: 'unexpected_error'
      }
    });
  }
});

/**
 * GET /admin/api/documents/ingest/active
 * List all active v5_ingest jobs across all documents
 *
 * IMPORTANT: This route must be defined BEFORE /:docId routes
 * Returns array of active jobs with doc_id, job_id, status_v2, etc.
 */
router.get('/ingest/active', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('jobs')
      .select('job_id, doc_id, job_type, status_v2, status, counters, created_at, started_at, last_heartbeat')
      .in('job_type', ['v5_ingest', 'v5_parse_detect'])
      .in('status_v2', ['queued', 'vision_running', 'vision_completed', 'vision_warning',
        'indexing_running', 'indexing_completed', 'dip_running',
        'parsing', 'parse_complete', 'detecting'])
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Add staleness check
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000;
    const jobs = (data || []).map(job => ({
      ...job,
      is_stale: job.last_heartbeat
        ? (now - new Date(job.last_heartbeat).getTime()) > staleThreshold
        : true
    }));

    return res.json({
      success: true,
      data: {
        jobs,
        count: jobs.length
      },
      requestId: res.locals.requestId
    });

  } catch (err) {
    log.error('Failed to get active ingest jobs', { error: err.message });
    return res.status(500).json({
      success: false,
      error: { code: 'LIST_ERROR', message: err.message },
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /admin/api/documents/:docId/index
 * v5 Index: Chunk document and store in Pinecone with model tags
 *
 * Body:
 * - selected_models: string[] (required) - User's installed primary model(s)
 * - referenced_selections: string[] (optional) - User's selected referenced systems
 * - force_reindex: boolean (optional) - If true, delete existing chunks first
 * - skip_dip: boolean (optional) - If true, skip DIP extraction (for streaming DIP separately)
 */
router.post('/:docId/index', async (req, res) => {
  try {
    const { docId } = req.params;

    // Check for active parse-detect job - reject if parse/detect is still running
    const parseDetectJob = await documentRepository.getActiveParseDetectJobForDoc(docId);
    if (parseDetectJob) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'ACTIVE_PARSE_DETECT_JOB',
          message: 'Parse/detect is still running for this document. Wait for detection to complete.',
          job_id: parseDetectJob.job_id,
          status_v2: parseDetectJob.status_v2
        }
      });
    }

    // Check for active background ingest job - reject manual call if one exists
    const activeJob = await documentRepository.getActiveIngestJobForDoc(docId);
    if (activeJob) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'ACTIVE_JOB_EXISTS',
          message: 'A background ingest job is running for this document. Use /ingest-status to monitor progress.',
          job_id: activeJob.job_id,
          status_v2: activeJob.status_v2
        }
      });
    }

    const {
      selected_models: selectedModelsRaw,
      referenced_selections: referencedSelectionsRaw = [],
      force_reindex: forceReindex = false,
      asset_uid: assetUid = null,
      skip_dip: skipDip = false
    } = req.body;

    // Phase D: derive from DB if not provided by frontend
    // Phase E: always fetch dbParams for alias_map
    const dbParams = await buildPipelineModelParams(docId);
    let selectedModels = selectedModelsRaw;
    let referencedSelections = referencedSelectionsRaw;
    if (!selectedModels || selectedModels.length === 0) {
      selectedModels = dbParams.selected_models;
      referencedSelections = dbParams.referenced_selections;
      log.info('Index: derived model arrays from DB', { docId, selectedModels, referencedSelections });
    }

    if (!selectedModels || selectedModels.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'No models found for this document'
        }
      });
    }

    log.info('Starting v5 indexing', {
      docId,
      selectedModels,
      referencedSelections,
      forceReindex
    });

    const result = await runV5Indexing({
      docId,
      selectedModels,
      referencedSelections,
      aliasMap: dbParams.alias_map,
      forceReindex
    });

    if (!result.success) {
      log.error('v5 indexing failed', {
        docId,
        error: result.error,
        message: result.error_message
      });

      return res.status(500).json({
        success: false,
        error: {
          code: result.error || 'INDEXING_FAILED',
          message: result.error_message || 'Indexing failed'
        }
      });
    }

    log.info('v5 indexing complete', {
      docId,
      chunksCreated: result.chunks_created,
      vectorsUpserted: result.vectors_upserted
    });

    // Optional: post-indexing colloquial extraction to populate systems.colloquial_keywords.
    // This depends on Pinecone content and is non-fatal.
    let colloquial = null;
    if (assetUid) {
      const colloquialResult = await runV5ColloquialKeywords({
        assetUid,
        docId,
        selectedModels
      });
      colloquial = colloquialResult.success
        ? { success: true, ...colloquialResult }
        : { success: false, error: colloquialResult.error, message: colloquialResult.error_message };
    }

    // Optional: post-indexing DIP extraction (specs, troubleshooting, procedures, etc.)
    // This is non-fatal - document is still searchable if DIP fails.
    // Can be skipped with skip_dip=true for streaming DIP separately.
    let dip = null;
    if (skipDip) {
      log.info('Skipping DIP extraction (skip_dip=true)', { docId });
      dip = { skipped: true };
    } else {
      try {
        log.info('Starting post-index DIP extraction', { docId, selectedModels, referencedSelections });
        const dipResult = await runDipExtraction({
          docId,
          selectedModels,
          referencedSelections,
          forceRerun: forceReindex // If reindexing, also rerun DIP
        });
        dip = dipResult.success
          ? {
              success: true,
              modes_completed: dipResult.modes_completed,
              modes_failed: dipResult.modes_failed,
              results: dipResult.results,
              total_extracted: dipResult.total_extracted,
              total_inserted: dipResult.total_inserted,
              processing_time: dipResult.processing_time
            }
          : {
              success: false,
              error: dipResult.error_code,
              message: dipResult.error,
              modes_completed: dipResult.modes_completed || [],
              modes_failed: dipResult.modes_failed || [],
              results: dipResult.results || []
            };
      } catch (dipError) {
        log.error('DIP extraction failed (non-fatal)', { docId, error: dipError.message });
        dip = { success: false, error: 'DIP_ERROR', message: dipError.message };
      }
    }

    return res.json({
      success: true,
      data: {
        doc_id: docId,
        chunks_created: result.chunks_created,
        chunks_skipped: result.chunks_skipped,
        vectors_upserted: result.vectors_upserted,
        total_tokens: result.total_tokens,
        statistics: result.statistics,
        processing_time: result.processing_time,
        colloquial,
        dip
      }
    });

  } catch (error) {
    log.error('v5 indexing error', { error: error.message, stack: error.stack });

    return res.status(500).json({
      success: false,
      error: {
        code: 'INDEX_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * POST /admin/api/documents/:docId/dip
 * v5 DIP: Extract specs, troubleshooting, procedures, golden rules, intent router
 *
 * Body:
 * - selected_models: string[] (required) - User's installed primary model(s)
 * - referenced_selections: string[] (optional) - User's selected referenced systems
 * - modes: string[] (optional) - DIP modes to run (default: all)
 * - force_rerun: boolean (optional) - If true, delete existing DIP rows first
 */
router.post('/:docId/dip', async (req, res) => {
  try {
    const { docId } = req.params;

    // Check for active background job - reject manual call if one exists
    const activeJob = await documentRepository.getActiveIngestJobForDoc(docId);
    if (activeJob) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'ACTIVE_JOB_EXISTS',
          message: 'A background ingest job is running for this document. Use /ingest-status to monitor progress.',
          job_id: activeJob.job_id,
          status_v2: activeJob.status_v2
        }
      });
    }

    const {
      selected_models: selectedModels,
      referenced_selections: referencedSelections = [],
      modes = ['specs', 'troubleshooting', 'procedures', 'golden_rules', 'intent_router'],
      force_rerun: forceRerun = false
    } = req.body;

    // Validate required fields
    if (!selectedModels || selectedModels.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'selected_models is required and cannot be empty'
        }
      });
    }

    log.info('Starting v5 DIP extraction', {
      docId,
      selectedModels,
      referencedSelections,
      modes,
      forceRerun
    });

    const result = await runDipExtraction({
      docId,
      selectedModels,
      referencedSelections,
      modes,
      forceRerun
    });

    if (!result.success) {
      log.error('v5 DIP extraction failed', {
        docId,
        error: result.error,
        errorCode: result.error_code
      });

      return res.status(500).json({
        success: false,
        error: {
          code: result.error_code || 'DIP_FAILED',
          message: result.error || 'DIP extraction failed'
        },
        data: {
          modes_completed: result.modes_completed || [],
          modes_failed: result.modes_failed || [],
          results: result.results || [],
          total_inserted: result.total_inserted || 0
        }
      });
    }

    log.info('v5 DIP extraction complete', {
      docId,
      modesCompleted: result.modes_completed,
      totalInserted: result.total_inserted
    });

    return res.json({
      success: true,
      data: {
        doc_id: docId,
        modes_requested: result.modes_requested,
        modes_completed: result.modes_completed,
        modes_failed: result.modes_failed,
        results: result.results,
        total_extracted: result.total_extracted,
        total_inserted: result.total_inserted,
        processing_time: result.processing_time
      }
    });

  } catch (error) {
    log.error('v5 DIP extraction error', { error: error.message, stack: error.stack });

    return res.status(500).json({
      success: false,
      error: {
        code: 'DIP_ERROR',
        message: error.message
      }
    });
  }
});

// dip/run and dip/stream endpoints removed — DIP now runs via background v5-ingest-runner
// using runDipWithCallback directly (no SSE infrastructure needed)

// ============================================
// Timing Persistence (Phase B)
// ============================================

// POST /:docId/timing — Save timing payload (bulk insert)
router.post('/:docId/timing', async (req, res) => {
  try {
    const { docId } = req.params;
    const { ingest_run_id, steps } = req.body;

    if (!ingest_run_id) {
      return res.status(400).json({ success: false, error: { message: 'ingest_run_id is required' } });
    }
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ success: false, error: { message: 'steps array is required' } });
    }

    const result = await saveTimingPayload(ingest_run_id, docId, steps);

    return res.status(201).json({
      success: true,
      data: result,
      requestId: res.locals.requestId
    });
  } catch (err) {
    log.error('Failed to save ingest timing', { error: err.message, docId: req.params.docId });
    return res.status(500).json({
      success: false,
      error: { message: err.message },
      requestId: res.locals.requestId
    });
  }
});

// GET /:docId/timing — Retrieve all timing runs for a document
router.get('/:docId/timing', async (req, res) => {
  try {
    const { docId } = req.params;
    const runs = await getTimingForDocument(docId);

    return res.json({
      success: true,
      data: { runs, count: runs.length },
      requestId: res.locals.requestId
    });
  } catch (err) {
    log.error('Failed to get ingest timing', { error: err.message, docId: req.params.docId });
    return res.status(500).json({
      success: false,
      error: { message: err.message },
      requestId: res.locals.requestId
    });
  }
});

// GET /:docId/timing/:ingestRunId — Retrieve one specific timing run
router.get('/:docId/timing/:ingestRunId', async (req, res) => {
  try {
    const { docId, ingestRunId } = req.params;
    const steps = await getTimingForRun(docId, ingestRunId);

    return res.json({
      success: true,
      data: { ingest_run_id: ingestRunId, doc_id: docId, steps, count: steps.length },
      requestId: res.locals.requestId
    });
  } catch (err) {
    log.error('Failed to get ingest timing run', {
      error: err.message, docId: req.params.docId, ingestRunId: req.params.ingestRunId
    });
    return res.status(500).json({
      success: false,
      error: { message: err.message },
      requestId: res.locals.requestId
    });
  }
});

// ============================================
// Background Ingest Status Endpoints
// ============================================

/**
 * GET /admin/api/documents/:docId/ingest-status
 * Get the current status of a background ingest job for a document
 *
 * Returns:
 * - job_id: UUID of the job
 * - status_v2: Current stage (queued, vision_running, indexing_completed, etc.)
 * - counters: Per-stage metrics (vision, indexing, dip)
 * - error: Error details if failed
 * - is_stale: True if job hasn't updated heartbeat in >5 min
 */
router.get('/:docId/ingest-status', async (req, res) => {
  try {
    const { docId } = req.params;

    const status = await getIngestStatus(docId);

    if (!status) {
      return res.json({
        success: true,
        data: {
          doc_id: docId,
          has_job: false,
          message: 'No ingest job found for this document'
        },
        requestId: res.locals.requestId
      });
    }

    return res.json({
      success: true,
      data: {
        doc_id: docId,
        has_job: true,
        ...status
      },
      requestId: res.locals.requestId
    });

  } catch (err) {
    log.error('Failed to get ingest status', { error: err.message, docId: req.params.docId });
    return res.status(500).json({
      success: false,
      error: { code: 'STATUS_ERROR', message: err.message },
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /admin/api/documents/:docId/ingest-retry
 * Retry a failed ingest by creating a new job
 *
 * Creates a new job row (preserves history) and reruns all stages.
 */
router.post('/:docId/ingest-retry', async (req, res) => {
  try {
    const { docId } = req.params;

    // Check for active job - can't retry if one is already running
    const activeJob = await documentRepository.getActiveIngestJobForDoc(docId);
    if (activeJob) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'ACTIVE_JOB_EXISTS',
          message: 'A job is already running for this document',
          job_id: activeJob.job_id,
          status_v2: activeJob.status_v2
        }
      });
    }

    // Get document info for retry
    const document = await documentRepository.getDocument(docId);
    if (!document) {
      return res.status(404).json({
        success: false,
        error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found' }
      });
    }

    // Get model params
    const dbParams = await buildPipelineModelParams(docId);
    if (!dbParams.selected_models || dbParams.selected_models.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_MODELS', message: 'No models found for this document' }
      });
    }

    log.info('Starting ingest retry', { docId });

    const result = await startIngestRun({
      docId,
      storagePath: document.storage_path,
      selectedModels: dbParams.selected_models,
      referencedSelections: dbParams.referenced_selections || []
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: {
          code: result.error,
          message: result.message,
          existing_job_id: result.existing_job_id
        }
      });
    }

    return res.json({
      success: true,
      data: {
        job_id: result.job_id,
        doc_id: result.doc_id,
        status_v2: result.status_v2,
        message: 'Retry job started'
      },
      requestId: res.locals.requestId
    });

  } catch (err) {
    log.error('Ingest retry failed', { error: err.message, docId: req.params.docId });
    return res.status(500).json({
      success: false,
      error: { code: 'RETRY_ERROR', message: err.message },
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /admin/api/documents/:docId/ingest-history
 * Get history of ingest jobs for a document
 *
 * Returns array of past jobs ordered by created_at desc
 */
router.get('/:docId/ingest-history', async (req, res) => {
  try {
    const { docId } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('jobs')
      .select('job_id, doc_id, status_v2, status, counters, error, created_at, started_at, completed_at')
      .eq('doc_id', docId)
      .eq('job_type', 'v5_ingest')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return res.json({
      success: true,
      data: {
        doc_id: docId,
        jobs: data || [],
        count: (data || []).length
      },
      requestId: res.locals.requestId
    });

  } catch (err) {
    log.error('Failed to get ingest history', { error: err.message, docId: req.params.docId });
    return res.status(500).json({
      success: false,
      error: { code: 'HISTORY_ERROR', message: err.message },
      requestId: res.locals.requestId
    });
  }
});

export default router;
