import { getSupabaseClient } from './supabaseClient.js';
import { logger } from '../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Repository for AIS vessel data
 */
class AisRepository {
  /**
   * Get all vessels from ais_vessels table
   * @returns {Promise<Array>} Array of vessels
   */
  async getVessels() {
    try {
      const supabase = await getSupabaseClient();

      const { data, error } = await supabase
        .from('ais_vessels')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      requestLogger.error('Error fetching AIS vessels', { error: error.message });
      throw error;
    }
  }

  /**
   * Get all friends from ais_friends table
   * @returns {Promise<Array>} Array of friends
   */
  async getFriends() {
    try {
      const supabase = await getSupabaseClient();

      const { data, error } = await supabase
        .from('ais_friends')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      requestLogger.error('Error fetching AIS friends', { error: error.message });
      throw error;
    }
  }

  /**
   * Check if a vessel is already a friend
   * @param {string} mmsi - Vessel MMSI
   * @returns {Promise<boolean>}
   */
  async isFriend(mmsi) {
    try {
      const supabase = await getSupabaseClient();

      const { count, error } = await supabase
        .from('ais_friends')
        .select('mmsi', { count: 'exact', head: true })
        .eq('mmsi', mmsi);

      if (error) throw error;
      return count > 0;
    } catch (error) {
      requestLogger.error('Error checking if vessel is friend', { error: error.message, mmsi });
      throw error;
    }
  }

  /**
   * Add a vessel as a friend
   * @param {string} mmsi - Vessel MMSI
   * @param {string} name - Vessel name
   * @param {string|null} shipType - Vessel type
   * @param {Object|null} lastSeen - Optional last seen position {latitude, longitude}
   * @returns {Promise<Object>} Created friend record
   */
  async addFriend(mmsi, name, shipType = null, lastSeen = null) {
    try {
      const supabase = await getSupabaseClient();

      const insertData = {
        mmsi,
        name,
        ship_type: shipType
      };

      // If we have position data, set initial last_seen
      if (lastSeen && lastSeen.latitude && lastSeen.longitude) {
        insertData.last_latitude = lastSeen.latitude;
        insertData.last_longitude = lastSeen.longitude;
        insertData.last_seen_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from('ais_friends')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new Error('Vessel is already a friend');
        }
        throw error;
      }

      requestLogger.info('Added AIS friend', { mmsi, name });
      return data;
    } catch (error) {
      requestLogger.error('Error adding AIS friend', { error: error.message, mmsi });
      throw error;
    }
  }

  /**
   * Remove a vessel from friends
   * @param {string} mmsi - Vessel MMSI
   * @returns {Promise<void>}
   */
  async removeFriend(mmsi) {
    try {
      const supabase = await getSupabaseClient();

      const { error } = await supabase
        .from('ais_friends')
        .delete()
        .eq('mmsi', mmsi);

      if (error) throw error;

      requestLogger.info('Removed AIS friend', { mmsi });
    } catch (error) {
      requestLogger.error('Error removing AIS friend', { error: error.message, mmsi });
      throw error;
    }
  }

  /**
   * Get a specific vessel by MMSI from ais_vessels
   * @param {string} mmsi - Vessel MMSI
   * @returns {Promise<Object|null>}
   */
  async getVesselByMmsi(mmsi) {
    try {
      const supabase = await getSupabaseClient();

      const { data, error } = await supabase
        .from('ais_vessels')
        .select('*')
        .eq('mmsi', mmsi)
        .maybeSingle();

      if (error) throw error;
      return data;
    } catch (error) {
      requestLogger.error('Error fetching vessel by MMSI', { error: error.message, mmsi });
      throw error;
    }
  }

  /**
   * Update last seen position for a friend
   * @param {string} mmsi - Vessel MMSI
   * @param {number} latitude - Last known latitude
   * @param {number} longitude - Last known longitude
   * @returns {Promise<void>}
   */
  async updateFriendLastSeen(mmsi, latitude, longitude) {
    try {
      const supabase = await getSupabaseClient();

      const { error } = await supabase
        .from('ais_friends')
        .update({
          last_latitude: latitude,
          last_longitude: longitude,
          last_seen_at: new Date().toISOString()
        })
        .eq('mmsi', mmsi);

      if (error) throw error;
    } catch (error) {
      requestLogger.error('Error updating friend last seen', { error: error.message, mmsi });
      throw error;
    }
  }
}

// Export singleton instance
export const aisRepository = new AisRepository();
