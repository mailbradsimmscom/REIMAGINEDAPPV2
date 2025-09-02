import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { validateResponse } from '../../middleware/responseValidation.js';
import { documentJobsQuerySchema, documentJobsResponseSchema } from '../../schemas/document.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/docs/jobs - List jobs
router.get('/', validateResponse(documentJobsResponseSchema, 'document'), async (req, res, next) => {
  try {
    const { limit, offset, status } = req.query;
    
    // Build query parameters object
    const queryParams = {};
    if (limit !== undefined) queryParams.limit = limit;
    if (offset !== undefined) queryParams.offset = offset;
    if (status !== undefined) queryParams.status = status;

    // Validate query parameters
    const validationResult = documentJobsQuerySchema.safeParse(queryParams);
    
    if (!validationResult.success) {
      const error = new Error('Invalid query parameters');
      error.name = 'ZodError';
      error.errors = validationResult.error.errors;
      throw error;
    }

    const { limit: validatedLimit, offset: validatedOffset, status: validatedStatus } = validationResult.data;
    
    const jobs = await documentService.listJobs(validatedLimit, validatedOffset, validatedStatus);
    
    const responseData = {
      success: true,
      data: {
        jobs,
        count: jobs.length,
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
