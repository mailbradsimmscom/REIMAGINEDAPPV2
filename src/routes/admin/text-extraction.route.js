/**
 * Admin Text Extraction Metrics Route
 * Provides endpoints to monitor text extraction performance and cache status
 */

import { Router } from 'express';
import { logger } from '../../utils/logger.js';
import { 
  getTextExtractionMetrics, 
  getCacheStats, 
  clearTextCache 
} from '../../services/document-text.service.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { EnvelopeSchema } from '../../schemas/envelope.schema.js';

const router = Router();

// Add validateResponse middleware
router.use(validateResponse(EnvelopeSchema));

/**
 * GET /admin/text-extraction/metrics
 * Get text extraction performance metrics
 */
router.get('/metrics', async (req, res, next) => {
  try {
    const requestLogger = logger.createRequestLogger();
    requestLogger.info('text_extraction.metrics_requested');
    
    const metrics = getTextExtractionMetrics();
    
    res.json({
      success: true,
      data: {
        ...metrics,
        timestamp: new Date().toISOString()
      },
      requestId: requestLogger.requestId
    });
    
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/text-extraction/cache
 * Get cache statistics and status
 */
router.get('/cache', async (req, res, next) => {
  try {
    const requestLogger = logger.createRequestLogger();
    requestLogger.info('text_extraction.cache_stats_requested');
    
    const cacheStats = getCacheStats();
    
    res.json({
      success: true,
      data: {
        ...cacheStats,
        timestamp: new Date().toISOString()
      },
      requestId: requestLogger.requestId
    });
    
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /admin/text-extraction/cache
 * Clear the text extraction cache
 */
router.delete('/cache', async (req, res, next) => {
  try {
    const requestLogger = logger.createRequestLogger();
    requestLogger.info('text_extraction.cache_clear_requested');
    
    clearTextCache();
    
    res.json({
      success: true,
      data: {
        message: 'Cache cleared successfully',
        timestamp: new Date().toISOString()
      },
      requestId: requestLogger.requestId
    });
    
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/text-extraction/health
 * Get overall health status of text extraction service
 */
router.get('/health', async (req, res, next) => {
  try {
    const requestLogger = logger.createRequestLogger();
    requestLogger.info('text_extraction.health_check_requested');
    
    const metrics = getTextExtractionMetrics();
    const cacheStats = getCacheStats();
    
    // Determine health status
    const isHealthy = metrics.successRate > 0.8; // 80% success rate threshold
    const cacheHealthy = cacheStats.size < cacheStats.maxSize * 0.9; // 90% capacity threshold
    
    const health = {
      status: isHealthy && cacheHealthy ? 'healthy' : 'degraded',
      metrics: {
        successRate: metrics.successRate,
        avgResponseTime: metrics.avgResponseTime,
        totalRequests: metrics.totalRequests
      },
      cache: {
        size: cacheStats.size,
        maxSize: cacheStats.maxSize,
        utilization: (cacheStats.size / cacheStats.maxSize) * 100
      },
      timestamp: new Date().toISOString()
    };
    
    res.json({
      success: true,
      data: health,
      requestId: requestLogger.requestId
    });
    
  } catch (error) {
    next(error);
  }
});

export default router;
