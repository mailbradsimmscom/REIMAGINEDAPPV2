import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

/**
 * DIP Stream Service
 *
 * Handles two-step DIP streaming:
 * 1. Store run params (POST) -> returns dip_run_id
 * 2. Stream SSE from sidecar (GET with dip_run_id)
 *
 * In-memory store with TTL for pending runs.
 */

const log = logger.createRequestLogger();

// In-memory store for pending DIP runs
// Key: dip_run_id, Value: { params, createdAt }
const pendingRuns = new Map();

// TTL for pending runs (10 minutes)
const RUN_TTL_MS = 10 * 60 * 1000;

// Cleanup interval (every 2 minutes)
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000;

// Start cleanup interval
setInterval(() => {
  const now = Date.now();
  for (const [runId, run] of pendingRuns.entries()) {
    if (now - run.createdAt > RUN_TTL_MS) {
      pendingRuns.delete(runId);
      log.debug('Cleaned up expired DIP run', { runId });
    }
  }
}, CLEANUP_INTERVAL_MS);

/**
 * Get the Python sidecar URL
 */
function getSidecarUrl() {
  return getEnv().PYTHON_SIDECAR_URL || 'http://localhost:8000';
}

/**
 * Generate a unique run ID
 */
function generateRunId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Store DIP run params and return a run ID
 *
 * @param {Object} params
 * @param {string} params.docId - Document ID
 * @param {string[]} params.selectedModels - User's selected primary models
 * @param {string[]} params.referencedSelections - User's selected referenced systems
 * @param {string[]} params.modelsCovered - All models the document covers
 * @param {string[]} [params.modes] - DIP modes to run
 * @param {boolean} [params.forceRerun] - Whether to delete existing DIP data first
 * @returns {string} dip_run_id
 */
export function storeDipRunParams({
  docId,
  selectedModels,
  referencedSelections = [],
  modelsCovered,
  modes = ['specs', 'troubleshooting', 'procedures', 'golden_rules', 'intent_router'],
  forceRerun = false
}) {
  const runId = generateRunId();

  pendingRuns.set(runId, {
    params: {
      doc_id: docId,
      models_covered: modelsCovered,
      selected_models: selectedModels,
      referenced_selections: referencedSelections,
      modes,
      force_rerun: forceRerun,
      stream: true  // Always stream when using this flow
    },
    createdAt: Date.now()
  });

  log.info('Stored DIP run params', { runId, docId, modes });
  return runId;
}

/**
 * Get stored run params by ID
 *
 * @param {string} runId
 * @returns {Object|null} params or null if not found/expired
 */
export function getDipRunParams(runId) {
  const run = pendingRuns.get(runId);
  if (!run) {
    return null;
  }

  // Check TTL
  if (Date.now() - run.createdAt > RUN_TTL_MS) {
    pendingRuns.delete(runId);
    return null;
  }

  return run.params;
}

/**
 * Remove run params after use
 *
 * @param {string} runId
 */
export function removeDipRunParams(runId) {
  pendingRuns.delete(runId);
}

/**
 * Stream DIP extraction from sidecar
 *
 * @param {string} runId - The run ID to look up params
 * @param {Object} res - Express response object (for SSE)
 * @param {AbortSignal} [signal] - Optional abort signal for client disconnect
 * @returns {Promise<void>}
 */
export async function streamDipExtraction(runId, res, signal) {
  const params = getDipRunParams(runId);

  if (!params) {
    // Send error SSE event
    res.write(`event: run_failed\ndata: ${JSON.stringify({
      error_code: 'RUN_NOT_FOUND',
      error: 'DIP run not found or expired. Please start a new run.'
    })}\n\n`);
    res.end();
    return;
  }

  const sidecarUrl = getSidecarUrl();
  const url = `${sidecarUrl}/v1/dip/run`;

  log.info('Starting DIP stream proxy', { runId, docId: params.doc_id });

  // 30-minute timeout - kept alive until stream completes or errors
  const DIP_TIMEOUT_MS = 30 * 60 * 1000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DIP_TIMEOUT_MS);

  // Combine with external signal if provided
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(params),
      signal: controller.signal
    });

    // NOTE: Do NOT clear timeout here - keep it alive through the entire stream

    if (!response.ok) {
      const errorText = await response.text();
      log.error('Sidecar DIP stream failed', { runId, status: response.status, error: errorText });
      res.write(`event: run_failed\ndata: ${JSON.stringify({
        error_code: 'SIDECAR_ERROR',
        error: `Sidecar returned ${response.status}: ${errorText}`
      })}\n\n`);
      res.end();
      return;
    }

    // Pipe the SSE stream from sidecar to client
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
    }

    // Stream completed successfully
    log.info('DIP stream completed', { runId });
    res.end();

  } catch (err) {
    if (err.name === 'AbortError') {
      // Check if it was timeout vs client disconnect
      const wasTimeout = !signal?.aborted;
      log.error('DIP stream aborted', { runId, wasTimeout });

      if (wasTimeout) {
        res.write(`event: run_failed\ndata: ${JSON.stringify({
          error_code: 'DIP_TIMEOUT',
          error: 'DIP extraction timed out after 30 minutes'
        })}\n\n`);
      }
      // If client disconnected, no point writing - they're gone
    } else {
      log.error('DIP stream error', { runId, error: err.message });
      res.write(`event: run_failed\ndata: ${JSON.stringify({
        error_code: 'STREAM_ERROR',
        error: err.message
      })}\n\n`);
    }

    res.end();
  } finally {
    // Always clean up timeout and params on all terminal paths
    clearTimeout(timeoutId);
    removeDipRunParams(runId);
  }
}

export default {
  storeDipRunParams,
  getDipRunParams,
  removeDipRunParams,
  streamDipExtraction
};
