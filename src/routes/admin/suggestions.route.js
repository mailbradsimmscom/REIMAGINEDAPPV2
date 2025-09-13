import { Router } from 'express';
import { adminOnly } from '../../middleware/admin.js';
import { logger } from '../../utils/logger.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';

const router = Router();

// Get all pending suggestions from all four tables
router.get('/pending', adminOnly, async (req, res) => {
  try {
    const { docId } = req.query;
    
    // Build the query conditions
    const conditions = { status: 'pending' };
    if (docId) {
      conditions.doc_id = docId;
    }

    // Fetch from all four tables in parallel with document model info
    const supabaseClient = await getSupabaseClient();
    const [specSuggestions, playbookHints, intentRouter, goldenTests] = await Promise.all([
      supabaseClient
        .from('spec_suggestions')
        .select(`
          *,
          documents!inner(
            model_norm,
            manufacturer_norm,
            model,
            manufacturer
          )
        `)
        .match(conditions)
        .order('created_at', { ascending: false }),
      
      supabaseClient
        .from('playbook_hints')
        .select(`
          *,
          documents!inner(
            model_norm,
            manufacturer_norm,
            model,
            manufacturer
          )
        `)
        .match(conditions)
        .order('created_at', { ascending: false }),
      
      supabaseClient
        .from('intent_router')
        .select(`
          *,
          documents!inner(
            model_norm,
            manufacturer_norm,
            model,
            manufacturer
          )
        `)
        .match(conditions)
        .order('created_at', { ascending: false }),
      
      supabaseClient
        .from('golden_tests')
        .select(`
          *,
          documents!inner(
            model_norm,
            manufacturer_norm,
            model,
            manufacturer
          )
        `)
        .match(conditions)
        .order('created_at', { ascending: false })
    ]);

    // Check for errors
    const errors = [specSuggestions.error, playbookHints.error, intentRouter.error, goldenTests.error]
      .filter(error => error);
    
    if (errors.length > 0) {
      logger.error('Failed to fetch suggestions', { errors });
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch suggestions' }
      });
    }

    // Normalize the data and add type information with model info
    const suggestions = [
      ...specSuggestions.data.map(item => ({
        ...item,
        type: 'spec',
        suggestion_type: 'spec_suggestion',
        display_value: `${item.spec_name}: ${item.spec_value || 'N/A'}${item.spec_unit ? ` ${item.spec_unit}` : ''}`,
        context: item.context || '',
        confidence: parseFloat(item.confidence) || 0,
        page: parseInt(item.page) || null,
        model: item.documents?.model_norm || item.documents?.model || 'Unknown Model',
        manufacturer: item.documents?.manufacturer_norm || item.documents?.manufacturer || 'Unknown Manufacturer'
      })),
      
      ...playbookHints.data.map(item => ({
        ...item,
        type: 'playbook',
        suggestion_type: 'playbook_hint',
        display_value: item.description || 'No description',
        context: '',
        confidence: parseFloat(item.confidence) || 0,
        page: parseInt(item.page) || null,
        model: item.documents?.model_norm || item.documents?.model || 'Unknown Model',
        manufacturer: item.documents?.manufacturer_norm || item.documents?.manufacturer || 'Unknown Manufacturer'
      })),
      
      ...intentRouter.data.map(item => ({
        ...item,
        type: 'intent',
        suggestion_type: 'intent_router',
        display_value: `${item.intent} → ${item.route_to}`,
        context: '',
        confidence: parseFloat(item.confidence) || 0,
        page: parseInt(item.page) || null,
        model: item.documents?.model_norm || item.documents?.model || 'Unknown Model',
        manufacturer: item.documents?.manufacturer_norm || item.documents?.manufacturer || 'Unknown Manufacturer'
      })),
      
      ...goldenTests.data.map(item => ({
        ...item,
        type: 'test',
        suggestion_type: 'golden_test',
        display_value: item.query || 'Unnamed Test',
        context: item.expected || '',
        confidence: parseFloat(item.confidence) || 0,
        page: parseInt(item.page) || null,
        model: item.documents?.model_norm || item.documents?.model || 'Unknown Model',
        manufacturer: item.documents?.manufacturer_norm || item.documents?.manufacturer || 'Unknown Manufacturer'
      }))
    ];

    // Sort by creation date
    suggestions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    logger.info('Fetched suggestions', { 
      total: suggestions.length,
      spec_suggestions: specSuggestions.data.length,
      playbook_hints: playbookHints.data.length,
      intent_router: intentRouter.data.length,
      golden_tests: goldenTests.data.length
    });

    res.json({
      success: true,
      data: {
        suggestions,
        counts: {
          spec_suggestions: specSuggestions.data.length,
          playbook_hints: playbookHints.data.length,
          intent_router: intentRouter.data.length,
          golden_tests: goldenTests.data.length,
          total: suggestions.length
        }
      }
    });

  } catch (error) {
    logger.error('Failed to fetch suggestions', { error: error.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch suggestions' }
    });
  }
});

// Approve selected suggestions
router.post('/approve', adminOnly, async (req, res) => {
  try {
    const { docId, approved } = req.body;
    
    if (!docId || !approved) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Missing docId or approved data' }
      });
    }

    let totalInserted = 0;
    const results = {};

    // Process each type of approved suggestions
    for (const [type, items] of Object.entries(approved)) {
      if (!Array.isArray(items) || items.length === 0) continue;

      try {
        let insertData = [];
        
        switch (type) {
          case 'spec_suggestions':
            insertData = items.map(item => ({
              doc_id: docId,
              spec_name: item.value,
              spec_value: item.spec_value || null,
              spec_unit: item.spec_unit || null,
              page: item.page,
              context: item.context || '',
              confidence: item.confidence,
              bbox: item.bbox || null,
              status: 'approved'
            }));
            break;
            
          case 'playbook_hints':
            insertData = items.map(item => ({
              doc_id: docId,
              test_name: item.test_name || 'Playbook Hint',
              test_type: item.test_type || 'procedure',
              description: item.value,
              steps: item.steps || [],
              expected_result: item.expected_result || 'See documentation',
              page: item.page,
              confidence: item.confidence
            }));
            break;
            
          case 'intent_router':
            insertData = items.map(item => ({
              doc_id: docId,
              intent: item.intent || item.value,
              route_to: item.route_to || 'general',
              context: item.context || '',
              confidence: item.confidence,
              status: 'approved'
            }));
            break;
            
          case 'golden_tests':
            insertData = items.map(item => ({
              doc_id: docId,
              test_name: item.test_name || item.value,
              test_type: item.test_type || 'maintenance',
              description: item.description || item.value,
              steps: item.steps || [],
              expected_result: item.expected_result || 'See documentation',
              page: item.page,
              confidence: item.confidence,
              approved_by: 'admin',
              status: 'approved'
            }));
            break;
        }

        if (insertData.length > 0) {
          const { data, error } = await supabaseClient
            .from(type)
            .insert(insertData);

          if (error) {
            logger.error(`Failed to insert ${type}`, { error: error.message });
            results[type] = { error: error.message };
          } else {
            results[type] = { inserted: insertData.length };
            totalInserted += insertData.length;
          }
        }
      } catch (error) {
        logger.error(`Error processing ${type}`, { error: error.message });
        results[type] = { error: error.message };
      }
    }

    logger.info('Approved suggestions', { docId, totalInserted, results });

    res.json({
      success: true,
      data: {
        total_inserted: totalInserted,
        results
      }
    });

  } catch (error) {
    logger.error('Failed to approve suggestions', { error: error.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to approve suggestions' }
    });
  }
});

export default router;
