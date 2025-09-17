import express from 'express';
import { adminOnly } from '../../middleware/admin.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();
const requestLogger = logger.createRequestLogger();

// Validation schemas removed - only used in commented-out routes

// GET /admin/api/playbooks - Get all playbook hints (staging data)
router.get('/', adminOnly, async (req, res) => {
  try {
    const filters = {
      system_norm: req.query.system_norm,
      subsystem_norm: req.query.subsystem_norm,
      doc_id: req.query.doc_id
    };

    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }
    
    let query = supabase.from('playbook_hints').select('id, doc_id, title, preconditions, steps, expected_outcome, error_codes, description, category, page, confidence, system_norm, subsystem_norm, manufacturer_norm, model_norm, asset_uid, status, created_at, updated_at');
    
    if (filters.system_norm) {
      query = query.eq('system_norm', filters.system_norm);
    }
    if (filters.subsystem_norm) {
      query = query.eq('subsystem_norm', filters.subsystem_norm);
    }
    if (filters.doc_id) {
      query = query.eq('doc_id', filters.doc_id);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) throw error;
    
    res.json({
      success: true,
      data: data,
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('Failed to get playbook hints', { error: error.message, query: req.query });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve playbook hints',
      requestId: req.id
    });
  }
});

// GET /admin/api/playbooks/stats - Get playbook hints statistics
router.get('/stats', adminOnly, async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }
    
    const { data, error } = await supabase.from('playbook_hints').select('id, system_norm, subsystem_norm');
    
    if (error) throw error;
    
    const stats = {
      totalPlaybooks: data.length,
      totalSteps: data.length, // Each hint is essentially a step
      systemCount: new Set(data.map(h => h.system_norm).filter(Boolean)).size
    };
    
    res.json({
      success: true,
      data: stats,
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('Failed to get playbook hints stats', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve playbook hints statistics',
      requestId: req.id
    });
  }
});

// GET /admin/api/playbooks/:playbookId - Get specific playbook hint
router.get('/:playbookId', adminOnly, async (req, res) => {
  try {
    const { playbookId } = req.params;

    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase client not available');
    }
    
    const { data, error } = await supabase
      .from('playbook_hints')
      .select('*')
      .eq('id', playbookId)
      .single();
    
    if (error || !data) {
      return res.status(404).json({
        success: false,
        error: 'Playbook hint not found',
        requestId: req.id
      });
    }
    
    res.json({
      success: true,
      data: data,
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('Failed to get playbook hint', { error: error.message, playbookId: req.params.playbookId });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve playbook hint',
      requestId: req.id
    });
  }
});

// POST /admin/api/playbooks - Create new playbook (DISABLED - staging data only)
/*
router.post('/', adminOnly, validate(createPlaybookSchema, 'body'), async (req, res) => {
  try {
    const playbookData = req.body;
    const steps = playbookData.steps || [];
    const createdBy = req.user?.id || 'admin';
    
    const result = await playbookRepository.createPlaybook(playbookData, steps, createdBy);
    
    requestLogger.info('Playbook created', { 
      playbookId: result.data.playbook_id, 
      title: result.data.title,
      createdBy 
    });
    
    res.status(201).json({
      success: true,
      data: result.data,
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('Failed to create playbook', { error: error.message, body: req.body });
    res.status(500).json({
      success: false,
      error: 'Failed to create playbook',
      requestId: req.id
    });
  }
});
*/

// PUT /admin/api/playbooks/:playbookId - Update playbook (DISABLED - staging data only)
/*
router.put('/:playbookId', adminOnly, validate(updatePlaybookSchema, 'body'), validate(playbookParamsSchema, 'params'), async (req, res) => {
  try {
    const { playbookId } = req.params;
    const updates = req.body;
    const updatedBy = req.user?.id || 'admin';
    
    // Check if playbook exists
    const existingPlaybook = await playbookRepository.getPlaybookById(playbookId);
    if (!existingPlaybook.data) {
      return res.status(404).json({
        success: false,
        error: 'Playbook not found',
        requestId: req.id
      });
    }
    
    const result = await playbookRepository.updatePlaybook(playbookId, updates, updatedBy);
    
    requestLogger.info('Playbook updated', { 
      playbookId, 
      updates,
      updatedBy 
    });
    
    res.json({
      success: true,
      data: result.data,
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('Failed to update playbook', { error: error.message, playbookId: req.params.playbookId, body: req.body });
    res.status(500).json({
      success: false,
      error: 'Failed to update playbook',
      requestId: req.id
    });
  }
});
*/

// DELETE /admin/api/playbooks/:playbookId - Delete playbook
/*
router.delete('/:playbookId', adminOnly, validate(playbookParamsSchema, 'params'), async (req, res) => {
  try {
    const { playbookId } = req.params;
    
    // Check if playbook exists
    const existingPlaybook = await playbookRepository.getPlaybookById(playbookId);
    if (!existingPlaybook.data) {
      return res.status(404).json({
        success: false,
        error: 'Playbook not found',
        requestId: req.id
      });
    }
    
    await playbookRepository.deletePlaybook(playbookId);
    
    requestLogger.info('Playbook deleted', { playbookId });
    
    res.json({
      success: true,
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('Failed to delete playbook', { error: error.message, playbookId: req.params.playbookId });
    res.status(500).json({
      success: false,
      error: 'Failed to delete playbook',
      requestId: req.id
    });
  }
});
*/

// POST /admin/api/playbooks/generate - Generate playbooks from hints
// DISABLED: Playbook generation removed - playbook_hints is now final destination
/*
router.post('/generate', adminOnly, async (req, res) => {
  try {
    const { system, subsystem, docId, force, dryRun } = req.query;
    const createdBy = req.user?.id || 'admin';
    
    // Get playbook hints grouped by system/subsystem
    const filters = {};
    if (system) filters.system_norm = system;
    if (subsystem) filters.subsystem_norm = subsystem;
    if (docId) filters.doc_id = docId;

    const { data: hintGroups, error } = await playbookRepository.getPlaybookHintsForGeneration(filters);
    if (error) throw error;

    if (!hintGroups || hintGroups.length === 0) {
      return res.json({
        success: true,
        data: {
          generated: 0,
          skipped: 0,
          errors: 0,
          playbooks: []
        },
        requestId: req.id
      });
    }

    const results = {
      generated: 0,
      skipped: 0,
      errors: 0,
      playbooks: []
    };

    for (const group of hintGroups) {
      try {
        const { system_norm, subsystem_norm, doc_id, hints } = group;
        
        // Check if playbook already exists
        const existingPlaybook = await playbookRepository.checkPlaybookExists(system_norm, subsystem_norm);
        
        if (existingPlaybook.data && force !== 'true') {
          results.skipped++;
          continue;
        }

        // Generate playbook data
        const playbookData = {
          title: `${system_norm || 'General'} - ${subsystem_norm || 'Maintenance'} Playbook`,
          system_norm,
          subsystem_norm,
          doc_id
        };

        const steps = hints.map((hint, index) => ({
          step_number: index + 1,
          instruction: hint.test_name || hint.description || `Step ${index + 1}`,
          source_hint_id: hint.id,
          doc_id: hint.doc_id
        }));

        if (dryRun === 'true') {
          results.playbooks.push({
            ...playbookData,
            stepsCount: steps.length,
            hints: hints.map(h => h.test_name || h.description)
          });
          results.generated++;
        } else {
          // Delete existing playbook if force is enabled
          if (existingPlaybook.data && force === 'true') {
            await playbookRepository.deletePlaybook(existingPlaybook.data.playbook_id);
          }

          // Create new playbook
          const result = await playbookRepository.createPlaybook(playbookData, steps, createdBy);
          
          results.playbooks.push({
            playbookId: result.data.playbook_id,
            ...playbookData,
            stepsCount: steps.length
          });
          results.generated++;
        }
      } catch (error) {
        requestLogger.error('Failed to generate playbook for group', {
          error: error.message,
          system_norm: group.system_norm,
          subsystem_norm: group.subsystem_norm
        });
        results.errors++;
      }
    }

    requestLogger.info('Playbooks generated', { 
      options: { system, subsystem, docId, force, dryRun },
      generated: results.generated,
      skipped: results.skipped,
      errors: results.errors,
      createdBy 
    });
    
    res.json({
      success: true,
      data: results,
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('Failed to generate playbooks', { error: error.message, query: req.query });
    res.status(500).json({
      success: false,
      error: 'Failed to generate playbooks',
      requestId: req.id
    });
  }
});
*/

export default router;
