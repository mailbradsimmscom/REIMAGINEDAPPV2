import express from 'express';
import { validate } from '../middleware/validate.js';
import { validateResponse } from '../middleware/validateResponse.js';
import { requirePinecone } from '../middleware/serviceGuards.js';
import { ERR } from '../constants/errorCodes.js';
import {
  pineconeSearchRequestSchema,
  pineconeStatsQuerySchema,
  pineconeDocumentChunksPathSchema,
  pineconeQueryRequestSchema,
  pineconeSearchResponseSchema,
  pineconeStatsResponseSchema,
  pineconeDocumentChunksResponseSchema,
  pineconeQueryResponseSchema
} from '../schemas/pinecone.schema.js';

const router = express.Router();

// Lazy import to avoid failing at router import time
async function getPineService() {
  return import('../services/pinecone.service.js');
}

// Method not allowed handler
function methodNotAllowed(req, res) {
  return res.status(405).json({
    success: false,
    error: {
      code: ERR.METHOD_NOT_ALLOWED,
      message: `${req.method} not allowed for ${req.path}`
    }
  });
}

// POST /pinecone/search - Search Pinecone
// Validation runs first, then service guard checks Pinecone availability
router.post('/search',
  validate(pineconeSearchRequestSchema, 'body'),
  requirePinecone(),
  validateResponse(pineconeSearchResponseSchema),
  async (req, res, next) => {
    try {
      const pineconeService = await getPineService();
      const result = await pineconeService.default.searchDocuments(req.body.query, req.body.context);
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

// Add method not allowed for GET /pinecone/search
router.all('/search', methodNotAllowed);

// GET /pinecone/stats - Get Pinecone stats
// Validation runs first, then service guard checks Pinecone availability
router.get('/stats',
  validate(pineconeStatsQuerySchema, 'query'),
  requirePinecone(),
  validateResponse(pineconeStatsResponseSchema),
  async (req, res, next) => {
    try {
      const pineconeService = await getPineService();
      const result = await pineconeService.default.getIndexStatistics();
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

// GET /pinecone/documents/:docId/chunks - Get document chunks
// Validation runs first, then service guard checks Pinecone availability
router.get('/documents/:docId/chunks',
  validate(pineconeDocumentChunksPathSchema, 'params'),
  requirePinecone(),
  validateResponse(pineconeDocumentChunksResponseSchema),
  async (req, res, next) => {
    try {
      const { docId } = req.params;
      const pineconeService = await getPineService();
      const result = await pineconeService.default.getDocumentChunks(docId);
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

// POST /pinecone/query - Query Pinecone
// Validation runs first, then service guard checks Pinecone availability
router.post('/query',
  validate(pineconeQueryRequestSchema, 'body'),
  requirePinecone(),
  validateResponse(pineconeQueryResponseSchema),
  async (req, res, next) => {
    try {
      const pineconeService = await getPineService();
      const result = await pineconeService.default.searchDocuments(req.body.query, req.body.context);
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

// Add method not allowed for GET /pinecone/query
router.all('/query', methodNotAllowed);

export default router;
