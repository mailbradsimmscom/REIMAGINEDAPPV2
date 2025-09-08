import { logger } from '../utils/logger.js';
import { getSupabaseClient } from './supabaseClient.js';

class PlaybookRepository {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  async checkSupabaseAvailability() {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      throw new Error('Database service unavailable');
    }
    return supabase;
  }

  /**
   * Get all playbooks with optional filtering
   */
  async getAllPlaybooks(filters = {}) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      let query = supabase
        .from('playbooks')
        .select(`
          *,
          playbook_steps (
            step_id,
            step_number,
            instruction,
            source_hint_id,
            doc_id
          )
        `)
        .order('created_at', { ascending: false });

      if (filters.system_norm) {
        query = query.eq('system_norm', filters.system_norm);
      }
      if (filters.subsystem_norm) {
        query = query.eq('subsystem_norm', filters.subsystem_norm);
      }
      if (filters.doc_id) {
        query = query.eq('doc_id', filters.doc_id);
      }

      const { data, error } = await query;
      if (error) throw error;

      this.requestLogger.info('Retrieved playbooks', { count: data?.length || 0, filters });
      return { success: true, data: data || [] };
    } catch (error) {
      this.requestLogger.error('Failed to get playbooks', { error: error.message, filters });
      throw error;
    }
  }

  /**
   * Get a specific playbook by ID
   */
  async getPlaybookById(playbookId) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('playbooks')
        .select(`
          *,
          playbook_steps (
            step_id,
            step_number,
            instruction,
            source_hint_id,
            doc_id
          )
        `)
        .eq('playbook_id', playbookId)
        .single();

      if (error) throw error;

      this.requestLogger.info('Retrieved playbook', { playbookId, found: !!data });
      return { success: true, data };
    } catch (error) {
      this.requestLogger.error('Failed to get playbook by ID', { error: error.message, playbookId });
      throw error;
    }
  }

  /**
   * Create a new playbook with steps
   */
  async createPlaybook(playbookData, steps = [], createdBy = 'system') {
    const supabase = await this.checkSupabaseAvailability();
    try {
      // Create the playbook first
      const { data: playbook, error: playbookError } = await supabase
        .from('playbooks')
        .insert({
          title: playbookData.title,
          system_norm: playbookData.system_norm,
          subsystem_norm: playbookData.subsystem_norm,
          doc_id: playbookData.doc_id,
          created_by: createdBy
        })
        .select()
        .single();

      if (playbookError) throw playbookError;

      // Create the steps if provided
      if (steps.length > 0) {
        const stepData = steps.map((step, index) => ({
          playbook_id: playbook.playbook_id,
          step_number: index + 1,
          instruction: step.instruction,
          source_hint_id: step.source_hint_id || null,
          doc_id: playbookData.doc_id
        }));

        const { data: createdSteps, error: stepsError } = await supabase
          .from('playbook_steps')
          .insert(stepData)
          .select();

        if (stepsError) throw stepsError;

        playbook.playbook_steps = createdSteps;
      }

      this.requestLogger.info('Created playbook', { 
        playbookId: playbook.playbook_id, 
        title: playbook.title,
        stepsCount: steps.length,
        createdBy 
      });

      return { success: true, data: playbook };
    } catch (error) {
      this.requestLogger.error('Failed to create playbook', { error: error.message, playbookData });
      throw error;
    }
  }

  /**
   * Update an existing playbook
   */
  async updatePlaybook(playbookId, updates, updatedBy = 'system') {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('playbooks')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('playbook_id', playbookId)
        .select()
        .single();

      if (error) throw error;

      this.requestLogger.info('Updated playbook', { playbookId, updates });
      return { success: true, data };
    } catch (error) {
      this.requestLogger.error('Failed to update playbook', { error: error.message, playbookId, updates });
      throw error;
    }
  }

  /**
   * Delete a playbook (cascades to steps)
   */
  async deletePlaybook(playbookId) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { error } = await supabase
        .from('playbooks')
        .delete()
        .eq('playbook_id', playbookId);

      if (error) throw error;

      this.requestLogger.info('Deleted playbook', { playbookId });
      return { success: true };
    } catch (error) {
      this.requestLogger.error('Failed to delete playbook', { error: error.message, playbookId });
      throw error;
    }
  }

  /**
   * Get playbook hints grouped by system/subsystem for generation
   */
  async getPlaybookHintsForGeneration(filters = {}) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      let query = supabase
        .from('playbook_hints')
        .select('*')
        .not('approved_at', 'is', null) // Only approved hints
        .order('system_norm, subsystem_norm, page');

      if (filters.system_norm) {
        query = query.eq('system_norm', filters.system_norm);
      }
      if (filters.subsystem_norm) {
        query = query.eq('subsystem_norm', filters.subsystem_norm);
      }
      if (filters.doc_id) {
        query = query.eq('doc_id', filters.doc_id);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Group hints by system/subsystem
      const groupedHints = {};
      data?.forEach(hint => {
        const key = `${hint.system_norm || 'unknown'}:${hint.subsystem_norm || 'general'}`;
        if (!groupedHints[key]) {
          groupedHints[key] = {
            system_norm: hint.system_norm,
            subsystem_norm: hint.subsystem_norm,
            doc_id: hint.doc_id,
            hints: []
          };
        }
        groupedHints[key].hints.push(hint);
      });

      const groupedArray = Object.values(groupedHints);
      this.requestLogger.info('Retrieved playbook hints for generation', { 
        totalHints: data?.length || 0,
        groups: groupedArray.length,
        filters 
      });

      return { success: true, data: groupedArray };
    } catch (error) {
      this.requestLogger.error('Failed to get playbook hints for generation', { error: error.message, filters });
      throw error;
    }
  }

  /**
   * Get playbook statistics
   */
  async getPlaybookStats() {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data: playbooks, error: playbooksError } = await supabase
        .from('playbooks')
        .select('system_norm, subsystem_norm, created_by');

      if (playbooksError) throw playbooksError;

      const { data: steps, error: stepsError } = await supabase
        .from('playbook_steps')
        .select('playbook_id');

      if (stepsError) throw stepsError;

      const stats = {
        totalPlaybooks: playbooks?.length || 0,
        totalSteps: steps?.length || 0,
        bySystem: {},
        bySubsystem: {},
        byCreator: {}
      };

      playbooks?.forEach(playbook => {
        stats.bySystem[playbook.system_norm] = (stats.bySystem[playbook.system_norm] || 0) + 1;
        stats.bySubsystem[playbook.subsystem_norm] = (stats.bySubsystem[playbook.subsystem_norm] || 0) + 1;
        stats.byCreator[playbook.created_by] = (stats.byCreator[playbook.created_by] || 0) + 1;
      });

      this.requestLogger.info('Retrieved playbook statistics', stats);
      return { success: true, data: stats };
    } catch (error) {
      this.requestLogger.error('Failed to get playbook statistics', { error: error.message });
      throw error;
    }
  }

  /**
   * Check if a playbook already exists for a system/subsystem combination
   */
  async checkPlaybookExists(systemNorm, subsystemNorm) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('playbooks')
        .select('playbook_id, title')
        .eq('system_norm', systemNorm)
        .eq('subsystem_norm', subsystemNorm)
        .limit(1);

      if (error) throw error;

      return { success: true, data: data?.[0] || null };
    } catch (error) {
      this.requestLogger.error('Failed to check playbook existence', { error: error.message, systemNorm, subsystemNorm });
      throw error;
    }
  }
}

export default new PlaybookRepository();
