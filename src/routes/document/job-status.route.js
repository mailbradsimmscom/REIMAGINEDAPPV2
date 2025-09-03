import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { documentJobStatusPathSchema, documentJobStatusResponseSchema } from '../../schemas/document.schema.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { z } from 'zod';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

const EnvelopeOk = z.object({
  success: z.literal(true),
  data: z.any()
});

// GET /admin/docs/jobs/:jobId - Get job status
router.get('/jobs/:jobId', async (req, res, next) => {
  try {
    const { jobId } = req.params;
    
    // Validate path parameters
    const pathValidation = documentJobStatusPathSchema.safeParse({ jobId });
    if (!pathValidation.success) {
      const error = new Error('Invalid path parameters');
      error.name = 'ZodError';
      error.errors = pathValidation.error.errors;
      throw error;
    }

    const { jobId: validatedJobId } = pathValidation.data;
    const job = await documentService.getJobStatus(validatedJobId);
    
    if (!job) {
      const error = new Error('Job not found');
      error.status = 404;
      throw error;
    }
    
    const envelope = {
      success: true,
      data: job
    };

          return enforceResponse(res, envelope, 200);
  } catch (error) {
    next(error);
  }
});

export default router;
