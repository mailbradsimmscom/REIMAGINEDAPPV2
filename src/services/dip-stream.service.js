import { logger } from '../utils/logger.js';
import { sidecarFetch } from '../utils/sidecar-fetch.js';
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
  aliasMap = {},
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
      alias_map: aliasMap,
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

  log.info('Starting DIP stream proxy', { runId, docId: params.doc_id });

  try {
    const response = await sidecarFetch('/v1/dip/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(params),
      timeout: 30 * 60 * 1000, // 30 min
      signal
    });

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
    const decoder = new TextDecoder();

    for await (const value of response.body) {
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
    }

    // Stream completed successfully
    log.info('DIP stream completed', { runId });
    res.end();

  } catch (err) {
    if (err.code === 'SIDECAR_TIMEOUT') {
      log.error('DIP stream timed out', { runId });
      res.write(`event: run_failed\ndata: ${JSON.stringify({
        error_code: 'DIP_TIMEOUT',
        error: 'DIP extraction timed out after 30 minutes'
      })}\n\n`);
    } else if (err.message === 'Aborted') {
      // Client disconnected — no point writing, they're gone
      log.error('DIP stream aborted (client disconnect)', { runId });
    } else {
      log.error('DIP stream error', { runId, error: err.message });
      res.write(`event: run_failed\ndata: ${JSON.stringify({
        error_code: 'STREAM_ERROR',
        error: err.message
      })}\n\n`);
    }

    res.end();
  } finally {
    removeDipRunParams(runId);
  }
}

/**
 * Run DIP extraction with callback for progress updates (used by background runner)
 *
 * @param {Object} params - DIP params (doc_id, models_covered, selected_models, etc.)
 * @param {Function} onProgress - Callback for progress updates: (event, data) => void
 *   Events: 'mode_started', 'mode_completed', 'mode_failed', 'run_completed', 'run_failed'
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<Object>} Final result with modes_completed, modes_failed, total_inserted
 */
export async function runDipWithCallback(params, onProgress, signal) {
  log.info('Starting DIP extraction with callback', { docId: params.doc_id, modes: params.modes });

  const result = {
    success: false,
    modes_completed: [],
    modes_failed: [],
    modes_pending: [...(params.modes || [])],
    total_inserted: 0,
    cache_tokens: { creation: 0, read: 0 },
    error: null
  };

  try {
    const response = await sidecarFetch('/v1/dip/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({ ...params, stream: true }),
      timeout: 30 * 60 * 1000, // 30 min
      signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('Sidecar DIP failed', { status: response.status, error: errorText });
      result.error = `Sidecar returned ${response.status}: ${errorText}`;
      if (onProgress) onProgress('run_failed', { error: result.error });
      return result;
    }

    // Parse SSE events
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const value of response.body) {
      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      let currentEvent = null;
      let currentData = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6);
        } else if (line === '' && currentEvent && currentData) {
          // End of event - process it
          try {
            const data = JSON.parse(currentData);
            processSSEEvent(currentEvent, data, result, onProgress);
          } catch (e) {
            log.warn('Failed to parse SSE data', { event: currentEvent, error: e.message });
          }
          currentEvent = null;
          currentData = '';
        }
      }
    }

    // Process any remaining buffered event
    if (buffer.trim()) {
      const lines = buffer.split('\n');
      let currentEvent = null;
      let currentData = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) currentEvent = line.slice(7).trim();
        else if (line.startsWith('data: ')) currentData = line.slice(6);
      }
      if (currentEvent && currentData) {
        try {
          const data = JSON.parse(currentData);
          processSSEEvent(currentEvent, data, result, onProgress);
        } catch (e) { /* ignore */ }
      }
    }

    // Determine success based on modes
    result.success = result.modes_completed.length > 0 || result.modes_failed.length === 0;
    log.info('DIP extraction completed', {
      docId: params.doc_id,
      modesCompleted: result.modes_completed,
      modesFailed: result.modes_failed,
      totalInserted: result.total_inserted
    });

    return result;

  } catch (err) {
    if (err.message === 'Aborted') {
      log.info('DIP extraction aborted', { docId: params.doc_id });
      result.error = 'Aborted';
    } else {
      log.error('DIP extraction error', { docId: params.doc_id, error: err.message });
      result.error = err.message;
    }
    if (onProgress) onProgress('run_failed', { error: result.error });
    return result;
  }
}

/**
 * Process an SSE event and update result/call callback
 */
function processSSEEvent(event, data, result, onProgress) {
  switch (event) {
    case 'mode_started':
      // Remove from pending
      result.modes_pending = result.modes_pending.filter(m => m !== data.mode);
      if (onProgress) onProgress('mode_started', data);
      break;

    case 'mode_completed':
      result.modes_completed.push(data.mode);
      result.modes_pending = result.modes_pending.filter(m => m !== data.mode);
      result.total_inserted += data.rows_inserted || 0;
      if (data.cache_creation_input_tokens) {
        result.cache_tokens.creation += data.cache_creation_input_tokens;
      }
      if (data.cache_read_input_tokens) {
        result.cache_tokens.read += data.cache_read_input_tokens;
      }
      if (onProgress) onProgress('mode_completed', data);
      break;

    case 'mode_failed':
      result.modes_failed.push({ mode: data.mode, error: data.error || 'Unknown error' });
      result.modes_pending = result.modes_pending.filter(m => m !== data.mode);
      if (onProgress) onProgress('mode_failed', data);
      break;

    case 'run_completed':
      // Final summary - update totals if provided
      if (data.total_inserted !== undefined) {
        result.total_inserted = data.total_inserted;
      }
      if (onProgress) onProgress('run_completed', data);
      break;

    case 'run_failed':
      result.error = data.error || 'DIP run failed';
      if (onProgress) onProgress('run_failed', data);
      break;

    default:
      // Unknown event - log but don't fail
      log.debug('Unknown DIP SSE event', { event, data });
  }
}

export default {
  storeDipRunParams,
  getDipRunParams,
  removeDipRunParams,
  streamDipExtraction,
  runDipWithCallback
};
