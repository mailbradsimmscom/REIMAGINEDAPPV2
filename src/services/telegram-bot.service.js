/**
 * Telegram Bot Service
 * Handles incoming commands from Telegram users using polling
 */

import TelegramBot from 'node-telegram-bot-api';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { telegramService } from './telegram.service.js';
import { anchorWatchService } from './anchor-watch.service.js';
import { gpsRepository } from '../repositories/gps.repository.js';

const moduleLogger = logger.createModuleLogger('telegram-bot');

class TelegramBotService {
  constructor() {
    this.bot = null;
    this.env = getEnv();
    this.isRunning = false;
  }

  /**
   * Initialize and start the bot with polling
   * @returns {Promise<void>}
   */
  async start() {
    if (!this.env.TELEGRAM_BOT_TOKEN) {
      moduleLogger.warn('Telegram bot token not configured, bot disabled');
      return;
    }

    if (this.isRunning) {
      moduleLogger.warn('Telegram bot already running');
      return;
    }

    try {
      // Create bot with polling enabled
      this.bot = new TelegramBot(this.env.TELEGRAM_BOT_TOKEN, {
        polling: {
          interval: 1000, // Poll every 1 second
          autoStart: true
        }
      });

      this.setupCommandHandlers();
      this.setupErrorHandlers();

      this.isRunning = true;
      moduleLogger.info('Telegram bot started with polling enabled');

    } catch (error) {
      moduleLogger.error('Failed to start Telegram bot', { error: error.message });
      throw error;
    }
  }

  /**
   * Stop the bot
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.bot || !this.isRunning) {
      return;
    }

    try {
      await this.bot.stopPolling();
      this.isRunning = false;
      moduleLogger.info('Telegram bot stopped');
    } catch (error) {
      moduleLogger.error('Error stopping Telegram bot', { error: error.message });
    }
  }

  /**
   * Setup command handlers
   */
  setupCommandHandlers() {
    // /start - Register user and show welcome
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      moduleLogger.info('Received /start command', { chatId });

      try {
        const welcomeMessage = `👋 *Welcome to BoatOS Anchor Watch*\n\n` +
          `Your Chat ID is: \`${chatId}\`\n\n` +
          `To enable notifications:\n` +
          `1. Add this to your .env file:\n` +
          `   \`TELEGRAM_CHAT_ID=${chatId}\`\n` +
          `2. Restart the server\n\n` +
          `Type /help to see available commands.`;

        await this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });

      } catch (error) {
        moduleLogger.error('Error handling /start command', { error: error.message, chatId });
        await this.sendErrorMessage(chatId, 'Failed to process /start command');
      }
    });

    // /status - Get current anchor watch status
    this.bot.onText(/\/status/, async (msg) => {
      const chatId = msg.chat.id;
      moduleLogger.info('Received /status command', { chatId });

      try {
        await this.bot.sendMessage(chatId, '⏳ Fetching anchor watch status...');

        const status = await anchorWatchService.getStatus();
        await telegramService.sendAnchorWatchStatus(status);

      } catch (error) {
        moduleLogger.error('Error handling /status command', { error: error.message, chatId });
        await this.sendErrorMessage(chatId, 'Failed to fetch anchor watch status');
      }
    });

    // /positions - Get recent GPS positions
    this.bot.onText(/\/positions/, async (msg) => {
      const chatId = msg.chat.id;
      moduleLogger.info('Received /positions command', { chatId });

      try {
        await this.bot.sendMessage(chatId, '⏳ Fetching recent positions...');

        const positions = await gpsRepository.getRecentPositions(5);
        await telegramService.sendRecentPositions(positions);

      } catch (error) {
        moduleLogger.error('Error handling /positions command', { error: error.message, chatId });
        await this.sendErrorMessage(chatId, 'Failed to fetch GPS positions');
      }
    });

    // /help - Show available commands
    this.bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      moduleLogger.info('Received /help command', { chatId });

      try {
        await telegramService.sendHelpMessage();
      } catch (error) {
        moduleLogger.error('Error handling /help command', { error: error.message, chatId });
        await this.sendErrorMessage(chatId, 'Failed to show help message');
      }
    });

    // Catch-all for unknown commands
    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text || '';

      // Ignore if it's a known command
      if (text.startsWith('/start') || text.startsWith('/status') ||
          text.startsWith('/positions') || text.startsWith('/help')) {
        return;
      }

      // Only respond to messages that start with /
      if (text.startsWith('/')) {
        moduleLogger.info('Unknown command received', { chatId, text });

        const unknownMessage = `❓ Unknown command: \`${text}\`\n\n` +
          `Type /help to see available commands.`;

        await this.bot.sendMessage(chatId, unknownMessage, { parse_mode: 'Markdown' });
      }
    });
  }

  /**
   * Setup error handlers
   */
  setupErrorHandlers() {
    this.bot.on('polling_error', (error) => {
      moduleLogger.error('Telegram polling error', { error: error.message });
    });

    this.bot.on('error', (error) => {
      moduleLogger.error('Telegram bot error', { error: error.message });
    });
  }

  /**
   * Send error message to user
   * @param {string|number} chatId - Telegram chat ID
   * @param {string} message - Error message
   */
  async sendErrorMessage(chatId, message) {
    try {
      await this.bot.sendMessage(chatId, `❌ ${message}`);
    } catch (error) {
      moduleLogger.error('Failed to send error message', { error: error.message, chatId });
    }
  }

  /**
   * Check if bot is running
   * @returns {boolean}
   */
  isActive() {
    return this.isRunning;
  }
}

// Create singleton instance
export const telegramBotService = new TelegramBotService();
