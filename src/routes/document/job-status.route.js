import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { documentJobStatusPathSchema } from '../../schemas/document.schema.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { JobStatusEnvelope } from '../../schemas/document.schema.js';
import { z } from 'zod';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// Apply response validation to all routes in this file
router.use(validateResponse(JobStatusEnvelope));

// GET /admin/docs/jobs/:jobId - Get job status
router.get('/jobs/:jobId', 
  validate(documentJobStatusPathSchema, 'params'),
  async (req, res, next) => {
  try {
    const { jobId } = req.params;
    
    const job = await documentService.getJobStatus(jobId);
    
    if (!job) {
      const error = new Error('Job not found');
      error.status = 404;
      throw error;
    }
    
    const envelope = {
      success: true,
      data: job
    };

          return res.json(envelope);
  } catch (error) {
    next(error);
  }
});

export default router;
