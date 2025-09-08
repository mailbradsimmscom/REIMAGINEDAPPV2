/**
 * Knowledge Repository
 * Handles fact-first retrieval from approved DIP suggestions
 */

import { logger } from '../utils/logger.js';
import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../config/env.js';

class KnowledgeRepository {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
    this.supabase = null;
    this.initSupabase();
  }

  initSupabase() {
    try {
      const env = getEnv();
      const supabaseUrl = env.SUPABASE_URL;
      const supabaseKey = env.SUPABASE_ANON_KEY;
      
      if (supabaseUrl && supabaseKey) {
        this.supabase = createClient(supabaseUrl, supabaseKey);
        this.requestLogger.info('Supabase client initialized for knowledge repository');
      } else {
        this.requestLogger.warn('Supabase credentials not available for knowledge repository');
      }
    } catch (error) {
      this.requestLogger.error('Failed to initialize Supabase client', { error: error.message });
    }
  }

  async checkSupabaseAvailability() {
    if (!this.supabase) {
      throw new Error('Database service unavailable');
    }
    return this.supabase;
  }

  /**
   * Find fact match by query string
   * Searches across all fact types in the knowledge_facts view
   */
  async findFactMatchByQuery(query) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      // Normalize query for better matching
      const normalizedQuery = query.toLowerCase().trim();
      
      // Search by key (spec suggestions)
      const { data: keyMatches, error: keyError } = await supabase
        .from('knowledge_facts')
        .select('*')
        .ilike('key', `%${normalizedQuery}%`)
        .limit(1);

      if (keyError) {
        this.requestLogger.error('Error searching by key', { error: keyError.message, query });
        throw keyError;
      }

      if (keyMatches && keyMatches.length > 0) {
        this.requestLogger.info('Fact match found by key', { 
          query, 
          factType: keyMatches[0].fact_type,
          key: keyMatches[0].key 
        });
        return keyMatches[0];
      }

      // Search by intent (intent hints)
      const { data: intentMatches, error: intentError } = await supabase
        .from('knowledge_facts')
        .select('*')
        .ilike('intent', `%${normalizedQuery}%`)
        .limit(1);

      if (intentError) {
        this.requestLogger.error('Error searching by intent', { error: intentError.message, query });
        throw intentError;
      }

      if (intentMatches && intentMatches.length > 0) {
        this.requestLogger.info('Fact match found by intent', { 
          query, 
          factType: intentMatches[0].fact_type,
          intent: intentMatches[0].intent 
        });
        return intentMatches[0];
      }

      // Search by query field (golden tests)
      const { data: queryMatches, error: queryError } = await supabase
        .from('knowledge_facts')
        .select('*')
        .ilike('query', `%${normalizedQuery}%`)
        .limit(1);

      if (queryError) {
        this.requestLogger.error('Error searching by query field', { error: queryError.message, query });
        throw queryError;
      }

      if (queryMatches && queryMatches.length > 0) {
        this.requestLogger.info('Fact match found by query field', { 
          query, 
          factType: queryMatches[0].fact_type,
          goldenQuery: queryMatches[0].query 
        });
        return queryMatches[0];
      }

      // No matches found
      this.requestLogger.info('No fact match found', { query });
      return null;

    } catch (error) {
      this.requestLogger.error('Failed to find fact match', { 
        error: error.message, 
        query 
      });
      throw error;
    }
  }

  /**
   * Find all facts for a specific document
   */
  async findFactsByDocument(docId) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('knowledge_facts')
        .select('*')
        .eq('doc_id', docId)
        .order('approved_at', { ascending: false });

      if (error) throw error;
      
      this.requestLogger.info('Facts retrieved for document', { 
        docId, 
        count: data.length 
      });
      
      return data || [];
    } catch (error) {
      this.requestLogger.error('Failed to find facts by document', { 
        error: error.message, 
        docId 
      });
      throw error;
    }
  }

  /**
   * Find facts by type
   */
  async findFactsByType(factType) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('knowledge_facts')
        .select('*')
        .eq('fact_type', factType)
        .order('approved_at', { ascending: false });

      if (error) throw error;
      
      this.requestLogger.info('Facts retrieved by type', { 
        factType, 
        count: data.length 
      });
      
      return data || [];
    } catch (error) {
      this.requestLogger.error('Failed to find facts by type', { 
        error: error.message, 
        factType 
      });
      throw error;
    }
  }

  /**
   * Get fact statistics
   */
  async getFactStatistics() {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('knowledge_facts')
        .select('fact_type')
        .not('fact_type', 'is', null);

      if (error) throw error;
      
      const stats = {
        total: data.length,
        byType: {}
      };

      data.forEach(fact => {
        stats.byType[fact.fact_type] = (stats.byType[fact.fact_type] || 0) + 1;
      });

      this.requestLogger.info('Fact statistics retrieved', { stats });
      return stats;
    } catch (error) {
      this.requestLogger.error('Failed to get fact statistics', { 
        error: error.message 
      });
      throw error;
    }
  }
}

export default new KnowledgeRepository();
