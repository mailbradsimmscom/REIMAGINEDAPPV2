import FormData from 'form-data';
import { logger } from '../utils/logger.js';
import documentRepository from '../repositories/document.repository.js';
import { getSupabaseStorageClient } from '../repositories/supabaseClient.js';
import { sidecarFetch } from '../utils/sidecar-fetch.js';
import { fetchDetectionReferenceData } from './document-ingest.service.js';
import { createUserTask } from '../repositories/user-tasks.repository.js';

/**
 * v5 Parse-Detect Runner Service
 *
 * Orchestrates background PDF parsing + model detection:
 * 1. Download PDF from Supabase Storage
 * 2. Parse via sidecar /v1/llamaparse (up to 15min)
 * 3. Detect models via sidecar /v1/detect-models-v2 (up to 15min)
 * 4. Store detection_result in documents table
 * 5. Create user todo for review
 *
 * Follows the same pattern as v5-ingest-runner.service.js:
 * - setImmediate() for non-blocking background execution
 * - Heartbeat updates every 30s
 * - Status tracking via jobs.status_v2
 */

const log = logger.createRequestLogger();

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

// Sidecar timeouts (15 minutes each — large docs can take a while)
const LLAMAPARSE_TIMEOUT_MS = 15 * 60 * 1000;
const DETECT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Start a background parse+detect run for a document.
 * Creates a job, returns immediately, kicks off pipeline via setImmediate().
 *
 * @param {Object} params
 * @param {string} params.docId - Document ID (SHA256 hash)
 * @param {string} params.storagePath - Supabase Storage path to PDF
 * @param {string} params.filename - Original filename
 * @returns {Promise<Object>} { success, job_id, doc_id, status_v2 } or { success: false, error }
 */
export async function startParseDetectRun({ docId, storagePath, filename }) {
  log.info('Starting parse-detect run', { docId, storagePath, filename });

  // Check for existing active job
  const existingJob = await documentRepository.getActiveParseDetectJobForDoc(docId);
  if (existingJob) {
    log.warn('Active parse-detect job already exists for document', {
      docId,
      existingJobId: existingJob.job_id,
      existingStatus: existingJob.status_v2
    });
    return {
      success: false,
      error: 'ACTIVE_JOB_EXISTS',
      message: 'A parse/detect job is already running for this document',
      existing_job_id: existingJob.job_id,
      existing_status: existingJob.status_v2
    };
  }

  // Create job record
  const jobData = {
    doc_id: docId,
    job_type: 'v5_parse_detect',
    status: 'queued',
    status_v2: 'queued',
    params: {
      doc_id: docId,
      storage_path: storagePath,
      filename
    },
    counters: {},
    last_heartbeat: new Date().toISOString()
  };

  const job = await documentRepository.createJob(jobData);
  const jobId = job.job_id;

  log.info('Parse-detect job created', { jobId, docId });

  // Start background execution
  setImmediate(() => {
    runParseDetectPipeline(jobId).catch(err => {
      log.error('Parse-detect pipeline unhandled error', { jobId, error: err.message });
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
 * Run the parse+detect pipeline (called in background via setImmediate)
 */
async function runParseDetectPipeline(jobId) {
  let heartbeatInterval = null;
  const counters = { parse: null, detect: null, error: null };

  try {
    // Get job details
    const job = await documentRepository.getJob(jobId);
    if (!job) {
      log.error('Job not found', { jobId });
      return;
    }

    const { doc_id: docId, storage_path: storagePath, filename } = job.params;

    log.info('Running parse-detect pipeline', { jobId, docId, filename });

    // Start heartbeat
    heartbeatInterval = setInterval(async () => {
      try {
        await documentRepository.updateJobHeartbeat(jobId);
      } catch (err) {
        log.warn('Heartbeat update failed', { jobId, error: err.message });
      }
    }, HEARTBEAT_INTERVAL_MS);

    // ========================================================================
    // Stage 1: Download PDF from Supabase Storage
    // ========================================================================
    let fileBuffer;
    try {
      const storage = await getSupabaseStorageClient();
      const { data, error } = await storage.storage.from('documents').download(storagePath);

      if (error) throw error;
      if (!data) throw new Error('No data returned from storage download');

      fileBuffer = Buffer.from(await data.arrayBuffer());
      log.info('PDF downloaded from storage', { jobId, docId, fileSize: fileBuffer.length });
    } catch (err) {
      log.error('Failed to download PDF from storage', { jobId, docId, storagePath, error: err.message });

      counters.error = {
        stage: 'download',
        message: `Failed to download PDF: ${err.message}`,
        timestamp: new Date().toISOString()
      };

      await documentRepository.updateJobIngestState(jobId, {
        statusV2: 'failed',
        counters,
        error: counters.error
      });

      // Create failure todo
      await createFailureTodo(docId, filename, 'parse_failed', 'PDF download failed');
      return;
    }

    // ========================================================================
    // Stage 2: Parse (LlamaParse)
    // ========================================================================
    await documentRepository.updateJobIngestState(jobId, {
      statusV2: 'parsing',
      counters
    });

    const parseStart = Date.now();
    let parseResult;

    try {
      const form = new FormData();
      form.append('file', fileBuffer, { filename, contentType: 'application/pdf' });

      const parseResponse = await sidecarFetch(`/v1/llamaparse?doc_id=${encodeURIComponent(docId)}`, {
        method: 'POST',
        headers: form.getHeaders(),
        body: form.getBuffer(),
        timeout: LLAMAPARSE_TIMEOUT_MS
      });

      if (!parseResponse.ok) {
        const errorText = await parseResponse.text();
        throw new Error(`LlamaParse returned ${parseResponse.status}: ${errorText}`);
      }

      parseResult = await parseResponse.json();

      counters.parse = {
        content_length: parseResult.text?.length || 0,
        sections_count: parseResult.sections?.length || 0,
        duration_ms: Date.now() - parseStart
      };

      log.info('Parse stage complete', {
        jobId, docId,
        contentLength: counters.parse.content_length,
        durationMs: counters.parse.duration_ms
      });

    } catch (err) {
      log.error('Parse stage failed', { jobId, docId, error: err.message });

      counters.parse = {
        error: err.message,
        duration_ms: Date.now() - parseStart
      };
      counters.error = {
        stage: 'parsing',
        message: err.message,
        timestamp: new Date().toISOString()
      };

      await documentRepository.updateJobIngestState(jobId, {
        statusV2: 'failed',
        counters,
        error: counters.error
      });

      await createFailureTodo(docId, filename, 'parse_failed', err.message);
      return;
    }

    // Free the file buffer — no longer needed after parse
    fileBuffer = null;

    // Update counters after successful parse
    await documentRepository.updateJobIngestState(jobId, {
      statusV2: 'detecting',
      counters
    });

    // ========================================================================
    // Stage 3: Detect Models
    // ========================================================================
    const detectStart = Date.now();

    try {
      // Fetch reference data from DB
      const referenceData = await fetchDetectionReferenceData();

      // Call sidecar detect-models-v2 with markdown from parse stage
      const detectBody = {
        markdown: parseResult.text,
        doc_id: docId,
        filename,
        reference_data: referenceData
      };

      const detectResponse = await sidecarFetch('/v1/detect-models-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(detectBody),
        timeout: DETECT_TIMEOUT_MS
      });

      if (!detectResponse.ok) {
        const errorText = await detectResponse.text();
        throw new Error(`Model detection returned ${detectResponse.status}: ${errorText}`);
      }

      const detectResult = await detectResponse.json();

      // Sidecar does NOT return reference_data — attach it for the stored result
      const fullDetectionResult = {
        ...detectResult,
        reference_data: referenceData
      };

      // Store detection result in documents table
      await documentRepository.saveDetectionResult(docId, fullDetectionResult);

      // Count detected models for counters
      const primaryCount = detectResult.primary_family?.members?.length ||
        detectResult.primary_models?.length || 0;
      const referencedCount = detectResult.referenced_products?.length || 0;

      counters.detect = {
        confidence: detectResult.confidence,
        primary_count: primaryCount,
        referenced_count: referencedCount,
        duration_ms: Date.now() - detectStart
      };

      log.info('Detect stage complete', {
        jobId, docId,
        confidence: detectResult.confidence,
        primaryCount,
        referencedCount,
        durationMs: counters.detect.duration_ms
      });

      // ========================================================================
      // Stage 4: Complete — create todo for user review
      // ========================================================================
      await documentRepository.updateJobIngestState(jobId, {
        statusV2: 'detection_complete',
        counters
      });

      // Create user todo for model selection review
      try {
        await createUserTask({
          description: `Review model selection: ${filename}`,
          due_date: new Date().toISOString(),
          created_by: 'document_ingest',
          priority: 'high',
          notes: JSON.stringify({
            type: 'detection_complete',
            doc_id: docId,
            job_id: jobId,
            confidence: detectResult.confidence,
            primary_count: primaryCount,
            referenced_count: referencedCount
          })
        });

        log.info('Detection complete todo created', { jobId, docId });
      } catch (todoErr) {
        // Todo creation failure is non-fatal
        log.warn('Failed to create detection complete todo', { jobId, docId, error: todoErr.message });
      }

      log.info('Parse-detect pipeline completed', { jobId, docId, counters });

    } catch (err) {
      log.error('Detect stage failed', { jobId, docId, error: err.message });

      counters.detect = {
        error: err.message,
        duration_ms: Date.now() - detectStart
      };
      counters.error = {
        stage: 'detecting',
        message: err.message,
        timestamp: new Date().toISOString()
      };

      await documentRepository.updateJobIngestState(jobId, {
        statusV2: 'failed',
        counters,
        error: counters.error
      });

      await createFailureTodo(docId, filename, 'detect_failed', err.message);
    }

  } catch (err) {
    log.error('Parse-detect pipeline failed', { jobId, error: err.message, stack: err.stack });

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
 * Get the current status of a parse-detect job for a document
 *
 * @param {string} docId - Document ID
 * @returns {Promise<Object|null>} Job status or null if no job exists
 */
export async function getParseDetectStatus(docId) {
  const job = await documentRepository.getLatestParseDetectJobForDoc(docId);

  if (!job) {
    return null;
  }

  // Check staleness (>5 min since last heartbeat while running)
  const isRunning = ['queued', 'parsing', 'parse_complete', 'detecting'].includes(job.status_v2);
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

/**
 * Create a failure todo for parse/detect errors
 */
async function createFailureTodo(docId, filename, type, errorMessage) {
  try {
    await createUserTask({
      description: `${type === 'parse_failed' ? 'Parse' : 'Detection'} failed: ${filename}`,
      due_date: new Date().toISOString(),
      created_by: 'document_ingest',
      priority: 'high',
      notes: JSON.stringify({
        type,
        doc_id: docId,
        error: errorMessage?.substring(0, 500) // Truncate long errors
      })
    });
  } catch (todoErr) {
    log.warn('Failed to create failure todo', { docId, type, error: todoErr.message });
  }
}

export default {
  startParseDetectRun,
  getParseDetectStatus
};
