import express from 'express';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { AdminManufacturersEnvelope } from '../../schemas/admin.schema.js';
import { adminService } from '../../services/admin.service.js';
import { z } from 'zod';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// Apply response validation to all routes in this file
router.use(validateResponse(AdminManufacturersEnvelope));

// Admin manufacturers query schema
const adminManufacturersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['active', 'inactive']).optional()
}).passthrough();

// GET /admin/manufacturers - List manufacturers
router.get('/', 
  validate(adminManufacturersQuerySchema, 'query'),
  async (req, res, next) => {
  try {
    const data = await adminService.getManufacturers();

    const envelope = {
      success: true,
      data
    };

    return res.json(envelope);
    
  } catch (error) {
    next(error);
  }
});

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
