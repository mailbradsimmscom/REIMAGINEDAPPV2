import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { documentGetQuerySchema, documentGetResponseSchema } from '../../schemas/document.schema.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { z } from 'zod';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

const EnvelopeOk = z.object({
  success: z.literal(true),
  data: z.any()
});

// GET /admin/docs/documents/:docId - Get document details
router.get('/documents/:docId', async (req, res, next) => {
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
    
    const envelope = {
      success: true,
      data: document
    };

    res.json(enforceResponse(EnvelopeOk, envelope));
  } catch (error) {
    next(error);
  }
});

export default router;
