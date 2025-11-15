import { getSupabaseClient } from './supabaseClient.js';
import { logger } from '../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Repository for accessing GPS position data from RPi
 */
class GpsRepository {
  /**
   * Get the most recent GPS position
   * @returns {Promise<Object|null>} Latest position or null if none/error
   */
  async getCurrentPosition() {
    try {
      const supabase = await getSupabaseClient();

      const { data, error } = await supabase
        .from('gps_position')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows found
          requestLogger.warn('No GPS positions available');
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      requestLogger.error('Error fetching current GPS position', { error: error.message });
      throw error;
    }
  }

  /**
   * Get recent GPS positions
   * @param {number} limit - Number of positions to retrieve
   * @returns {Promise<Array>} Array of positions
   */
  async getRecentPositions(limit = 20) {
    try {
      const supabase = await getSupabaseClient();

      const { data, error } = await supabase
        .from('gps_position')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      requestLogger.error('Error fetching recent GPS positions', { error: error.message });
      throw error;
    }
  }

  /**
   * Get positions within a time range
   * @param {Date} startTime - Start of time range
   * @param {Date} endTime - End of time range
   * @returns {Promise<Array>} Array of positions
   */
  async getPositionsInRange(startTime, endTime) {
    try {
      const supabase = await getSupabaseClient();

      const { data, error } = await supabase
        .from('gps_position')
        .select('*')
        .gte('timestamp', startTime.toISOString())
        .lte('timestamp', endTime.toISOString())
        .order('timestamp', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      requestLogger.error('Error fetching GPS positions in range', { error: error.message });
      throw error;
    }
  }
}

// Export singleton instance
export const gpsRepository = new GpsRepository();
