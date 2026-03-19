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
        .select('timestamp, latitude, longitude, true_wind_speed, true_wind_direction, speed_over_ground')
        .gte('timestamp', startTime.toISOString())
        .lte('timestamp', endTime.toISOString())
        .order('timestamp', { ascending: true })
        .limit(5000);

      if (error) throw error;
      return data || [];
    } catch (error) {
      requestLogger.error('Error fetching GPS positions in range', { error: error.message });
      throw error;
    }
  }
  /**
   * Get positions summary in a time range with bounding box and downsampling.
   * Uses a single Postgres RPC call for performance.
   * @param {Date} startTime - Start of time range
   * @param {Date} endTime - End of time range
   * @param {number} intervalSeconds - Downsample interval (default 60s)
   * @returns {Promise<Object>} { positions, boundingBox, totalPositions }
   */
  async getPositionsSummaryInRange(startTime, endTime, intervalSeconds = 60) {
    try {
      const supabase = await getSupabaseClient();

      const { data, error } = await supabase.rpc('gps_positions_summary_in_range', {
        p_start: startTime.toISOString(),
        p_end: endTime.toISOString(),
        p_interval_seconds: intervalSeconds
      });

      if (error) throw error;

      if (!data || data.length === 0) {
        return { positions: [], boundingBox: null, totalPositions: 0 };
      }

      // First row contains total_count (same on all rows via window function)
      const totalPositions = data[0].total_count;

      // Compute bounding box from downsampled positions
      let minLat = Infinity, maxLat = -Infinity;
      let minLon = Infinity, maxLon = -Infinity;

      const positions = data.map(row => {
        if (row.latitude < minLat) minLat = row.latitude;
        if (row.latitude > maxLat) maxLat = row.latitude;
        if (row.longitude < minLon) minLon = row.longitude;
        if (row.longitude > maxLon) maxLon = row.longitude;

        return {
          timestamp: row.timestamp,
          latitude: row.latitude,
          longitude: row.longitude,
          true_wind_speed: row.true_wind_speed,
          true_wind_direction: row.true_wind_direction,
          depth: row.depth
        };
      });

      const boundingBox = { minLat, maxLat, minLon, maxLon };

      return { positions, boundingBox, totalPositions };
    } catch (error) {
      requestLogger.error('Error fetching positions summary', { error: error.message });
      throw error;
    }
  }
}

// Export singleton instance
export const gpsRepository = new GpsRepository();
