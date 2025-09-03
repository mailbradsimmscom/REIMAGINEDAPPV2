import express from 'express';
import { z } from 'zod';
import { enforceResponse } from '../middleware/enforceResponse.js';

const router = express.Router();

const HealthOk = z.object({
  success: z.literal(true),
  data: z.object({
    status: z.literal('ok'),
    ts: z.string()
  })
});

// GET /health - Health check endpoint
router.get('/', (req, res, next) => {
  try {
    const envelope = {
      success: true,
      data: { 
        status: 'ok', 
        ts: new Date().toISOString() 
      }
    };
    return enforceResponse(res, envelope, 200);
  } catch (e) {
    return next(e);
  }
});

export default router;
