import express from 'express';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { AdminSystemsEnvelope } from '../../schemas/admin.schema.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { logger } from '../../utils/logger.js';
import { z } from 'zod';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// Apply response validation to all routes in this file
router.use(validateResponse(AdminSystemsEnvelope));

// Admin systems query schema
const adminSystemsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['active', 'inactive', 'maintenance']).optional()
}).passthrough();

// GET /admin/systems - List systems
router.get('/', 
  validate(adminSystemsQuerySchema, 'query'),
  async (req, res, next) => {
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
      data: {
        totalSystems: data?.length || 0,
        lastUpdated: new Date().toISOString(),
        databaseStatus: 'connected',
        documentsCount: 0,
        jobsCount: 0
      }
    };

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
