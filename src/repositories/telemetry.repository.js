import { getSupabaseClient } from './supabaseClient.js';
import { logger } from '../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Repository for accessing Victron telemetry data from Supabase
 */
class TelemetryRepository {
  /**
   * Get current state of all telemetry metrics
   * Joins with devices and metrics tables for full context
   * @returns {Promise<Array>} Array of current telemetry readings
   */
  async getCurrentState() {
    try {
      const supabase = await getSupabaseClient();

      // Key metrics we care about for dashboard display
      // Using 'or' filter to get only relevant metrics
      const dashboardMetrics = [
        // Battery metrics
        'Soc',
        'Dc/0/Voltage',
        'Dc/0/Current',
        'Dc/0/Power',
        'TimeToGo',
        // Solar metrics
        'Yield/Power',
        'Yield/User',
        'Pv/V',
        // Tank metrics
        'Level',
        'Remaining',
        'RawValue',
        // System metrics
        'Dc/Battery/Soc',
        'Dc/Battery/Voltage',
        'Dc/Battery/Current',
        'Dc/Battery/Power',
        'Dc/Pv/Power',
        'Ac/Consumption/L1/Power'
        // Note: Temperature uses 'RawValue' which is already included for tanks
      ];

      const { data, error } = await supabase
        .from('telemetry_current_state')
        .select(`
          metric_id,
          last_ts,
          numeric_value,
          bool_value,
          string_value,
          telemetry_metrics!inner (
            metric_name,
            unit,
            is_primary,
            telemetry_devices!inner (
              source_device_id,
              display_name,
              product_name,
              category
            )
          )
        `)
        .in('telemetry_metrics.metric_name', dashboardMetrics)
        .order('last_ts', { ascending: false });

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      requestLogger.error('Error fetching telemetry current state', { error: error.message });
      throw error;
    }
  }

  /**
   * Get current state for a specific device category
   * @param {string} category - Device category (battery, tank, solarcharger, etc.)
   * @returns {Promise<Array>} Array of current readings for that category
   */
  async getCurrentStateByCategory(category) {
    try {
      const supabase = await getSupabaseClient();

      const { data, error } = await supabase
        .from('telemetry_current_state')
        .select(`
          metric_id,
          last_ts,
          numeric_value,
          bool_value,
          string_value,
          telemetry_metrics!inner (
            metric_name,
            unit,
            is_primary,
            telemetry_devices!inner (
              source_device_id,
              display_name,
              product_name,
              category
            )
          )
        `)
        .eq('telemetry_metrics.telemetry_devices.category', category)
        .order('last_ts', { ascending: false });

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      requestLogger.error('Error fetching telemetry by category', {
        category,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get list of all telemetry devices
   * @returns {Promise<Array>} Array of devices
   */
  async getDevices() {
    try {
      const supabase = await getSupabaseClient();

      const { data, error } = await supabase
        .from('telemetry_devices')
        .select('*')
        .order('category', { ascending: true });

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      requestLogger.error('Error fetching telemetry devices', { error: error.message });
      throw error;
    }
  }

  /**
   * Get aggregated data for a metric
   * @param {string} metricId - UUID of the metric
   * @param {string} resolution - '1m', '5m', or '1h'
   * @param {number} hours - Number of hours of history to retrieve
   * @returns {Promise<Array>} Array of aggregated readings
   */
  async getAggregatedData(metricId, resolution = '5m', hours = 24) {
    try {
      const supabase = await getSupabaseClient();

      const tableName = `telemetry_agg_${resolution}`;
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('metric_id', metricId)
        .gte('bucket_start', cutoff)
        .order('bucket_start', { ascending: true });

      if (error) {
        throw error;
      }

      return data || [];
    } catch (error) {
      requestLogger.error('Error fetching aggregated telemetry', {
        metricId,
        resolution,
        error: error.message
      });
      throw error;
    }
  }
}

// Export singleton instance
export const telemetryRepository = new TelemetryRepository();
