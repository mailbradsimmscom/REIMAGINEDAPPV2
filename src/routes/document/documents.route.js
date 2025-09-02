import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { validateResponse } from '../../middleware/responseValidation.js';
import { documentDocumentsQuerySchema, documentDocumentsResponseSchema } from '../../schemas/document.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/docs/documents - List documents
router.get('/', validateResponse(documentDocumentsResponseSchema, 'document'), async (req, res, next) => {
  try {
    const { limit, offset } = req.query;
    
    // Build query parameters object
    const queryParams = {};
    if (limit !== undefined) queryParams.limit = limit;
    if (offset !== undefined) queryParams.offset = offset;

    // Validate query parameters
    const validationResult = documentDocumentsQuerySchema.safeParse(queryParams);
    
    if (!validationResult.success) {
      const error = new Error('Invalid query parameters');
      error.name = 'ZodError';
      error.errors = validationResult.error.errors;
      throw error;
    }

    const { limit: validatedLimit, offset: validatedOffset } = validationResult.data;
    
    const documents = await documentService.listDocuments(validatedLimit, validatedOffset);
    
    const responseData = {
      success: true,
      data: {
        documents,
        count: documents.length,
        limit: validatedLimit,
        offset: validatedOffset
      }
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

export default router;
