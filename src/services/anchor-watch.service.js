import { gpsRepository } from '../repositories/gps.repository.js';
import { anchoragesRepository } from '../repositories/anchorages.repository.js';
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
    if (distanceMeters <= radiusMeters) return 'safe';
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
            status: 'inactive',
            true_wind_speed: pos.true_wind_speed,
            true_wind_direction: pos.true_wind_direction
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
            status: status,
            true_wind_speed: pos.true_wind_speed,
            true_wind_direction: pos.true_wind_direction
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
   * Compute convex hull of 2D points using Andrew's monotone chain algorithm.
   * @param {Array<{latitude: number, longitude: number}>} points
   * @returns {Array<{latitude: number, longitude: number}>} Hull vertices in order
   */
  computeConvexHull(points) {
    const pts = points.map(p => [p.longitude, p.latitude]);
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    const cross = (O, A, B) =>
      (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);

    // Build lower hull
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
        lower.pop();
      lower.push(p);
    }

    // Build upper hull
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
        upper.pop();
      upper.push(p);
    }

    // Remove last point of each half because it's repeated
    lower.pop();
    upper.pop();

    const hull = lower.concat(upper);
    return hull.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
  }

  /**
   * Calculate horizontal reach of anchor chain using catenary formula.
   * Accounts for chain sag under gravity — more accurate than straight-line.
   *
   * Chain hangs in a catenary from bow roller to where it meets the seabed,
   * then lies flat on the bottom. Total horizontal = catenary arc + flat portion.
   *
   * @param {number} scope - Total chain deployed (meters)
   * @param {number} h - Height from seabed to bow roller (depth + freeboard)
   * @returns {number} Horizontal distance from bow roller to anchor (meters)
   */
  catenaryHorizontalReach(scope, h) {
    // Newton's method to solve catenary equations:
    //   s_air = a * sinh(x_cat / a)      — chain length in the air
    //   h     = a * (cosh(x_cat / a) - 1) — height of catenary
    // where a = catenary parameter, x_cat = horizontal span of hanging part

    // From the identity cosh²-sinh²=1:
    //   s_air² = h² + 2*a*h
    //   so: a = (s_air² - h²) / (2*h)

    // We don't know s_air directly, but scope = s_air + chain_on_bottom
    // Start by assuming all chain is in the air (s_air = scope)
    // Then iterate: compute a → compute x_cat → compute s_air → check

    // If scope >> h, most chain is on bottom. Use iterative approach.
    // Initial guess: s_air = h * 1.05 (slightly more than height)
    let sAir = Math.max(h * 1.02, h + 0.5); // chain in air must be > h

    // Cap s_air at scope (can't have more chain in air than total)
    if (sAir > scope) sAir = scope;

    // Iterate to find consistent s_air
    for (let i = 0; i < 20; i++) {
      const a = (sAir * sAir - h * h) / (2 * h);
      if (a <= 0) {
        // Degenerate case — fall back to straight line
        return Math.sqrt(scope * scope - h * h);
      }

      // x_cat from h = a * (cosh(x/a) - 1) → x = a * acosh(h/a + 1)
      const xCat = a * Math.acosh(h / a + 1);

      // Actual chain in air from this a: s = a * sinh(x/a)
      const sCalc = a * Math.sinh(xCat / a);

      // Chain on bottom
      const onBottom = scope - sCalc;

      if (onBottom < 0) {
        // All chain is in the air, increase s_air estimate
        sAir = scope;
        const aFull = (sAir * sAir - h * h) / (2 * h);
        if (aFull <= 0) return Math.sqrt(scope * scope - h * h);
        const xFull = aFull * Math.acosh(h / aFull + 1);
        return xFull; // no chain on bottom
      }

      // Total horizontal reach = catenary span + flat chain on bottom
      const totalReach = xCat + onBottom;

      // Check convergence
      if (Math.abs(sCalc - sAir) < 0.01) {
        return totalReach;
      }

      // Update s_air toward computed value
      sAir = sCalc;
    }

    // Fallback to straight line if iteration didn't converge
    return Math.sqrt(scope * scope - h * h);
  }

  /**
   * Get safe zone analysis for current anchorage.
   * Filters outliers, computes convex hull of swing pattern + 5% buffer.
   * @param {number} intervalSeconds - Downsample interval (default 60)
   * @returns {Promise<Object>} { positions, safeZone, anchorage, totalPositions, downsampledPositions, outlierPositions }
   */
  async getSafeBox(intervalSeconds = 60, chainScopeMeters = null) {
    const supabase = await getSupabaseClient();

    // Find current anchorage (departed_at is null)
    const { data: anchorage, error } = await supabase
      .from('anchorages')
      .select('*')
      .is('departed_at', null)
      .order('arrived_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!anchorage) {
      throw new Error('No active anchorage found (no record with departed_at = null)');
    }

    const startTime = new Date(anchorage.arrived_at);
    const endTime = new Date();

    const { positions, totalPositions } = await gpsRepository.getPositionsSummaryInRange(
      startTime, endTime, intervalSeconds
    );

    if (positions.length === 0) {
      throw new Error('No GPS positions found for current anchorage period');
    }

    // Step 1: Compute centroid of all downsampled positions
    const centroidLat = positions.reduce((s, p) => s + p.latitude, 0) / positions.length;
    const centroidLon = positions.reduce((s, p) => s + p.longitude, 0) / positions.length;

    // Step 2: Compute distance of each position from centroid
    const distances = positions.map(p =>
      this.calculateDistance(p.latitude, p.longitude, centroidLat, centroidLon)
    );

    // Step 3: Filter outliers (> 2 standard deviations from mean distance)
    const meanDist = distances.reduce((s, d) => s + d, 0) / distances.length;
    const variance = distances.reduce((s, d) => s + (d - meanDist) ** 2, 0) / distances.length;
    const stdDev = Math.sqrt(variance);
    const cutoff = meanDist + 2 * stdDev;

    const filteredPositions = [];
    let outlierCount = 0;
    for (let i = 0; i < positions.length; i++) {
      if (distances[i] <= cutoff) {
        filteredPositions.push(positions[i]);
      } else {
        outlierCount++;
      }
    }

    // Step 4: Infer anchor position from chain geometry + wind direction
    // Uses catenary formula for accurate horizontal reach calculation.
    // Filters out low-wind positions where boat doesn't weathervane reliably.
    const CHAIN_SCOPE_M = chainScopeMeters || 45;
    const GPS_TO_BOW_M = 15.24; // 50 feet
    const FREEBOARD_M = 1.7; // waterline to bow roller
    const MIN_WIND_KT = 5; // skip low-wind positions
    const R_EARTH = 6371000;

    const anchorEstimates = [];
    for (const pos of filteredPositions) {
      if (pos.true_wind_direction == null || pos.depth == null || pos.depth <= 0) continue;
      if (pos.true_wind_speed == null || pos.true_wind_speed < MIN_WIND_KT) continue;

      const h = pos.depth + FREEBOARD_M;
      if (h >= CHAIN_SCOPE_M) continue;

      const horizontalReach = this.catenaryHorizontalReach(CHAIN_SCOPE_M, h);
      const totalDistance = GPS_TO_BOW_M + horizontalReach;

      const bearingRad = pos.true_wind_direction * Math.PI / 180;
      const latRad = pos.latitude * Math.PI / 180;
      const lonRad = pos.longitude * Math.PI / 180;
      const angularDist = totalDistance / R_EARTH;

      const anchorLat = Math.asin(
        Math.sin(latRad) * Math.cos(angularDist) +
        Math.cos(latRad) * Math.sin(angularDist) * Math.cos(bearingRad)
      );
      const anchorLon = lonRad + Math.atan2(
        Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(latRad),
        Math.cos(angularDist) - Math.sin(latRad) * Math.sin(anchorLat)
      );

      anchorEstimates.push({
        latitude: anchorLat * 180 / Math.PI,
        longitude: anchorLon * 180 / Math.PI
      });
    }

    let inferredAnchor = null;
    let swingCircle = null;

    if (anchorEstimates.length > 10) {
      // Median for anchor position (resistant to outliers)
      const sortedLats = anchorEstimates.map(e => e.latitude).sort((a, b) => a - b);
      const sortedLons = anchorEstimates.map(e => e.longitude).sort((a, b) => a - b);
      const mid = Math.floor(sortedLats.length / 2);
      const medianLat = sortedLats.length % 2 ? sortedLats[mid] : (sortedLats[mid - 1] + sortedLats[mid]) / 2;
      const medianLon = sortedLons.length % 2 ? sortedLons[mid] : (sortedLons[mid - 1] + sortedLons[mid]) / 2;

      // Confidence radius
      const estimateDistances = anchorEstimates.map(e =>
        this.calculateDistance(e.latitude, e.longitude, medianLat, medianLon)
      );
      const meanEstDist = estimateDistances.reduce((s, d) => s + d, 0) / estimateDistances.length;
      const estVariance = estimateDistances.reduce((s, d) => s + (d - meanEstDist) ** 2, 0) / estimateDistances.length;
      const confidenceRadius = Math.sqrt(estVariance);

      inferredAnchor = {
        latitude: medianLat,
        longitude: medianLon,
        confidenceRadiusMeters: Math.round(confidenceRadius * 10) / 10,
        estimateCount: anchorEstimates.length,
        chainScopeMeters: CHAIN_SCOPE_M,
        gpsToBowMeters: GPS_TO_BOW_M,
        freeboardMeters: FREEBOARD_M,
        minWindKt: MIN_WIND_KT
      };

      // Step 5: Compute swing circle centered on inferred anchor
      // Max observed distance from anchor to any GPS position + 5% buffer
      let maxSwingMeters = 0;
      const bearingsFromAnchor = [];

      for (const pos of filteredPositions) {
        const d = this.calculateDistance(pos.latitude, pos.longitude, medianLat, medianLon);
        if (d > maxSwingMeters) maxSwingMeters = d;

        // Bearing from anchor to GPS position (for arc coverage)
        const dLon = (pos.longitude - medianLon) * Math.PI / 180;
        const lat1 = medianLat * Math.PI / 180;
        const lat2 = pos.latitude * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        const bearing = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
        bearingsFromAnchor.push(bearing);
      }

      const safeRadiusMeters = maxSwingMeters * 1.05;

      // Arc coverage: find the angular range of observed positions
      bearingsFromAnchor.sort((a, b) => a - b);
      // Find the largest gap between consecutive bearings
      let maxGap = 0;
      let gapStart = 0;
      for (let i = 1; i < bearingsFromAnchor.length; i++) {
        const gap = bearingsFromAnchor[i] - bearingsFromAnchor[i - 1];
        if (gap > maxGap) {
          maxGap = gap;
          gapStart = i;
        }
      }
      // Check wrap-around gap
      const wrapGap = (360 - bearingsFromAnchor[bearingsFromAnchor.length - 1]) + bearingsFromAnchor[0];
      if (wrapGap > maxGap) {
        maxGap = wrapGap;
        gapStart = 0;
      }
      const arcCoverage = Math.round(360 - maxGap);
      // Arc starts after the largest gap
      const arcStartDeg = Math.round(bearingsFromAnchor[gapStart]);
      const arcEndDeg = Math.round(bearingsFromAnchor[(gapStart - 1 + bearingsFromAnchor.length) % bearingsFromAnchor.length]);

      swingCircle = {
        centerLat: medianLat,
        centerLon: medianLon,
        maxSwingMeters: Math.round(maxSwingMeters * 10) / 10,
        safeRadiusMeters: Math.round(safeRadiusMeters * 10) / 10,
        arcCoverageDeg: arcCoverage,
        arcStartDeg,
        arcEndDeg
      };
    }

    return {
      positions: filteredPositions,
      swingCircle,
      inferredAnchor,
      anchorage: {
        id: anchorage.id,
        name: anchorage.name || anchorage.location_name,
        arrived_at: anchorage.arrived_at,
        latitude: anchorage.latitude,
        longitude: anchorage.longitude
      },
      totalPositions,
      downsampledPositions: filteredPositions.length,
      outlierPositions: outlierCount
    };
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
