import { logger } from '../utils/logger.js';
import { sidecarFetch } from '../utils/sidecar-fetch.js';

/**
 * DIP Stream Service
 *
 * Provides runDipWithCallback for the background ingest runner.
 * SSE infrastructure (storeDipRunParams, getDipRunParams, streamDipExtraction,
 * pendingRuns Map, cleanup interval) removed — DIP now runs only via
 * v5-ingest-runner using runDipWithCallback directly.
 */

const log = logger.createRequestLogger();

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
      log.debug('Unknown DIP SSE event', { event, data });
  }
}

export default {
  runDipWithCallback
};
