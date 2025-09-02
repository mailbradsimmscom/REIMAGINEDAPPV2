import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { 
  documentJobsQuerySchema, 
  documentJobsResponseSchema,
  documentGetQuerySchema,
  documentGetResponseSchema
} from '../../schemas/document.schema.js';

const router = express.Router();

// Apply admin gate middleware
router.use(adminGate);

// GET /admin/docs/jobs - List jobs
router.get('/', 
  validate(documentJobsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { limit, offset, status } = req.query;
      
      const jobs = await documentService.listJobs(limit, offset, status);
      
      const responseData = {
        success: true,
        data: {
          jobs,
          count: jobs.length,
          limit,
          offset
        }
      };

      res.json(responseData);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
