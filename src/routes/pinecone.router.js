import express from 'express';
import { validate } from '../middleware/validate.js';
import { validateResponse } from '../middleware/validateResponse.js';
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

// Helper function to check if Pinecone is configured
import { isPineconeConfigured } from '../services/pinecone.guard.js';

// Method not allowed handler
function methodNotAllowed(req, res) {
  return res.json({
    success: false,
    error: {
      code: ERR.METHOD_NOT_ALLOWED,
      message: `${req.method} not allowed for ${req.path}`
    }
  }, 405);
}

// POST /pinecone/search - Search Pinecone
router.post('/search', 
  validate(pineconeSearchRequestSchema, 'body'),
  validateResponse(pineconeSearchResponseSchema),
  async (req, res, next) => {
    try {
      if (!isPineconeConfigured()) {
        const envelope = {
          success: false,
          error: { code: ERR.PINECONE_DISABLED, message: 'Pinecone not configured' }
        };
        // Optional: Validate response schema if RESPONSE_VALIDATE=1
        // pineconeSearchResponseSchema.parse(envelope);
        return res.status(400).json(envelope);
      }

      const pineconeService = await getPineService();
      const result = await pineconeService.default.searchDocuments(req.body.query, req.body.context);
      const envelope = {
        success: true,
        data: result
      };
      // Optional: Validate response schema if RESPONSE_VALIDATE=1
      // pineconeSearchResponseSchema.parse(envelope);
      return res.json(envelope);
    } catch (error) {
      next(error);
    }
  }
);

// Add method not allowed for GET /pinecone/search
router.all('/search', methodNotAllowed);

// GET /pinecone/stats - Get Pinecone stats
router.get('/stats', 
  validate(pineconeStatsQuerySchema, 'query'),
  validateResponse(pineconeStatsResponseSchema),
  async (req, res, next) => {
    try {
      if (!isPineconeConfigured()) {
        const envelope = {
          success: false,
          error: { code: ERR.PINECONE_DISABLED, message: 'Pinecone not configured' }
        };
        // Optional: Validate response schema if RESPONSE_VALIDATE=1
        // pineconeStatsResponseSchema.parse(envelope);
        return res.status(400).json(envelope);
      }

      const pineconeService = await getPineService();
      const result = await pineconeService.default.getIndexStatistics();
      const envelope = {
        success: true,
        data: result
      };
      // Optional: Validate response schema if RESPONSE_VALIDATE=1
      // pineconeStatsResponseSchema.parse(envelope);
      return res.json(envelope);
    } catch (error) {
      next(error);
    }
  }
);

// GET /pinecone/documents/:docId/chunks - Get document chunks
router.get('/documents/:docId/chunks', 
  validate(pineconeDocumentChunksPathSchema, 'params'),
  validateResponse(pineconeDocumentChunksResponseSchema),
  async (req, res, next) => {
    try {
      if (!isPineconeConfigured()) {
        const envelope = {
          success: false,
          error: { code: ERR.PINECONE_DISABLED, message: 'Pinecone not configured' }
        };
        // Optional: Validate response schema if RESPONSE_VALIDATE=1
        // pineconeDocumentChunksResponseSchema.parse(envelope);
        return res.status(400).json(envelope);
      }

      const { docId } = req.params;
      const pineconeService = await getPineService();
      const result = await pineconeService.default.getDocumentChunks(docId);
      const envelope = {
        success: true,
        data: result
      };
      // Optional: Validate response schema if RESPONSE_VALIDATE=1
      // pineconeDocumentChunksResponseSchema.parse(envelope);
      return res.json(envelope);
    } catch (error) {
      next(error);
    }
  }
);

// POST /pinecone/query - Query Pinecone
router.post('/query', 
  validate(pineconeQueryRequestSchema, 'body'),
  validateResponse(pineconeQueryResponseSchema),
  async (req, res, next) => {
    try {
      if (!isPineconeConfigured()) {
        const envelope = {
          success: false,
          error: { code: 'PINECONE_DISABLED', message: 'Pinecone not configured' }
        };
        // Optional: Validate response schema if RESPONSE_VALIDATE=1
        // pineconeQueryResponseSchema.parse(envelope);
        return res.status(400).json(envelope);
      }

      const pineconeService = await getPineService();
      const result = await pineconeService.default.searchDocuments(req.body.query, req.body.context);
      const envelope = {
        success: true,
        data: result
      };
      // Optional: Validate response schema if RESPONSE_VALIDATE=1
      // pineconeQueryResponseSchema.parse(envelope);
      return res.json(envelope);
    } catch (error) {
      next(error);
    }
  }
);

// Add method not allowed for GET /pinecone/query
router.all('/query', methodNotAllowed);

export default router;
