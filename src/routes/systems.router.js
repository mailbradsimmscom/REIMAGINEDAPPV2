import express from 'express';
import { listSystemsSvc, getSystemSvc, searchSystemsSvc } from '../services/systems.service.js';
import { validate } from '../middleware/validate.js';
import { validateResponse } from '../middleware/validateResponse.js';
import { requireSupabase } from '../middleware/serviceGuards.js';
import { 
  SystemsListEnvelope,
  SystemsSearchEnvelope,
  SystemsGetEnvelope,
  systemsListQuerySchema, 
  systemsListResponseSchema,
  systemsSearchQuerySchema,
  systemsSearchResponseSchema,
  systemsGetPathSchema,
  systemsGetResponseSchema,
  UUIDParam
} from '../schemas/systems.schema.js';

const router = express.Router();

// GET /systems/search - Search systems (MUST come before /:assetUid)
// Validation runs first, then service guard checks Supabase availability
router.get('/search',
  validate(systemsSearchQuerySchema, 'query'),
  requireSupabase(),
  validateResponse(SystemsSearchEnvelope),
  async (req, res, next) => {
    try {
      const { q, limit } = req.query;
      
      const result = await searchSystemsSvc(q, { limit });
      const envelope = {
        success: true,
        data: result
      };

      return res.json(envelope);
    } catch (error) {
      next(error);
    }
  }
);

// GET /systems - List systems
router.get('/',
  validate(systemsListQuerySchema, 'query'),
  requireSupabase(),
  validateResponse(SystemsListEnvelope),
  async (req, res, next) => {
    try {
      const { limit, cursor } = req.query;
      
      const result = await listSystemsSvc({ limit, cursor });
      const envelope = {
        success: true,
        data: result
      };

      return res.json(envelope);
    } catch (error) {
      next(error);
    }
  }
);

// GET /systems/:assetUid - Get specific system
router.get('/:assetUid',
  validate(UUIDParam, 'params'),
  requireSupabase(),
  validateResponse(SystemsGetEnvelope),
  async (req, res, next) => {
    try {
      const { assetUid } = req.validated?.params ?? req.params;
      const result = await getSystemSvc(assetUid);
      const envelope = {
        success: true,
        data: result
      };
      return res.json(envelope);
    } catch (err) {
      return next(err);
    }
  }
);

// Method not allowed for all other methods on /systems/search
router.all('/search', (req, res) => {
  return res.status(405).json({
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  });
});

// Method not allowed for all other methods on /systems
router.all('/', (req, res) => {
  return res.status(405).json({
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  });
});

export default router;
