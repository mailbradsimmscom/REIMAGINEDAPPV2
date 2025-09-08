/**
 * Suggestions Repository
 * Handles database operations for DIP suggestion approval
 */

import { logger } from '../utils/logger.js';
import { getSupabaseClient } from './supabaseClient.js';

class SuggestionsRepository {
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
   * Insert approved spec suggestion
   */
  async insertSpecSuggestion(doc_id, suggestion, approved_by = 'admin') {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('spec_suggestions')
        .insert({
          doc_id,
          hint_type: suggestion.hint_type || suggestion.key,
          value: suggestion.value,
          unit: suggestion.unit,
          page: suggestion.page,
          context: suggestion.context,
          confidence: suggestion.confidence,
          approved_by,
          approved_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      
      this.requestLogger.info('Spec suggestion inserted', { 
        doc_id, 
        suggestion_id: data.id,
        approved_by 
      });
      
      return { success: true, data };
    } catch (error) {
      this.requestLogger.error('Failed to insert spec suggestion', { 
        error: error.message, 
        doc_id, 
        suggestion 
      });
      throw error;
    }
  }

  /**
   * Insert approved golden test
   */
  async insertGoldenTest(doc_id, test, approved_by = 'admin') {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('golden_tests')
        .insert({
          doc_id,
          query: test.query || test.test_name || test.description || 'Test query',
          expected: test.expected || test.expected_result || 'Expected result',
          approved_by,
          approved_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      
      this.requestLogger.info('Golden test inserted', { 
        doc_id, 
        test_id: data.id,
        approved_by 
      });
      
      return { success: true, data };
    } catch (error) {
      this.requestLogger.error('Failed to insert golden test', { 
        error: error.message, 
        doc_id, 
        test 
      });
      throw error;
    }
  }

  /**
   * Insert approved playbook hint
   */
  async insertPlaybookHint(doc_id, hint, approved_by = 'admin') {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('playbook_hints')
        .insert({
          doc_id,
          test_name: hint.test_name || hint.text || hint.description || 'Playbook Hint',
          test_type: hint.test_type || hint.trigger || 'general',
          description: hint.description || hint.text,
          steps: hint.steps || [],
          expected_result: hint.expected_result || hint.expected,
          page: hint.page,
          confidence: hint.confidence,
          approved_by,
          approved_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      
      this.requestLogger.info('Playbook hint inserted', { 
        doc_id, 
        hint_id: data.id,
        approved_by 
      });
      
      return { success: true, data };
    } catch (error) {
      this.requestLogger.error('Failed to insert playbook hint', { 
        error: error.message, 
        doc_id, 
        hint 
      });
      throw error;
    }
  }

  /**
   * Insert entity candidate
   */
  async insertEntityCandidate(doc_id, entity, approved_by = 'admin') {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('entity_candidates')
        .insert({
          doc_id,
          entity_type: entity.entity_type,
          value: entity.value,
          page: entity.page,
          context: entity.context,
          confidence: entity.confidence,
          approved_by,
          approved_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      
      this.requestLogger.info('Entity candidate inserted', { 
        doc_id, 
        entity_id: data.id,
        approved_by 
      });
      
      return { success: true, data };
    } catch (error) {
      this.requestLogger.error('Failed to insert entity candidate', { 
        error: error.message, 
        doc_id, 
        entity 
      });
      throw error;
    }
  }

  /**
   * Insert DIP review audit log (optional)
   */
  async insertDipReview(doc_id, suggestion_type, content, approved_by = 'admin') {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('dip_reviews')
        .insert({
          doc_id,
          suggestion_type,
          content,
          approved_by,
          approved_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      
      this.requestLogger.info('DIP review logged', { 
        doc_id, 
        suggestion_type,
        review_id: data.id,
        approved_by 
      });
      
      return { success: true, data };
    } catch (error) {
      this.requestLogger.error('Failed to insert DIP review', { 
        error: error.message, 
        doc_id, 
        suggestion_type 
      });
      throw error;
    }
  }
}

export default new SuggestionsRepository();
