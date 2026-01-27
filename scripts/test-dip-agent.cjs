/**
 * Test script for DIP Agent
 * Tests: evaluation, escalation, and Telegram integration
 */

const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Escape markdown special characters for Telegram
function escapeMarkdown(text) {
  if (!text) return 'N/A';
  return String(text).replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

// Simple test mode - just send a test escalation to Telegram
async function testTelegramEscalation() {
  const botToken = process.env.TELEGRAM_DIP_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_DIP_CHAT_ID;

  if (!botToken || !chatId) {
    console.error('Missing TELEGRAM_DIP_BOT_TOKEN or TELEGRAM_DIP_CHAT_ID');
    process.exit(1);
  }

  console.log('Starting Telegram escalation test...');
  console.log('Bot token:', botToken.slice(0, 10) + '...');
  console.log('Chat ID:', chatId);

  const bot = new TelegramBot(botToken, { polling: false });

  // Get a random pending item
  const { data: item, error } = await supabase
    .from('staging_spec_suggestions')
    .select('*')
    .eq('status', 'pending')
    .limit(1)
    .single();

  if (error || !item) {
    console.error('No pending items found');
    process.exit(1);
  }

  console.log('\nItem to escalate:');
  console.log('  ID:', item.id);
  console.log('  Parameter:', item.parameter);
  console.log('  Value:', item.value, item.units);

  // Format message with escaped values
  const message = `*DIP Review Test*

*Table:* \`staging_spec_suggestions\`

*System:* ${escapeMarkdown(item.manufacturer_norm)} ${escapeMarkdown(item.model_norm)}
*Parameter:* ${escapeMarkdown(item.parameter)}
*Value:* ${escapeMarkdown(item.value)} ${escapeMarkdown(item.units)}
*Category:* ${escapeMarkdown(item.category)}

This is a test escalation.`;

  // Create inline keyboard (use abbreviated table names for 64-byte limit)
  const keyboard = {
    inline_keyboard: [[
      { text: 'Approve', callback_data: `a:spec:${item.id}` },
      { text: 'Reject', callback_data: `r:spec:${item.id}` }
    ]]
  };

  try {
    await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });

    console.log('\nTest escalation sent successfully!');
    console.log('Check your Telegram for the message with buttons.');
    console.log('\nTo test the callback, start the bot with polling:');
    console.log('  node scripts/test-dip-bot-polling.cjs');

  } catch (err) {
    console.error('Failed to send message:', err.message);
  }

  process.exit(0);
}

// Run the test
testTelegramEscalation();
