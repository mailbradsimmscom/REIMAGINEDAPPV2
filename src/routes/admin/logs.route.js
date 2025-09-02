import express from 'express';
import { adminGate } from '../../middleware/admin.js';
import { validateResponse } from '../../middleware/responseValidation.js';
import { adminLogsQuerySchema, adminLogsResponseSchema } from '../../schemas/admin.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/logs - Get log files
router.get('/', validateResponse(adminLogsResponseSchema, 'admin'), async (req, res, next) => {
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

    const responseData = {
      success: true,
      data: logsData
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

export default router;
