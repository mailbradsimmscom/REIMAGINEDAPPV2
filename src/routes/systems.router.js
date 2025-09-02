import express from 'express';
import { listSystemsSvc, getSystemSvc, searchSystemsSvc } from '../services/systems.service.js';
import { validateResponse } from '../middleware/responseValidation.js';
import { 
  systemsListQuerySchema, 
  systemsListResponseSchema,
  systemsSearchQuerySchema,
  systemsSearchResponseSchema,
  systemsGetResponseSchema
} from '../schemas/systems.schema.js';

const router = express.Router();

// GET /systems/search - Search systems (MUST come before /:assetUid)
router.get('/search', validateResponse(systemsSearchResponseSchema, 'systems'), async (req, res, next) => {
  try {
    const { q, limit } = req.query;
    
    // Handle empty query case
    if (!q || q.trim() === '') {
      const error = new Error('Query parameter is required and must be at least 2 characters');
      error.status = 400;
      throw error;
    }

    // Validate query parameters
    const queryParams = { q };
    if (limit !== undefined) queryParams.limit = limit;
    
    const validationResult = systemsSearchQuerySchema.safeParse(queryParams);
    
    if (!validationResult.success) {
      const error = new Error('Invalid query parameters');
      error.name = 'ValidationError';
      error.details = validationResult.error.errors;
      throw error;
    }

    const result = await searchSystemsSvc(q, { limit });
    const responseData = {
      success: true,
      data: result
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /systems - List systems
router.get('/', validateResponse(systemsListResponseSchema, 'systems'), async (req, res, next) => {
  try {
    const { limit, cursor } = req.query;
    
    // Validate query parameters if present
    const queryParams = {};
    if (limit !== undefined) queryParams.limit = limit;
    if (cursor !== undefined) queryParams.cursor = cursor;
    
    const validationResult = systemsListQuerySchema.safeParse(queryParams);
    
    if (!validationResult.success) {
      const error = new Error('Invalid query parameters');
      error.name = 'ValidationError';
      error.details = validationResult.error.errors;
      throw error;
    }

    const result = await listSystemsSvc({ limit, cursor });
    const responseData = {
      success: true,
      data: result
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /systems/:assetUid - Get specific system
router.get('/:assetUid', validateResponse(systemsGetResponseSchema, 'systems'), async (req, res, next) => {
  try {
    const { assetUid } = req.params;
    
    if (!assetUid) {
      const error = new Error('Invalid asset_uid parameter');
      error.status = 400;
      throw error;
    }
    
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
});

export default router;
