import express from 'express';
import { enforceResponse } from '../middleware/enforceResponse.js';
import { validate } from '../middleware/validate.js';
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
async function isPineconeConfigured() {
  const { getEnv } = await import('../config/env.js');
  const { PINECONE_API_KEY, PINECONE_INDEX } = getEnv();
  return PINECONE_API_KEY && PINECONE_INDEX;
}

// Method not allowed handler
function methodNotAllowed(req, res) {
  return enforceResponse(res, {
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
  async (req, res, next) => {
    try {
      if (!(await isPineconeConfigured())) {
        const envelope = {
          success: false,
          error: { code: ERR.PINECONE_DISABLED, message: 'Pinecone not configured' }
        };
        // Optional: Validate response schema if RESPONSE_VALIDATE=1
        // pineconeSearchResponseSchema.parse(envelope);
        return enforceResponse(res, envelope, 400);
      }

      const pineconeService = await getPineService();
      const result = await pineconeService.default.searchDocuments(req.body.query, req.body.context);
      const envelope = {
        success: true,
        data: result
      };
      // Optional: Validate response schema if RESPONSE_VALIDATE=1
      // pineconeSearchResponseSchema.parse(envelope);
      return enforceResponse(res, envelope, 200);
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
  async (req, res, next) => {
    try {
      if (!(await isPineconeConfigured())) {
        const envelope = {
          success: false,
          error: { code: ERR.PINECONE_DISABLED, message: 'Pinecone not configured' }
        };
        // Optional: Validate response schema if RESPONSE_VALIDATE=1
        // pineconeStatsResponseSchema.parse(envelope);
        return enforceResponse(res, envelope, 400);
      }

      const pineconeService = await getPineService();
      const result = await pineconeService.default.getIndexStatistics();
      const envelope = {
        success: true,
        data: result
      };
      // Optional: Validate response schema if RESPONSE_VALIDATE=1
      // pineconeStatsResponseSchema.parse(envelope);
      return enforceResponse(res, envelope, 200);
    } catch (error) {
      next(error);
    }
  }
);

// GET /pinecone/documents/:docId/chunks - Get document chunks
router.get('/documents/:docId/chunks', 
  validate(pineconeDocumentChunksPathSchema, 'params'),
  async (req, res, next) => {
    try {
      if (!(await isPineconeConfigured())) {
        const envelope = {
          success: false,
          error: { code: ERR.PINECONE_DISABLED, message: 'Pinecone not configured' }
        };
        // Optional: Validate response schema if RESPONSE_VALIDATE=1
        // pineconeDocumentChunksResponseSchema.parse(envelope);
        return enforceResponse(res, envelope, 400);
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
      return enforceResponse(res, envelope, 200);
    } catch (error) {
      next(error);
    }
  }
);

// POST /pinecone/query - Query Pinecone
router.post('/query', 
  validate(pineconeQueryRequestSchema, 'body'),
  async (req, res, next) => {
    try {
      if (!(await isPineconeConfigured())) {
        const envelope = {
          success: false,
          error: { code: 'PINECONE_DISABLED', message: 'Pinecone not configured' }
        };
        // Optional: Validate response schema if RESPONSE_VALIDATE=1
        // pineconeQueryResponseSchema.parse(envelope);
        return enforceResponse(res, envelope, 400);
      }

      const pineconeService = await getPineService();
      const result = await pineconeService.default.searchDocuments(req.body.query, req.body.context);
      const envelope = {
        success: true,
        data: result
      };
      // Optional: Validate response schema if RESPONSE_VALIDATE=1
      // pineconeQueryResponseSchema.parse(envelope);
      return enforceResponse(res, envelope, 200);
    } catch (error) {
      next(error);
    }
  }
);

// Add method not allowed for GET /pinecone/query
router.all('/query', methodNotAllowed);

export default router;
