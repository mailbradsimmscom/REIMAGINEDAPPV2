import express from 'express';
import { validateResponse } from '../middleware/responseValidation.js';
import { healthResponseSchema } from '../schemas/health.schema.js';

const router = express.Router();

// GET /health - Health check endpoint
router.get('/', validateResponse(healthResponseSchema, 'health'), (req, res) => {
  res.json({ 
    status: 'ok', 
    uptimeSeconds: Math.floor(process.uptime()) 
  });
});

export default router;
