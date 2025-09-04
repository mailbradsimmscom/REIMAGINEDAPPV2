import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { documentGetQuerySchema } from '../../schemas/document.schema.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { DocumentGetOneEnvelope } from '../../schemas/document.schema.js';
import { z } from 'zod';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// Apply response validation to all routes in this file
router.use(validateResponse(DocumentGetOneEnvelope));

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

          return res.json(envelope);
  } catch (error) {
    next(error);
  }
});

export default router;
