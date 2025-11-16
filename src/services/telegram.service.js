/**
 * Telegram Service
 * Handles sending formatted messages to Telegram users
 */

import TelegramBot from 'node-telegram-bot-api';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

const moduleLogger = logger.createModuleLogger('telegram-service');

class TelegramService {
  constructor() {
    this.bot = null;
    this.env = getEnv();
  }

  /**
   * Initialize bot instance
   * @returns {TelegramBot|null}
   */
  getBot() {
    if (!this.bot && this.env.TELEGRAM_BOT_TOKEN) {
      try {
        this.bot = new TelegramBot(this.env.TELEGRAM_BOT_TOKEN, { polling: false });
        moduleLogger.info('Telegram bot initialized (send-only mode)');
      } catch (error) {
        moduleLogger.error('Failed to initialize Telegram bot', { error: error.message });
        return null;
      }
    }
    return this.bot;
  }

  /**
   * Check if Telegram is configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!(this.env.TELEGRAM_BOT_TOKEN && this.env.TELEGRAM_CHAT_ID);
  }

  /**
   * Send a plain text message
   * @param {string} message - Message text
   * @param {string} [chatId] - Override default chat ID
   * @returns {Promise<void>}
   */
  async sendMessage(message, chatId = null) {
    const bot = this.getBot();
    const targetChatId = chatId || this.env.TELEGRAM_CHAT_ID;

    if (!bot || !targetChatId) {
      moduleLogger.warn('Telegram not configured, skipping message send');
      return;
    }

    try {
      await bot.sendMessage(targetChatId, message, { parse_mode: 'Markdown' });
      moduleLogger.info('Telegram message sent', { chatId: targetChatId });
    } catch (error) {
      moduleLogger.error('Failed to send Telegram message', {
        error: error.message,
        chatId: targetChatId
      });
      throw error;
    }
  }

  /**
   * Format and send anchor watch status message
   * @param {Object} status - Anchor watch status object
   * @returns {Promise<void>}
   */
  async sendAnchorWatchStatus(status) {
    if (!status) {
      await this.sendMessage('⚓ *Anchor Watch Status*\n\nNo status data available');
      return;
    }

    let message = '⚓ *Anchor Watch Status*\n\n';

    if (!status.active) {
      message += '❌ Anchor watch is *not active*';
      await this.sendMessage(message);
      return;
    }

    // Status emoji and text
    let statusEmoji = '✅';
    let statusText = 'Safe';

    if (status.status === 'warning') {
      statusEmoji = '⚠️';
      statusText = 'Warning - Approaching Limit';
    } else if (status.status === 'dragging') {
      statusEmoji = '🚨';
      statusText = 'DRAGGING DETECTED';
    } else if (status.status === 'gps_lost') {
      statusEmoji = '📡';
      statusText = 'GPS Signal Lost';
    }

    message += `${statusEmoji} *Status:* ${statusText}\n\n`;

    // Distance
    if (status.distance_meters !== null && status.distance_meters !== undefined) {
      message += `📏 *Distance:* ${Math.round(status.distance_meters)}m from anchor\n`;
    }

    // Radius
    if (status.radius_meters) {
      message += `🎯 *Safe Radius:* ${status.radius_meters}m\n`;
    }

    // Current position
    if (status.current_lat && status.current_lon) {
      message += `📍 *Position:* ${status.current_lat.toFixed(6)}, ${status.current_lon.toFixed(6)}\n`;
    }

    // Anchor position
    if (status.anchor_lat && status.anchor_lon) {
      message += `⚓ *Anchor:* ${status.anchor_lat.toFixed(6)}, ${status.anchor_lon.toFixed(6)}\n`;
    }

    // Last updated
    if (status.last_updated) {
      const updateTime = new Date(status.last_updated).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      message += `\n⏰ Updated: ${updateTime}`;
    }

    await this.sendMessage(message);
  }

  /**
   * Format and send anchor watch alert (status change)
   * @param {Object} status - Current anchor watch status
   * @param {string} previousStatus - Previous status value
   * @returns {Promise<void>}
   */
  async sendAnchorWatchAlert(status, previousStatus) {
    if (!status || !status.active) return;

    let message = '';
    const distance = status.distance_meters ? Math.round(status.distance_meters) : 'N/A';
    const radius = status.radius_meters || 'N/A';

    switch (status.status) {
      case 'safe':
        if (previousStatus === 'warning' || previousStatus === 'dragging') {
          // Returned to safe zone
          message = `✅ *ANCHOR HOLDING*\n\nReturned to safe zone\n📏 ${distance}m from anchor (${radius}m radius)`;
        }
        break;

      case 'warning':
        message = `⚠️ *ANCHOR WATCH WARNING*\n\nApproaching safe zone limit\n📏 ${distance}m from anchor (${radius}m radius)\n\n⚠️ Monitor position closely`;
        break;

      case 'dragging':
        message = `🚨 *ANCHOR DRAGGING ALERT*\n\n🚨 ANCHOR IS DRAGGING 🚨\n\n📏 ${distance}m from anchor point\n🎯 Safe radius: ${radius}m\n\n⚠️ IMMEDIATE ACTION REQUIRED`;
        break;

      case 'gps_lost':
        message = `📡 *GPS SIGNAL LOST*\n\nUnable to determine position\n⚠️ Check GPS connection`;
        break;

      default:
        // Unknown status, send generic alert
        message = `⚓ *Anchor Watch Update*\n\nStatus: ${status.status}\n📏 Distance: ${distance}m`;
    }

    if (message) {
      await this.sendMessage(message);
      moduleLogger.info('Anchor watch alert sent', {
        status: status.status,
        previousStatus,
        distance: status.distance_meters
      });
    }
  }

  /**
   * Format and send recent GPS positions
   * @param {Array} positions - Array of position objects
   * @returns {Promise<void>}
   */
  async sendRecentPositions(positions) {
    if (!positions || positions.length === 0) {
      await this.sendMessage('📍 *Recent Positions*\n\nNo GPS positions available');
      return;
    }

    let message = '📍 *Recent Positions*\n\n';

    // Limit to 5 most recent
    const recentPositions = positions.slice(0, 5);

    recentPositions.forEach((pos, index) => {
      const time = new Date(pos.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
      const lat = pos.latitude.toFixed(4);
      const lon = pos.longitude.toFixed(4);
      const distance = pos.distance_from_anchor ? `${Math.round(pos.distance_from_anchor)}m` : '-';

      message += `${index + 1}. ${time} | ${lat}, ${lon} | ${distance}\n`;
    });

    await this.sendMessage(message);
  }

  /**
   * Send activation confirmation
   * @param {Object} config - Activation config (lat, lon, radius)
   * @returns {Promise<void>}
   */
  async sendActivationConfirmation(config) {
    const message = `✅ *Anchor Watch Activated*\n\n` +
      `⚓ Anchor: ${config.latitude.toFixed(6)}, ${config.longitude.toFixed(6)}\n` +
      `🎯 Safe Radius: ${config.radius_meters}m\n\n` +
      `You will receive alerts if the boat moves outside the safe zone.`;

    await this.sendMessage(message);
  }

  /**
   * Send deactivation confirmation
   * @returns {Promise<void>}
   */
  async sendDeactivationConfirmation() {
    const message = `⚓ *Anchor Watch Deactivated*\n\nNo longer monitoring anchor position.`;
    await this.sendMessage(message);
  }

  /**
   * Send help/welcome message
   * @returns {Promise<void>}
   */
  async sendHelpMessage() {
    const message = `⚓ *BoatOS Anchor Watch Bot*\n\n` +
      `Available commands:\n\n` +
      `/start - Register and get your Chat ID\n` +
      `/status - Current anchor watch status\n` +
      `/positions - Recent GPS positions\n` +
      `/help - Show this help message\n\n` +
      `You will receive automatic alerts when:\n` +
      `• Anchor watch is activated\n` +
      `• Boat approaches safe zone limit\n` +
      `• Anchor is dragging\n` +
      `• GPS signal is lost`;

    await this.sendMessage(message);
  }
}

// Create singleton instance
export const telegramService = new TelegramService();
