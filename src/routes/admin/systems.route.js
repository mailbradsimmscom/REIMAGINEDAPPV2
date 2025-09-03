import express from 'express';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { adminGate } from '../../middleware/admin.js';
import { adminSystemsResponseSchema } from '../../schemas/admin.schema.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/systems - List systems
router.get('/', async (req, res, next) => {
  try {
    const requestLogger = logger.createRequestLogger();
    const supabase = await getSupabaseClient();
    
    const { data, error } = await supabase
      .from('systems')
      .select('*')
      .order('asset_uid');

    if (error) {
      throw error;
    }

    const envelope = {
      success: true,
      data: data || []
    };

    // Optional: Validate response schema if RESPONSE_VALIDATE=1
    // adminSystemsResponseSchema.parse(envelope);

    return enforceResponse(res, envelope);
    
    requestLogger.info('Systems retrieved', { count: data?.length || 0 });
    
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
