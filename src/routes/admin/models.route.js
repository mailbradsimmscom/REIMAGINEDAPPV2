import express from 'express';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { adminGate } from '../../middleware/admin.js';
import { validateResponse } from '../../middleware/responseValidation.js';
import { adminModelsQuerySchema, adminModelsResponseSchema } from '../../schemas/admin.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/models - Get models statistics
router.get('/', validateResponse(adminModelsResponseSchema, 'admin'), async (req, res, next) => {
  try {
    const { manufacturer } = req.query;
    
    // Validate query parameters
    // TODO: Re-enable query validation after debugging
    // const validationResult = adminModelsQuerySchema.safeParse({ manufacturer });
    // 
    // if (!validationResult.success) {
    //   const error = new Error('Invalid query parameters');
    //   error.name = 'ZodError';
    //   error.errors = validationResult.error.errors;
    //   throw error;
    // }

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

    const responseData = {
      success: true,
      data: modelsData
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

export default router;
