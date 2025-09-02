import pineconeService from '../services/pinecone.service.js';
import { logger } from '../utils/logger.js';
import { validate } from '../middleware/validate.js';
import { 
  pineconeSearchRequestSchema, 
  pineconeSearchResponseSchema,
  pineconeStatsQuerySchema,
  pineconeStatsResponseSchema,
  pineconeErrorSchema 
} from '../schemas/pinecone.schema.js';

// POST /pinecone/search - Search documents
export async function pineconeSearchRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    // Parse request body
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    
    req.on('end', async () => {
      try {
        const body = Buffer.concat(chunks);
        const requestData = JSON.parse(body.toString());
        
        // Validate request data
        const validationResult = pineconeSearchRequestSchema.safeParse(requestData);
        
        if (!validationResult.success) {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({
            success: false,
            error: 'Invalid request data',
            details: validationResult.error.errors
          }));
          return;
        }

        const {
          query,
          context = {},
          topK = 10,
          includeMetadata = true
        } = validationResult.data;

        // Search documents
        const searchResults = await pineconeService.searchDocuments(query, context);

        // Validate response data
        const responseValidation = pineconeSearchResponseSchema.safeParse(searchResults);
        if (!responseValidation.success) {
          throw new Error('Invalid response format');
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(searchResults));

        requestLogger.info('Pinecone search completed', {
          query: query.substring(0, 100),
          resultsCount: searchResults.results?.length || 0
        });

      } catch (error) {
        requestLogger.error('Failed to process search request', { error: error.message });
        
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
      }
    });

  } catch (error) {
    requestLogger.error('Failed to handle search request', { error: error.message });
    
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'Internal server error'
    }));
  }
}

// GET /pinecone/stats - Get index statistics
export async function pineconeStatsRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const stats = await pineconeService.getIndexStatistics();
    
    const responseData = {
      success: true,
      data: stats
    };
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(responseData));

    requestLogger.info('Pinecone stats retrieved', {
      totalVectors: stats.totalVectors,
      dimension: stats.dimension
    });

  } catch (error) {
    requestLogger.error('Failed to get Pinecone stats', { error: error.message });
    
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to get index statistics'
    }));
  }
}

// GET /pinecone/document/:docId/chunks - Get document chunks
export async function pineconeDocumentChunksRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const url = new URL(req.url, 'http://localhost');
    const docId = url.pathname.split('/').pop();
    
    if (!docId) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: 'Document ID is required'
      }));
      return;
    }

    const topK = parseInt(url.searchParams.get('topK') || '50');
    const chunks = await pineconeService.getDocumentChunks(docId, { topK });
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      data: {
        documentId: docId,
        chunks,
        totalChunks: chunks.length
      }
    }));

    requestLogger.info('Document chunks retrieved', {
      documentId: docId,
      chunksCount: chunks.length
    });

  } catch (error) {
    requestLogger.error('Failed to get document chunks', { error: error.message });
    
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to get document chunks'
    }));
  }
}

// POST /pinecone/query - Enhanced query with context
export async function pineconeQueryRoute(req, res) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    // Parse request body
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    
    req.on('end', async () => {
      try {
        const body = Buffer.concat(chunks);
        const requestData = JSON.parse(body.toString());
        
        const {
          query,
          context = {},
          options = {}
        } = requestData;

        if (!query || typeof query !== 'string') {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({
            success: false,
            error: 'Query is required and must be a string'
          }));
          return;
        }

        // Enhanced search with context
        const searchResults = await pineconeService.searchDocuments(query, context);

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(searchResults));

        requestLogger.info('Enhanced query completed', {
          query: query.substring(0, 100),
          contextKeys: Object.keys(context),
          resultsCount: searchResults.results?.length || 0
        });

      } catch (error) {
        requestLogger.error('Failed to process enhanced query', { error: error.message });
        
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          success: false,
          error: error.message
        }));
      }
    });

  } catch (error) {
    requestLogger.error('Failed to handle enhanced query', { error: error.message });
    
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'Internal server error'
    }));
  }
}

export const pineconeRoutes = {
  pineconeSearchRoute,
  pineconeStatsRoute,
  pineconeDocumentChunksRoute,
  pineconeQueryRoute
};
