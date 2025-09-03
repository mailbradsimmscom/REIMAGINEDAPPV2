import express from 'express';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { adminGate } from '../../middleware/admin.js';
import { adminSystemsResponseSchema } from '../../schemas/admin.schema.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

const EnvelopeOk = z.object({
  success: z.literal(true),
  data: z.any()
});

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

    return enforceResponse(res, envelope);
    
    requestLogger.info('Systems retrieved', { count: data?.length || 0 });
    
  } catch (error) {
    next(error);
  }
});

export default router;
