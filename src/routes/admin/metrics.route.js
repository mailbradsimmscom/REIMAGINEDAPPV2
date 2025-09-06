import express from 'express';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { AdminMetricsEnvelope } from '../../schemas/admin.schema.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { getRequestMetrics } from '../../middleware/requestLogging.js';
import { logger } from '../../utils/logger.js';
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
    
    const metrics = {
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
      data: metrics
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

export default router;
