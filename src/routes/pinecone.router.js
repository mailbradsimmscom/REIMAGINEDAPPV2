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
import pineconeService from '../services/pinecone.service.js';

const router = express.Router();

const EnvelopeOk = z.object({
  success: z.literal(true),
  data: z.any()
});

// POST /pinecone/search - Search Pinecone
router.post('/search', 
  validate(pineconeSearchRequestSchema, 'body'),
  async (req, res, next) => {
    try {
      const result = await pineconeService.searchDocuments(req.body.query, req.body.context);
      const envelope = {
        success: true,
        data: result
      };
      res.json(await enforceResponse(EnvelopeOk, envelope));
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
      const result = await pineconeService.getIndexStatistics();
      const envelope = {
        success: true,
        data: result
      };
      res.json(await enforceResponse(EnvelopeOk, envelope));
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
      const { docId } = req.params;
      const result = await pineconeService.getDocumentChunks(docId);
      const envelope = {
        success: true,
        data: result
      };
      res.json(await enforceResponse(EnvelopeOk, envelope));
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
      const result = await pineconeService.searchDocuments(req.body.query, req.body.context);
      const envelope = {
        success: true,
        data: result
      };
      res.json(await enforceResponse(EnvelopeOk, envelope));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
