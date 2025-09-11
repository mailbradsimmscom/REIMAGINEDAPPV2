import express from 'express';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { AdminSystemsEnvelope } from '../../schemas/admin.schema.js';
import { adminService } from '../../services/admin.service.js';
import { lookupSystemByManufacturerAndModel } from '../../repositories/systems.repository.js';
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
    const { getSupabaseClient } = await import('../../repositories/supabaseClient.js');
    const supabase = await getSupabaseClient();
    
    // Get document count
    let documentsCount = 0;
    try {
      const { count: docCount, error: docError } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true });
      
      if (!docError) {
        documentsCount = docCount || 0;
      }
    } catch (error) {
      // Table might not exist, that's ok
    }
    
    // Get job count
    let jobsCount = 0;
    try {
      const { count: jobCount, error: jobError } = await supabase
        .from('jobs')
        .select('*', { count: 'exact', head: true });
      
      if (!jobError) {
        jobsCount = jobCount || 0;
      }
    } catch (error) {
      // Table might not exist, that's ok
    }
    
    const data = await adminService.getSystems();

    const envelope = {
      success: true,
      data: {
        totalSystems: data.total,
        lastUpdated: data.lastUpdated,
        databaseStatus: 'connected',
        documentsCount: documentsCount,
        jobsCount: jobsCount
      }
    };

    return res.json(envelope);
    
  } catch (error) {
    next(error);
  }
});

// System lookup query schema
const systemLookupQuerySchema = z.object({
  manufacturer: z.string().min(1, 'Manufacturer is required'),
  model: z.string().min(1, 'Model is required')
});

// GET /admin/systems/lookup - Lookup system by manufacturer and model
router.get('/lookup',
  validate(systemLookupQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { manufacturer, model } = req.query;
      
      const systemData = await lookupSystemByManufacturerAndModel(manufacturer, model);
      
      const envelope = {
        success: true,
        data: systemData
      };
      
      return res.json(envelope);
      
    } catch (error) {
      if (error.code === 'SYSTEM_NOT_FOUND') {
        return res.json({
          success: false,
          error: {
            code: 'SYSTEM_NOT_FOUND',
            message: error.message
          }
        }, 404);
      }
      
      next(error);
    }
  }
);

// Method not allowed for all other methods
router.all('/', (req, res) => {
  return res.json({
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  }, 405);
});

export default router;
