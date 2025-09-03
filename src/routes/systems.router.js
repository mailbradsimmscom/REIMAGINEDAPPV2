import express from 'express';
import { listSystemsSvc, getSystemSvc, searchSystemsSvc } from '../services/systems.service.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { enforceResponse } from '../middleware/enforceResponse.js';
import { 
  systemsListQuerySchema, 
  systemsListResponseSchema,
  systemsSearchQuerySchema,
  systemsSearchResponseSchema,
  systemsGetPathSchema,
  systemsGetResponseSchema
} from '../schemas/systems.schema.js';

const router = express.Router();

const EnvelopeOk = z.object({
  success: z.literal(true),
  data: z.any()
});

// GET /systems/search - Search systems (MUST come before /:assetUid)
router.get('/search', 
  validate(systemsSearchQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { q, limit } = req.query;
      
      const result = await searchSystemsSvc(q, { limit });
      const envelope = {
        success: true,
        data: result
      };

      res.json(enforceResponse(EnvelopeOk, envelope));
    } catch (error) {
      next(error);
    }
  }
);

// GET /systems - List systems
router.get('/', 
  validate(systemsListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { limit, cursor } = req.query;
      
      const result = await listSystemsSvc({ limit, cursor });
      const envelope = {
        success: true,
        data: result
      };

      res.json(enforceResponse(EnvelopeOk, envelope));
    } catch (error) {
      next(error);
    }
  }
);

// GET /systems/:assetUid - Get specific system
router.get('/:assetUid', 
  validate(systemsGetPathSchema, 'params'),
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
      
      const envelope = {
        success: true,
        data: item
      };

      res.json(enforceResponse(EnvelopeOk, envelope));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
