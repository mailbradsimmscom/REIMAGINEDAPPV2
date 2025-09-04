import express from 'express';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { AdminModelsEnvelope, adminModelsQuerySchema } from '../../schemas/admin.schema.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// Apply response validation to all routes in this file
router.use(validateResponse(AdminModelsEnvelope));

// GET /admin/models - List models
router.get('/', 
  validate(adminModelsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const requestLogger = logger.createRequestLogger();
      const supabase = await getSupabaseClient();
      
      const { data, error } = await supabase
        .from('models')
        .select('*')
        .order('name');

      if (error) {
        throw error;
      }

      const envelope = {
        success: true,
        data: {
          models: data?.map(m => ({ 
            model_norm: m.name, 
            manufacturer_norm: m.manufacturer || 'Unknown' 
          })) || [],
          count: data?.length || 0,
          manufacturer: req.query.manufacturer || 'all',
          lastUpdated: new Date().toISOString()
        }
      };

      return enforceResponse(res, envelope);
      
      requestLogger.info('Models retrieved', { count: data?.length || 0 });
      
    } catch (error) {
      next(error);
    }
  }
);

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
