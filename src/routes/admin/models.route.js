import express from 'express';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { AdminModelsEnvelope, adminModelsQuerySchema } from '../../schemas/admin.schema.js';
import { adminService } from '../../services/admin.service.js';

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
      const manufacturer = req.query.manufacturer || 'all';
      const data = await adminService.getModels(manufacturer);

      const envelope = {
        success: true,
        data: {
          models: data.top.map(m => ({ 
            model_norm: m.model_norm, 
            manufacturer_norm: manufacturer !== 'all' ? manufacturer : 'Unknown' 
          })),
          count: data.total,
          manufacturer: manufacturer,
          lastUpdated: data.lastUpdated
        }
      };

      return res.json(envelope);
      
    } catch (error) {
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
