import { getSupabaseClient } from './supabaseClient.js';
import { logger } from '../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Repository for anchorage and mooring data
 */
class AnchoragesRepository {
  /**
   * Get all anchorages, most recent first
   * @returns {Promise<Array>} Array of anchorages with trip data
   */
  async findAll() {
    try {
      const supabase = await getSupabaseClient();

      const { data, error } = await supabase
        .from('anchorages')
        .select(`
          *,
          arrival_trip:trips!arrival_trip_id(id, title),
          departure_trip:trips!departure_trip_id(id, title)
        `)
        .order('arrived_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      requestLogger.error('Error fetching anchorages', { error: error.message });
      throw error;
    }
  }

  /**
   * Find single anchorage by ID
   * @param {string} id - Anchorage UUID
   * @returns {Promise<Object|null>} Anchorage or null
   */
  async findById(id) {
    try {
      const supabase = await getSupabaseClient();

      const { data, error } = await supabase
        .from('anchorages')
        .select(`
          *,
          arrival_trip:trips!arrival_trip_id(id, title),
          departure_trip:trips!departure_trip_id(id, title)
        `)
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
      }
      return data;
    } catch (error) {
      requestLogger.error('Error fetching anchorage', { error: error.message, id });
      throw error;
    }
  }

  /**
   * Insert new anchorage
   * @param {Object} anchorage - Anchorage data
   * @returns {Promise<Object>} Created anchorage
   */
  async create(anchorage) {
    try {
      const supabase = await getSupabaseClient();

      const { data, error } = await supabase
        .from('anchorages')
        .insert(anchorage)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      requestLogger.error('Error creating anchorage', { error: error.message });
      throw error;
    }
  }

  /**
   * Update anchorage
   * @param {string} id - Anchorage UUID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated anchorage
   */
  async update(id, updates) {
    try {
      const supabase = await getSupabaseClient();

      const { data, error } = await supabase
        .from('anchorages')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      requestLogger.error('Error updating anchorage', { error: error.message, id });
      throw error;
    }
  }

  /**
   * Delete anchorage
   * @param {string} id - Anchorage UUID
   * @returns {Promise<void>}
   */
  async remove(id) {
    try {
      const supabase = await getSupabaseClient();

      const { error } = await supabase
        .from('anchorages')
        .delete()
        .eq('id', id);

      if (error) throw error;
    } catch (error) {
      requestLogger.error('Error deleting anchorage', { error: error.message, id });
      throw error;
    }
  }

  /**
   * Detect anchorages from GPS history using stationary period analysis
   * Finds periods where boat stayed in same location for minHours or more
   * @param {number} minHours - Minimum hours stationary to count as anchorage (default 4)
   * @returns {Promise<Array>} Detected anchorage candidates
   */
  async detectFromGpsHistory(minHours = 4) {
    try {
      const supabase = await getSupabaseClient();

      // Complex CTE query to find stationary periods in GPS data
      const { data, error } = await supabase.rpc('detect_anchorages_from_gps', {
        min_hours: minHours
      });

      if (error) {
        // Fall back to raw SQL if RPC not available
        requestLogger.warn('RPC detect_anchorages_from_gps not found, using raw query');
        return await this.detectFromGpsHistoryRaw(minHours);
      }

      return data || [];
    } catch (error) {
      requestLogger.error('Error detecting anchorages from GPS', { error: error.message });
      throw error;
    }
  }

  /**
   * Raw SQL fallback for anchorage detection
   * @param {number} minHours - Minimum hours stationary
   * @returns {Promise<Array>} Detected anchorage candidates
   */
  async detectFromGpsHistoryRaw(minHours = 4) {
    try {
      const supabase = await getSupabaseClient();

      // This query groups GPS positions by hour, identifies stationary periods,
      // and returns candidates that haven't been recorded yet
      const query = `
        WITH hourly_positions AS (
          SELECT
            date_trunc('hour', timestamp) as hour,
            AVG(latitude) as lat,
            AVG(longitude) as lon,
            AVG(true_wind_speed) as avg_wind_speed,
            AVG(true_wind_direction) as avg_wind_dir
          FROM gps_position
          GROUP BY 1
        ),
        with_movement AS (
          SELECT
            hour, lat, lon, avg_wind_speed, avg_wind_dir,
            SQRT(POWER(lat - LAG(lat) OVER (ORDER BY hour), 2) +
                 POWER(lon - LAG(lon) OVER (ORDER BY hour), 2)) as movement
          FROM hourly_positions
        ),
        stationary_hours AS (
          SELECT
            hour, lat, lon, avg_wind_speed, avg_wind_dir,
            CASE WHEN movement < 0.0005 THEN 0 ELSE 1 END as moved,
            SUM(CASE WHEN movement < 0.0005 THEN 0 ELSE 1 END) OVER (ORDER BY hour) as grp
          FROM with_movement
        ),
        anchorage_candidates AS (
          SELECT
            MIN(hour) as arrived_at,
            MAX(hour) + interval '1 hour' as departed_at,
            ROUND(AVG(lat)::numeric, 5) as latitude,
            ROUND(AVG(lon)::numeric, 5) as longitude,
            COUNT(*) as hours_anchored,
            ROUND(AVG(avg_wind_speed)::numeric, 1) as avg_wind_speed,
            ROUND(AVG(avg_wind_dir)::numeric, 0) as avg_wind_direction
          FROM stationary_hours
          WHERE moved = 0
          GROUP BY grp
          HAVING COUNT(*) >= ${minHours}
        )
        SELECT
          ac.*,
          NOT EXISTS (
            SELECT 1 FROM anchorages a
            WHERE ABS(EXTRACT(EPOCH FROM (a.arrived_at - ac.arrived_at))) < 3600
              AND ABS(a.latitude - ac.latitude) < 0.001
              AND ABS(a.longitude - ac.longitude) < 0.001
          ) as is_new
        FROM anchorage_candidates ac
        ORDER BY arrived_at DESC
      `;

      const { data, error } = await supabase.rpc('exec_sql', { query });

      if (error) {
        // If exec_sql RPC doesn't exist, we need to do this differently
        // For now, return empty array and log the issue
        requestLogger.warn('exec_sql RPC not available - anchorage detection requires DB function');
        return [];
      }

      // Filter to only new anchorages
      return (data || []).filter(a => a.is_new);
    } catch (error) {
      requestLogger.error('Error in raw GPS detection query', { error: error.message });
      throw error;
    }
  }

  /**
   * Find trips that ended or started near a given timestamp
   * Used to link arrival/departure trips to anchorages
   * @param {Date|string} timestamp - Time to search around
   * @param {number} windowMinutes - Search window in minutes (default 60)
   * @param {string} type - 'arrival' (trip ended near time) or 'departure' (trip started near time)
   * @returns {Promise<Object|null>} Matching trip or null
   */
  async findTripNearTime(timestamp, windowMinutes = 60, type = 'arrival') {
    try {
      const supabase = await getSupabaseClient();
      const ts = new Date(timestamp);
      const windowMs = windowMinutes * 60 * 1000;
      const startTime = new Date(ts.getTime() - windowMs);
      const endTime = new Date(ts.getTime() + windowMs);

      // For arrival: find trip that ended near this time
      // For departure: find trip that started near this time
      const timeField = type === 'arrival' ? 'ended_at' : 'started_at';

      const { data, error } = await supabase
        .from('trips')
        .select('id, title, started_at, ended_at')
        .gte(timeField, startTime.toISOString())
        .lte(timeField, endTime.toISOString())
        .order(timeField, { ascending: type === 'departure' })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    } catch (error) {
      requestLogger.error('Error finding trip near time', {
        error: error.message,
        timestamp,
        type
      });
      throw error;
    }
  }

  /**
   * Check if an anchorage already exists at this location/time
   * @param {number} latitude - Latitude
   * @param {number} longitude - Longitude
   * @param {Date|string} arrivedAt - Arrival time
   * @returns {Promise<boolean>} True if exists
   */
  async exists(latitude, longitude, arrivedAt) {
    try {
      const supabase = await getSupabaseClient();
      const ts = new Date(arrivedAt);
      const windowMs = 3600 * 1000; // 1 hour window
      const startTime = new Date(ts.getTime() - windowMs);
      const endTime = new Date(ts.getTime() + windowMs);

      const { count, error } = await supabase
        .from('anchorages')
        .select('id', { count: 'exact', head: true })
        .gte('arrived_at', startTime.toISOString())
        .lte('arrived_at', endTime.toISOString())
        .gte('latitude', latitude - 0.001)
        .lte('latitude', latitude + 0.001)
        .gte('longitude', longitude - 0.001)
        .lte('longitude', longitude + 0.001);

      if (error) throw error;
      return count > 0;
    } catch (error) {
      requestLogger.error('Error checking anchorage exists', { error: error.message });
      throw error;
    }
  }
}

// Export singleton instance
export const anchoragesRepository = new AnchoragesRepository();
