import express from 'express';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { adminGate } from '../../middleware/admin.js';
import { validateResponse } from '../../middleware/responseValidation.js';
import { adminManufacturersResponseSchema } from '../../schemas/admin.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/manufacturers - Get manufacturers statistics
router.get('/', validateResponse(adminManufacturersResponseSchema, 'admin'), async (req, res, next) => {
  try {
    const supabase = getSupabaseClient();
    
    // Get manufacturers count
    const { count: manufacturersCount } = await supabase
      .from('systems')
      .select('manufacturer_norm', { count: 'exact', head: true });

    // Get top manufacturers
    const { data: topManufacturers } = await supabase
      .from('systems')
      .select('manufacturer_norm')
      .not('manufacturer_norm', 'is', null)
      .order('manufacturer_norm', { ascending: true });

    const manufacturersData = {
      total: manufacturersCount || 0,
      top: topManufacturers || [],
      lastUpdated: new Date().toISOString()
    };

    const responseData = {
      success: true,
      data: manufacturersData
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

export default router;
