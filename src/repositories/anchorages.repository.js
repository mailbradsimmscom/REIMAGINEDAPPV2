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
   * Get the N most recent anchorages by arrived_at
   * Used for dynamic lookback calculation
   * @param {number} limit - Number of anchorages to retrieve
   * @returns {Promise<Array>} Recent anchorages
   */
  async getRecentAnchorages(limit = 2) {
    try {
      const supabase = await getSupabaseClient();

      const { data, error } = await supabase
        .from('anchorages')
        .select('id, arrived_at, departed_at')
        .order('arrived_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      requestLogger.error('Error fetching recent anchorages', { error: error.message });
      throw error;
    }
  }

  /**
   * Detect anchorages from GPS history using stationary period analysis
   * Finds periods where boat stayed in same location for minHours or more
   * Processes data in JavaScript - no database functions required
   * @param {number} minHours - Minimum hours stationary to count as anchorage (default 4)
   * @returns {Promise<Array>} Detected anchorage candidates
   */
  async detectFromGpsHistory(minHours = 4) {
    try {
      const supabase = await getSupabaseClient();

      // Dynamic lookback: start from most recent anchorage's departed_at
      // This keeps the GPS query small and fast
      const recentAnchorages = await this.getRecentAnchorages(1);
      let startTime;

      if (recentAnchorages.length >= 1 && recentAnchorages[0].departed_at) {
        startTime = new Date(recentAnchorages[0].departed_at);
        requestLogger.info('Using dynamic lookback from most recent anchorage', {
          anchorageId: recentAnchorages[0].id,
          since: startTime.toISOString()
        });
      } else {
        // Fallback to 14 days if no recent departed anchorage
        startTime = new Date();
        startTime.setDate(startTime.getDate() - 14);
        requestLogger.info('Using 14-day fallback lookback', {
          since: startTime.toISOString(),
          reason: recentAnchorages.length < 1 ? 'no anchorages' : 'no departed_at'
        });
      }

      requestLogger.info('Fetching GPS data for anchorage detection', {
        since: startTime.toISOString()
      });

      const allPositions = [];
      let lastTimestamp = startTime.toISOString();
      const batchSize = 1000; // Supabase max

      while (true) {
        const { data: batch, error } = await supabase
          .from('gps_position')
          .select('timestamp, latitude, longitude, true_wind_speed, true_wind_direction')
          .gt('timestamp', lastTimestamp)
          .order('timestamp', { ascending: true })
          .limit(batchSize);

        if (error) throw error;
        if (!batch || batch.length === 0) break;

        allPositions.push(...batch);
        lastTimestamp = batch[batch.length - 1].timestamp;

        if (batch.length < batchSize) break;
      }

      requestLogger.info('GPS data fetched', { totalPositions: allPositions.length });

      if (allPositions.length === 0) {
        return [];
      }

      // Group positions by hour
      const hourlyPositions = this.groupPositionsByHour(allPositions);

      // Find stationary periods
      const candidates = this.findStationaryPeriods(hourlyPositions, minHours);

      requestLogger.info('Anchorage candidates found', { count: candidates.length });

      return candidates;
    } catch (error) {
      requestLogger.error('Error detecting anchorages from GPS', { error: error.message });
      throw error;
    }
  }

  /**
   * Group GPS positions by hour and calculate averages
   * @param {Array} positions - Raw GPS positions
   * @returns {Array} Hourly averaged positions sorted by time
   */
  groupPositionsByHour(positions) {
    const hourly = new Map();

    for (const pos of positions) {
      const hour = new Date(pos.timestamp);
      hour.setMinutes(0, 0, 0);
      const key = hour.toISOString();

      if (!hourly.has(key)) {
        hourly.set(key, { hour, positions: [] });
      }
      hourly.get(key).positions.push(pos);
    }

    // Calculate averages for each hour
    return Array.from(hourly.values())
      .map(({ hour, positions }) => ({
        hour,
        lat: positions.reduce((sum, p) => sum + p.latitude, 0) / positions.length,
        lon: positions.reduce((sum, p) => sum + p.longitude, 0) / positions.length,
        avgWindSpeed: positions.reduce((sum, p) => sum + (p.true_wind_speed || 0), 0) / positions.length,
        avgWindDir: this.averageAngle(positions.map(p => p.true_wind_direction).filter(d => d != null))
      }))
      .sort((a, b) => a.hour - b.hour);
  }

  /**
   * Calculate average of angles (handles wraparound at 360°)
   * @param {Array} angles - Array of angles in degrees
   * @returns {number} Average angle
   */
  averageAngle(angles) {
    if (angles.length === 0) return 0;

    const sinSum = angles.reduce((sum, a) => sum + Math.sin(a * Math.PI / 180), 0);
    const cosSum = angles.reduce((sum, a) => sum + Math.cos(a * Math.PI / 180), 0);

    return ((Math.atan2(sinSum, cosSum) * 180 / Math.PI) + 360) % 360;
  }

  /**
   * Find stationary periods from hourly positions
   * @param {Array} hourlyPositions - Hourly averaged positions
   * @param {number} minHours - Minimum hours to qualify as anchorage
   * @returns {Array} Anchorage candidates
   */
  findStationaryPeriods(hourlyPositions, minHours) {
    if (hourlyPositions.length < 2) return [];

    const MOVEMENT_THRESHOLD = 0.0027; // ~300 meters in degrees (allows for anchor swing)
    const candidates = [];
    let currentGroup = [hourlyPositions[0]];

    for (let i = 1; i < hourlyPositions.length; i++) {
      const prev = hourlyPositions[i - 1];
      const curr = hourlyPositions[i];

      // Calculate movement (simple Euclidean in degrees)
      const movement = Math.sqrt(
        Math.pow(curr.lat - prev.lat, 2) +
        Math.pow(curr.lon - prev.lon, 2)
      );

      // Check for time gap (more than 2 hours between readings = break)
      const timeDiff = (curr.hour - prev.hour) / (1000 * 60 * 60);

      if (movement < MOVEMENT_THRESHOLD && timeDiff <= 2) {
        // Still stationary, add to current group
        currentGroup.push(curr);
      } else {
        // Moved or time gap - check if current group qualifies
        if (currentGroup.length >= minHours) {
          candidates.push(this.groupToCandidate(currentGroup));
        }
        // Start new group
        currentGroup = [curr];
      }
    }

    // Don't forget the last group
    if (currentGroup.length >= minHours) {
      candidates.push(this.groupToCandidate(currentGroup));
    }

    // Check if the last candidate is "still here" (within 2 hours of now)
    if (candidates.length > 0) {
      const lastCandidate = candidates[candidates.length - 1];
      const lastDepartedAt = new Date(lastCandidate.departed_at);
      const now = new Date();
      const hoursAgo = (now - lastDepartedAt) / (1000 * 60 * 60);

      if (hoursAgo <= 2) {
        // Boat is still anchored - set departed_at to null
        lastCandidate.departed_at = null;
        lastCandidate.hours_anchored = null; // Will be calculated as "in progress"
        requestLogger.info('Current anchorage detected (still here)', {
          arrived_at: lastCandidate.arrived_at,
          latitude: lastCandidate.latitude,
          longitude: lastCandidate.longitude
        });
      }
    }

    return candidates;
  }

  /**
   * Convert a group of hourly positions to an anchorage candidate
   * @param {Array} group - Group of consecutive stationary hours
   * @returns {Object} Anchorage candidate
   */
  groupToCandidate(group) {
    const avgLat = group.reduce((sum, p) => sum + p.lat, 0) / group.length;
    const avgLon = group.reduce((sum, p) => sum + p.lon, 0) / group.length;
    const avgWindSpeed = group.reduce((sum, p) => sum + p.avgWindSpeed, 0) / group.length;
    const avgWindDir = this.averageAngle(group.map(p => p.avgWindDir));

    return {
      latitude: Math.round(avgLat * 100000) / 100000,
      longitude: Math.round(avgLon * 100000) / 100000,
      arrived_at: group[0].hour.toISOString(),
      departed_at: new Date(group[group.length - 1].hour.getTime() + 3600000).toISOString(),
      hours_anchored: group.length,
      avg_wind_speed: Math.round(avgWindSpeed * 10) / 10,
      avg_wind_direction: Math.round(avgWindDir)
    };
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
   * Find an existing anchorage at this location (within 300m) regardless of time
   * Used for extending duration of existing anchorages
   * @param {number} latitude - Latitude
   * @param {number} longitude - Longitude
   * @returns {Promise<Object|null>} Existing anchorage or null
   */
  async findAtLocation(latitude, longitude) {
    try {
      const supabase = await getSupabaseClient();
      const tolerance = 0.0027; // ~300m - same as movement threshold

      const { data, error } = await supabase
        .from('anchorages')
        .select('*')
        .gte('latitude', latitude - tolerance)
        .lte('latitude', latitude + tolerance)
        .gte('longitude', longitude - tolerance)
        .lte('longitude', longitude + tolerance)
        .order('arrived_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    } catch (error) {
      requestLogger.error('Error finding anchorage at location', { error: error.message });
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
