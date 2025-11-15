import { gpsRepository } from '../repositories/gps.repository.js';
import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';

const env = getEnv();
const requestLogger = logger.createRequestLogger();

class AnchorWatchService {
  constructor() {
    this.safeRatio = parseFloat(env.ANCHOR_WATCH_SAFE_RATIO);
    this.warningRatio = parseFloat(env.ANCHOR_WATCH_WARNING_RATIO);
    this.centroidSamples = parseInt(env.ANCHOR_WATCH_CENTROID_SAMPLES);
    this.staleThresholdSec = parseInt(env.ANCHOR_WATCH_STALE_THRESHOLD_SEC);
  }

  /**
   * Calculate distance between two points using Haversine formula
   * @param {number} lat1 - Latitude of point 1
   * @param {number} lon1 - Longitude of point 1
   * @param {number} lat2 - Latitude of point 2
   * @param {number} lon2 - Longitude of point 2
   * @returns {number} Distance in meters
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }

  /**
   * Calculate centroid of recent positions
   * @returns {Promise<Object>} Centroid {latitude, longitude, sample_size}
   */
  async calculateCentroid() {
    try {
      const positions = await gpsRepository.getRecentPositions(this.centroidSamples);

      if (!positions || positions.length === 0) {
        throw new Error('No GPS positions available for centroid calculation');
      }

      // Calculate average of all positions
      const sum = positions.reduce((acc, pos) => ({
        lat: acc.lat + pos.latitude,
        lon: acc.lon + pos.longitude
      }), { lat: 0, lon: 0 });

      return {
        latitude: sum.lat / positions.length,
        longitude: sum.lon / positions.length,
        sample_size: positions.length
      };
    } catch (error) {
      requestLogger.error('Error calculating centroid', { error: error.message });
      throw error;
    }
  }

  /**
   * Determine anchor watch status based on distance
   * @param {number} distanceMeters - Distance from anchor in meters
   * @param {number} radiusMeters - Anchor zone radius in meters
   * @returns {string} 'safe', 'warning', or 'dragging'
   */
  determineStatus(distanceMeters, radiusMeters) {
    const ratio = distanceMeters / radiusMeters;
    if (ratio <= this.safeRatio) return 'safe';
    if (ratio <= this.warningRatio) return 'warning';
    return 'dragging';
  }

  /**
   * Get current anchor watch status
   * @returns {Promise<Object>} Current status with all calculated fields
   */
  async getStatus() {
    try {
      const supabase = await getSupabaseClient();

      // Get active zone
      const { data: zone, error: zoneError } = await supabase
        .from('anchor_watch_zones')
        .select('*')
        .eq('is_active', true)
        .single();

      if (zoneError && zoneError.code !== 'PGRST116') {
        throw zoneError;
      }

      if (!zone) {
        // No active anchor watch
        return {
          active: false,
          anchor_lat: null,
          anchor_lon: null,
          radius_meters: null,
          current_lat: null,
          current_lon: null,
          distance_meters: null,
          status: 'inactive',
          last_updated: null
        };
      }

      // Get current position
      const currentPosition = await gpsRepository.getCurrentPosition();

      if (!currentPosition) {
        return {
          active: true,
          anchor_lat: zone.center_lat,
          anchor_lon: zone.center_lng,
          radius_meters: zone.radius_meters,
          current_lat: null,
          current_lon: null,
          distance_meters: null,
          status: 'gps_lost',
          last_updated: null
        };
      }

      // Check if GPS data is stale
      const positionAge = (Date.now() - new Date(currentPosition.timestamp).getTime()) / 1000;
      if (positionAge > this.staleThresholdSec) {
        requestLogger.warn('GPS data is stale', { age_seconds: positionAge });
      }

      // Calculate distance from anchor
      const distance = this.calculateDistance(
        currentPosition.latitude,
        currentPosition.longitude,
        zone.center_lat,
        zone.center_lng
      );

      // Determine status
      const status = this.determineStatus(distance, zone.radius_meters);

      // Check if we need to create an alert
      if (status === 'dragging') {
        await this.createAlertIfNeeded(zone.zone_id, 'anchor_drag', currentPosition, distance);
      }

      return {
        active: true,
        anchor_lat: zone.center_lat,
        anchor_lon: zone.center_lng,
        radius_meters: zone.radius_meters,
        current_lat: currentPosition.latitude,
        current_lon: currentPosition.longitude,
        distance_meters: Math.round(distance * 100) / 100,
        status: status,
        last_updated: currentPosition.timestamp
      };
    } catch (error) {
      requestLogger.error('Error getting anchor watch status', { error: error.message });
      throw error;
    }
  }

  /**
   * Get recent positions with distance from anchor calculated
   * @param {number} limit - Number of positions to retrieve
   * @returns {Promise<Object>} Positions with calculated distances
   */
  async getPositionsWithDistance(limit = 20) {
    try {
      const supabase = await getSupabaseClient();

      // Get active zone
      const { data: zone } = await supabase
        .from('anchor_watch_zones')
        .select('*')
        .eq('is_active', true)
        .single();

      // Get recent positions
      const positions = await gpsRepository.getRecentPositions(limit);

      // If no active zone, return positions without distances
      if (!zone) {
        return {
          positions: positions.map(pos => ({
            latitude: pos.latitude,
            longitude: pos.longitude,
            timestamp: pos.timestamp,
            distance_from_anchor: null,
            status: 'inactive'
          }))
        };
      }

      // Calculate distance for each position
      const centerLat = zone.center_lat;
      const centerLng = zone.center_lng;
      const radiusMeters = zone.radius_meters;

      return {
        positions: positions.map(pos => {
          const distance = this.calculateDistance(
            pos.latitude,
            pos.longitude,
            centerLat,
            centerLng
          );
          const status = this.determineStatus(distance, radiusMeters);

          return {
            latitude: pos.latitude,
            longitude: pos.longitude,
            timestamp: pos.timestamp,
            distance_from_anchor: Math.round(distance * 100) / 100,
            status: status
          };
        })
      };
    } catch (error) {
      requestLogger.error('Error getting positions with distance', { error: error.message });
      throw error;
    }
  }

  /**
   * Activate anchor watch with specified center and radius
   * @param {number} latitude - Anchor latitude
   * @param {number} longitude - Anchor longitude
   * @param {number} radiusMeters - Watch radius in meters
   * @returns {Promise<Object>} Created zone
   */
  async activate(latitude, longitude, radiusMeters) {
    try {
      const supabase = await getSupabaseClient();

      // Deactivate any existing zones
      await this.deactivate();

      // Create new active zone
      const { data: zone, error } = await supabase
        .from('anchor_watch_zones')
        .insert({
          center_lat: latitude,
          center_lng: longitude,
          radius_meters: radiusMeters,
          is_active: true,
          activated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      requestLogger.info('Anchor watch activated', {
        lat: latitude,
        lng: longitude,
        radius: radiusMeters
      });

      return zone;
    } catch (error) {
      requestLogger.error('Error activating anchor watch', { error: error.message });
      throw error;
    }
  }

  /**
   * Deactivate anchor watch
   * @returns {Promise<void>}
   */
  async deactivate() {
    try {
      const supabase = await getSupabaseClient();

      const { error } = await supabase
        .from('anchor_watch_zones')
        .update({
          is_active: false,
          deactivated_at: new Date().toISOString()
        })
        .eq('is_active', true);

      if (error) throw error;

      requestLogger.info('Anchor watch deactivated');
    } catch (error) {
      requestLogger.error('Error deactivating anchor watch', { error: error.message });
      throw error;
    }
  }

  /**
   * Update anchor watch radius
   * @param {number} radiusMeters - New radius in meters
   * @returns {Promise<Object>} Updated zone
   */
  async updateRadius(radiusMeters) {
    try {
      const supabase = await getSupabaseClient();

      const { data: zone, error } = await supabase
        .from('anchor_watch_zones')
        .update({ radius_meters: radiusMeters })
        .eq('is_active', true)
        .select()
        .single();

      if (error) throw error;

      requestLogger.info('Anchor watch radius updated', { radius: radiusMeters });
      return zone;
    } catch (error) {
      requestLogger.error('Error updating anchor watch radius', { error: error.message });
      throw error;
    }
  }

  /**
   * Create alert if needed (prevents duplicate alerts)
   * @private
   */
  async createAlertIfNeeded(zoneId, alertType, position, distance) {
    try {
      const supabase = await getSupabaseClient();

      // Check for recent unacknowledged alert of same type
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentAlert } = await supabase
        .from('anchor_watch_alerts')
        .select('alert_id')
        .eq('zone_id', zoneId)
        .eq('alert_type', alertType)
        .eq('acknowledged', false)
        .gte('created_at', fiveMinutesAgo)
        .maybeSingle();

      if (recentAlert) {
        // Alert already exists
        return;
      }

      // Create new alert
      const { error } = await supabase
        .from('anchor_watch_alerts')
        .insert({
          zone_id: zoneId,
          alert_type: alertType,
          position_lat: position.latitude,
          position_lng: position.longitude,
          distance_meters: distance,
          details: {
            speed_over_ground: position.speed_over_ground,
            course_over_ground: position.course_over_ground
          }
        });

      if (error) throw error;

      requestLogger.warn('Anchor watch alert created', {
        type: alertType,
        distance: distance
      });
    } catch (error) {
      requestLogger.error('Error creating alert', { error: error.message });
      // Don't throw - alert creation failure shouldn't break status check
    }
  }
}

// Export singleton instance
export const anchorWatchService = new AnchorWatchService();
