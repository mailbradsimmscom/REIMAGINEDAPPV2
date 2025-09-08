// src/services/pinecone-retrieval.service.js
// Pinecone vector search service with spec-biased retrieval

import pineconeService from './pinecone.service.js';
import { filterSpecLike } from '../utils/specFilter.js';
import { rerankChunks } from './rerank.service.js';
import { logger } from '../utils/logger.js';

/**
 * Perform spec-biased retrieval from Pinecone
 * @param {Object} params - Retrieval parameters
 * @param {string} params.query - The search query
 * @param {string} params.namespace - Pinecone namespace
 * @param {Object} params.context - Additional context
 * @returns {Promise<Object>} - Retrieval results with metadata
 */
export async function retrieveWithSpecBias({ query, namespace, context = {} }) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    requestLogger.info('🔍 [PINECONE RETRIEVAL] Starting spec-biased retrieval', { 
      query: query.substring(0, 100),
      namespace: namespace || 'default'
    });
    
    const { getEnv } = await import('../config/env.js');
    const env = getEnv();
    const topK = 40; // widen recall
    const floor = Number(env.SEARCH_RANK_FLOOR ?? 0.50);

    // 1) Wide recall from Pinecone
    const searchContext = {
      manufacturer: context.manufacturer || null,
      model: context.model || null,
      previousMessages: context.previousMessages || []
    };
    
    const pineconeResponse = await pineconeService.searchDocuments(query, searchContext);
    const results = pineconeResponse?.results || [];
    
    // Extract chunks from grouped results
    const hits = results.flatMap(result => result.chunks || []);
    const rawCount = hits.length;

    requestLogger.info('🔍 [PINECONE RETRIEVAL] Raw Pinecone results', { 
      resultsCount: results.length,
      hitsCount: hits.length
    });

    // 2) Apply dense score floor
    const passedFloor = hits.filter(h => (h.score ?? 0) >= floor);
    
    requestLogger.info('🔍 [PINECONE RETRIEVAL] Passed floor filtering', { 
      passedFloorCount: passedFloor.length,
      floor
    });

    // 3) Regex post-filter for spec-like chunks
    const specy = await filterSpecLike(passedFloor);
    
    requestLogger.info('🔍 [PINECONE RETRIEVAL] Spec filtering applied', { 
      specFilteredCount: specy.length
    });

    // 4) Fallback if none survived spec filter
    const pool = specy.length ? specy : passedFloor;

    // 5) Tiny LLM rerank (small set only)
    const reranked = await rerankChunks(query, pool);

    // 6) Take top few for answer assembly
    const finalists = reranked.slice(0, Math.min(5, pool.length));
    
    requestLogger.info('🔍 [PINECONE RETRIEVAL] Final results', { 
      finalistsCount: finalists.length
    });

    // 7) Return with observability
    const result = {
      finalists,
      meta: {
        rawCount,
        passedFloorCount: passedFloor.length,
        filteredCount: specy.length,
        usedFallback: specy.length === 0,
        floor,
        topK,
        retrievalMethod: 'pinecone-spec-bias'
      },
    };

    requestLogger.info('✅ [PINECONE RETRIEVAL] Spec-biased retrieval completed', result.meta);
    return result;

  } catch (error) {
    requestLogger.error('❌ [PINECONE RETRIEVAL] Spec-biased retrieval failed', { 
      error: error.message,
      query: query.substring(0, 100)
    });
    
    // Fallback to empty results
    const { getEnv } = await import('../config/env.js');
    const env = getEnv();
    return {
      finalists: [],
      meta: {
        rawCount: 0,
        passedFloorCount: 0,
        filteredCount: 0,
        usedFallback: true,
        floor: Number(env.SEARCH_RANK_FLOOR ?? 0.50),
        topK: 40,
        error: error.message,
        retrievalMethod: 'pinecone-error'
      }
    };
  }
}

/**
 * Perform standard Pinecone search without spec bias
 * @param {Object} params - Search parameters
 * @param {string} params.query - The search query
 * @param {Object} params.context - Search context
 * @returns {Promise<Object>} - Search results
 */
export async function searchDocuments(query, context = {}) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    requestLogger.info('🔍 [PINECONE RETRIEVAL] Standard search', { 
      query: query.substring(0, 100)
    });
    
    const searchContext = {
      manufacturer: context.manufacturer || null,
      model: context.model || null,
      previousMessages: context.previousMessages || []
    };
    
    const response = await pineconeService.searchDocuments(query, searchContext);
    
    requestLogger.info('✅ [PINECONE RETRIEVAL] Standard search completed', { 
      resultsCount: response?.results?.length || 0
    });
    
    return response;
  } catch (error) {
    requestLogger.error('❌ [PINECONE RETRIEVAL] Standard search failed', { 
      error: error.message,
      query: query.substring(0, 100)
    });
    throw error;
  }
}
