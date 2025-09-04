import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { EnvelopeSchema } from '../../schemas/envelope.schema.js';
import { 
  documentJobsQuerySchema, 
  documentJobsResponseSchema,
  documentGetQuerySchema,
  documentGetResponseSchema
} from '../../schemas/document.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// Apply response validation to all routes in this file
router.use(validateResponse(EnvelopeSchema));

// GET /admin/docs/jobs - List jobs
router.get('/', 
  validate(documentJobsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { limit, offset, status } = req.query;
      
      const jobs = await documentService.listJobs(limit, offset, status);
      
      const envelope = {
        success: true,
        data: {
          jobs,
          count: jobs.length,
          limit,
          offset
        }
      };

      return enforceResponse(res, envelope, 200);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
