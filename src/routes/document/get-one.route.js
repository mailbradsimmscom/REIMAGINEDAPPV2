import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
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
router.get('/documents/:docId', 
  validate(documentGetQuerySchema, 'params'),
  async (req, res, next) => {
  try {
    const { docId } = req.params;
    
    const document = await documentService.getDocument(docId);
    
    if (!document) {
      const error = new Error('Document not found');
      error.status = 404;
      throw error;
    }
    
    const envelope = {
      success: true,
      data: document
    };

          return enforceResponse(res, envelope, 200);
  } catch (error) {
    next(error);
  }
});

export default router;
