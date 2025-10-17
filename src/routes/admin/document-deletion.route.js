import express from 'express';
import { z } from 'zod';
import { DocumentDeletionService } from '../../services/document-deletion.service.js';
import { adminOnly } from '../../middleware/admin.js';

const router = express.Router();
const deletionService = new DocumentDeletionService();

// Apply admin authentication to all routes
router.use(adminOnly);

// Zod schemas
const deletionOptionsSchema = z.object({
  documents_table: z.boolean(),
  storage_all: z.boolean(),
  storage_manual: z.boolean(),
  storage_dip: z.boolean(),
  document_chunks: z.boolean(),
  jobs: z.boolean(),
  pinecone: z.boolean(),
  staging_specs: z.boolean(),
  staging_procedures: z.boolean(),
  staging_qa: z.boolean(),
  staging_golden: z.boolean(),
  production_specs: z.boolean(),
  production_procedures: z.boolean(),
  production_qa: z.boolean(),
  production_golden: z.boolean(),
  colloquial_keywords: z.boolean(),
  manual_flag: z.boolean()
});

const deletionRequestSchema = z.object({
  deletionOptions: deletionOptionsSchema,
  confirmation: z.string(),
  reason: z.string().optional()
});

/**
 * GET /admin/api/documents/:docId/deletion-preview
 * Get preview of what would be deleted
 */
router.get('/documents/:docId/deletion-preview', async (req, res) => {
  try {
    const { docId } = req.params;

    const preview = await deletionService.getDeletionPreview(docId);

    return res.json({
      success: true,
      data: preview,
      requestId: res.locals.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        message: error.message,
        code: 'DELETION_PREVIEW_ERROR'
      },
      requestId: res.locals.requestId
    });
  }
});

/**
 * DELETE /admin/api/documents/:docId
 * Execute document deletion with audit trail
 */
router.delete('/documents/:docId', async (req, res) => {
  try {
    const { docId } = req.params;

    // Validate request body
    const validationResult = deletionRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid deletion options',
          details: validationResult.error.issues
        },
        requestId: res.locals.requestId
      });
    }

    const { deletionOptions, confirmation, reason } = validationResult.data;

    // Verify confirmation matches doc ID
    if (confirmation !== docId.toUpperCase()) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Confirmation code does not match document ID',
          code: 'INVALID_CONFIRMATION'
        },
        requestId: res.locals.requestId
      });
    }

    // Execute deletion
    const result = await deletionService.deleteDocument(
      docId,
      deletionOptions,
      'admin@system', // TODO: Get from auth context
      reason
    );

    return res.json({
      success: true,
      data: result,
      message: 'Document deletion completed',
      requestId: res.locals.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        message: error.message,
        code: 'DELETION_ERROR'
      },
      requestId: res.locals.requestId
    });
  }
});

export default router;