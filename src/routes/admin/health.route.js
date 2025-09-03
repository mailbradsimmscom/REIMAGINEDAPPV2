import express from 'express';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { adminHealthResponseSchema } from '../../schemas/admin.schema.js';

const router = express.Router();

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

    // Optional: Validate response schema if RESPONSE_VALIDATE=1
    // adminHealthResponseSchema.parse(envelope);

    return enforceResponse(res, envelope, 200);
  } catch (e) {
    return next(e);
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
