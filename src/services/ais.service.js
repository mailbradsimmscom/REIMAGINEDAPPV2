import { aisRepository } from '../repositories/ais.repository.js';
import { gpsRepository } from '../repositories/gps.repository.js';
import { logger } from '../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Service for AIS vessel operations
 */
class AisService {
  /**
   * Calculate distance between two points using Haversine formula
   * @param {number} lat1 - Latitude of point 1
   * @param {number} lon1 - Longitude of point 1
   * @param {number} lat2 - Latitude of point 2
   * @param {number} lon2 - Longitude of point 2
   * @returns {number} Distance in nautical miles
   */
  calculateDistanceNm(lat1, lon1, lat2, lon2) {
    const R = 3440.065; // Earth radius in nautical miles
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Get vessels around us sorted by distance
   * @returns {Promise<Object>} Vessels with distance and our position
   */
  async getVesselsAroundUs() {
    try {
      // Get our current position
      const ourPosition = await gpsRepository.getCurrentPosition();
      if (!ourPosition) {
        return {
          ourPosition: null,
          vessels: [],
          error: 'GPS position not available'
        };
      }

      // Get all vessels
      const vessels = await aisRepository.getVessels();

      // Get friends list for marking
      const friends = await aisRepository.getFriends();
      const friendMmsis = new Set(friends.map(f => f.mmsi));

      // Calculate distance for each vessel and sort
      const vesselsWithDistance = vessels
        .filter(v => v.latitude && v.longitude) // Skip vessels without position
        .map(vessel => {
          const distance = this.calculateDistanceNm(
            ourPosition.latitude,
            ourPosition.longitude,
            vessel.latitude,
            vessel.longitude
          );

          return {
            mmsi: vessel.mmsi,
            name: vessel.name || 'Unknown',
            latitude: vessel.latitude,
            longitude: vessel.longitude,
            speed_over_ground: vessel.speed_over_ground,
            course_over_ground: vessel.course_over_ground,
            ship_type: vessel.ship_type,
            navigation_state: vessel.navigation_state,
            updated_at: vessel.updated_at,
            distance_nm: Math.round(distance * 100) / 100,
            is_friend: friendMmsis.has(vessel.mmsi)
          };
        })
        .sort((a, b) => a.distance_nm - b.distance_nm);

      return {
        ourPosition: {
          latitude: ourPosition.latitude,
          longitude: ourPosition.longitude,
          timestamp: ourPosition.timestamp
        },
        vessels: vesselsWithDistance,
        count: vesselsWithDistance.length
      };
    } catch (error) {
      requestLogger.error('Error getting vessels around us', { error: error.message });
      throw error;
    }
  }

  /**
   * Get friends list with local position data if available
   * Also updates last_seen for friends currently in range
   * @returns {Promise<Object>} Friends with position info
   */
  async getFriendsWithPositions() {
    try {
      // Get friends list
      const friends = await aisRepository.getFriends();

      // Get our current position for distance calculation
      const ourPosition = await gpsRepository.getCurrentPosition();

      // Get all local vessels to check if friends are nearby
      const localVessels = await aisRepository.getVessels();
      const localVesselMap = new Map(localVessels.map(v => [v.mmsi, v]));

      // Enrich friends with local position data if available
      const friendsWithPositions = await Promise.all(friends.map(async (friend) => {
        const localData = localVesselMap.get(friend.mmsi);

        let distance = null;
        if (localData && ourPosition && localData.latitude && localData.longitude) {
          distance = this.calculateDistanceNm(
            ourPosition.latitude,
            ourPosition.longitude,
            localData.latitude,
            localData.longitude
          );

          // Update last seen position since friend is currently in range
          await aisRepository.updateFriendLastSeen(
            friend.mmsi,
            localData.latitude,
            localData.longitude
          );
        }

        return {
          mmsi: friend.mmsi,
          name: friend.name,
          ship_type: friend.ship_type,
          created_at: friend.created_at,
          // Current position (if vessel is nearby)
          is_nearby: !!localData,
          latitude: localData?.latitude || null,
          longitude: localData?.longitude || null,
          speed_over_ground: localData?.speed_over_ground || null,
          navigation_state: localData?.navigation_state || null,
          distance_nm: distance ? Math.round(distance * 100) / 100 : null,
          // Last seen data (for when friend is not nearby)
          last_latitude: friend.last_latitude,
          last_longitude: friend.last_longitude,
          last_seen_at: localData ? new Date().toISOString() : friend.last_seen_at
        };
      }));

      return {
        ourPosition: ourPosition ? {
          latitude: ourPosition.latitude,
          longitude: ourPosition.longitude
        } : null,
        friends: friendsWithPositions,
        count: friendsWithPositions.length
      };
    } catch (error) {
      requestLogger.error('Error getting friends with positions', { error: error.message });
      throw error;
    }
  }

  /**
   * Add a vessel as a friend
   * @param {string} mmsi - Vessel MMSI
   * @param {string} name - Vessel name
   * @param {string|null} shipType - Vessel type
   * @returns {Promise<Object>} Created friend
   */
  async addFriend(mmsi, name, shipType = null) {
    if (!mmsi || !name) {
      throw new Error('MMSI and name are required');
    }

    // Check if already a friend
    const isFriend = await aisRepository.isFriend(mmsi);
    if (isFriend) {
      throw new Error('Vessel is already a friend');
    }

    // Check if vessel is currently in range to set initial last_seen
    const vessel = await aisRepository.getVesselByMmsi(mmsi);
    const lastSeen = vessel ? {
      latitude: vessel.latitude,
      longitude: vessel.longitude
    } : null;

    return await aisRepository.addFriend(mmsi, name, shipType, lastSeen);
  }

  /**
   * Remove a vessel from friends
   * @param {string} mmsi - Vessel MMSI
   * @returns {Promise<void>}
   */
  async removeFriend(mmsi) {
    if (!mmsi) {
      throw new Error('MMSI is required');
    }

    return await aisRepository.removeFriend(mmsi);
  }
}

// Export singleton instance
export const aisService = new AisService();
