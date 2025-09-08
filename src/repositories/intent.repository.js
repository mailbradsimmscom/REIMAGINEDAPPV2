import { logger } from '../utils/logger.js';
import { getSupabaseClient } from './supabaseClient.js';

class IntentRepository {
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
   * Get all intent routes with optional filtering
   */
  async getAllIntentRoutes(filters = {}) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      let query = supabase
        .from('intent_router')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters.intent) {
        query = query.eq('intent', filters.intent);
      }
      if (filters.pattern) {
        query = query.ilike('pattern', `%${filters.pattern}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      this.requestLogger.info('Retrieved intent routes', { count: data?.length || 0, filters });
      return { success: true, data: data || [] };
    } catch (error) {
      this.requestLogger.error('Failed to get intent routes', { error: error.message, filters });
      throw error;
    }
  }

  /**
   * Get a specific intent route by ID
   */
  async getIntentRouteById(id) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('intent_router')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      this.requestLogger.info('Retrieved intent route', { id, found: !!data });
      return { success: true, data };
    } catch (error) {
      this.requestLogger.error('Failed to get intent route by ID', { error: error.message, id });
      throw error;
    }
  }

  /**
   * Create a new intent route
   */
  async createIntentRoute(routeData, createdBy = 'admin') {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('intent_router')
        .insert({
          pattern: routeData.pattern,
          intent: routeData.intent,
          route_to: routeData.route_to,
          intent_hint_id: routeData.intent_hint_id || null,
          created_by: createdBy
        })
        .select()
        .single();

      if (error) throw error;

      this.requestLogger.info('Created intent route', { id: data.id, pattern: data.pattern, intent: data.intent });
      return { success: true, data };
    } catch (error) {
      this.requestLogger.error('Failed to create intent route', { error: error.message, routeData });
      throw error;
    }
  }

  /**
   * Update an existing intent route
   */
  async updateIntentRoute(id, updates, updatedBy = 'admin') {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('intent_router')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      this.requestLogger.info('Updated intent route', { id, updates });
      return { success: true, data };
    } catch (error) {
      this.requestLogger.error('Failed to update intent route', { error: error.message, id, updates });
      throw error;
    }
  }

  /**
   * Delete an intent route
   */
  async deleteIntentRoute(id) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { error } = await supabase
        .from('intent_router')
        .delete()
        .eq('id', id);

      if (error) throw error;

      this.requestLogger.info('Deleted intent route', { id });
      return { success: true };
    } catch (error) {
      this.requestLogger.error('Failed to delete intent route', { error: error.message, id });
      throw error;
    }
  }

  /**
   * Find the best matching intent route for a query
   */
  async findMatchingRoute(query) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      // Get all routes and find the best match
      const { data: routes, error } = await supabase
        .from('intent_router')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Simple pattern matching - could be enhanced with fuzzy matching
      const normalizedQuery = query.toLowerCase().trim();
      const match = routes?.find(route => 
        normalizedQuery.includes(route.pattern.toLowerCase())
      );

      this.requestLogger.info('Found matching route', { 
        query: normalizedQuery, 
        match: match ? { pattern: match.pattern, route_to: match.route_to } : null 
      });

      return { success: true, data: match || null };
    } catch (error) {
      this.requestLogger.error('Failed to find matching route', { error: error.message, query });
      throw error;
    }
  }

  /**
   * Get intent route statistics
   */
  async getIntentRouteStats() {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('intent_router')
        .select('intent, created_by');

      if (error) throw error;

      const stats = {
        total: data?.length || 0,
        byIntent: {},
        byCreator: {}
      };

      data?.forEach(route => {
        stats.byIntent[route.intent] = (stats.byIntent[route.intent] || 0) + 1;
        stats.byCreator[route.created_by] = (stats.byCreator[route.created_by] || 0) + 1;
      });

      this.requestLogger.info('Retrieved intent route statistics', stats);
      return { success: true, data: stats };
    } catch (error) {
      this.requestLogger.error('Failed to get intent route statistics', { error: error.message });
      throw error;
    }
  }
}

export default new IntentRepository();
