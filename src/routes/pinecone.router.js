import express from 'express';
import pineconeService from '../services/pinecone.service.js';
import { validateResponse } from '../middleware/responseValidation.js';
import { validate } from '../middleware/validate.js';
import { 
  pineconeSearchRequestSchema, 
  pineconeSearchResponseSchema,
  pineconeStatsQuerySchema,
  pineconeStatsResponseSchema,
  pineconeDocumentChunksPathSchema,
  pineconeDocumentChunksResponseSchema,
  pineconeQueryRequestSchema,
  pineconeQueryResponseSchema
} from '../schemas/pinecone.schema.js';

const router = express.Router();

// POST /pinecone/search - Search documents
router.post('/search', 
  validate(pineconeSearchRequestSchema, 'body'),
  validateResponse(pineconeSearchResponseSchema, 'pinecone'), 
  async (req, res, next) => {
    try {
      const {
        query,
        context = {},
        topK = 10,
        includeMetadata = true
      } = req.body;

      // Search documents
      const searchResults = await pineconeService.searchDocuments(query, context);

      res.json(searchResults);
    } catch (error) {
      next(error);
    }
  }
);

// GET /pinecone/stats - Get index statistics
router.get('/stats', 
  validate(pineconeStatsQuerySchema, 'query'),
  validateResponse(pineconeStatsResponseSchema, 'pinecone'), 
  async (req, res, next) => {
    try {
      const stats = await pineconeService.getIndexStatistics();
      
      const responseData = {
        success: true,
        data: stats
      };

      res.json(responseData);
    } catch (error) {
      next(error);
    }
  }
);

// GET /pinecone/documents/:docId/chunks - Get document chunks
router.get('/documents/:docId/chunks', 
  validate(pineconeDocumentChunksPathSchema, 'params'),
  validateResponse(pineconeDocumentChunksResponseSchema, 'pinecone'), 
  async (req, res, next) => {
    try {
      const { docId } = req.params;
      
      const chunks = await pineconeService.getDocumentChunks(docId);
      
      const responseData = {
        success: true,
        data: {
          documentId: docId,
          chunks,
          totalChunks: chunks.length
        }
      };

      res.json(responseData);
    } catch (error) {
      next(error);
    }
  }
);

// POST /pinecone/query - Enhanced query with context
router.post('/query', 
  validate(pineconeQueryRequestSchema, 'body'),
  validateResponse(pineconeQueryResponseSchema, 'pinecone'), 
  async (req, res, next) => {
    try {
      const {
        query,
        enhancedQuery,
        context = {},
        topK = 10,
        includeMetadata = true
      } = req.body;

      // Enhanced query with context
      const queryResults = await pineconeService.queryWithContext(
        query, 
        enhancedQuery, 
        context, 
        { topK, includeMetadata }
      );

      res.json(queryResults);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
