import express from 'express';
import { z } from 'zod';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { adminGate } from '../../middleware/admin.js';

const router = express.Router();

const AdminHealthOk = z.object({
  success: z.literal(true),
  data: z.object({
    status: z.literal('ok'),
    ts: z.string()
  })
});

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/health - Get system health status
router.get('/', (req, res, next) => {
  try {
    const envelope = { 
      success: true, 
      data: { 
        status: 'ok', 
        ts: new Date().toISOString() 
      } 
    };
    return res.status(200).json(enforceResponse(AdminHealthOk, envelope));
  } catch (e) {
    return next(e);
  }
});

export default router;
