/**
 * Anchor Watch Alerts Service
 * Monitors anchor watch status and sends Telegram alerts on status changes
 */

import { logger } from '../utils/logger.js';
import { telegramService } from './telegram.service.js';
import { anchorWatchService } from './anchor-watch.service.js';

const moduleLogger = logger.createModuleLogger('anchor-watch-alerts');

class AnchorWatchAlertsService {
  constructor() {
    this.lastKnownStatus = null;
    this.lastAlertTime = null;
    this.monitoringInterval = null;
    this.checkIntervalMs = 20000; // Check every 20 seconds
    this.minAlertIntervalMs = 60000; // Minimum 1 minute between alerts for same status
    this.periodicUpdateIntervalMs = 1800000; // 30 minutes periodic update
    this.lastPeriodicUpdate = null;
  }

  /**
   * Start monitoring anchor watch status
   */
  start() {
    if (this.monitoringInterval) {
      moduleLogger.warn('Anchor watch alerts already running');
      return;
    }

    if (!telegramService.isConfigured()) {
      moduleLogger.warn('Telegram not configured, anchor watch alerts disabled');
      return;
    }

    // Start monitoring
    this.monitoringInterval = setInterval(() => {
      this.checkStatus().catch(error => {
        moduleLogger.error('Error checking anchor watch status', { error: error.message });
      });
    }, this.checkIntervalMs);

    // Run initial check
    this.checkStatus().catch(error => {
      moduleLogger.error('Error in initial status check', { error: error.message });
    });

    moduleLogger.info('Anchor watch alerts monitoring started', {
      checkInterval: this.checkIntervalMs / 1000 + 's'
    });
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      moduleLogger.info('Anchor watch alerts monitoring stopped');
    }
  }

  /**
   * Check current status and send alerts if needed
   * @returns {Promise<void>}
   */
  async checkStatus() {
    try {
      const status = await anchorWatchService.getStatus();

      // Skip if anchor watch is not active
      if (!status || !status.active) {
        // Reset state when inactive
        if (this.lastKnownStatus !== null) {
          this.lastKnownStatus = null;
          this.lastAlertTime = null;
          this.lastPeriodicUpdate = null;
          moduleLogger.info('Anchor watch deactivated, alerts reset');
        }
        return;
      }

      const currentStatus = status.status;
      const now = Date.now();

      // Check for status change
      const statusChanged = this.lastKnownStatus !== currentStatus;

      if (statusChanged) {
        // Status changed - send alert
        await this.sendStatusChangeAlert(status);
        this.lastKnownStatus = currentStatus;
        this.lastAlertTime = now;
        this.lastPeriodicUpdate = now; // Reset periodic timer on status change

      } else if (currentStatus !== 'safe') {
        // Status hasn't changed, but not safe - check for repeat alert
        const timeSinceLastAlert = now - (this.lastAlertTime || 0);

        if (timeSinceLastAlert > this.minAlertIntervalMs) {
          // Send reminder for non-safe status
          await this.sendStatusChangeAlert(status);
          this.lastAlertTime = now;
        }
      } else {
        // Status is safe and hasn't changed - check for periodic update
        const timeSinceLastUpdate = now - (this.lastPeriodicUpdate || 0);

        if (timeSinceLastUpdate > this.periodicUpdateIntervalMs) {
          // Send periodic "all good" update
          await this.sendPeriodicUpdate(status);
          this.lastPeriodicUpdate = now;
        }
      }

    } catch (error) {
      moduleLogger.error('Failed to check anchor watch status', { error: error.message });
    }
  }

  /**
   * Send status change alert
   * @param {Object} status - Current anchor watch status
   * @returns {Promise<void>}
   */
  async sendStatusChangeAlert(status) {
    try {
      await telegramService.sendAnchorWatchAlert(status, this.lastKnownStatus);
      moduleLogger.info('Status change alert sent', {
        from: this.lastKnownStatus,
        to: status.status,
        distance: status.distance_meters
      });
    } catch (error) {
      moduleLogger.error('Failed to send status change alert', { error: error.message });
    }
  }

  /**
   * Send periodic "all good" update
   * @param {Object} status - Current anchor watch status
   * @returns {Promise<void>}
   */
  async sendPeriodicUpdate(status) {
    try {
      const distance = status.distance_meters ? Math.round(status.distance_meters) : 'N/A';
      const radius = status.radius_meters || 'N/A';

      const message = `⚓ *Anchor Watch Update*\n\n` +
        `✅ All good - anchor holding\n` +
        `📏 ${distance}m from anchor (${radius}m radius)\n\n` +
        `⏰ Periodic update`;

      await telegramService.sendMessage(message);

      moduleLogger.info('Periodic update sent', { distance: status.distance_meters });

    } catch (error) {
      moduleLogger.error('Failed to send periodic update', { error: error.message });
    }
  }

  /**
   * Send activation notification
   * @param {Object} config - Activation configuration
   * @returns {Promise<void>}
   */
  async sendActivationNotification(config) {
    try {
      await telegramService.sendActivationConfirmation(config);
      this.lastKnownStatus = 'safe'; // Assume safe on activation
      this.lastAlertTime = Date.now();
      this.lastPeriodicUpdate = Date.now();

      moduleLogger.info('Activation notification sent', {
        latitude: config.latitude,
        longitude: config.longitude,
        radius: config.radius_meters
      });

    } catch (error) {
      moduleLogger.error('Failed to send activation notification', { error: error.message });
    }
  }

  /**
   * Send deactivation notification
   * @returns {Promise<void>}
   */
  async sendDeactivationNotification() {
    try {
      await telegramService.sendDeactivationConfirmation();
      this.lastKnownStatus = null;
      this.lastAlertTime = null;
      this.lastPeriodicUpdate = null;

      moduleLogger.info('Deactivation notification sent');

    } catch (error) {
      moduleLogger.error('Failed to send deactivation notification', { error: error.message });
    }
  }

  /**
   * Check if monitoring is active
   * @returns {boolean}
   */
  isActive() {
    return this.monitoringInterval !== null;
  }
}

// Create singleton instance
export const anchorWatchAlertsService = new AnchorWatchAlertsService();
