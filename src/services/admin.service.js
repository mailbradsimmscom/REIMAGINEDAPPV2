import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { logger } from '../utils/logger.js';

export class AdminService {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  async getManufacturers() {
    const supabase = await getSupabaseClient();
    
    try {
      const { data, error } = await supabase
        .from('manufacturers')
        .select('*')
        .order('name');

      if (error) {
        this.requestLogger.warn('Manufacturers table query failed', { error: error.message });
        return {
          total: 0,
          manufacturers: [],
          lastUpdated: new Date().toISOString()
        };
      }

      this.requestLogger.info('Manufacturers retrieved', { count: data?.length || 0 });

      return {
        total: data?.length || 0,
        manufacturers: data?.map(m => m.name) || [],
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      this.requestLogger.warn('Manufacturers query failed', { error: error.message });
      return {
        total: 0,
        manufacturers: [],
        lastUpdated: new Date().toISOString()
      };
    }
  }

  async getModels() {
    const supabase = await getSupabaseClient();
    
    try {
      const { data, error } = await supabase
        .from('models')
        .select('*')
        .order('name');

      if (error) {
        this.requestLogger.warn('Models table query failed', { error: error.message });
        return {
          total: 0,
          models: [],
          lastUpdated: new Date().toISOString()
        };
      }

      this.requestLogger.info('Models retrieved', { count: data?.length || 0 });

      return {
        total: data?.length || 0,
        models: data?.map(m => m.name) || [],
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      this.requestLogger.warn('Models query failed', { error: error.message });
      return {
        total: 0,
        models: [],
        lastUpdated: new Date().toISOString()
      };
    }
  }

  async getSystems() {
    const supabase = await getSupabaseClient();
    
    try {
      const { data, error } = await supabase
        .from('systems')
        .select('*')
        .order('name');

      if (error) {
        this.requestLogger.warn('Systems table query failed', { error: error.message });
        // Return empty data if table doesn't exist or has issues
        return {
          total: 0,
          top: [],
          lastUpdated: new Date().toISOString()
        };
      }

      this.requestLogger.info('Systems retrieved', { count: data?.length || 0 });

      return {
        total: data?.length || 0,
        top: data?.slice(0, 10).map(s => ({ system_norm: s.name })) || [],
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      this.requestLogger.warn('Systems query failed', { error: error.message });
      return {
        total: 0,
        top: [],
        lastUpdated: new Date().toISOString()
      };
    }
  }
}

export const adminService = new AdminService();
