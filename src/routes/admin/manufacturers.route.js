import express from 'express';
import { z } from 'zod';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { adminGate } from '../../middleware/admin.js';

const router = express.Router();

const EnvelopeOk = z.object({
  success: z.literal(true),
  data: z.any()
});

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/manufacturers - Get manufacturers statistics
router.get('/', async (req, res, next) => {
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

    const envelope = {
      success: true,
      data: manufacturersData
    };

    return enforceResponse(res, envelope, 200);
  } catch (error) {
    next(error);
  }
});

export default router;
