import express from 'express';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { adminGate } from '../../middleware/admin.js';
import { validateResponse } from '../../middleware/responseValidation.js';
import { adminSystemsResponseSchema } from '../../schemas/admin.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/systems - Get systems statistics
router.get('/', validateResponse(adminSystemsResponseSchema, 'admin'), async (req, res, next) => {
  try {
    const supabase = getSupabaseClient();
    const { count: documentsCount } = await supabase.from('documents').select('*', { count: 'exact', head: true });
    const { count: jobsCount } = await supabase.from('jobs').select('*', { count: 'exact', head: true });
    const { count: totalSystems } = await supabase.from('systems').select('*', { count: 'exact', head: true });

    const systemsData = {
      totalSystems: totalSystems || 0,
      lastUpdated: new Date().toISOString(),
      databaseStatus: 'connected',
      documentsCount: documentsCount || 0,
      jobsCount: jobsCount || 0
    };

    const responseData = {
      success: true,
      data: systemsData
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

export default router;
