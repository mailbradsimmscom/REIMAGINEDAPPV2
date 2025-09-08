import { Router } from 'express';
import { logger } from '../../utils/logger.js';
import documentRepository from '../../repositories/document.repository.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { EnvelopeSchema } from '../../schemas/envelope.schema.js';

const router = Router();

// Add validateResponse middleware
router.use(validateResponse(EnvelopeSchema));

/**
 * GET /admin/docs/chunks/:docId
 * Get document chunks for a specific document
 */
router.get('/:docId', async (req, res, next) => {
  try {
    const { docId } = req.params;
    
    const requestLogger = logger.createRequestLogger();
    requestLogger.info('Fetching chunks for document', { docId });
    
    // Get chunks from repository
    const chunks = await documentRepository.getChunksByDocId(docId);
    
    requestLogger.info('Chunks fetched successfully', { 
      docId, 
      chunkCount: chunks.length 
    });
    
    res.json({
      success: true,
      data: {
        docId,
        chunks,
        count: chunks.length
      },
      requestId: requestLogger.requestId
    });
  } catch (error) {
    const requestLogger = logger.createRequestLogger();
    requestLogger.error('Failed to fetch chunks', { 
      error: error.message, 
      docId: req.params.docId 
    });
    next(error);
  }
});

export default router;
