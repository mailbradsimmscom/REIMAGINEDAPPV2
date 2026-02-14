import { logger } from '../utils/logger.js';
import documentRepository from '../repositories/document.repository.js';
import { runVisionPipeline } from './vision-pipeline.service.js';
import { runV5Indexing } from './v5-index.service.js';
import { buildPipelineModelParams } from './alias-map.service.js';
import { runDipWithCallback } from './dip-stream.service.js';
import { createUserTask } from '../repositories/user-tasks.repository.js';

/**
 * v5 Ingest Runner Service
 *
 * Orchestrates background document processing:
 * 1. Vision (optional, can fail with warning)
 * 2. Indexing (required, stops on failure)
 * 3. DIP (required, partial success OK)
 *
 * Updates job status_v2 and counters throughout execution.
 * Runs via setImmediate to not block the request.
 */

const log = logger.createRequestLogger();

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

/**
 * Start a background ingest run for a document
 *
 * @param {Object} params
 * @param {string} params.docId - Document ID
 * @param {string} params.storagePath - Storage path to PDF
 * @param {string[]} params.selectedModels - User's installed primary models
 * @param {string[]} params.referencedSelections - User's selected referenced systems
 * @param {string} [params.installedAssetUid] - Primary system asset_uid
 * @param {boolean} [params.skipDip=false] - Skip DIP extraction
 * @returns {Promise<Object>} { job_id, doc_id, status_v2 }
 */
export async function startIngestRun({
  docId,
  storagePath,
  selectedModels,
  referencedSelections = [],
  installedAssetUid = null,
  skipDip = false,
  filename = null
}) {
  log.info('Starting ingest run', { docId, selectedModels, skipDip });

  // Check for existing active job
  const existingJob = await documentRepository.getActiveIngestJobForDoc(docId);
  if (existingJob) {
    log.warn('Active ingest job already exists for document', {
      docId,
      existingJobId: existingJob.job_id,
      existingStatus: existingJob.status_v2
    });
    return {
      success: false,
      error: 'ACTIVE_JOB_EXISTS',
      message: 'An ingest job is already running for this document',
      existing_job_id: existingJob.job_id,
      existing_status: existingJob.status_v2
    };
  }

  // Get alias map for pipeline
  const dbParams = await buildPipelineModelParams(docId);

  // Create job record
  const jobData = {
    doc_id: docId,
    job_type: 'v5_ingest',
    status: 'queued',
    status_v2: 'queued',
    params: {
      doc_id: docId,
      storage_path: storagePath,
      selected_models: selectedModels,
      referenced_selections: referencedSelections,
      alias_map: dbParams.alias_map,
      installed_asset_uid: installedAssetUid,
      skip_dip: skipDip,
      filename
    },
    counters: {},
    selected_models: selectedModels,
    last_heartbeat: new Date().toISOString()
  };

  const job = await documentRepository.createJob(jobData);
  const jobId = job.job_id;

  log.info('Ingest job created', { jobId, docId });

  // Start background execution
  setImmediate(() => {
    runIngestPipeline(jobId).catch(err => {
      log.error('Ingest pipeline unhandled error', { jobId, error: err.message });
    });
  });

  return {
    success: true,
    job_id: jobId,
    doc_id: docId,
    status_v2: 'queued'
  };
}

/**
 * Run the ingest pipeline (called in background)
 */
async function runIngestPipeline(jobId) {
  let heartbeatInterval = null;
  const counters = { vision: null, indexing: null, dip: null, error: null };

  try {
    // Get job details
    const job = await documentRepository.getJob(jobId);
    if (!job) {
      log.error('Job not found', { jobId });
      return;
    }

    const {
      doc_id: docId,
      storage_path: storagePath,
      selected_models: selectedModels,
      referenced_selections: referencedSelections,
      alias_map: aliasMap,
      installed_asset_uid: installedAssetUid,
      skip_dip: skipDip
    } = job.params;

    log.info('Running ingest pipeline', { jobId, docId, skipDip });

    // Start heartbeat
    heartbeatInterval = setInterval(async () => {
      try {
        await documentRepository.updateJobHeartbeat(jobId);
      } catch (err) {
        log.warn('Heartbeat update failed', { jobId, error: err.message });
      }
    }, HEARTBEAT_INTERVAL_MS);

    // ========================================================================
    // Stage 1: Vision (optional - continues on failure)
    // ========================================================================
    await documentRepository.updateJobIngestState(jobId, {
      statusV2: 'vision_running',
      counters
    });

    let visionResult;
    const visionStart = Date.now();

    try {
      if (!storagePath) {
        log.info('Skipping vision - no storage path', { jobId, docId });
        visionResult = { success: true, skipped: true };
        counters.vision = { skipped: true, reason: 'no_storage_path' };
      } else {
        visionResult = await runVisionPipeline({
          docId,
          storagePath,
          selectedModels,
          referencedSelections,
          aliasMap
        });

        counters.vision = {
          pages_analyzed: visionResult.pages_analyzed || 0,
          figures_cropped: visionResult.figures_cropped || 0,
          tables_cropped: visionResult.tables_cropped || 0,
          assets_saved: visionResult.assets_saved || 0,
          duration_ms: Date.now() - visionStart
        };

        if (!visionResult.success) {
          counters.vision.warning = visionResult.error;
        }
      }
    } catch (err) {
      log.error('Vision stage threw error', { jobId, docId, error: err.message });
      visionResult = { success: false, error: err.message };
      counters.vision = {
        warning: err.message,
        duration_ms: Date.now() - visionStart
      };
    }

    // Vision failure is non-fatal - continue with warning
    const visionStatus = visionResult.success ? 'vision_completed' : 'vision_warning';
    await documentRepository.updateJobIngestState(jobId, {
      statusV2: visionStatus,
      counters
    });

    log.info('Vision stage complete', { jobId, docId, status: visionStatus });

    // ========================================================================
    // Stage 2: Indexing (required - stops on failure)
    // ========================================================================
    await documentRepository.updateJobIngestState(jobId, {
      statusV2: 'indexing_running',
      counters
    });

    const indexingStart = Date.now();
    let indexingResult;

    try {
      indexingResult = await runV5Indexing({
        docId,
        selectedModels,
        referencedSelections,
        aliasMap
      });

      counters.indexing = {
        chunks_created: indexingResult.chunks_created || 0,
        chunks_skipped: indexingResult.chunks_skipped || 0,
        vectors_upserted: indexingResult.vectors_upserted || 0,
        total_tokens: indexingResult.total_tokens || 0,
        duration_ms: Date.now() - indexingStart
      };
    } catch (err) {
      log.error('Indexing stage threw error', { jobId, docId, error: err.message });
      indexingResult = { success: false, error: err.message };
      counters.indexing = {
        error: err.message,
        duration_ms: Date.now() - indexingStart
      };
    }

    if (!indexingResult.success) {
      counters.error = {
        stage: 'indexing',
        message: indexingResult.error || indexingResult.error_message,
        timestamp: new Date().toISOString()
      };

      await documentRepository.updateJobIngestState(jobId, {
        statusV2: 'indexing_failed',
        counters,
        error: counters.error
      });

      log.error('Indexing failed - stopping pipeline', { jobId, docId });
      return;
    }

    await documentRepository.updateJobIngestState(jobId, {
      statusV2: 'indexing_completed',
      counters
    });

    log.info('Indexing stage complete', { jobId, docId });

    // ========================================================================
    // Stage 3: DIP (required, partial success OK)
    // ========================================================================
    if (skipDip) {
      log.info('Skipping DIP stage', { jobId, docId });
      counters.dip = { skipped: true, reason: 'skip_dip_flag' };
    } else {
      await documentRepository.updateJobIngestState(jobId, {
        statusV2: 'dip_running',
        counters
      });

      const dipStart = Date.now();
      counters.dip = {
        modes_completed: [],
        modes_failed: [],
        modes_pending: ['specs', 'troubleshooting', 'procedures', 'golden_rules', 'intent_router'],
        total_inserted: 0,
        cache_tokens: { creation: 0, read: 0 }
      };

      try {
        // Get models_covered from document for DIP
        const document = await documentRepository.getDocument(docId);
        const modelsCovered = document?.models_covered || selectedModels;

        const dipParams = {
          doc_id: docId,
          models_covered: modelsCovered,
          selected_models: selectedModels,
          referenced_selections: referencedSelections,
          alias_map: aliasMap,
          modes: ['specs', 'troubleshooting', 'procedures', 'golden_rules', 'intent_router'],
          force_rerun: false
        };

        // Run DIP with progress callback
        const dipResult = await runDipWithCallback(dipParams, async (event, data) => {
          // Update counters on each progress event
          if (event === 'mode_started') {
            counters.dip.modes_pending = counters.dip.modes_pending.filter(m => m !== data.mode);
          } else if (event === 'mode_completed') {
            counters.dip.modes_completed.push(data.mode);
            counters.dip.total_inserted += data.rows_inserted || 0;
            if (data.cache_creation_input_tokens) {
              counters.dip.cache_tokens.creation += data.cache_creation_input_tokens;
            }
            if (data.cache_read_input_tokens) {
              counters.dip.cache_tokens.read += data.cache_read_input_tokens;
            }
          } else if (event === 'mode_failed') {
            counters.dip.modes_failed.push({ mode: data.mode, error: data.error });
          }

          // Persist progress periodically
          try {
            await documentRepository.updateJobIngestState(jobId, { counters });
          } catch (e) {
            log.warn('Failed to persist DIP progress', { jobId, error: e.message });
          }
        });

        counters.dip.duration_ms = Date.now() - dipStart;
        counters.dip.modes_completed = dipResult.modes_completed;
        counters.dip.modes_failed = dipResult.modes_failed;
        counters.dip.modes_pending = [];
        counters.dip.total_inserted = dipResult.total_inserted;

        if (dipResult.error) {
          counters.dip.error = dipResult.error;
        }

        log.info('DIP stage complete', {
          jobId, docId,
          modesCompleted: dipResult.modes_completed.length,
          modesFailed: dipResult.modes_failed.length,
          totalInserted: dipResult.total_inserted
        });

      } catch (err) {
        log.error('DIP stage threw error', { jobId, docId, error: err.message });
        counters.dip.error = err.message;
        counters.dip.duration_ms = Date.now() - dipStart;
      }

      // Determine DIP status: partial if some modes failed, failed if ALL failed
      const allModesFailed = counters.dip.modes_completed.length === 0 &&
        counters.dip.modes_failed.length > 0;

      if (allModesFailed) {
        // All modes failed - but we don't stop the pipeline, just record it
        log.warn('All DIP modes failed', { jobId, docId });
        await documentRepository.updateJobIngestState(jobId, {
          statusV2: 'dip_partial',
          counters
        });
      } else if (counters.dip.modes_failed.length > 0) {
        // Partial success
        await documentRepository.updateJobIngestState(jobId, {
          statusV2: 'dip_partial',
          counters
        });
      }
    }

    // ========================================================================
    // Complete
    // ========================================================================
    await documentRepository.updateJobIngestState(jobId, {
      statusV2: 'completed',
      counters
    });

    // Update job DIP success flag
    const dipSuccess = !counters.dip?.skipped &&
      counters.dip?.modes_completed?.length > 0 &&
      counters.dip?.modes_failed?.length === 0;
    await documentRepository.updateJobDIPSuccess(jobId, dipSuccess);

    log.info('Ingest pipeline completed', { jobId, docId, counters });

    // Create user todo for ingest completion
    const filename = job.params.filename;
    try {
      await createUserTask({
        description: `Ingestion complete: ${filename || docId.substring(0, 16)} — ${counters.indexing?.chunks_created || 0} chunks, ${counters.dip?.modes_completed?.length || 0} DIP modes`,
        due_date: new Date().toISOString(),
        created_by: 'document_ingest',
        priority: 'normal',
        notes: JSON.stringify({
          type: 'ingest_complete',
          doc_id: docId,
          job_id: jobId,
          chunks_created: counters.indexing?.chunks_created,
          vectors_upserted: counters.indexing?.vectors_upserted,
          dip_modes: counters.dip?.modes_completed?.length
        })
      });
    } catch (todoErr) {
      log.warn('Failed to create ingest complete todo', { jobId, docId, error: todoErr.message });
    }

  } catch (err) {
    log.error('Ingest pipeline failed', { jobId, error: err.message, stack: err.stack });

    counters.error = {
      stage: 'unknown',
      message: err.message,
      timestamp: new Date().toISOString()
    };

    try {
      await documentRepository.updateJobIngestState(jobId, {
        statusV2: 'failed',
        counters,
        error: counters.error
      });

      // Create failure todo
      const job = await documentRepository.getJob(jobId);
      const filename = job?.params?.filename;
      await createUserTask({
        description: `Ingestion failed: ${filename || jobId.substring(0, 16)}`,
        due_date: new Date().toISOString(),
        created_by: 'document_ingest',
        priority: 'high',
        notes: JSON.stringify({
          type: 'ingest_failed',
          doc_id: job?.doc_id || jobId,
          job_id: jobId,
          error: err.message?.substring(0, 500)
        })
      });
    } catch (updateErr) {
      log.error('Failed to update job as failed', { jobId, error: updateErr.message });
    }
  } finally {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
  }
}

/**
 * Get the current status of an ingest job for a document
 *
 * @param {string} docId - Document ID
 * @returns {Promise<Object|null>} Job status or null if no job exists
 */
export async function getIngestStatus(docId) {
  const job = await documentRepository.getLatestIngestJobForDoc(docId);

  if (!job) {
    return null;
  }

  // Check staleness (>5 min since last heartbeat while running)
  const isRunning = ['queued', 'vision_running', 'vision_completed', 'vision_warning',
    'indexing_running', 'indexing_completed', 'dip_running'].includes(job.status_v2);
  let isStale = false;

  if (isRunning && job.last_heartbeat) {
    const lastHeartbeat = new Date(job.last_heartbeat).getTime();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    isStale = Date.now() - lastHeartbeat > staleThreshold;
  }

  return {
    job_id: job.job_id,
    doc_id: job.doc_id,
    status_v2: job.status_v2,
    status: job.status,
    counters: job.counters || {},
    error: job.error,
    is_stale: isStale,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
    last_heartbeat: job.last_heartbeat
  };
}

export default {
  startIngestRun,
  getIngestStatus
};
