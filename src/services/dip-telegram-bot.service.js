/**
 * DIP Telegram Bot Service
 * Handles DIP review escalations and callback responses
 * Separate from Anchor Watch bot for clean separation of concerns
 */

import TelegramBot from 'node-telegram-bot-api';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../repositories/supabaseClient.js';

const moduleLogger = logger.createModuleLogger('dip-telegram-bot');

class DipTelegramBotService {
  constructor() {
    this.bot = null;
    this.env = null;
    this.isRunning = false;
    // Store escalation data for reasoning capture
    this.pendingEscalations = new Map(); // Map<sourceId, { item, sourceTable, evaluation }>
    this.pendingReasonRequests = new Map(); // Map<chatId, { sourceTable, sourceId, messageId }>
  }

  /**
   * Safely answer a callback query (handles expired/stale callbacks)
   */
  async safeAnswerCallback(queryId, options) {
    try {
      await this.bot.answerCallbackQuery(queryId, options);
    } catch (error) {
      // Stale callbacks are normal - user clicked old button
      moduleLogger.debug('Could not answer callback (likely expired)', { error: error.message });
    }
  }

  /**
   * Initialize and start the bot with polling
   */
  async start() {
    this.env = getEnv();

    if (!this.env.TELEGRAM_DIP_BOT_TOKEN) {
      moduleLogger.warn('DIP Telegram bot token not configured, bot disabled');
      return;
    }

    if (this.isRunning) {
      moduleLogger.warn('DIP Telegram bot already running');
      return;
    }

    try {
      this.bot = new TelegramBot(this.env.TELEGRAM_DIP_BOT_TOKEN, {
        polling: {
          interval: 2000, // Poll every 2 seconds
          autoStart: true
        }
      });

      this.setupCommandHandlers();
      this.setupCallbackHandlers();
      this.setupMessageHandlers();
      this.setupErrorHandlers();

      this.isRunning = true;
      moduleLogger.info('DIP Telegram bot started with polling enabled');

    } catch (error) {
      moduleLogger.error('Failed to start DIP Telegram bot', { error: error.message });
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stop() {
    if (!this.bot || !this.isRunning) {
      return;
    }

    try {
      await this.bot.stopPolling();
      this.isRunning = false;
      moduleLogger.info('DIP Telegram bot stopped');
    } catch (error) {
      moduleLogger.error('Error stopping DIP Telegram bot', { error: error.message });
    }
  }

  /**
   * Setup command handlers
   */
  setupCommandHandlers() {
    // /start - Welcome message
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      moduleLogger.info('DIP bot received /start', { chatId });

      const message = `*BoatOS DIP Review Bot*

This bot sends you DIP items that need human review.

When items are sent:
- Tap *Approve* to approve the item
- Tap *Reject* to reject the item

Your decisions help train the autonomous agent.

Your Chat ID: \`${chatId}\``;

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    // /stats - Show agent stats
    this.bot.onText(/\/stats/, async (msg) => {
      const chatId = msg.chat.id;
      moduleLogger.info('DIP bot received /stats', { chatId });

      try {
        const { getAgentStats } = await import('./agents/dip-review-agent.service.js');
        const { getLastRun } = await import('./agents/dip-metrics.service.js');

        const stats = await getAgentStats();
        const lastRun = await getLastRun('dip');

        let message = `*DIP Agent Stats*

Total Decisions: ${stats.totalDecisions}
Min to Activate: ${stats.minToActivate}
Agent Active: ${stats.isActive ? 'Yes' : 'No'}

*By Source:*
- Human: ${stats.bySource.human || 0}
- Agent: ${stats.bySource.agent || 0}
- Telegram: ${stats.bySource.telegram || 0}
- Pre-Filter: ${stats.bySource.pre_filter || 0}

*By Decision:*
- Approved: ${stats.byDecision.approved || 0}
- Rejected: ${stats.byDecision.rejected || 0}

*Thresholds:*
- Auto: ${stats.thresholds.autoApprove}
- Escalate: <${stats.thresholds.escalateBelow}`;

        if (lastRun) {
          const runTime = lastRun.completed_at
            ? new Date(lastRun.completed_at).toLocaleString()
            : 'In progress';
          message += `

*Last Batch Run:*
- Status: ${lastRun.status}
- Time: ${runTime}
- Items: ${lastRun.items_processed || 0}
- Auto-Approved: ${lastRun.auto_approved || 0}
- Auto-Rejected: ${lastRun.auto_rejected || 0}
- Escalated: ${lastRun.escalated || 0}
- Pre-Filtered: ${lastRun.pre_filtered || 0}`;
        }

        await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

      } catch (error) {
        moduleLogger.error('Error fetching stats', { error: error.message });
        await this.bot.sendMessage(chatId, 'Error fetching stats: ' + error.message);
      }
    });

    // /help - Show help
    this.bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;

      const message = `*BoatOS DIP Review Bot*

*Commands:*
/start - Welcome message
/stats - Show agent statistics
/help - Show this help

*How it works:*
1. Agent evaluates DIP items
2. Low confidence items sent here
3. You tap Approve/Reject
4. Decision recorded + feeds training`;

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
  }

  /**
   * Setup callback query handlers for inline buttons
   */
  setupCallbackHandlers() {
    // Table name abbreviation mapping (for 64-byte callback limit)
    const tableMap = {
      'spec': 'staging_spec_suggestions',
      'playbook': 'staging_playbook_hints',
      'intent': 'staging_intent_router',
      'golden': 'staging_golden_tests'
    };

    // Rejection reason codes and labels
    const rejectReasons = {
      'wrong': 'Wrong equipment or system mismatch',
      'install': 'Installation/setup instructions only',
      'comply': 'Compliance, legal, or regulatory content',
      'generic': 'Too generic or not actionable',
      'other': null // Will prompt for text
    };

    this.bot.on('callback_query', async (query) => {
      const chatId = query.message.chat.id;
      const messageId = query.message.message_id;
      const data = query.data;

      moduleLogger.info('DIP bot received callback', { chatId, data });

      try {
        const parts = data.split(':');

        // Handle rejection reason callbacks: "rr:table:id:reason"
        if (parts[0] === 'rr' && parts.length === 4) {
          const [, tableAbbr, sourceId, reasonCode] = parts;
          const sourceTable = tableMap[tableAbbr] || tableAbbr;

          // Handle "Other" - prompt for text
          if (reasonCode === 'other') {
            // Store pending request and prompt for text
            this.pendingReasonRequests.set(chatId, {
              sourceTable,
              sourceId,
              messageId,
              timestamp: Date.now()
            });

            await this.safeAnswerCallback(query.id, { text: 'Please type your reason...' });
            await this.bot.sendMessage(chatId, 'Please reply with your rejection reason:', {
              reply_to_message_id: messageId
            });
            return;
          }

          // Standard rejection reason
          const reasoning = rejectReasons[reasonCode] || `Rejected: ${reasonCode}`;
          await this.recordTelegramDecision(sourceTable, sourceId, 'rejected', reasoning);
          await this.updateItemStatus(sourceTable, sourceId, 'rejected');

          // Clean up stored escalation
          this.pendingEscalations.delete(sourceId);

          await this.safeAnswerCallback(query.id, { text: 'Item rejected!' });

          // Remove buttons
          try {
            await this.bot.editMessageReplyMarkup(
              { inline_keyboard: [] },
              { chat_id: chatId, message_id: messageId }
            );
          } catch (e) { /* Ignore if already edited */ }

          moduleLogger.info('Telegram rejection recorded', { sourceTable, sourceId, reasoning });
          return;
        }

        // Handle initial approve/reject: "a:table:id" or "r:table:id"
        if (parts.length !== 3) {
          await this.safeAnswerCallback(query.id, { text: 'Invalid callback data' });
          return;
        }

        const [actionAbbr, tableAbbr, sourceId] = parts;
        const sourceTable = tableMap[tableAbbr] || tableAbbr;

        // APPROVE: Use LLM reasoning from stored evaluation
        if (actionAbbr === 'a') {
          const escalationData = this.pendingEscalations.get(sourceId);
          const reasoning = escalationData?.evaluation?.reasoning || 'Approved via Telegram';

          await this.recordTelegramDecision(sourceTable, sourceId, 'approved', reasoning);
          await this.updateItemStatus(sourceTable, sourceId, 'approved');

          // Clean up stored escalation
          this.pendingEscalations.delete(sourceId);

          await this.safeAnswerCallback(query.id, { text: 'Item approved!' });

          // Remove buttons
          try {
            await this.bot.editMessageReplyMarkup(
              { inline_keyboard: [] },
              { chat_id: chatId, message_id: messageId }
            );
          } catch (e) { /* Ignore if already edited */ }

          moduleLogger.info('Telegram approval recorded', { sourceTable, sourceId, reasoning: reasoning.slice(0, 50) });
          return;
        }

        // REJECT: Show rejection reason buttons
        if (actionAbbr === 'r') {
          const abbr = tableAbbr;

          const reasonKeyboard = {
            inline_keyboard: [
              [
                { text: 'Wrong Equipment', callback_data: `rr:${abbr}:${sourceId}:wrong` },
                { text: 'Installation Only', callback_data: `rr:${abbr}:${sourceId}:install` }
              ],
              [
                { text: 'Compliance/Legal', callback_data: `rr:${abbr}:${sourceId}:comply` },
                { text: 'Too Generic', callback_data: `rr:${abbr}:${sourceId}:generic` }
              ],
              [
                { text: 'Other...', callback_data: `rr:${abbr}:${sourceId}:other` }
              ]
            ]
          };

          await this.safeAnswerCallback(query.id, { text: 'Select rejection reason' });

          // Replace buttons with reason options
          try {
            await this.bot.editMessageReplyMarkup(reasonKeyboard, {
              chat_id: chatId,
              message_id: messageId
            });
          } catch (e) {
            moduleLogger.warn('Could not edit message for rejection reasons', { error: e.message });
          }

          return;
        }

        await this.safeAnswerCallback(query.id, { text: 'Invalid action' });

      } catch (error) {
        moduleLogger.error('Error handling callback', { error: error.message, data });
        await this.safeAnswerCallback(query.id, { text: 'Error: ' + error.message });
      }
    });
  }

  /**
   * Setup message handlers for text replies (e.g., "Other" rejection reason)
   */
  setupMessageHandlers() {
    this.bot.on('message', async (msg) => {
      // Only process text messages
      if (!msg.text || msg.text.startsWith('/')) return;

      const chatId = msg.chat.id;

      // Check if we're waiting for a rejection reason from this chat
      const pending = this.pendingReasonRequests.get(chatId);
      if (!pending) return;

      // Check if request is stale (> 5 minutes)
      const maxAge = 5 * 60 * 1000;
      if (Date.now() - pending.timestamp > maxAge) {
        this.pendingReasonRequests.delete(chatId);
        return;
      }

      const { sourceTable, sourceId, messageId } = pending;
      const reasoning = msg.text.trim();

      moduleLogger.info('Received custom rejection reason', { chatId, sourceId, reasoning: reasoning.slice(0, 50) });

      try {
        // Record the decision with custom reasoning
        await this.recordTelegramDecision(sourceTable, sourceId, 'rejected', reasoning);
        await this.updateItemStatus(sourceTable, sourceId, 'rejected');

        // Clean up
        this.pendingReasonRequests.delete(chatId);
        this.pendingEscalations.delete(sourceId);

        // Remove buttons from original message
        try {
          await this.bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: messageId }
          );
        } catch (e) { /* Ignore if already edited */ }

        // Confirm to user
        await this.bot.sendMessage(chatId, `Item rejected with reason: "${reasoning.slice(0, 100)}${reasoning.length > 100 ? '...' : ''}"`);

        moduleLogger.info('Telegram rejection with custom reason recorded', { sourceTable, sourceId });

      } catch (error) {
        moduleLogger.error('Error recording custom rejection reason', { error: error.message });
        await this.bot.sendMessage(chatId, 'Error recording rejection: ' + error.message);
      }
    });
  }

  /**
   * Setup error handlers
   */
  setupErrorHandlers() {
    this.bot.on('polling_error', (error) => {
      moduleLogger.error('DIP Telegram polling error', { error: error.message });
    });

    this.bot.on('error', (error) => {
      moduleLogger.error('DIP Telegram bot error', { error: error.message });
    });
  }

  /**
   * Record a decision made via Telegram
   * Also stores embedding for future retrieval-based learning
   * @param {string} sourceTable - Source table name
   * @param {string} sourceId - Item ID
   * @param {string} decision - 'approved' or 'rejected'
   * @param {string} reasoning - Reasoning for the decision (LLM reasoning for approvals, human reason for rejections)
   */
  async recordTelegramDecision(sourceTable, sourceId, decision, reasoning) {
    const supabase = await getSupabaseClient();

    // First, get the item to snapshot it
    const { data: item, error: fetchError } = await supabase
      .from(sourceTable)
      .select('*')
      .eq('id', sourceId)
      .single();

    if (fetchError) {
      throw new Error(`Failed to fetch item: ${fetchError.message}`);
    }

    // Record the decision
    const { data: inserted, error: insertError } = await supabase
      .from('agent_training_decisions')
      .insert({
        agent_type: 'dip',
        source_table: sourceTable,
        source_id: sourceId,
        item_snapshot: item,
        decision: decision,
        reasoning: reasoning || 'Decision made via Telegram',
        decision_source: 'telegram',
        confidence: null // Human decision, no confidence score
      })
      .select('id')
      .single();

    if (insertError) {
      throw new Error(`Failed to record decision: ${insertError.message}`);
    }

    // Store embedding asynchronously (non-blocking)
    if (inserted?.id) {
      import('./agents/dip-exemplar.service.js').then(({ storeDecisionEmbedding }) => {
        storeDecisionEmbedding(inserted.id, item, sourceTable).catch(err => {
          moduleLogger.warn('Failed to store embedding', { error: err.message });
        });
      });
    }

    // Update total_decisions in agent_config
    const { data: config } = await supabase
      .from('agent_config')
      .select('total_decisions')
      .eq('agent_type', 'dip')
      .single();

    if (config) {
      await supabase
        .from('agent_config')
        .update({
          total_decisions: (config.total_decisions || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq('agent_type', 'dip');
    }
  }

  /**
   * Update item status in source table
   */
  async updateItemStatus(sourceTable, sourceId, status) {
    const supabase = await getSupabaseClient();

    const { error } = await supabase
      .from(sourceTable)
      .update({ status })
      .eq('id', sourceId);

    if (error) {
      throw new Error(`Failed to update status: ${error.message}`);
    }
  }

  /**
   * Send an escalation message with approve/reject buttons
   * @param {Object} item - The item to escalate
   * @param {string} sourceTable - The source table name
   * @param {Object} evaluation - The agent's evaluation
   */
  async sendEscalation(item, sourceTable, evaluation) {
    // Table abbreviation mapping (reverse of callback handler)
    const tableAbbr = {
      'staging_spec_suggestions': 'spec',
      'staging_playbook_hints': 'playbook',
      'staging_intent_router': 'intent',
      'staging_golden_tests': 'golden'
    };

    // Friendly type names
    const typeNames = {
      'staging_spec_suggestions': 'Spec',
      'staging_playbook_hints': 'Playbook',
      'staging_intent_router': 'Intent',
      'staging_golden_tests': 'Test'
    };

    if (!this.bot || !this.env.TELEGRAM_DIP_CHAT_ID) {
      moduleLogger.warn('DIP bot not configured, cannot send escalation');
      return false;
    }

    const chatId = this.env.TELEGRAM_DIP_CHAT_ID;

    // Format the item for display
    const itemDisplay = this.formatItemForDisplay(item, sourceTable);
    const typeName = typeNames[sourceTable] || 'Item';
    const system = this.getSystemName(item);

    const message = `*${typeName}: ${system}*

${itemDisplay}

_Agent says:_ ${this.escapeMarkdown(evaluation.reasoning)}
_Confidence:_ ${Math.round(evaluation.confidence * 100)}%`;

    // Create inline keyboard with abbreviated callback data (64-byte limit)
    const abbr = tableAbbr[sourceTable] || sourceTable.slice(0, 8);
    const keyboard = {
      inline_keyboard: [[
        { text: 'Approve', callback_data: `a:${abbr}:${item.id}` },
        { text: 'Reject', callback_data: `r:${abbr}:${item.id}` }
      ]]
    };

    try {
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });

      // Store escalation data for reasoning capture when callback arrives
      this.pendingEscalations.set(item.id, {
        item,
        sourceTable,
        evaluation,
        timestamp: Date.now()
      });

      // Clean up old entries (older than 24 hours) to prevent memory leak
      this.cleanupOldEscalations();

      moduleLogger.info('Escalation sent', { sourceTable, itemId: item.id });
      return true;

    } catch (error) {
      moduleLogger.error('Failed to send escalation', { error: error.message });
      return false;
    }
  }

  /**
   * Clean up escalations older than 24 hours
   */
  cleanupOldEscalations() {
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();

    for (const [sourceId, data] of this.pendingEscalations) {
      if (data.timestamp && now - data.timestamp > maxAge) {
        this.pendingEscalations.delete(sourceId);
      }
    }
  }

  /**
   * Escape markdown special characters for Telegram
   */
  escapeMarkdown(text) {
    if (!text) return 'N/A';
    return String(text).replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
  }

  /**
   * Get system name (manufacturer + model) from item
   */
  getSystemName(item) {
    const parts = [];
    if (item.manufacturer_norm) parts.push(item.manufacturer_norm);
    if (item.model_norm) parts.push(item.model_norm);
    if (parts.length === 0) {
      if (item.manufacturer) parts.push(item.manufacturer);
      if (item.model) parts.push(item.model);
    }
    return parts.length > 0 ? parts.join(' ') : 'Unknown System';
  }

  /**
   * Format an item for Telegram display (content-focused, system shown in header)
   */
  formatItemForDisplay(item, sourceTable) {
    const esc = (t) => this.escapeMarkdown(t);
    let display = '';

    switch (sourceTable) {
      case 'staging_spec_suggestions':
        // Show what spec is being added
        const units = item.units ? ` ${esc(item.units)}` : '';
        const category = item.category ? ` \\[${esc(item.category)}\\]` : '';
        display = `\`${esc(item.parameter)}\`: ${esc(item.value)}${units}${category}`;
        if (item.notes) {
          display += `\n_${esc(item.notes.slice(0, 150))}${item.notes.length > 150 ? '...' : ''}_`;
        }
        break;

      case 'staging_playbook_hints':
        // Show playbook title and first few steps
        display = `*${esc(item.title)}*`;
        const steps = item.steps || [];
        if (steps.length > 0) {
          const previewSteps = steps.slice(0, 3).map((s, i) => `${i + 1}\\. ${esc(s.slice(0, 80))}`);
          display += `\n${previewSteps.join('\n')}`;
          if (steps.length > 3) {
            display += `\n_\\.\\.\\. and ${steps.length - 3} more steps_`;
          }
        }
        break;

      case 'staging_intent_router':
        // Show Q&A pair
        display = `Q: ${esc(item.question)}\nA: ${esc((item.answer || '').slice(0, 200))}${(item.answer || '').length > 200 ? '...' : ''}`;
        break;

      case 'staging_golden_tests':
        // Show test case
        display = `Query: ${esc(item.query)}\nExpected: ${esc(item.expected)}`;
        break;

      default:
        display = `ID: ${item.id}`;
    }

    return display;
  }

  /**
   * Check if bot is running
   */
  isActive() {
    return this.isRunning;
  }

  /**
   * Get bot instance (for external use)
   */
  getBot() {
    return this.bot;
  }
}

// Create singleton instance
export const dipTelegramBotService = new DipTelegramBotService();
export default dipTelegramBotService;
