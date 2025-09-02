import express from 'express';
import { listSystemsSvc, getSystemSvc, searchSystemsSvc } from '../services/systems.service.js';
// TEMPORARILY DISABLED: import { validateResponse } from '../middleware/responseValidation.js';
import { validate } from '../middleware/validate.js';
import { 
  systemsListQuerySchema, 
  systemsListResponseSchema,
  systemsSearchQuerySchema,
  systemsSearchResponseSchema,
  systemsGetPathSchema,
  systemsGetResponseSchema
} from '../schemas/systems.schema.js';

const router = express.Router();

// GET /systems/search - Search systems (MUST come before /:assetUid)
router.get('/search', 
  validate(systemsSearchQuerySchema, 'query'),
  // TEMPORARILY DISABLED: validateResponse(systemsSearchResponseSchema, 'systems'), 
  async (req, res, next) => {
    try {
      const { q, limit } = req.query;
      
      const result = await searchSystemsSvc(q, { limit });
      const responseData = {
        success: true,
        data: result
      };

      res.json(responseData);
    } catch (error) {
      next(error);
    }
  }
);

// GET /systems - List systems
router.get('/', 
  validate(systemsListQuerySchema, 'query'),
  // TEMPORARILY DISABLED: validateResponse(systemsListResponseSchema, 'systems'), 
  async (req, res, next) => {
    try {
      const { limit, cursor } = req.query;
      
      const result = await listSystemsSvc({ limit, cursor });
      const responseData = {
        success: true,
        data: result
      };

      res.json(responseData);
    } catch (error) {
      next(error);
    }
  }
);

// GET /systems/:assetUid - Get specific system
router.get('/:assetUid', 
  validate(systemsGetPathSchema, 'params'),
  // TEMPORARILY DISABLED: validateResponse(systemsGetResponseSchema, 'systems'), 
  async (req, res, next) => {
    try {
      const { assetUid } = req.params;
      
      const item = await getSystemSvc(assetUid);
      if (!item) {
        const error = new Error('System not found');
        error.status = 404;
        error.context = { assetUid };
        throw error;
      }
      
      const responseData = {
        success: true,
        data: item
      };

      res.json(responseData);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
