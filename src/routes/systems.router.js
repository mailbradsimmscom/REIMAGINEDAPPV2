import express from 'express';
import { listSystemsSvc, getSystemSvc, searchSystemsSvc } from '../services/systems.service.js';
import { validate } from '../middleware/validate.js';
import { enforceResponse } from '../middleware/enforceResponse.js';
import { requireSupabase } from '../middleware/serviceGuards.js';
import { 
  systemsListQuerySchema, 
  systemsListResponseSchema,
  systemsSearchQuerySchema,
  systemsSearchResponseSchema,
  systemsGetPathSchema,
  systemsGetResponseSchema,
  UUIDParam
} from '../schemas/systems.schema.js';

const router = express.Router();

// Apply service guards - systems routes require Supabase
router.use(requireSupabase());

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

      // Optional: Validate response schema if RESPONSE_VALIDATE=1
      // systemsSearchResponseSchema.parse(envelope);

      return enforceResponse(res, envelope, 200);
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

      // Optional: Validate response schema if RESPONSE_VALIDATE=1
      // systemsListResponseSchema.parse(envelope);

      return enforceResponse(res, envelope, 200);
    } catch (error) {
      next(error);
    }
  }
);

// GET /systems/:assetUid - Get specific system
router.get('/:assetUid',
  validate(UUIDParam, 'params'),
  async (req, res, next) => {
    try {
      const { assetUid } = req.validated?.params ?? req.params;
      const result = await getSystemSvc(assetUid);
      const envelope = {
        success: true,
        data: result
      };
      // Optional: Validate response schema if RESPONSE_VALIDATE=1
      // systemsGetResponseSchema.parse(envelope);
      return enforceResponse(res, envelope, 200);
    } catch (err) {
      return next(err);
    }
  }
);

// Method not allowed for all other methods on /systems/search
router.all('/search', (req, res) => {
  return enforceResponse(res, {
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  }, 405);
});

// Method not allowed for all other methods on /systems
router.all('/', (req, res) => {
  return enforceResponse(res, {
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  }, 405);
});

export default router;
