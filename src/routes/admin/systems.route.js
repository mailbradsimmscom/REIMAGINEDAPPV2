import express from 'express';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { adminGate } from '../../middleware/admin.js';
import { adminSystemsResponseSchema } from '../../schemas/admin.schema.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { z } from 'zod';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

const EnvelopeOk = z.object({
  success: z.literal(true),
  data: z.any()
});

// GET /admin/systems - Get systems statistics
router.get('/systems', async (req, res, next) => {
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

    const envelope = {
      success: true,
      data: systemsData
    };

    return res.json(enforceResponse(EnvelopeOk, envelope));
  } catch (error) {
    return next(error);
  }
});

export default router;
