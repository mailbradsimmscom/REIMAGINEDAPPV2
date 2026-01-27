/**
 * Test Telegram escalation with proper formatting
 * Uses the actual sendEscalation method for realistic testing
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function sendTestEscalation() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Get a real pending item
  let item, tableName, abbr;

  const { data: specs } = await supabase
    .from('staging_spec_suggestions')
    .select('*')
    .eq('status', 'pending')
    .limit(1);

  if (specs && specs.length > 0) {
    item = specs[0];
    tableName = 'staging_spec_suggestions';
    abbr = 'spec';
  } else {
    const { data: playbooks } = await supabase
      .from('staging_playbook_hints')
      .select('*')
      .eq('status', 'pending')
      .limit(1);

    if (playbooks && playbooks.length > 0) {
      item = playbooks[0];
      tableName = 'staging_playbook_hints';
      abbr = 'playbook';
    } else {
      console.log('No pending items found.');
      return;
    }
  }

  // Import and use the actual service
  const { dipTelegramBotService } = await import('../src/services/dip-telegram-bot.service.js');

  // Initialize the bot (without polling - just for sending)
  const TelegramBot = require('node-telegram-bot-api');
  dipTelegramBotService.bot = new TelegramBot(process.env.TELEGRAM_DIP_BOT_TOKEN);
  dipTelegramBotService.env = process.env;

  // Create mock evaluation
  const evaluation = {
    confidence: 0.72,
    reasoning: 'This spec provides specific operational parameters that would be useful for maintenance and troubleshooting.',
    decision: 'approved'
  };

  // Send using the real method
  const sent = await dipTelegramBotService.sendEscalation(item, tableName, evaluation);

  if (sent) {
    console.log('Escalation sent successfully!');
    console.log('Item ID:', item.id);
    console.log('Table:', tableName);
    console.log('');
    console.log('New message format:');
    console.log('- Header: Type + System name');
    console.log('- Content: The actual spec/playbook/etc');
    console.log('- Agent reasoning + confidence');
    console.log('');
    console.log('Tap Approve or Reject to test the flow.');
  } else {
    console.log('Failed to send escalation');
  }
}

sendTestEscalation().catch(console.error);
