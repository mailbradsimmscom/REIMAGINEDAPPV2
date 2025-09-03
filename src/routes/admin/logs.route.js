import express from 'express';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { adminLogsQuerySchema, adminLogsResponseSchema } from '../../schemas/admin.schema.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/logs - Get log files
router.get('/', 
  validate(adminLogsQuerySchema, 'query'),
  async (req, res, next) => {
  try {
    const { level, limit, correlationId } = req.query;
    
    // Build query parameters object
    const queryParams = {};
    if (level !== undefined) queryParams.level = level;
    if (limit !== undefined) queryParams.limit = limit;
    if (correlationId !== undefined) queryParams.correlationId = correlationId;

    // Validate query parameters
    const validationResult = adminLogsQuerySchema.safeParse(queryParams);
    
    if (!validationResult.success) {
      const error = new Error('Invalid query parameters');
      error.name = 'ZodError';
      error.errors = validationResult.error.errors;
      throw error;
    }

    // TODO: Implement actual log retrieval
    const logsData = {
      logs: [],
      count: 0,
      level: level || 'all',
      limit: limit || 100
    };

    const envelope = {
      success: true,
      data: logsData
    };

    // Optional: Validate response schema if RESPONSE_VALIDATE=1
    // adminLogsResponseSchema.parse(envelope);

    return enforceResponse(res, envelope, 200);
  } catch (error) {
    next(error);
  }
});

// Method not allowed for all other methods
router.all('/', (req, res) => {
  return enforceResponse(res, {
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  }, 405);
});

export default router;
