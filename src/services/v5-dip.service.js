import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';
import documentRepository from '../repositories/document.repository.js';

/**
 * v5 DIP Service
 *
 * Orchestrates DIP (Document Intelligence Packet) extraction:
 * 1. Fetch document to get models_covered
 * 2. Call sidecar /v1/dip/run
 * 3. Return extraction results
 */

const log = logger.createRequestLogger();

/**
 * Get the Python sidecar URL
 */
function getSidecarUrl() {
  return getEnv().PYTHON_SIDECAR_URL || 'http://localhost:8000';
}

/**
 * Run v5 DIP extraction for a document
 *
 * @param {Object} params
 * @param {string} params.docId - Document ID
 * @param {string[]} params.selectedModels - User's installed primary model(s)
 * @param {string[]} [params.referencedSelections=[]] - User's selected referenced systems
 * @param {string[]} [params.modes] - DIP modes to run (default: all)
 * @param {boolean} [params.forceRerun=false] - If true, delete existing DIP rows first
 * @returns {Promise<Object>} DIP extraction results
 */
export async function runDipExtraction({
  docId,
  selectedModels,
  referencedSelections = [],
  modes = ['specs', 'troubleshooting', 'procedures', 'golden_rules', 'intent_router'],
  forceRerun = false
}) {
  const startTime = Date.now();
  const sidecarUrl = getSidecarUrl();

  log.info('Starting v5 DIP extraction', {
    docId,
    selectedModels,
    referencedSelections,
    modes,
    forceRerun
  });

  // ========================================================================
  // Step 1: Fetch document to get models_covered
  // ========================================================================
  let modelsCovered;
  try {
    const document = await documentRepository.getDocument(docId);

    if (!document) {
      log.error('Document not found', { docId });
      return {
        success: false,
        error_code: 'DOCUMENT_NOT_FOUND',
        error: `Document ${docId} not found in database`,
        total_inserted: 0,
        processing_time: Date.now() - startTime
      };
    }

    modelsCovered = document.models_covered;

    if (!modelsCovered || modelsCovered.length === 0) {
      log.error('Document missing models_covered', { docId });
      return {
        success: false,
        error_code: 'MODELS_COVERED_MISSING',
        error: 'Document is missing models_covered; rerun model detection before DIP.',
        total_inserted: 0,
        processing_time: Date.now() - startTime
      };
    }

    log.info('Using models_covered from document', { docId, modelsCovered });
  } catch (err) {
    log.error('Failed to fetch document', { docId, error: err.message });
    return {
      success: false,
      error_code: 'DB_ERROR',
      error: `Failed to fetch document: ${err.message}`,
      total_inserted: 0,
      processing_time: Date.now() - startTime
    };
  }

  // ========================================================================
  // Step 2: Call sidecar /v1/dip/run
  // ========================================================================
  try {
    log.info('Calling sidecar /v1/dip/run', { docId, modelsCovered, selectedModels, modes });

    const requestBody = {
      doc_id: docId,
      models_covered: modelsCovered,
      selected_models: selectedModels,
      referenced_selections: referencedSelections,
      modes: modes,
      force_rerun: forceRerun
    };

    // DIP extraction can take 5-30+ minutes for large documents
    // Use AbortController with 30-minute timeout to prevent indefinite hangs
    const DIP_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DIP_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(`${sidecarUrl}/v1/dip/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        log.error('DIP extraction timed out', { docId, timeoutMs: DIP_TIMEOUT_MS });
        return {
          success: false,
          error_code: 'DIP_TIMEOUT',
          error: `DIP extraction timed out after ${DIP_TIMEOUT_MS / 60000} minutes`,
          total_inserted: 0,
          processing_time: Date.now() - startTime
        };
      }
      throw err;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      log.error('Sidecar dip/run failed', { docId, status: response.status, error: errorText });
      return {
        success: false,
        error_code: 'SIDECAR_ERROR',
        error: `Sidecar returned ${response.status}: ${errorText}`,
        total_inserted: 0,
        processing_time: Date.now() - startTime
      };
    }

    const result = await response.json();

    if (!result.success) {
      log.error('Sidecar dip/run returned failure', { docId, error: result.error, error_code: result.error_code });
      return {
        success: false,
        error_code: result.error_code || 'DIP_FAILED',
        error: result.error || 'Unknown DIP error',
        modes_completed: result.modes_completed || [],
        modes_failed: result.modes_failed || [],
        results: result.results || [],
        total_extracted: result.total_extracted || 0,
        total_inserted: result.total_inserted || 0,
        processing_time: Date.now() - startTime
      };
    }

    log.info('v5 DIP extraction complete', {
      docId,
      modesCompleted: result.modes_completed,
      modesFailed: result.modes_failed,
      totalInserted: result.total_inserted
    });

    return {
      success: true,
      modes_requested: result.modes_requested,
      modes_completed: result.modes_completed,
      modes_failed: result.modes_failed,
      results: result.results,
      total_extracted: result.total_extracted,
      total_inserted: result.total_inserted,
      processing_time: Date.now() - startTime
    };

  } catch (err) {
    log.error('Failed to call sidecar', { docId, error: err.message });
    return {
      success: false,
      error_code: 'NETWORK_ERROR',
      error: `Failed to call sidecar: ${err.message}`,
      total_inserted: 0,
      processing_time: Date.now() - startTime
    };
  }
}

export default {
  runDipExtraction
};
