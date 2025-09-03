import express from 'express';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { adminModelsQuerySchema, adminModelsResponseSchema } from '../../schemas/admin.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/models - Get models statistics
router.get('/', 
  validate(adminModelsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { manufacturer } = req.query;

      const supabase = getSupabaseClient();
      
      let query = supabase
        .from('systems')
        .select('model_norm, manufacturer_norm')
        .not('model_norm', 'is', null);

      if (manufacturer) {
        query = query.eq('manufacturer_norm', manufacturer);
      }

      const { data: models } = await query.order('model_norm', { ascending: true });

      const modelsData = {
        models: models || [],
        count: models?.length || 0,
        manufacturer: manufacturer || 'all',
        lastUpdated: new Date().toISOString()
      };

      const envelope = {
        success: true,
        data: modelsData
      };

      return enforceResponse(res, envelope, 200);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
