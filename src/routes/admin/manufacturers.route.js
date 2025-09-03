import express from 'express';
import { z } from 'zod';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { adminGate } from '../../middleware/admin.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

const EnvelopeOk = z.object({
  success: z.literal(true),
  data: z.any()
});

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/manufacturers - List manufacturers
router.get('/', async (req, res, next) => {
  try {
    const requestLogger = logger.createRequestLogger();
    const supabase = await getSupabaseClient();
    
    const { data, error } = await supabase
      .from('manufacturers')
      .select('*')
      .order('name');

    if (error) {
      throw error;
    }

    const envelope = {
      success: true,
      data: data || []
    };

    return enforceResponse(res, envelope);
    
    requestLogger.info('Manufacturers retrieved', { count: data?.length || 0 });
    
  } catch (error) {
    next(error);
  }
});

export default router;
