/**
 * Admin Suggestions Route
 * Handles DIP suggestion review and approval
 */

import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { isAdmin } from '../middleware/admin.js';
import { validateRequest } from '../middleware/validate.js';

const router = Router();
const requestLogger = logger.createRequestLogger();

// Schema for DIP suggestion approval
const approveSuggestionsSchema = z.object({
  doc_id: z.string().uuid('Document ID must be a valid UUID'),
  approved: z.object({
    entities: z.array(z.object({
      entity_type: z.string(),
      value: z.string(),
      page: z.number().optional(),
      context: z.string().optional(),
      confidence: z.number().min(0).max(1).optional()
    })).optional().default([]),
    specs: z.array(z.object({
      hint_type: z.string(),
      value: z.string(),
      unit: z.string().optional(),
      page: z.number().optional(),
      context: z.string().optional(),
      confidence: z.number().min(0).max(1).optional()
    })).optional().default([]),
    golden_tests: z.array(z.object({
      test_name: z.string(),
      test_type: z.string(),
      description: z.string().optional(),
      steps: z.array(z.string()).optional(),
      expected_result: z.string().optional(),
      page: z.number().optional(),
      confidence: z.number().min(0).max(1).optional()
    })).optional().default([])
  })
});

// GET /admin/suggestions/pending
// Returns list of completed DIP jobs with suggestions
router.get('/pending', isAdmin, async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({
        success: false,
        error: 'Database service unavailable'
      });
    }

    // Get completed DIP jobs
    const { data: jobs, error } = await supabase
      .from('jobs')
      .select(`
        job_id,
        doc_id,
        status,
        dip_success,
        counters,
        created_at,
        documents!inner(
          doc_id,
          manufacturer,
          model,
          file_name
        )
      `)
      .eq('job_type', 'DIP')
      .eq('status', 'completed')
      .eq('dip_success', true)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      requestLogger.error('Failed to fetch pending DIP jobs', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch pending suggestions'
      });
    }

    // Format response
    const suggestions = jobs.map(job => ({
      job_id: job.job_id,
      doc_id: job.doc_id,
      file_name: job.documents?.file_name || 'Unknown',
      manufacturer: job.documents?.manufacturer || 'Unknown',
      model: job.documents?.model || 'Unknown',
      created_at: job.created_at,
      entities_count: job.counters?.entities_extracted || 0,
      specs_count: job.counters?.spec_hints_found || 0,
      tests_count: job.counters?.golden_tests_generated || 0
    }));

    requestLogger.info('Fetched pending DIP suggestions', { count: suggestions.length });

    return res.json({
      success: true,
      data: {
        suggestions,
        count: suggestions.length
      }
    });

  } catch (error) {
    requestLogger.error('Error fetching pending suggestions', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /admin/suggestions/:docId
// Returns DIP suggestions for a specific document
router.get('/:docId', isAdmin, validateRequest({
  params: z.object({
    docId: z.string().uuid('Document ID must be a valid UUID')
  })
}), async (req, res) => {
  try {
    const { docId } = req.params;
    const supabase = await getSupabaseClient();
    
    if (!supabase) {
      return res.status(503).json({
        success: false,
        error: 'Database service unavailable'
      });
    }

    // Get DIP files from Supabase Storage
    const dipFiles = {};
    const fileTypes = ['entities', 'spec_hints', 'golden_tests', 'summary'];
    
    for (const fileType of fileTypes) {
      try {
        const fileName = `${docId}_${fileType}.json`;
        const storagePath = `manuals/${docId}/DIP/${fileName}`;
        
        const { data: fileData, error: fileError } = await supabase.storage
          .from('documents')
          .download(storagePath);

        if (fileError) {
          requestLogger.warn(`DIP file not found: ${fileName}`, { error: fileError.message });
          dipFiles[fileType] = null;
        } else {
          const content = await fileData.text();
          dipFiles[fileType] = JSON.parse(content);
        }
      } catch (error) {
        requestLogger.error(`Error loading DIP file ${fileType}`, { error: error.message });
        dipFiles[fileType] = null;
      }
    }

    requestLogger.info('Loaded DIP suggestions', { docId, filesLoaded: Object.keys(dipFiles).length });

    return res.json({
      success: true,
      data: {
        doc_id: docId,
        dip_files: dipFiles
      }
    });

  } catch (error) {
    requestLogger.error('Error loading DIP suggestions', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /admin/suggestions/approve
// Approves selected DIP suggestions
router.post('/approve', isAdmin, validateRequest({
  body: approveSuggestionsSchema
}), async (req, res) => {
  try {
    const { doc_id, approved } = req.body;
    const supabase = await getSupabaseClient();
    
    if (!supabase) {
      return res.status(503).json({
        success: false,
        error: 'Database service unavailable'
      });
    }

    const results = {
      entities: { inserted: 0, errors: [] },
      specs: { inserted: 0, errors: [] },
      tests: { inserted: 0, errors: [] }
    };

    // Insert approved entities
    if (approved.entities && approved.entities.length > 0) {
      try {
        const entityData = approved.entities.map(entity => ({
          doc_id,
          entity_type: entity.entity_type,
          value: entity.value,
          page: entity.page,
          context: entity.context,
          confidence: entity.confidence,
          approved_by: req.user?.id || 'admin'
        }));

        const { data, error } = await supabase
          .from('entity_candidates')
          .insert(entityData)
          .select();

        if (error) {
          results.entities.errors.push(error.message);
        } else {
          results.entities.inserted = data.length;
        }
      } catch (error) {
        results.entities.errors.push(error.message);
      }
    }

    // Insert approved spec hints
    if (approved.specs && approved.specs.length > 0) {
      try {
        const specData = approved.specs.map(spec => ({
          doc_id,
          hint_type: spec.hint_type,
          value: spec.value,
          unit: spec.unit,
          page: spec.page,
          context: spec.context,
          confidence: spec.confidence,
          approved_by: req.user?.id || 'admin'
        }));

        const { data, error } = await supabase
          .from('spec_suggestions')
          .insert(specData)
          .select();

        if (error) {
          results.specs.errors.push(error.message);
        } else {
          results.specs.inserted = data.length;
        }
      } catch (error) {
        results.specs.errors.push(error.message);
      }
    }

    // Insert approved golden tests
    if (approved.golden_tests && approved.golden_tests.length > 0) {
      try {
        const testData = approved.golden_tests.map(test => ({
          doc_id,
          test_name: test.test_name,
          test_type: test.test_type,
          description: test.description,
          steps: test.steps,
          expected_result: test.expected_result,
          page: test.page,
          confidence: test.confidence,
          approved_by: req.user?.id || 'admin'
        }));

        const { data, error } = await supabase
          .from('playbook_hints')
          .insert(testData)
          .select();

        if (error) {
          results.tests.errors.push(error.message);
        } else {
          results.tests.inserted = data.length;
        }
      } catch (error) {
        results.tests.errors.push(error.message);
      }
    }

    const totalInserted = results.entities.inserted + results.specs.inserted + results.tests.inserted;
    const hasErrors = results.entities.errors.length > 0 || 
                     results.specs.errors.length > 0 || 
                     results.tests.errors.length > 0;

    requestLogger.info('DIP suggestions approved', { 
      doc_id, 
      totalInserted,
      hasErrors 
    });

    return res.json({
      success: !hasErrors,
      data: {
        doc_id,
        results,
        total_inserted: totalInserted
      },
      error: hasErrors ? 'Some suggestions failed to save' : null
    });

  } catch (error) {
    requestLogger.error('Error approving DIP suggestions', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

export default router;