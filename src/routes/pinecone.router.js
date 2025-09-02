import express from 'express';
import pineconeService from '../services/pinecone.service.js';
import { validateResponse } from '../middleware/responseValidation.js';
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
router.post('/search', validateResponse(pineconeSearchResponseSchema, 'pinecone'), async (req, res, next) => {
  try {
    // Validate request data
    const validationResult = pineconeSearchRequestSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      const error = new Error('Invalid request data');
      error.name = 'ZodError';
      error.errors = validationResult.error.errors;
      throw error;
    }

    const {
      query,
      context = {},
      topK = 10,
      includeMetadata = true
    } = validationResult.data;

    // Search documents
    const searchResults = await pineconeService.searchDocuments(query, context);

    res.json(searchResults);
  } catch (error) {
    next(error);
  }
});

// GET /pinecone/stats - Get index statistics
router.get('/stats', validateResponse(pineconeStatsResponseSchema, 'pinecone'), async (req, res, next) => {
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
});

// GET /pinecone/documents/:docId/chunks - Get document chunks
router.get('/documents/:docId/chunks', validateResponse(pineconeDocumentChunksResponseSchema, 'pinecone'), async (req, res, next) => {
  try {
    const { docId } = req.params;
    
    // Validate path parameters
    const pathValidation = pineconeDocumentChunksPathSchema.safeParse({ docId });
    if (!pathValidation.success) {
      const error = new Error('Invalid path parameters');
      error.name = 'ZodError';
      error.errors = pathValidation.error.errors;
      throw error;
    }

    const { docId: validatedDocId } = pathValidation.data;
    const chunks = await pineconeService.getDocumentChunks(validatedDocId);
    
    const responseData = {
      success: true,
      data: {
        documentId: validatedDocId,
        chunks,
        totalChunks: chunks.length
      }
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// POST /pinecone/query - Enhanced query with context
router.post('/query', validateResponse(pineconeQueryResponseSchema, 'pinecone'), async (req, res, next) => {
  try {
    // Validate request body
    const validationResult = pineconeQueryRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      const error = new Error('Invalid request data');
      error.name = 'ZodError';
      error.errors = validationResult.error.errors;
      throw error;
    }

    const { query, context, options } = validationResult.data;

    // Enhanced search with context
    const searchResults = await pineconeService.searchDocuments(query, context);

    res.json(searchResults);
  } catch (error) {
    next(error);
  }
});

export default router;
