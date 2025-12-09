import express from 'express';
import documentService from '../../services/document.service.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { requireSupabase } from '../../middleware/serviceGuards.js';
import { DocumentJobsEnvelope } from '../../schemas/document.schema.js';
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
router.use(validateResponse(DocumentJobsEnvelope));

// GET /admin/docs/jobs - List jobs
router.get('/',
  validate(documentJobsQuerySchema, 'query'),
  requireSupabase(),
  async (req, res, next) => {
    try {
      // Use validated query with defaults from schema
      const validated = req.validated?.query ?? req.query;
      const limit = Number(validated.limit) || 50;
      const offset = Number(validated.offset) || 0;
      const status = validated.status;

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

      return res.json(envelope);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
