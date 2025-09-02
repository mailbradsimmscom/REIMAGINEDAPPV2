import express from 'express';
import pineconeService from '../services/pinecone.service.js';
import { 
  pineconeSearchRequestSchema, 
  pineconeSearchResponseSchema,
  pineconeStatsQuerySchema,
  pineconeStatsResponseSchema
} from '../schemas/pinecone.schema.js';

const router = express.Router();

// POST /pinecone/search - Search documents
router.post('/search', async (req, res, next) => {
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

    // TODO: Re-enable response validation after debugging
    // const responseValidation = pineconeSearchResponseSchema.safeParse(searchResults);
    // if (!responseValidation.success) {
    //   throw new Error('Invalid response format');
    // }

    res.json(searchResults);
  } catch (error) {
    next(error);
  }
});

// GET /pinecone/stats - Get index statistics
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await pineconeService.getIndexStatistics();
    
    const responseData = {
      success: true,
      data: stats
    };

    // TODO: Re-enable response validation after debugging
    // const responseValidation = pineconeStatsResponseSchema.safeParse(responseData);
    // if (!responseValidation.success) {
    //   throw new Error('Invalid response format');
    // }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /pinecone/documents/:docId/chunks - Get document chunks
router.get('/documents/:docId/chunks', async (req, res, next) => {
  try {
    const { docId } = req.params;
    
    if (!docId) {
      const error = new Error('Document ID is required');
      error.status = 400;
      throw error;
    }

    const chunks = await pineconeService.getDocumentChunks(docId);
    
    res.json({
      success: true,
      data: {
        documentId: docId,
        chunks,
        totalChunks: chunks.length
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /pinecone/query - Enhanced query with context
router.post('/query', async (req, res, next) => {
  try {
    const {
      query,
      context = {},
      options = {}
    } = req.body;

    if (!query || typeof query !== 'string') {
      const error = new Error('Query is required and must be a string');
      error.status = 400;
      throw error;
    }

    // Enhanced search with context
    const searchResults = await pineconeService.searchDocuments(query, context);

    res.json(searchResults);
  } catch (error) {
    next(error);
  }
});

export default router;
