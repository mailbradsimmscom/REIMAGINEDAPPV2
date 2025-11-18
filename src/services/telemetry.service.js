import { telemetryRepository } from '../repositories/telemetry.repository.js';
import { logger } from '../utils/logger.js';

const requestLogger = logger.createRequestLogger();

class TelemetryService {
  /**
   * Get current telemetry data formatted for dashboard display
   * Groups data by category and formats for easy consumption
   * @returns {Promise<Object>} Formatted telemetry data
   */
  async getCurrentTelemetry() {
    try {
      const rawData = await telemetryRepository.getCurrentState();

      // Transform and group the data
      const grouped = this.groupByCategory(rawData);

      // Extract key metrics for quick display
      const summary = this.extractSummary(grouped);

      return {
        summary,
        categories: grouped,
        last_updated: this.getLatestTimestamp(rawData)
      };
    } catch (error) {
      requestLogger.error('Error getting current telemetry', { error: error.message });
      throw error;
    }
  }

  /**
   * Group raw telemetry data by device category
   * @param {Array} rawData - Raw telemetry readings
   * @returns {Object} Data grouped by category
   */
  groupByCategory(rawData) {
    const grouped = {};

    for (const reading of rawData) {
      const device = reading.telemetry_metrics.telemetry_devices;
      const metric = reading.telemetry_metrics;
      const category = device.category || 'unknown';

      if (!grouped[category]) {
        grouped[category] = {
          devices: {}
        };
      }

      const deviceId = device.source_device_id;
      if (!grouped[category].devices[deviceId]) {
        grouped[category].devices[deviceId] = {
          display_name: device.display_name || deviceId,
          product_name: device.product_name,
          metrics: {}
        };
      }

      grouped[category].devices[deviceId].metrics[metric.metric_name] = {
        value: reading.numeric_value ?? reading.bool_value ?? reading.string_value,
        unit: metric.unit,
        is_primary: metric.is_primary,
        last_ts: reading.last_ts
      };
    }

    return grouped;
  }

  /**
   * Extract key summary metrics for dashboard header
   * @param {Object} grouped - Grouped telemetry data
   * @returns {Object} Summary metrics
   */
  extractSummary(grouped) {
    const summary = {
      battery_soc: null,
      battery_voltage: null,
      battery_current: null,
      battery_power: null,
      solar_power: null,
      ac_consumption: null,
      tanks: []
    };

    // Battery metrics (from system/0 or battery/1)
    if (grouped.system?.devices['system/0']?.metrics) {
      const systemMetrics = grouped.system.devices['system/0'].metrics;
      summary.battery_soc = systemMetrics['Dc/Battery/Soc']?.value ?? null;
      summary.battery_voltage = systemMetrics['Dc/Battery/Voltage']?.value ?? null;
      summary.battery_current = systemMetrics['Dc/Battery/Current']?.value ?? null;
      summary.battery_power = systemMetrics['Dc/Battery/Power']?.value ?? null;
      summary.solar_power = systemMetrics['Dc/Pv/Power']?.value ?? null;
      summary.ac_consumption = systemMetrics['Ac/Consumption/L1/Power']?.value ?? null;
    }

    // Fallback to battery/1 if system metrics not available
    if (summary.battery_soc === null && grouped.battery?.devices['battery/1']?.metrics) {
      const batteryMetrics = grouped.battery.devices['battery/1'].metrics;
      summary.battery_soc = batteryMetrics['Soc']?.value ?? null;
      summary.battery_voltage = batteryMetrics['Dc/0/Voltage']?.value ?? null;
      summary.battery_current = batteryMetrics['Dc/0/Current']?.value ?? null;
      summary.battery_power = batteryMetrics['Dc/0/Power']?.value ?? null;
    }

    // Tank levels
    if (grouped.tank?.devices) {
      for (const [deviceId, device] of Object.entries(grouped.tank.devices)) {
        const level = device.metrics['Level']?.value ?? device.metrics['Remaining']?.value;
        if (level !== undefined) {
          summary.tanks.push({
            device_id: deviceId,
            name: device.display_name || deviceId,
            level: level,
            // Level is 0-1 fraction, convert to percentage
            level_percent: Math.round((level * 100) * 10) / 10
          });
        }
      }
    }

    return summary;
  }

  /**
   * Get the most recent timestamp from readings
   * @param {Array} rawData - Raw telemetry readings
   * @returns {string|null} ISO timestamp or null
   */
  getLatestTimestamp(rawData) {
    if (!rawData || rawData.length === 0) return null;

    let latest = null;
    for (const reading of rawData) {
      if (!latest || new Date(reading.last_ts) > new Date(latest)) {
        latest = reading.last_ts;
      }
    }
    return latest;
  }

  /**
   * Get battery details
   * @returns {Promise<Object>} Battery telemetry data
   */
  async getBatteryDetails() {
    try {
      const rawData = await telemetryRepository.getCurrentStateByCategory('battery');
      const systemData = await telemetryRepository.getCurrentStateByCategory('system');

      // Combine battery and system data
      const allData = [...rawData, ...systemData];
      const grouped = this.groupByCategory(allData);

      return {
        battery: grouped.battery || { devices: {} },
        system: grouped.system || { devices: {} },
        last_updated: this.getLatestTimestamp(allData)
      };
    } catch (error) {
      requestLogger.error('Error getting battery details', { error: error.message });
      throw error;
    }
  }

  /**
   * Get solar charger details
   * @returns {Promise<Object>} Solar telemetry data
   */
  async getSolarDetails() {
    try {
      const rawData = await telemetryRepository.getCurrentStateByCategory('solarcharger');
      const grouped = this.groupByCategory(rawData);

      // Calculate total solar power
      let totalPower = 0;
      if (grouped.solarcharger?.devices) {
        for (const device of Object.values(grouped.solarcharger.devices)) {
          const power = device.metrics['Yield/Power']?.value || 0;
          totalPower += power;
        }
      }

      return {
        total_power: totalPower,
        chargers: grouped.solarcharger?.devices || {},
        last_updated: this.getLatestTimestamp(rawData)
      };
    } catch (error) {
      requestLogger.error('Error getting solar details', { error: error.message });
      throw error;
    }
  }

  /**
   * Get tank levels
   * @returns {Promise<Object>} Tank telemetry data
   */
  async getTankDetails() {
    try {
      const rawData = await telemetryRepository.getCurrentStateByCategory('tank');
      const grouped = this.groupByCategory(rawData);

      const tanks = [];
      if (grouped.tank?.devices) {
        for (const [deviceId, device] of Object.entries(grouped.tank.devices)) {
          const level = device.metrics['Level']?.value ?? device.metrics['Remaining']?.value;
          tanks.push({
            device_id: deviceId,
            name: device.display_name || deviceId,
            level: level,
            level_percent: level !== undefined ? Math.round((level * 100) * 10) / 10 : null,
            raw_value: device.metrics['RawValue']?.value,
            last_ts: device.metrics['Level']?.last_ts || device.metrics['Remaining']?.last_ts
          });
        }
      }

      return {
        tanks,
        last_updated: this.getLatestTimestamp(rawData)
      };
    } catch (error) {
      requestLogger.error('Error getting tank details', { error: error.message });
      throw error;
    }
  }
}

// Export singleton instance
export const telemetryService = new TelemetryService();
