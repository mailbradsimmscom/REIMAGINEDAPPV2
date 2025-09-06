/**
 * Document Text Extraction Service
 * Multi-source text extractor: DB chunks → Storage text → graceful fallback
 * Includes caching and performance monitoring
 */

import { logger } from '../utils/logger.js';
import documentRepository from '../repositories/document.repository.js';
import { getSupabaseStorageClient } from '../repositories/supabaseClient.js';

// Simple in-memory cache with TTL
const textCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100; // Max 100 documents in cache

// Performance metrics
const metrics = {
  totalRequests: 0,
  cacheHits: 0,
  dbHits: 0,
  storageHits: 0,
  failures: 0,
  avgResponseTime: 0
};

/**
 * Extract text preview from document using multiple sources
 * Priority: Cache → DB chunks → Storage → Empty fallback
 * 
 * @param {string} docId - Document ID
 * @param {Object} options - Extraction options
 * @param {number} options.maxPages - Maximum pages to extract (default: 6)
 * @param {boolean} options.useCache - Whether to use cache (default: true)
 * @returns {Promise<Object>} Text extraction result
 */
export async function extractTextPreview(docId, options = {}) {
  const startTime = Date.now();
  const requestLogger = logger.createRequestLogger();
  const { maxPages = 6, useCache = true } = options;
  
  metrics.totalRequests++;
  
  try {
    // 1. Check cache first
    if (useCache) {
      const cached = getFromCache(docId);
      if (cached) {
        metrics.cacheHits++;
        requestLogger.info('text_extraction.cache_hit', { docId, cachedAt: cached.timestamp });
        return {
          text: cached.text,
          source: 'cache',
          ocrConfidence: cached.ocrConfidence,
          tablesOk: cached.tablesOk,
          extractedAt: cached.timestamp,
          requestId: requestLogger.requestId
        };
      }
    }
    
    requestLogger.info('text_extraction.start', { docId, maxPages });
    
    // 2. Try database chunks (primary source)
    const dbResult = await extractFromDatabase(docId, maxPages, requestLogger);
    if (dbResult.success && dbResult.text?.trim()) {
      metrics.dbHits++;
      const result = {
        text: dbResult.text,
        source: 'database',
        ocrConfidence: null,
        tablesOk: null,
        extractedAt: new Date().toISOString(),
        requestId: requestLogger.requestId
      };
      
      // Cache the result
      if (useCache) {
        setCache(docId, result);
      }
      
      requestLogger.info('text_extraction.db_success', { 
        docId, 
        textLength: result.text.length,
        chunksUsed: dbResult.chunksUsed 
      });
      
      return result;
    }
    
    // 3. Try storage files (fallback)
    const storageResult = await extractFromStorage(docId, maxPages, requestLogger);
    if (storageResult.success && storageResult.text?.trim()) {
      metrics.storageHits++;
      const result = {
        text: storageResult.text,
        source: 'storage',
        ocrConfidence: storageResult.ocrConfidence,
        tablesOk: storageResult.tablesOk,
        extractedAt: new Date().toISOString(),
        requestId: requestLogger.requestId
      };
      
      // Cache the result
      if (useCache) {
        setCache(docId, result);
      }
      
      requestLogger.info('text_extraction.storage_success', { 
        docId, 
        textLength: result.text.length 
      });
      
      return result;
    }
    
    // 4. Graceful fallback - return empty but don't crash
    requestLogger.warn('text_extraction.no_sources', { 
      docId, 
      dbSuccess: dbResult.success,
      storageSuccess: storageResult.success 
    });
    
    const result = {
      text: '',
      source: 'none',
      ocrConfidence: null,
      tablesOk: null,
      extractedAt: new Date().toISOString(),
      requestId: requestLogger.requestId
    };
    
    return result;
    
  } catch (error) {
    metrics.failures++;
    requestLogger.error('text_extraction.error', { 
      docId, 
      error: error.message,
      stack: error.stack 
    });
    
    // Return empty result instead of crashing
    return {
      text: '',
      source: 'error',
      ocrConfidence: null,
      tablesOk: null,
      extractedAt: new Date().toISOString(),
      requestId: requestLogger.requestId,
      error: error.message
    };
  } finally {
    // Update performance metrics
    const duration = Date.now() - startTime;
    metrics.avgResponseTime = (metrics.avgResponseTime + duration) / 2;
    
    requestLogger.info('text_extraction.complete', { 
      docId, 
      duration,
      source: 'unknown' // Will be set by the calling code
    });
  }
}

/**
 * Extract text from database chunks
 * @param {string} docId - Document ID
 * @param {number} maxPages - Maximum pages to extract
 * @param {Object} requestLogger - Logger instance
 * @returns {Promise<Object>} Extraction result
 */
async function extractFromDatabase(docId, maxPages, requestLogger) {
  try {
    requestLogger.info('text_extraction.db_attempt', { docId, maxPages });
    
    // Get chunks from database
    const chunks = await documentRepository.getChunksByDocId(docId);
    
    if (!chunks || chunks.length === 0) {
      requestLogger.info('text_extraction.db_no_chunks', { docId });
      return { success: false, text: '', chunksUsed: 0 };
    }
    
    // Sort by page_start and limit to maxPages
    const sortedChunks = chunks
      .sort((a, b) => (a.page_start || 0) - (b.page_start || 0))
      .slice(0, maxPages * 10); // Assume ~10 chunks per page
    
    // Extract text content
    const textParts = sortedChunks
      .filter(chunk => chunk.text && chunk.text.trim())
      .map(chunk => chunk.text.trim())
      .filter(text => text.length > 0);
    
    if (textParts.length === 0) {
      requestLogger.info('text_extraction.db_no_text', { docId, totalChunks: chunks.length });
      return { success: false, text: '', chunksUsed: chunks.length };
    }
    
    const combinedText = textParts.join('\n\n');
    
    requestLogger.info('text_extraction.db_success', { 
      docId, 
      chunksUsed: textParts.length,
      totalChunks: chunks.length,
      textLength: combinedText.length 
    });
    
    return { 
      success: true, 
      text: combinedText,
      chunksUsed: textParts.length
    };
    
  } catch (error) {
    requestLogger.error('text_extraction.db_error', { 
      docId, 
      error: error.message 
    });
    return { success: false, text: '', chunksUsed: 0, error: error.message };
  }
}

/**
 * Extract text from storage files
 * @param {string} docId - Document ID
 * @param {number} maxPages - Maximum pages to extract
 * @param {Object} requestLogger - Logger instance
 * @returns {Promise<Object>} Extraction result
 */
async function extractFromStorage(docId, maxPages, requestLogger) {
  try {
    requestLogger.info('text_extraction.storage_attempt', { docId, maxPages });
    
    const storage = getSupabaseStorageClient();
    if (!storage) {
      requestLogger.warn('text_extraction.storage_unavailable', { docId });
      return { success: false, text: '', error: 'Storage unavailable' };
    }
    
    const BUCKET = 'documents';
    const base = `manuals/${docId}/text`;
    
    // Try preview file first
    try {
      const previewPath = `${base}/preview.txt`;
      const download = await storage.storage.from(BUCKET).download(previewPath);
      
      if (!download.error && download.data) {
        const text = await download.data.text();
        if (text?.trim()) {
          requestLogger.info('text_extraction.storage_preview_success', { 
            docId, 
            textLength: text.length 
          });
          return { 
            success: true, 
            text, 
            ocrConfidence: null, 
            tablesOk: null 
          };
        }
      }
    } catch (error) {
      requestLogger.debug('text_extraction.storage_preview_failed', { 
        docId, 
        error: error.message 
      });
    }
    
    // Try individual page files
    const pageTexts = [];
    for (let page = 1; page <= maxPages; page++) {
      try {
        const pagePath = `${base}/page-${page}.txt`;
        const download = await storage.storage.from(BUCKET).download(pagePath);
        
        if (!download.error && download.data) {
          const text = await download.data.text();
          if (text?.trim()) {
            pageTexts.push(text.trim());
          }
        }
      } catch (error) {
        requestLogger.debug('text_extraction.storage_page_failed', { 
          docId, 
          page, 
          error: error.message 
        });
        break; // Stop trying more pages if one fails
      }
    }
    
    if (pageTexts.length > 0) {
      const combinedText = pageTexts.join('\n\n');
      requestLogger.info('text_extraction.storage_pages_success', { 
        docId, 
        pagesFound: pageTexts.length,
        textLength: combinedText.length 
      });
      return { 
        success: true, 
        text: combinedText, 
        ocrConfidence: null, 
        tablesOk: null 
      };
    }
    
    requestLogger.info('text_extraction.storage_no_files', { docId });
    return { success: false, text: '', error: 'No text files found' };
    
  } catch (error) {
    requestLogger.error('text_extraction.storage_error', { 
      docId, 
      error: error.message 
    });
    return { success: false, text: '', error: error.message };
  }
}

/**
 * Get text from cache
 * @param {string} docId - Document ID
 * @returns {Object|null} Cached result or null
 */
function getFromCache(docId) {
  const cached = textCache.get(docId);
  if (!cached) return null;
  
  // Check if cache entry is expired
  if (Date.now() - cached.timestamp > CACHE_TTL) {
    textCache.delete(docId);
    return null;
  }
  
  return cached;
}

/**
 * Set text in cache
 * @param {string} docId - Document ID
 * @param {Object} result - Text extraction result
 */
function setCache(docId, result) {
  // Clean up cache if it's getting too large
  if (textCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = textCache.keys().next().value;
    textCache.delete(oldestKey);
  }
  
  textCache.set(docId, {
    text: result.text,
    ocrConfidence: result.ocrConfidence,
    tablesOk: result.tablesOk,
    timestamp: Date.now()
  });
}

/**
 * Get performance metrics
 * @returns {Object} Current metrics
 */
export function getTextExtractionMetrics() {
  return {
    ...metrics,
    cacheSize: textCache.size,
    cacheHitRate: metrics.totalRequests > 0 ? (metrics.cacheHits / metrics.totalRequests) : 0,
    successRate: metrics.totalRequests > 0 ? ((metrics.totalRequests - metrics.failures) / metrics.totalRequests) : 0
  };
}

/**
 * Clear cache
 */
export function clearTextCache() {
  textCache.clear();
  logger.info('text_extraction.cache_cleared', { cacheSize: textCache.size });
}

/**
 * Get cache statistics
 * @returns {Object} Cache stats
 */
export function getCacheStats() {
  const entries = Array.from(textCache.entries());
  const now = Date.now();
  
  return {
    size: textCache.size,
    maxSize: MAX_CACHE_SIZE,
    ttl: CACHE_TTL,
    entries: entries.map(([docId, data]) => ({
      docId,
      age: now - data.timestamp,
      textLength: data.text.length,
      isExpired: (now - data.timestamp) > CACHE_TTL
    }))
  };
}
