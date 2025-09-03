import express from 'express';
import { z } from 'zod';
import { enforceResponse } from '../middleware/enforceResponse.js';
import { validate } from '../middleware/validate.js';
import { 
  pineconeSearchRequestSchema,
  pineconeStatsQuerySchema,
  pineconeDocumentChunksPathSchema,
  pineconeQueryRequestSchema
} from '../schemas/pinecone.schema.js';
import { getEnv } from '../config/env.js';

const router = express.Router();

const EnvelopeOk = z.object({
  success: z.literal(true),
  data: z.any()
});

const EnvelopeError = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string()
  })
});

// Lazy import to avoid failing at router import time
async function getPineService() {
  return import('../services/pinecone.service.js');
}

// Helper function to check if Pinecone is configured
function isPineconeConfigured() {
  const { PINECONE_API_KEY, PINECONE_INDEX } = getEnv({ loose: true });
  return PINECONE_API_KEY && PINECONE_INDEX;
}

// POST /pinecone/search - Search Pinecone
router.post('/search', 
  validate(pineconeSearchRequestSchema, 'body'),
  async (req, res, next) => {
    try {
      if (!isPineconeConfigured()) {
        const envelope = {
          success: false,
          error: { code: 'PINECONE_DISABLED', message: 'Pinecone not configured' }
        };
        return res.json(enforceResponse(EnvelopeError, envelope));
      }

      const pineconeService = await getPineService();
      const result = await pineconeService.default.searchDocuments(req.body.query, req.body.context);
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

// GET /pinecone/stats - Get Pinecone stats
router.get('/stats', 
  validate(pineconeStatsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      if (!isPineconeConfigured()) {
        const envelope = {
          success: false,
          error: { code: 'PINECONE_DISABLED', message: 'Pinecone not configured' }
        };
        return res.json(enforceResponse(EnvelopeError, envelope));
      }

      const pineconeService = await getPineService();
      const result = await pineconeService.default.getIndexStatistics();
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

// GET /pinecone/documents/:docId/chunks - Get document chunks
router.get('/documents/:docId/chunks', 
  validate(pineconeDocumentChunksPathSchema, 'params'),
  async (req, res, next) => {
    try {
      if (!isPineconeConfigured()) {
        const envelope = {
          success: false,
          error: { code: 'PINECONE_DISABLED', message: 'Pinecone not configured' }
        };
        return res.json(enforceResponse(EnvelopeError, envelope));
      }

      const { docId } = req.params;
      const pineconeService = await getPineService();
      const result = await pineconeService.default.getDocumentChunks(docId);
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

// POST /pinecone/query - Query Pinecone
router.post('/query', 
  validate(pineconeQueryRequestSchema, 'body'),
  async (req, res, next) => {
    try {
      if (!isPineconeConfigured()) {
        const envelope = {
          success: false,
          error: { code: 'PINECONE_DISABLED', message: 'Pinecone not configured' }
        };
        return res.json(enforceResponse(EnvelopeError, envelope));
      }

      const pineconeService = await getPineService();
      const result = await pineconeService.default.searchDocuments(req.body.query, req.body.context);
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

export default router;
