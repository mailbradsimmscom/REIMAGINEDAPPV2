import { logger } from '../utils/logger.js';
import documentRepository from '../repositories/document.repository.js';
import { extractColloquialKeywordsV5 } from './colloquial-extraction.service.js';

const log = logger.createRequestLogger();

/**
 * v5 Colloquial Keywords Service
 *
 * Runs AFTER v5 indexing so it can use Pinecone content.
 * Updates systems.colloquial_keywords for the installed system.
 */
export async function runV5ColloquialKeywords({
  assetUid,
  docId,
  selectedModels
}) {
  const startTime = Date.now();

  if (!assetUid) {
    return {
      success: false,
      error: 'VALIDATION_ERROR',
      error_message: 'asset_uid is required'
    };
  }
  if (!docId) {
    return {
      success: false,
      error: 'VALIDATION_ERROR',
      error_message: 'doc_id is required'
    };
  }
  if (!Array.isArray(selectedModels) || selectedModels.length === 0) {
    return {
      success: false,
      error: 'VALIDATION_ERROR',
      error_message: 'selected_models is required and cannot be empty'
    };
  }

  try {
    log.info('Starting v5 colloquial keywords', { assetUid, docId, selectedModels });

    const result = await extractColloquialKeywordsV5({
      docId,
      selectedModels
    });

    if (!result.keywords || result.keywords.trim().length === 0) {
      log.warn('No colloquial keywords extracted (v5)', { assetUid, docId });
      return {
        success: true,
        keywords_saved: false,
        keywords_count: 0,
        processing_time: Date.now() - startTime
      };
    }

    await documentRepository.updateSystemColloquialKeywords(assetUid, result.keywords);

    // Ensure Manual_Local_Copy is set on the system
    await documentRepository.updateSystemManualFlag(assetUid, true);

    return {
      success: true,
      keywords_saved: true,
      keywords_count: result.stats?.colloquial_keywords_count || 0,
      processing_time: Date.now() - startTime
    };
  } catch (err) {
    log.warn('v5 colloquial keywords failed (non-fatal)', {
      assetUid,
      docId,
      error: err.message
    });
    return {
      success: false,
      error: 'COLLOQUIAL_FAILED',
      error_message: err.message,
      processing_time: Date.now() - startTime
    };
  }
}

export default { runV5ColloquialKeywords };

