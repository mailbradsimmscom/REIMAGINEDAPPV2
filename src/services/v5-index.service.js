import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';
import documentRepository from '../repositories/document.repository.js';

/**
 * v5 Index Service
 *
 * Orchestrates document indexing with v5 model tagging:
 * 1. Fetch document to get models_covered
 * 2. Call sidecar /v1/index-document
 * 3. Return indexing results
 */

const log = logger.createRequestLogger();

/**
 * Get the Python sidecar URL
 */
function getSidecarUrl() {
  return getEnv().PYTHON_SIDECAR_URL || 'http://localhost:8000';
}

/**
 * Run v5 indexing for a document
 *
 * @param {Object} params
 * @param {string} params.docId - Document ID
 * @param {string[]} params.selectedModels - User's installed primary model(s)
 * @param {string[]} [params.referencedSelections=[]] - User's selected referenced systems
 * @param {boolean} [params.forceReindex=false] - If true, delete existing chunks first
 * @returns {Promise<Object>} Indexing results
 */
export async function runV5Indexing({
  docId,
  selectedModels,
  referencedSelections = [],
  forceReindex = false
}) {
  const startTime = Date.now();
  const sidecarUrl = getSidecarUrl();

  log.info('Starting v5 indexing', {
    docId,
    selectedModels,
    referencedSelections,
    forceReindex
  });

  // ========================================================================
  // Step 1: Fetch document to get models_covered and filename
  // ========================================================================
  let modelsCovered;
  let filename;
  try {
    const document = await documentRepository.getDocument(docId);

    if (!document) {
      log.error('Document not found', { docId });
      return {
        success: false,
        error: 'DOCUMENT_NOT_FOUND',
        error_message: `Document ${docId} not found in database`,
        chunks_created: 0,
        vectors_upserted: 0,
        processing_time: Date.now() - startTime
      };
    }

    modelsCovered = document.models_covered;
    filename = document.filename || 'document.pdf';

    if (!modelsCovered || modelsCovered.length === 0) {
      log.error('Document missing models_covered', { docId });
      return {
        success: false,
        error: 'MODELS_COVERED_MISSING',
        error_message: 'Document is missing models_covered; rerun model detection before indexing.',
        chunks_created: 0,
        vectors_upserted: 0,
        processing_time: Date.now() - startTime
      };
    }

    log.info('Using models_covered from document', { docId, modelsCovered, filename });
  } catch (err) {
    log.error('Failed to fetch document', { docId, error: err.message });
    return {
      success: false,
      error: 'DB_ERROR',
      error_message: `Failed to fetch document: ${err.message}`,
      chunks_created: 0,
      vectors_upserted: 0,
      processing_time: Date.now() - startTime
    };
  }

  // ========================================================================
  // Step 2: Call sidecar /v1/index-document
  // ========================================================================
  try {
    log.info('Calling sidecar /v1/index-document', { docId, modelsCovered, selectedModels });

    const requestBody = {
      doc_id: docId,
      models_covered: modelsCovered,
      selected_models: selectedModels,
      referenced_selections: referencedSelections,
      filename: filename,
      force_reindex: forceReindex
    };

    const response = await fetch(`${sidecarUrl}/v1/index-document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('Sidecar index-document failed', { docId, status: response.status, error: errorText });
      return {
        success: false,
        error: 'SIDECAR_ERROR',
        error_message: `Sidecar returned ${response.status}: ${errorText}`,
        chunks_created: 0,
        vectors_upserted: 0,
        processing_time: Date.now() - startTime
      };
    }

    const result = await response.json();

    if (!result.success) {
      log.error('Sidecar index-document returned failure', { docId, error: result.error, error_code: result.error_code });
      return {
        success: false,
        error: result.error_code || 'INDEXING_FAILED',
        error_message: result.error || 'Unknown indexing error',
        chunks_created: result.chunks_created || 0,
        vectors_upserted: result.vectors_upserted || 0,
        processing_time: Date.now() - startTime
      };
    }

    log.info('v5 indexing complete', {
      docId,
      chunksCreated: result.chunks_created,
      vectorsUpserted: result.vectors_upserted,
      totalTokens: result.total_tokens
    });

    return {
      success: true,
      chunks_created: result.chunks_created,
      chunks_skipped: result.chunks_skipped,
      vectors_upserted: result.vectors_upserted,
      total_tokens: result.total_tokens,
      statistics: result.statistics,
      processing_time: Date.now() - startTime
    };

  } catch (err) {
    log.error('Failed to call sidecar', { docId, error: err.message });
    return {
      success: false,
      error: 'NETWORK_ERROR',
      error_message: `Failed to call sidecar: ${err.message}`,
      chunks_created: 0,
      vectors_upserted: 0,
      processing_time: Date.now() - startTime
    };
  }
}

export default {
  runV5Indexing
};
