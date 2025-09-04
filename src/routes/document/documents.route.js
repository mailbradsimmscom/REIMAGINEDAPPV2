import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { 
  documentDocumentsQuerySchema, 
  documentDocumentsResponseSchema 
} from '../../schemas/document.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// Apply response validation
router.use(validateResponse(documentDocumentsResponseSchema));

// GET /admin/docs/documents - List documents
router.get('/', 
  validate(documentDocumentsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { limit, offset, status } = req.query;
      
      const documents = await documentService.listDocuments(Number(limit), Number(offset), status);
      
      const envelope = {
        success: true,
        data: {
          documents,
          count: documents.length,
          limit: Number(limit),
          offset: Number(offset)
        },
        error: null,
      };

      // Optional: Validate response schema if RESPONSE_VALIDATE=1
      // documentDocumentsResponseSchema.parse(envelope);

      return res.json(envelope);
    } catch (error) {
      return next(error);
    }
  }
);

// Method not allowed for all other methods
router.all('/', (req, res) => {
  return res.json({
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  }, 405);
});

export default router;
