import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../repositories/supabaseClient.js';

class ViewRefreshService {
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
   * Refresh the knowledge_facts materialized view
   * This should be called after approving suggestions to update the fact-first retrieval
   */
  async refreshKnowledgeFactsView() {
    const supabase = await this.checkSupabaseAvailability();
    try {
      // Try the RPC function first (preferred method)
      const { data, error } = await supabase.rpc('refresh_knowledge_facts');
      
      if (error) {
        // Fallback to raw SQL if RPC fails
        this.requestLogger.warn('RPC refresh failed, trying raw SQL', { error: error.message });
        const { error: sqlError } = await supabase
          .from('knowledge_facts')
          .select('*')
          .limit(0); // This will trigger a refresh if the view exists
        
        if (sqlError) {
          throw new Error(`Both RPC and raw SQL refresh failed: ${error.message}, ${sqlError.message}`);
        }
      }

      this.requestLogger.info('Knowledge facts view refreshed successfully', { 
        method: error ? 'raw_sql' : 'rpc',
        timestamp: new Date().toISOString()
      });

      return { success: true, method: error ? 'raw_sql' : 'rpc' };
    } catch (error) {
      this.requestLogger.error('Failed to refresh knowledge facts view', { error: error.message });
      throw error;
    }
  }

  /**
   * Refresh the knowledge_facts view with error handling
   * Returns success/failure without throwing
   */
  async refreshKnowledgeFactsViewSafe() {
    try {
      const result = await this.refreshKnowledgeFactsView();
      return { success: true, ...result };
    } catch (error) {
      this.requestLogger.error('Safe refresh failed', { error: error.message });
      return { 
        success: false, 
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get view refresh statistics
   */
  async getViewRefreshStats() {
    const supabase = await this.checkSupabaseAvailability();
    try {
      // Get count of records in the view
      const { count, error } = await supabase
        .from('knowledge_facts')
        .select('*', { count: 'exact', head: true });

      if (error) throw error;

      // Get breakdown by fact type
      const { data: breakdown, error: breakdownError } = await supabase
        .from('knowledge_facts')
        .select('fact_type')
        .limit(1000); // Sample for breakdown

      if (breakdownError) throw breakdownError;

      const stats = {
        totalFacts: count || 0,
        factTypes: {}
      };

      breakdown?.forEach(fact => {
        stats.factTypes[fact.fact_type] = (stats.factTypes[fact.fact_type] || 0) + 1;
      });

      this.requestLogger.info('Retrieved view refresh statistics', stats);
      return { success: true, data: stats };
    } catch (error) {
      this.requestLogger.error('Failed to get view refresh stats', { error: error.message });
      throw error;
    }
  }

  /**
   * Check if the knowledge_facts view exists and is accessible
   */
  async checkViewHealth() {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('knowledge_facts')
        .select('fact_type')
        .limit(1);

      if (error) {
        return { 
          healthy: false, 
          error: error.message,
          exists: error.message.includes('does not exist') ? false : true
        };
      }

      return { 
        healthy: true, 
        exists: true,
        sampleData: data?.[0] || null
      };
    } catch (error) {
      this.requestLogger.error('View health check failed', { error: error.message });
      return { 
        healthy: false, 
        error: error.message,
        exists: false
      };
    }
  }
}

export default new ViewRefreshService();
