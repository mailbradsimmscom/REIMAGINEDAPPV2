/**
 * Twilio SMS Service
 * Sends critical anchor watch alerts via SMS
 */

import twilio from 'twilio';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

const moduleLogger = logger.createModuleLogger('twilio-service');

class TwilioService {
  constructor() {
    this.client = null;
    this.env = getEnv();
  }

  /**
   * Initialize Twilio client
   * @returns {Object|null}
   */
  getClient() {
    if (!this.client && this.env.TWILIO_ACCOUNT_SID && this.env.TWILIO_AUTH_TOKEN) {
      try {
        this.client = twilio(this.env.TWILIO_ACCOUNT_SID, this.env.TWILIO_AUTH_TOKEN);
        moduleLogger.info('Twilio client initialized');
      } catch (error) {
        moduleLogger.error('Failed to initialize Twilio client', { error: error.message });
        return null;
      }
    }
    return this.client;
  }

  /**
   * Check if Twilio SMS is configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!(
      this.env.TWILIO_ACCOUNT_SID &&
      this.env.TWILIO_AUTH_TOKEN &&
      this.env.TWILIO_PHONE_NUMBER &&
      this.env.TWILIO_SMS_TO
    );
  }

  /**
   * Send SMS message
   * @param {string} message - Message text
   * @returns {Promise<void>}
   */
  async sendSMS(message) {
    const client = this.getClient();

    if (!client || !this.isConfigured()) {
      moduleLogger.warn('Twilio not configured, skipping SMS send');
      return;
    }

    try {
      const result = await client.messages.create({
        body: message,
        from: this.env.TWILIO_PHONE_NUMBER,
        to: this.env.TWILIO_SMS_TO
      });

      moduleLogger.info('SMS sent successfully', {
        sid: result.sid,
        to: this.env.TWILIO_SMS_TO,
        status: result.status
      });

    } catch (error) {
      moduleLogger.error('Failed to send SMS', {
        error: error.message,
        code: error.code,
        to: this.env.TWILIO_SMS_TO
      });
      throw error;
    }
  }

  /**
   * Send critical anchor watch alert via SMS
   * @param {Object} status - Anchor watch status
   * @returns {Promise<void>}
   */
  async sendCriticalAlert(status) {
    if (!status) return;

    const distance = status.distance_meters ? Math.round(status.distance_meters) : 'N/A';
    const radius = status.radius_meters || 'N/A';
    let message = '';

    switch (status.status) {
      case 'warning':
        message = `⚠️ ANCHOR WATCH WARNING\n\n` +
          `Approaching safe zone limit!\n` +
          `Distance: ${distance}m from anchor\n` +
          `Safe radius: ${radius}m\n\n` +
          `Monitor position closely.`;
        break;

      case 'dragging':
        message = `🚨 ANCHOR DRAGGING ALERT 🚨\n\n` +
          `ANCHOR IS DRAGGING!\n\n` +
          `Distance: ${distance}m from anchor point\n` +
          `Safe radius: ${radius}m\n\n` +
          `IMMEDIATE ACTION REQUIRED`;
        break;

      case 'gps_lost':
        message = `📡 GPS SIGNAL LOST\n\n` +
          `Unable to determine boat position.\n` +
          `Check GPS connection immediately.`;
        break;

      default:
        // Don't send SMS for safe status
        return;
    }

    if (message) {
      await this.sendSMS(message);
      moduleLogger.info('Critical alert SMS sent', {
        status: status.status,
        distance: status.distance_meters
      });
    }
  }

  /**
   * Send test SMS
   * @returns {Promise<void>}
   */
  async sendTestMessage() {
    const message = `BoatOS Anchor Watch\n\nTest message - SMS alerts are working correctly.`;
    await this.sendSMS(message);
  }
}

// Create singleton instance
export const twilioService = new TwilioService();
