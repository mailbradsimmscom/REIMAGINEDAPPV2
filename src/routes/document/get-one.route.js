import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { validateResponse } from '../../middleware/responseValidation.js';
import { documentGetQuerySchema, documentGetResponseSchema } from '../../schemas/document.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/docs/documents/:docId - Get document details
router.get('/:docId', validateResponse(documentGetResponseSchema, 'document'), async (req, res, next) => {
  try {
    const { docId } = req.params;
    
    // Validate query parameters (docId from URL path)
    const validationResult = documentGetQuerySchema.safeParse({ docId });
    if (!validationResult.success) {
      const error = new Error('Invalid document ID');
      error.name = 'ZodError';
      error.errors = validationResult.error.errors;
      throw error;
    }

    const { docId: validatedDocId } = validationResult.data;
    
    const document = await documentService.getDocument(validatedDocId);
    
    if (!document) {
      const error = new Error('Document not found');
      error.status = 404;
      throw error;
    }
    
    const responseData = {
      success: true,
      data: document
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

export default router;
