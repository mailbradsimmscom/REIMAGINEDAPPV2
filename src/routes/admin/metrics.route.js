import express from 'express';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { AdminMetricsEnvelope } from '../../schemas/admin.schema.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { getRequestMetrics } from '../../middleware/requestLogging.js';
import { logger } from '../../utils/logger.js';
import { metrics as metricsUtils } from '../../utils/metrics.js';
import { z } from 'zod';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// Apply response validation to all routes in this file
router.use(validateResponse(AdminMetricsEnvelope));

// Admin metrics query schema
const adminMetricsQuerySchema = z.object({
  timeframe: z.enum(['5m', '15m', '1h', '24h']).default('15m'),
  limit: z.coerce.number().int().min(1).max(1000).default(100)
}).passthrough();

// GET /admin/metrics - Get aggregated metrics
router.get('/', 
  validate(adminMetricsQuerySchema, 'query'),
  async (req, res, next) => {
  try {
    const requestLogger = logger.createRequestLogger();
    const { timeframe = '15m', limit = 100 } = req.query;
    
    // Get real request metrics
    const requestMetrics = getRequestMetrics(timeframe);
    
    // Get fuzzy matching and context rewrite metrics
    const dashboardMetrics = metricsUtils.getDashboardMetrics();
    
    const metricsData = {
      timeframe,
      windowStart: requestMetrics.windowStart,
      windowEnd: requestMetrics.windowEnd,
      
      // Chat Health Metrics (from real request data)
      chatHealth: {
        totalRequests: requestMetrics.totalRequests,
        requestsPerMinute: requestMetrics.requestsPerMinute,
        p95Latency: requestMetrics.p95Latency,
        errorRate: requestMetrics.errorRate,
        errorCount: requestMetrics.errorCount,
        successCount: requestMetrics.successCount
      },
      
      // Fuzzy Matching & Context Rewrite Metrics (from our new metrics system)
      fuzzyMatching: {
        maintenanceDetection: {
          totalOperations: dashboardMetrics.maintenance_detection.total_questions,
          successRate: dashboardMetrics.maintenance_detection.success_rate,
          avgDuration: dashboardMetrics.maintenance_detection.avg_duration,
          performanceScore: dashboardMetrics.maintenance_detection.performance_score,
          fuzzyMatches: dashboardMetrics.maintenance_detection.fuzzy_matches,
          exactMatches: dashboardMetrics.maintenance_detection.exact_matches
        },
        unitsNormalization: {
          totalOperations: dashboardMetrics.units_normalization.total_operations,
          successRate: dashboardMetrics.units_normalization.success_rate,
          avgDuration: dashboardMetrics.units_normalization.avg_duration,
          performanceScore: dashboardMetrics.units_normalization.performance_score,
          fuzzySuccessRate: dashboardMetrics.units_normalization.fuzzy_success_rate
        },
        contextRewrite: {
          totalOperations: dashboardMetrics.context_rewrite.total_operations,
          successRate: dashboardMetrics.context_rewrite.success_rate,
          avgDuration: dashboardMetrics.context_rewrite.avg_duration,
          performanceScore: dashboardMetrics.context_rewrite.performance_score || 0
        },
        overall: {
          totalOperations: dashboardMetrics.fuzzy_matching.total_operations,
          successRate: dashboardMetrics.fuzzy_matching.success_rate,
          performanceScore: dashboardMetrics.fuzzy_matching.performance_score,
          typoCorrections: dashboardMetrics.fuzzy_matching.typo_corrections
        }
      },
      
      // Retrieval Quality Metrics (from existing specBiasMeta)
      retrievalQuality: {
        avgRawCount: 0, // Will be populated from chat responses
        avgPassedFloorCount: 0,
        avgFilteredCount: 0,
        specHitRate: 0, // % queries with filteredCount > 0
        totalQueries: 0,
        topUnitMatches: {
          psi: 0,
          bar: 0,
          volt: 0,
          amp: 0,
          hz: 0,
          celsius: 0,
          fahrenheit: 0
        }
      },
      
      // OpenAI Usage Metrics
      openaiUsage: {
        totalCalls: 0, // Will be populated from OpenAI client logs
        callsPerMinute: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        tokensPerMinute: 0,
        estimatedCost: 0,
        retryCount: 0,
        rateLimitCount: 0
      },
      
      // System Health
      systemHealth: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        environment: process.env.NODE_ENV || 'development'
      },
      
      // Recent Errors (from real request data)
      recentErrors: requestMetrics.recentErrors,
      
      // Data freshness
      lastUpdated: new Date().toISOString(),
      dataSource: requestMetrics.dataSource
    };
    
    requestLogger.info('Metrics retrieved', { 
      timeframe, 
      totalRequests: requestMetrics.totalRequests,
      errorCount: requestMetrics.errorCount,
      dataSource: requestMetrics.dataSource
    });

    const envelope = {
      success: true,
      data: metricsData
    };

    return res.json(envelope);
    
  } catch (error) {
    next(error);
  }
});

// GET /admin/metrics/fuzzy - Get detailed fuzzy matching metrics
router.get('/fuzzy', async (req, res, next) => {
  try {
    const requestLogger = logger.createRequestLogger();
    
    // Get detailed fuzzy matching metrics
    const dashboardMetrics = metricsUtils.getDashboardMetrics();
    const allMetrics = metricsUtils.getMetrics();
    
    // Get performance metrics for each operation
    const maintenancePerformance = metricsUtils.getPerformanceMetrics('maintenance_detection');
    const unitsPerformance = metricsUtils.getPerformanceMetrics('units_normalization');
    const contextRewritePerformance = metricsUtils.getPerformanceMetrics('context_rewrite');
    
    const fuzzyMetrics = {
      summary: {
        maintenanceDetection: dashboardMetrics.maintenance_detection,
        unitsNormalization: dashboardMetrics.units_normalization,
        contextRewrite: dashboardMetrics.context_rewrite,
        overall: dashboardMetrics.fuzzy_matching
      },
      performance: {
        maintenanceDetection: maintenancePerformance,
        unitsNormalization: unitsPerformance,
        contextRewrite: contextRewritePerformance
      },
      raw: {
        totalMetrics: Object.keys(allMetrics).length,
        metricCategories: [...new Set(Object.keys(allMetrics).map(k => k.split('&')[0]))],
        lastUpdated: new Date().toISOString()
      }
    };
    
    requestLogger.info('Fuzzy matching metrics retrieved', { 
      totalMetrics: Object.keys(allMetrics).length,
      maintenanceOps: dashboardMetrics.maintenance_detection.total_questions,
      unitsOps: dashboardMetrics.units_normalization.total_operations
    });

    const envelope = {
      success: true,
      data: fuzzyMetrics
    };

    return res.json(envelope);
    
  } catch (error) {
    next(error);
  }
});

// Method not allowed for all other methods
router.all('/', (req, res) => {
  return res.json({
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  }, 405);
});

router.all('/fuzzy', (req, res) => {
  return res.json({
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  }, 405);
});

export default router;
