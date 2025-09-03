import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { 
  documentDocumentsQuerySchema, 
  documentDocumentsResponseSchema 
} from '../../schemas/document.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/docs/documents - List documents
router.get('/', 
  validate(documentDocumentsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { limit, offset, status } = req.query;
      
      const documents = await documentService.listDocuments(limit, offset, status);
      
      const envelope = {
        success: true,
        data: {
          documents,
          count: documents.length,
          limit,
          offset
        }
      };

      res.json(enforceResponse(documentDocumentsResponseSchema, envelope));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
