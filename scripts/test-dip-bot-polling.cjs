/**
 * Test script for DIP Bot with Polling
 * Uses the actual dipTelegramBotService for full functionality
 *
 * Usage: node scripts/test-dip-bot-polling.cjs
 *        node scripts/test-dip-bot-polling.cjs --send  (sends a test then polls)
 */

require('dotenv').config();

const sendTest = process.argv.includes('--send');

async function main() {
  console.log('Starting DIP bot with polling...');
  console.log('Press Ctrl+C to stop\n');

  // Import and start the actual service
  const { dipTelegramBotService } = await import('../src/services/dip-telegram-bot.service.js');

  await dipTelegramBotService.start();

  // Optionally send a test escalation first
  if (sendTest) {
    console.log('Sending test escalation...\n');
    await sendTestEscalation(dipTelegramBotService);
  }

  console.log('Bot is listening for callbacks...');
  console.log('');
  console.log('Features:');
  console.log('- Approve: Uses LLM reasoning from escalation');
  console.log('- Reject: Shows reason buttons');
  console.log('- Other: Prompts for custom text reason');
  console.log('');
  console.log('Commands: /stats, /test (send test item)');

  // Add /test command to send from within this process
  dipTelegramBotService.getBot().onText(/\/test/, async (msg) => {
    console.log('\nReceived /test command, sending test escalation...');
    await sendTestEscalation(dipTelegramBotService);
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await dipTelegramBotService.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await dipTelegramBotService.stop();
    process.exit(0);
  });
}

async function sendTestEscalation(service) {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Get a real pending item
  const { data: specs } = await supabase
    .from('staging_spec_suggestions')
    .select('*')
    .eq('status', 'pending')
    .limit(1);

  let item, tableName;

  if (specs && specs.length > 0) {
    item = specs[0];
    tableName = 'staging_spec_suggestions';
  } else {
    const { data: playbooks } = await supabase
      .from('staging_playbook_hints')
      .select('*')
      .eq('status', 'pending')
      .limit(1);

    if (playbooks && playbooks.length > 0) {
      item = playbooks[0];
      tableName = 'staging_playbook_hints';
    } else {
      console.log('No pending items found.');
      return;
    }
  }

  const evaluation = {
    confidence: 0.72,
    reasoning: 'This provides specific operational parameters useful for maintenance and troubleshooting.',
    decision: 'approved'
  };

  const sent = await service.sendEscalation(item, tableName, evaluation);
  if (sent) {
    console.log('Test sent! ID:', item.id);
    console.log('Tap Approve or Reject to test reasoning capture.\n');
  }
}

main().catch(err => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
