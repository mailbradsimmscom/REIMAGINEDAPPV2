import express from 'express';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { AdminHealthEnvelope } from '../../schemas/admin.schema.js';
import { EmptyQuery } from '../../schemas/health.schema.js';
import { ENV } from '../../config/env.js';

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
