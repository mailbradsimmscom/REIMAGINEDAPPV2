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
      // Main system totals
      battery_soc: null,
      battery_voltage: null,
      battery_current: null,
      battery_power: null,
      solar_power: null,
      ac_consumption: null,
      temperature: null,
      // Detailed breakdowns
      batteries: [],
      solar_chargers: [],
      tanks: []
    };

    // System-level metrics (totals)
    if (grouped.system?.devices['system/0']?.metrics) {
      const systemMetrics = grouped.system.devices['system/0'].metrics;
      summary.battery_soc = systemMetrics['Dc/Battery/Soc']?.value ?? null;
      summary.battery_voltage = systemMetrics['Dc/Battery/Voltage']?.value ?? null;
      summary.battery_current = systemMetrics['Dc/Battery/Current']?.value ?? null;
      summary.battery_power = systemMetrics['Dc/Battery/Power']?.value ?? null;
      summary.solar_power = systemMetrics['Dc/Pv/Power']?.value ?? null;
      summary.ac_consumption = systemMetrics['Ac/Consumption/L1/Power']?.value ?? null;
    }

    // Individual battery banks
    if (grouped.battery?.devices) {
      for (const [deviceId, device] of Object.entries(grouped.battery.devices)) {
        const voltage = device.metrics['Dc/0/Voltage']?.value;
        const soc = device.metrics['Soc']?.value;
        const current = device.metrics['Dc/0/Current']?.value;
        const power = device.metrics['Dc/0/Power']?.value;
        const timeToGo = device.metrics['TimeToGo']?.value;

        // Determine battery bank name based on voltage
        let bankName = device.display_name || deviceId;
        if (voltage) {
          if (voltage >= 40) bankName = '48V Bank';
          else if (voltage >= 20) bankName = '24V Bank';
          else if (voltage >= 10) bankName = '12V Bank';
        }

        summary.batteries.push({
          device_id: deviceId,
          name: bankName,
          soc: soc,
          voltage: voltage,
          current: current,
          power: power,
          time_to_go: timeToGo,
          last_ts: device.metrics['Soc']?.last_ts || device.metrics['Dc/0/Voltage']?.last_ts
        });
      }

      // Sort by voltage descending (48V first)
      summary.batteries.sort((a, b) => (b.voltage || 0) - (a.voltage || 0));
    }

    // Fallback main battery from battery/1 if system metrics not available
    if (summary.battery_soc === null && summary.batteries.length > 0) {
      const mainBattery = summary.batteries[0];
      summary.battery_soc = mainBattery.soc;
      summary.battery_voltage = mainBattery.voltage;
      summary.battery_current = mainBattery.current;
      summary.battery_power = mainBattery.power;
    }

    // Individual solar chargers
    if (grouped.solarcharger?.devices) {
      let totalSolarPower = 0;
      for (const [deviceId, device] of Object.entries(grouped.solarcharger.devices)) {
        const power = device.metrics['Yield/Power']?.value || 0;
        const pvVoltage = device.metrics['Pv/V']?.value;
        const dcVoltage = device.metrics['Dc/0/Voltage']?.value;
        const yieldToday = device.metrics['Yield/User']?.value;

        totalSolarPower += power;

        // Extract charger number from device ID (e.g., "solarcharger/289" -> "289")
        const chargerNum = deviceId.split('/')[1] || deviceId;

        // Use display_name only if it's not the same as deviceId
        const displayName = device.display_name !== deviceId ? device.display_name : null;

        summary.solar_chargers.push({
          device_id: deviceId,
          name: displayName || `MPPT ${chargerNum}`,
          power: power,
          pv_voltage: pvVoltage,
          dc_voltage: dcVoltage,
          yield_today: yieldToday,
          last_ts: device.metrics['Yield/Power']?.last_ts
        });
      }

      // Sort by device ID for consistent ordering
      summary.solar_chargers.sort((a, b) => a.device_id.localeCompare(b.device_id));

      // Use calculated total if system total not available
      if (summary.solar_power === null) {
        summary.solar_power = totalSolarPower;
      }
    }

    // Tank levels - all 4 tanks
    if (grouped.tank?.devices) {
      // Tank name mappings
      const tankNames = {
        'tank/20': 'Port Water',
        'tank/21': 'Starboard Water',
        'tank/22': 'Starboard Diesel',
        'tank/23': 'Port Diesel'
      };

      for (const [deviceId, device] of Object.entries(grouped.tank.devices)) {
        const level = device.metrics['Level']?.value ?? device.metrics['Remaining']?.value;
        const rawValue = device.metrics['RawValue']?.value;

        // Determine if level is 0-1 fraction or 0-100 percentage
        // If > 1, assume it's already a percentage
        let levelPercent = null;
        if (level !== undefined) {
          if (level > 1) {
            // Already a percentage (0-100)
            levelPercent = Math.round(level * 10) / 10;
          } else {
            // Fraction (0-1), convert to percentage
            levelPercent = Math.round((level * 100) * 10) / 10;
          }
        }

        // Use tankNames mapping, fallback to display_name only if it's not the device ID
        const displayName = device.display_name !== deviceId ? device.display_name : null;
        const tankName = displayName || tankNames[deviceId] || deviceId;

        summary.tanks.push({
          device_id: deviceId,
          name: tankName,
          level: level,
          level_percent: levelPercent,
          raw_value: rawValue,
          type: this.getTankType(deviceId, tankName),
          last_ts: device.metrics['Level']?.last_ts || device.metrics['Remaining']?.last_ts
        });
      }

      // Sort tanks: water first, then diesel
      summary.tanks.sort((a, b) => {
        if (a.type === b.type) return a.device_id.localeCompare(b.device_id);
        return a.type === 'water' ? -1 : 1;
      });
    }

    // Temperature
    if (grouped.temperature?.devices['temperature/27']?.metrics) {
      const tempMetrics = grouped.temperature.devices['temperature/27'].metrics;
      summary.temperature = tempMetrics['RawValue']?.value ?? null;
    }

    return summary;
  }

  /**
   * Determine tank type from device ID or name
   * @param {string} deviceId - Device ID
   * @param {string} name - Tank name
   * @returns {string} 'water', 'fuel', or 'waste'
   */
  getTankType(deviceId, name) {
    const lowerName = (name || deviceId).toLowerCase();
    if (lowerName.includes('diesel') || lowerName.includes('fuel')) return 'fuel';
    if (lowerName.includes('waste') || lowerName.includes('black') || lowerName.includes('grey')) return 'waste';
    return 'water';
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
