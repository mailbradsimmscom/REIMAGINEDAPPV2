import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { logger } from '../utils/logger.js';

export class AdminService {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  async getManufacturers() {
    const supabase = await getSupabaseClient();
    
    const { data, error } = await supabase
      .from('manufacturers')
      .select('*')
      .order('name');

    if (error) {
      throw error;
    }

    this.requestLogger.info('Manufacturers retrieved', { count: data?.length || 0 });

    return {
      total: data?.length || 0,
      top: data?.slice(0, 10).map(m => ({ manufacturer_norm: m.name })) || [],
      lastUpdated: new Date().toISOString()
    };
  }

  async getModels() {
    const supabase = await getSupabaseClient();
    
    const { data, error } = await supabase
      .from('models')
      .select('*')
      .order('name');

    if (error) {
      throw error;
    }

    this.requestLogger.info('Models retrieved', { count: data?.length || 0 });

    return {
      total: data?.length || 0,
      top: data?.slice(0, 10).map(m => ({ model_norm: m.name })) || [],
      lastUpdated: new Date().toISOString()
    };
  }

  async getSystems() {
    const supabase = await getSupabaseClient();
    
    const { data, error } = await supabase
      .from('systems')
      .select('*')
      .order('name');

    if (error) {
      throw error;
    }

    this.requestLogger.info('Systems retrieved', { count: data?.length || 0 });

    return {
      total: data?.length || 0,
      top: data?.slice(0, 10).map(s => ({ system_norm: s.name })) || [],
      lastUpdated: new Date().toISOString()
    };
  }
}

export const adminService = new AdminService();
