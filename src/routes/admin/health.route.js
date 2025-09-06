import express from 'express';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { AdminHealthEnvelope } from '../../schemas/admin.schema.js';
import { EmptyQuery } from '../../schemas/health.schema.js';
import { ENV } from '../../config/env.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

// Apply response validation to all routes in this file
router.use(validateResponse(AdminHealthEnvelope));

// GET /admin/health - Get system health status
router.get('/', 
  validate(EmptyQuery, 'query'),
  (req, res, next) => {
  try {
    const envelope = { 
      success: true, 
      data: { 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: ENV.NODE_ENV || 'development',
        version: process.version
      } 
    };

    return res.json(envelope);
  } catch (e) {
    return next(e);
  }
});

// GET /admin/health/connectivity - Validate DB + Storage connectivity
router.get('/connectivity', 
  validate(EmptyQuery, 'query'),
  async (req, res, next) => {
  try {
    const requestLogger = logger.createRequestLogger();
    const checks = {
      database: { status: 'unknown', error: null },
      storage: { status: 'unknown', error: null }
    };

    // Test Database connectivity
    try {
      const supabaseClient = await getSupabaseClient();
      const { data, error } = await supabaseClient
        .from('document_chunks')
        .select('count')
        .limit(1);
      
      if (error) {
        checks.database = { status: 'error', error: error.message };
      } else {
        checks.database = { status: 'healthy', error: null };
      }
    } catch (error) {
      checks.database = { status: 'error', error: error.message };
    }

    // Test Storage connectivity
    try {
      const supabaseClient = await getSupabaseClient();
      const { data, error } = await supabaseClient.storage
        .from('documents')
        .list('', { limit: 1 });
      
      if (error) {
        checks.storage = { status: 'error', error: error.message };
      } else {
        checks.storage = { status: 'healthy', error: null };
      }
    } catch (error) {
      checks.storage = { status: 'error', error: error.message };
    }

    const allHealthy = Object.values(checks).every(check => check.status === 'healthy');
    const overallStatus = allHealthy ? 'healthy' : 'degraded';

    requestLogger.info('Connectivity check completed', { 
      status: overallStatus,
      checks: Object.keys(checks).reduce((acc, key) => {
        acc[key] = checks[key].status;
        return acc;
      }, {})
    });

    const envelope = { 
      success: true, 
      data: { 
        status: overallStatus,
        timestamp: new Date().toISOString(),
        checks
      } 
    };

    return res.json(envelope);
  } catch (e) {
    return next(e);
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
