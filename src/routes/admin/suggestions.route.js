/**
 * Admin Suggestions Route
 * Handles DIP suggestion review and approval
 */

import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { adminOnly } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import suggestionsRepository from '../../repositories/suggestions.repository.js';
import viewRefreshService from '../../services/viewRefresh.service.js';
import suggestionsMergeService from '../../services/suggestions.merge.service.js';

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
    spec_suggestions: z.array(z.object({
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
    })).optional().default([]),
    playbook_hints: z.array(z.object({
      text: z.string(),
      trigger: z.string().optional(),
      page: z.number().optional(),
      context: z.string().optional(),
      confidence: z.number().min(0).max(1).optional()
    })).optional().default([])
  })
});

// GET /admin/suggestions/view-health - Check knowledge_facts view health
router.get('/view-health', adminOnly, async (req, res) => {
  try {
    const health = await viewRefreshService.checkViewHealth();
    const stats = await viewRefreshService.getViewRefreshStats();
    
    res.json({
      success: true,
      data: {
        health,
        stats: stats.data,
        timestamp: new Date().toISOString()
      },
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('View health check failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to check view health',
      requestId: req.id
    });
  }
});

// POST /admin/suggestions/refresh-view - Manually refresh knowledge_facts view
router.post('/refresh-view', adminOnly, async (req, res) => {
  try {
    const result = await viewRefreshService.refreshKnowledgeFactsViewSafe();
    
    requestLogger.info('Manual view refresh requested', { 
      success: result.success,
      method: result.method,
      error: result.error
    });
    
    res.json({
      success: result.success,
      data: {
        refresh_result: result,
        timestamp: new Date().toISOString()
      },
      error: result.success ? null : result.error
    });
  } catch (error) {
    requestLogger.error('Manual view refresh failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to refresh view',
      requestId: req.id
    });
  }
});

// GET /admin/suggestions/pending
// Returns list of completed DIP jobs with suggestions
router.get('/pending', adminOnly, async (req, res) => {
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
        created_at,
        documents!inner(
          doc_id,
          manufacturer,
          model,
          manufacturer_norm,
          model_norm
        )
      `)
      .eq('job_type', 'DIP')
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      requestLogger.error('Failed to fetch pending DIP jobs', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch pending suggestions'
      });
    }

    // Handle empty case gracefully
    if (!jobs || jobs.length === 0) {
      requestLogger.info('No pending DIP suggestions found');
      return res.json({
        success: true,
        data: {
          suggestions: [],
          count: 0,
          message: 'No DIP suggestions available. Upload documents to generate suggestions.'
        }
      });
    }

    // Format response
    const suggestions = jobs.map(job => ({
      job_id: job.job_id,
      doc_id: job.doc_id,
      file_name: `${job.documents?.manufacturer || 'Unknown'} ${job.documents?.model || 'Unknown'}`,
      manufacturer: job.documents?.manufacturer || 'Unknown',
      model: job.documents?.model || 'Unknown',
      created_at: job.created_at,
      type: 'dip_completed',
      value: `DIP processing completed for ${job.documents?.manufacturer || 'Unknown'} ${job.documents?.model || 'Unknown'}`,
      confidence: 1.0,
      page: null,
      context: `Document: ${job.documents?.manufacturer_norm || job.documents?.manufacturer || 'Unknown'} ${job.documents?.model_norm || job.documents?.model || 'Unknown'}`
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
router.get('/:docId', adminOnly, validate(z.object({
  docId: z.string().uuid('Document ID must be a valid UUID')
}), 'params'), async (req, res) => {
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
router.post('/approve', adminOnly, validate(approveSuggestionsSchema, 'body'), async (req, res) => {
  try {
    const { doc_id, approved } = req.body;
    const approved_by = req.user?.id || 'admin';
    
    const results = {
      entities: { inserted: 0, errors: [] },
      spec_suggestions: { inserted: 0, errors: [] },
      golden_tests: { inserted: 0, errors: [] },
      playbook_hints: { inserted: 0, errors: [] }
    };

    // Add approval metadata to suggestions
    const approvedWithMetadata = {
      entities: approved.entities?.map(entity => ({
        ...entity,
        approved_at: new Date().toISOString(),
        approved_by
      })) || [],
      spec_suggestions: approved.spec_suggestions?.map(spec => ({
        ...spec,
        approved_at: new Date().toISOString(),
        approved_by
      })) || [],
      golden_tests: approved.golden_tests?.map(test => ({
        ...test,
        approved_at: new Date().toISOString(),
        approved_by
      })) || [],
      playbook_hints: approved.playbook_hints?.map(hint => ({
        ...hint,
        approved_at: new Date().toISOString(),
        approved_by
      })) || []
    };

    // Step 1: Store approved suggestions in suggestion tables (for audit trail)
    if (approvedWithMetadata.entities.length > 0) {
      for (const entity of approvedWithMetadata.entities) {
        try {
          await suggestionsRepository.insertEntityCandidate(doc_id, entity, approved_by);
          results.entities.inserted++;
        } catch (error) {
          results.entities.errors.push(error.message);
        }
      }
    }

    if (approvedWithMetadata.spec_suggestions.length > 0) {
      for (const spec of approvedWithMetadata.spec_suggestions) {
        try {
          await suggestionsRepository.insertSpecSuggestion(doc_id, spec, approved_by);
          results.spec_suggestions.inserted++;
        } catch (error) {
          results.spec_suggestions.errors.push(error.message);
        }
      }
    }

    if (approvedWithMetadata.golden_tests.length > 0) {
      for (const test of approvedWithMetadata.golden_tests) {
        try {
          await suggestionsRepository.insertGoldenTest(doc_id, test, approved_by);
          results.golden_tests.inserted++;
        } catch (error) {
          results.golden_tests.errors.push(error.message);
        }
      }
    }

    if (approvedWithMetadata.playbook_hints.length > 0) {
      for (const hint of approvedWithMetadata.playbook_hints) {
        try {
          await suggestionsRepository.insertPlaybookHint(doc_id, hint, approved_by);
          results.playbook_hints.inserted++;
        } catch (error) {
          results.playbook_hints.errors.push(error.message);
        }
      }
    }

    // Step 2: Merge approved suggestions into production tables
    let mergeResult = null;
    try {
      mergeResult = await suggestionsMergeService.mergeAllSuggestions(doc_id, approvedWithMetadata);
      requestLogger.info('Suggestions merged to production tables', {
        doc_id,
        mergeResult
      });
    } catch (error) {
      requestLogger.error('Failed to merge suggestions to production', {
        error: error.message,
        doc_id
      });
      // Don't fail the entire operation, but log the error
      mergeResult = { error: error.message };
    }

    const totalInserted = results.entities.inserted + 
                         results.spec_suggestions.inserted + 
                         results.golden_tests.inserted + 
                         results.playbook_hints.inserted;
    
    const hasErrors = results.entities.errors.length > 0 || 
                     results.spec_suggestions.errors.length > 0 || 
                     results.golden_tests.errors.length > 0 ||
                     results.playbook_hints.errors.length > 0;

    // Refresh knowledge_facts view if any suggestions were approved
    let viewRefreshResult = null;
    if (totalInserted > 0) {
      try {
        viewRefreshResult = await viewRefreshService.refreshKnowledgeFactsViewSafe();
        requestLogger.info('View refresh attempted after approval', { 
          success: viewRefreshResult.success,
          method: viewRefreshResult.method,
          error: viewRefreshResult.error
        });
      } catch (error) {
        requestLogger.error('View refresh failed after approval', { error: error.message });
        viewRefreshResult = { success: false, error: error.message };
      }
    }

    requestLogger.info('DIP suggestions approved', { 
      doc_id, 
      totalInserted,
      hasErrors,
      viewRefresh: viewRefreshResult,
      breakdown: {
        entities: results.entities.inserted,
        spec_suggestions: results.spec_suggestions.inserted,
        golden_tests: results.golden_tests.inserted,
        playbook_hints: results.playbook_hints.inserted
      }
    });

    return res.json({
      success: !hasErrors,
      data: {
        doc_id,
        results,
        total_inserted: totalInserted,
        view_refresh: viewRefreshResult,
        merge_to_production: mergeResult
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