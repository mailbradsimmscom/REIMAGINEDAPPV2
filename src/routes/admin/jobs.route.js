/**
 * Admin jobs management route
 * Provides manual job processing triggers for testing and debugging
 */

import { Router } from 'express';
import { logger } from '../../utils/logger.js';
import jobProcessor from '../../services/job.processor.js';
import documentRepository from '../../repositories/document.repository.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { EnvelopeSchema } from '../../schemas/envelope.schema.js';

const router = Router();
const log = logger.createRequestLogger();

// Add validateResponse middleware
router.use(validateResponse(EnvelopeSchema));

/**
 * POST /admin/jobs/process-next
 * Manually trigger processing of the next queued job
 */
router.post('/process-next', async (req, res, next) => {
  try {
    log.info('Manual job processing triggered');
    
    // Get the next queued job
    const queuedJobs = await documentRepository.getJobsByStatus('queued', 1);
    
    if (queuedJobs.length === 0) {
      return res.json({
        success: true,
        data: {
          message: 'No queued jobs found',
          processed: false
        }
      });
    }
    
    const job = queuedJobs[0];
    log.info('Processing job manually', { jobId: job.job_id, docId: job.doc_id });
    
    // Process the job using the existing processor
    await jobProcessor.processJob(job.job_id);
    
    log.info('Manual job processing completed', { jobId: job.job_id });
    
    res.json({
      success: true,
      data: {
        message: 'Job processed successfully',
        jobId: job.job_id,
        docId: job.doc_id,
        processed: true
      }
    });
    
  } catch (error) {
    log.error('Manual job processing failed', { error: error.message });
    next(error);
  }
});

/**
 * GET /admin/jobs/queue
 * List queued jobs for inspection
 */
router.get('/queue', async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;
    
    const queuedJobs = await documentRepository.getJobsByStatus('queued', Number(limit));
    
    res.json({
      success: true,
      data: {
        jobs: queuedJobs.map(job => ({
          job_id: job.job_id,
          doc_id: job.doc_id,
          status: job.status,
          created_at: job.created_at,
          storage_path: job.storage_path
        })),
        count: queuedJobs.length
      }
    });
    
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/jobs/status
 * Get job processor status
 */
router.get('/status', async (req, res, next) => {
  try {
    const status = jobProcessor.getStatus();
    
    res.json({
      success: true,
      data: {
        processor: status,
        message: 'Job processor status retrieved'
      }
    });
    
  } catch (error) {
    next(error);
  }
});

export default router;
