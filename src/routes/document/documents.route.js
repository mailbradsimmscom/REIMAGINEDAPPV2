import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { requireSupabase } from '../../middleware/serviceGuards.js';
import {
  documentDocumentsQuerySchema,
  documentDocumentsResponseSchema
} from '../../schemas/document.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/docs/documents - List documents
// Validation runs first, then service guard checks Supabase availability
router.get('/',
  validate(documentDocumentsQuerySchema, 'query'),
  requireSupabase(),
  validateResponse(documentDocumentsResponseSchema),
  async (req, res, next) => {
    try {
      // Use validated query with defaults from schema
      const validated = req.validated?.query ?? req.query;
      const limit = Number(validated.limit) || 50;
      const offset = Number(validated.offset) || 0;
      const status = validated.status;

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

      return res.json(envelope);
    } catch (error) {
      return next(error);
    }
  }
);

// Method not allowed for all other methods
router.all('/', (req, res) => {
  return res.status(405).json({
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  });
});

export default router;
