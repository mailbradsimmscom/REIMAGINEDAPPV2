import express from 'express';
import { env } from '../../config/env.js';
import { adminGate } from '../../middleware/admin.js';
import { validateResponse } from '../../middleware/responseValidation.js';
import { adminHealthResponseSchema } from '../../schemas/admin.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/health - Get system health status
router.get('/', validateResponse(adminHealthResponseSchema, 'admin'), async (req, res, next) => {
  try {
    const healthData = {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: env.nodeEnv,
      version: env.appVersion
    };

    const responseData = {
      success: true,
      data: healthData
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

export default router;
