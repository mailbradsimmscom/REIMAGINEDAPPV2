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
  /**
   * Get positions summary in a time range with bounding box and downsampling.
   * Uses cursor-based pagination to handle large datasets efficiently.
   * @param {Date} startTime - Start of time range
   * @param {Date} endTime - End of time range
   * @param {number} intervalSeconds - Downsample interval (default 60s)
   * @returns {Promise<Object>} { positions, boundingBox, totalPositions }
   */
  async getPositionsSummaryInRange(startTime, endTime, intervalSeconds = 60) {
    try {
      const supabase = await getSupabaseClient();
      const batchSize = 1000;
      let lastTimestamp = startTime.toISOString();

      // Bounding box tracking (computed from ALL positions)
      let minLat = Infinity, maxLat = -Infinity;
      let minLon = Infinity, maxLon = -Infinity;

      // Downsampled positions
      const positions = [];
      let totalPositions = 0;
      let lastSampledTime = 0;

      while (true) {
        const { data: batch, error } = await supabase
          .from('gps_position')
          .select('timestamp, latitude, longitude, true_wind_speed, true_wind_direction, depth')
          .gt('timestamp', lastTimestamp)
          .lte('timestamp', endTime.toISOString())
          .order('timestamp', { ascending: true })
          .limit(batchSize);

        if (error) throw error;
        if (!batch || batch.length === 0) break;

        for (const pos of batch) {
          totalPositions++;

          // Update bounding box from every position
          if (pos.latitude < minLat) minLat = pos.latitude;
          if (pos.latitude > maxLat) maxLat = pos.latitude;
          if (pos.longitude < minLon) minLon = pos.longitude;
          if (pos.longitude > maxLon) maxLon = pos.longitude;

          // Downsample: keep one position per intervalSeconds
          const posTime = new Date(pos.timestamp).getTime();
          if (posTime - lastSampledTime >= intervalSeconds * 1000) {
            positions.push(pos);
            lastSampledTime = posTime;
          }
        }

        lastTimestamp = batch[batch.length - 1].timestamp;
        if (batch.length < batchSize) break;
      }

      const boundingBox = totalPositions > 0
        ? { minLat, maxLat, minLon, maxLon }
        : null;

      return { positions, boundingBox, totalPositions };
    } catch (error) {
      requestLogger.error('Error fetching positions summary', { error: error.message });
      throw error;
    }
  }
}

// Export singleton instance
export const gpsRepository = new GpsRepository();
