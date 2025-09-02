import express from 'express';
// TEMPORARILY DISABLED: import { validateResponse } from '../middleware/responseValidation.js';
import { healthResponseSchema } from '../schemas/health.schema.js';

const router = express.Router();

// GET /health - Health check endpoint
router.get('/', 
  // TEMPORARILY DISABLED: validateResponse(healthResponseSchema, 'health'), 
  (req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime())
    });
  }
);

export default router;
