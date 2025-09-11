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

    // Get pending entity candidates
    const { data: entityCandidates, error: candidatesError } = await supabase
      .from('entity_candidates')
      .select(`
        id,
        doc_id,
        entity_type,
        value,
        page,
        context,
        confidence,
        status,
        created_at,
        documents(
          doc_id,
          manufacturer,
          model,
          manufacturer_norm,
          model_norm
        )
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50);

    if (candidatesError) {
      requestLogger.error('Failed to fetch entity candidates', { error: candidatesError.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch entity candidates'
      });
    }

    // Format entity candidate suggestions
    const entitySuggestions = (entityCandidates || []).map(candidate => ({
      id: candidate.id,
      doc_id: candidate.doc_id,
      file_name: `${candidate.documents?.manufacturer || 'Unknown'} ${candidate.documents?.model || 'Unknown'}`,
      manufacturer: candidate.documents?.manufacturer || 'Unknown',
      model: candidate.documents?.model || 'Unknown',
      created_at: candidate.created_at,
      type: 'entity_candidate',
      entity_type: candidate.entity_type,
      value: candidate.value,
      confidence: candidate.confidence,
      page: candidate.page,
      context: candidate.context
    }));

    requestLogger.info('Fetched entity candidates', { 
      entityCount: entitySuggestions.length
    });

    return res.json({
      success: true,
      data: {
        suggestions: entitySuggestions,
        count: entitySuggestions.length,
        entity_count: entitySuggestions.length
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
    
    try {
      // Try new Python sidecar format first
      const dipPath = `manuals/${docId}/dip.json`;
      const suggestionsPath = `manuals/${docId}/suggestions.json`;
      
      const [dipResponse, suggestionsResponse] = await Promise.allSettled([
        supabase.storage.from('documents').download(dipPath),
        supabase.storage.from('documents').download(suggestionsPath)
      ]);
      
      if (dipResponse.status === 'fulfilled' && dipResponse.value.data) {
        const dipContent = await dipResponse.value.data.text();
        const dipData = JSON.parse(dipContent);
        
        // Map Python sidecar format to expected format
        dipFiles.entities = dipData.entities ? { entities: dipData.entities } : null;
        dipFiles.spec_hints = dipData.spec_hints ? { spec_hints: dipData.spec_hints } : null;
        dipFiles.golden_tests = dipData.golden_tests ? { golden_tests: dipData.golden_tests } : null;
        dipFiles.summary = dipData.summary || null;
      }
      
      if (suggestionsResponse.status === 'fulfilled' && suggestionsResponse.value.data) {
        const suggestionsContent = await suggestionsResponse.value.data.text();
        const suggestionsData = JSON.parse(suggestionsContent);
        
        // Merge suggestions data if available
        if (suggestionsData.entities) dipFiles.entities = { entities: suggestionsData.entities };
        if (suggestionsData.spec_hints) dipFiles.spec_hints = { spec_hints: suggestionsData.spec_hints };
        if (suggestionsData.golden_tests) dipFiles.golden_tests = { golden_tests: suggestionsData.golden_tests };
        if (suggestionsData.summary) dipFiles.summary = suggestionsData.summary;
      }
      
      // Fallback to old format if new format not found
      if (!dipFiles.entities && !dipFiles.spec_hints && !dipFiles.golden_tests) {
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
      }
      
    } catch (error) {
      requestLogger.error('Error loading DIP files', { error: error.message });
      // Return empty structure
      dipFiles.entities = null;
      dipFiles.spec_hints = null;
      dipFiles.golden_tests = null;
      dipFiles.summary = null;
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


export default router;