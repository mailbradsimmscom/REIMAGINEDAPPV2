import express from 'express';
import documentService from '../../services/document.service.js';
import documentRepository from '../../repositories/document.repository.js';
import { createSystem } from '../../repositories/system-management.repository.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { adminGate } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import { requireSupabase } from '../../middleware/serviceGuards.js';
import { documentJobStatusPathSchema } from '../../schemas/document.schema.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { JobStatusEnvelope } from '../../schemas/document.schema.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();
const log = logger.createRequestLogger();

// Apply admin gate middleware
router.use(adminGate);

// Apply response validation to all routes in this file
router.use(validateResponse(JobStatusEnvelope));

// GET /admin/docs/jobs/:jobId - Get job status
router.get('/:jobId',
  validate(documentJobStatusPathSchema, 'params'),
  requireSupabase(),
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

/**
 * POST /document/jobs/:jobId/model-selection
 * Submit user's model selection for a multi-model document
 * This unblocks the pipeline from model_selection stage
 */
router.post('/:jobId/model-selection',
  requireSupabase(),
  async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const { selected_models } = req.body;

      log.info('Model selection received', { jobId, selected_models });

      // Validate input
      if (!selected_models || !Array.isArray(selected_models) || selected_models.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'selected_models must be a non-empty array' }
        });
      }

      // Get current job
      const job = await documentService.getJobStatus(jobId);
      if (!job) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Job not found' }
        });
      }

      // Verify job is in model_selection stage
      if (job.status_v2 !== 'model_selection') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_STATE',
            message: `Job is not awaiting model selection (current stage: ${job.status_v2})`
          }
        });
      }

      // Update job with selected models
      await documentRepository.updateJobStatus(jobId, job.status, {
        selected_models
      });

      log.info('Model selection saved, resuming processing', { jobId, selected_models });

      // Resume the job processing (fire and forget)
      documentService.processJob(jobId).catch(error => {
        log.error('Failed to resume job after model selection', {
          jobId,
          error: error.message
        });
      });

      return res.json({
        success: true,
        data: {
          jobId,
          selected_models,
          message: 'Model selection saved, processing resumed'
        }
      });

    } catch (error) {
      log.error('Model selection failed', { error: error.message, jobId: req.params.jobId });
      next(error);
    }
  }
);

/**
 * POST /document/jobs/:jobId/confirm-systems
 * Document-first flow: Create systems from detected models and resume pipeline
 * Called from onboarding.html after user confirms which models they have
 */
router.post('/:jobId/confirm-systems',
  requireSupabase(),
  async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const { systems, manufacturer, product_category } = req.body;

      log.info('Confirm systems request received', {
        jobId,
        systemCount: systems?.length,
        manufacturer
      });

      // Validate input
      if (!systems || !Array.isArray(systems) || systems.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'systems must be a non-empty array' }
        });
      }

      // Get current job
      const job = await documentService.getJobStatus(jobId);
      if (!job) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Job not found' }
        });
      }

      // Get doc_id from job
      const docId = job.doc_id;
      if (!docId) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_STATE', message: 'Job has no associated document' }
        });
      }

      const supabase = await getSupabaseClient();
      const createdSystems = [];
      const documentSystemLinks = [];

      // Create each system
      for (const systemData of systems) {
        try {
          // Prepare system record
          const systemRecord = {
            manufacturer_norm: systemData.manufacturer_norm || manufacturer,
            model_norm: systemData.model_norm,
            description: systemData.model_norm, // Use model as default description
            serial_number: systemData.serial_number || null,
            location: systemData.location || null,
            source: 'document',
            detected_from_doc_id: docId
          };

          // Create system
          const createdSystem = await createSystem(systemRecord);
          createdSystems.push(createdSystem);

          // Prepare document_systems link
          documentSystemLinks.push({
            doc_id: docId,
            asset_uid: createdSystem.asset_uid,
            is_primary: systemData.is_primary !== false
          });

          log.info('System created', {
            assetUid: createdSystem.asset_uid,
            model: systemData.model_norm
          });

        } catch (systemError) {
          log.error('Failed to create system', {
            error: systemError.message,
            model: systemData.model_norm
          });
          // Continue with other systems even if one fails
        }
      }

      // Create document_systems links
      if (documentSystemLinks.length > 0) {
        try {
          const { error: linkError } = await supabase
            .from('document_systems')
            .insert(documentSystemLinks);

          if (linkError) {
            log.error('Failed to create document_systems links', {
              error: linkError.message,
              count: documentSystemLinks.length
            });
          } else {
            log.info('Document-system links created', {
              count: documentSystemLinks.length
            });
          }
        } catch (linkError) {
          log.error('Error creating document_systems links', {
            error: linkError.message
          });
        }
      }

      // Get the model names for DIP filtering
      const selectedModels = systems.map(s => s.model_norm);

      // Update job with selected models and resume processing
      await documentRepository.updateJobStatus(jobId, job.status, {
        selected_models: selectedModels,
        systems_created: createdSystems.length
      });

      log.info('Systems confirmed, resuming processing', {
        jobId,
        systemsCreated: createdSystems.length,
        selectedModels
      });

      // Resume the job processing (fire and forget)
      documentService.processJob(jobId).catch(error => {
        log.error('Failed to resume job after system confirmation', {
          jobId,
          error: error.message
        });
      });

      return res.json({
        success: true,
        data: {
          jobId,
          systems_created: createdSystems.length,
          document_links_created: documentSystemLinks.length,
          selected_models: selectedModels,
          message: 'Systems created, processing resumed'
        }
      });

    } catch (error) {
      log.error('Confirm systems failed', {
        error: error.message,
        jobId: req.params.jobId
      });
      next(error);
    }
  }
);

export default router;
