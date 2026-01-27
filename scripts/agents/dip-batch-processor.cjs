/**
 * DIP Batch Processor
 *
 * Autonomous batch processing of DIP staging items.
 *
 * Usage:
 *   node scripts/agents/dip-batch-processor.cjs [options]
 *
 * Options:
 *   --mode=MODE         Run mode: report|active|full (default: active)
 *                       - report: evaluate + log, no status changes, no telegram
 *                       - active: full operation with status changes + telegram
 *                       - full: active + auto-rebuild criteria (future)
 *   --max-items=N       Maximum items to process (default: 200)
 *   --max-llm=N         Maximum LLM calls (default: 200)
 *   --max-escalations=N Maximum Telegram escalations (default: 20)
 *   --rate-limit=N      Delay between items in ms (default: 1000)
 *   --table=NAME        Process only specific table
 *   --poll              Keep running to receive Telegram callbacks
 *   --verbose           Show detailed progress
 *
 * Example:
 *   node scripts/agents/dip-batch-processor.cjs --mode=report --max-items=50
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Telegram bot service (lazy loaded)
let telegramService = null;
async function getTelegramService() {
  if (!telegramService) {
    const { dipTelegramBotService } = await import('../../src/services/dip-telegram-bot.service.js');
    telegramService = dipTelegramBotService;
  }
  return telegramService;
}

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

const VALID_MODES = ['report', 'active', 'full'];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    mode: 'active',        // report | active | full
    maxItems: 200,
    maxLLMCalls: 200,
    maxEscalations: 20,
    rateLimitMs: 1000,
    table: null,
    verbose: false,
    poll: false            // Keep running to receive Telegram callbacks
  };

  for (const arg of args) {
    if (arg === '--poll') {
      options.poll = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg.startsWith('--mode=')) {
      const mode = arg.split('=')[1];
      if (!VALID_MODES.includes(mode)) {
        console.error(`Invalid mode: ${mode}. Must be one of: ${VALID_MODES.join(', ')}`);
        process.exit(1);
      }
      options.mode = mode;
    } else if (arg.startsWith('--max-items=')) {
      options.maxItems = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--max-llm=')) {
      options.maxLLMCalls = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--max-escalations=')) {
      options.maxEscalations = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--rate-limit=')) {
      options.rateLimitMs = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--table=')) {
      options.table = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    }
  }

  return options;
}

function showHelp() {
  console.log(`
DIP Batch Processor - Autonomous DIP staging item processing

Usage:
  node scripts/agents/dip-batch-processor.cjs [options]

Options:
  --mode=MODE         Run mode: report|active|full (default: active)
                      - report: evaluate + log to agent_run_items, no status changes
                      - active: full operation with status changes + telegram
                      - full: active + auto-rebuild criteria (future)
  --max-items=N       Maximum items to process (default: 200)
  --max-llm=N         Maximum LLM calls (default: 200)
  --max-escalations=N Maximum Telegram escalations (default: 20)
  --rate-limit=N      Delay between items in ms (default: 1000)
  --table=NAME        Process only specific table
  --poll              Keep running to receive Telegram callbacks
  --verbose           Show detailed progress
  --help              Show this help

Examples:
  # Report mode - safe testing, logs decisions but doesn't change status
  node scripts/agents/dip-batch-processor.cjs --mode=report --max-items=50

  # Active mode - full operation
  node scripts/agents/dip-batch-processor.cjs --mode=active --max-items=100 --max-escalations=20

  # Process only spec_suggestions
  node scripts/agents/dip-batch-processor.cjs --table=staging_spec_suggestions
`);
}

// ============================================================================
// MAIN PROCESSOR
// ============================================================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Staging tables to process
const STAGING_TABLES = [
  'staging_spec_suggestions',
  'staging_playbook_hints',
  'staging_intent_router',
  'staging_golden_tests'
];

// Pre-filter keywords (from learned criteria)
const REJECT_KEYWORDS = [
  'ce marking', 'ukca', 'fcc part', 'industry canada', 'acma', 'rsm',
  'regulatory compliance', 'certified', 'certification mark',
  'trademark', 'registered trademark', '®', '™',
  'warranty card', 'warranty documentation', 'legal disclaimer', 'liability',
  'download our app', 'visit our website', 'contact customer support',
  'english is the official language', 'tools required for installation'
];

const REJECT_CATEGORIES = [
  'compliance', 'regulatory', 'legal', 'warranty', 'trademark', 'certification'
];

/**
 * Extract content text from item based on table type
 * Prevents false positives from matching on metadata fields like IDs
 */
function getContentText(item, sourceTable) {
  switch (sourceTable) {
    case 'staging_spec_suggestions':
      return [
        item.parameter || '',
        item.value || '',
        item.notes || '',
        item.category || '',
        item.units || ''
      ].join(' ').toLowerCase();

    case 'staging_playbook_hints':
      return [
        item.title || '',
        item.description || '',
        ...(item.steps || [])
      ].join(' ').toLowerCase();

    case 'staging_intent_router':
      return [
        item.question || '',
        item.answer || '',
        item.expected_intent || ''
      ].join(' ').toLowerCase();

    case 'staging_golden_tests':
      return [
        item.query || '',
        item.expected || '',
        item.context || ''
      ].join(' ').toLowerCase();

    default:
      // Fallback to relevant fields only (not full JSON)
      return Object.entries(item)
        .filter(([k]) => !['id', 'created_at', 'updated_at', 'status', 'processing_run_id', 'document_id', 'page_number'].includes(k))
        .map(([, v]) => typeof v === 'string' ? v : '')
        .join(' ')
        .toLowerCase();
  }
}

/**
 * Pre-filter an item (deterministic, no LLM)
 * Uses table-specific content extraction to avoid false positives
 */
function preFilter(item, sourceTable) {
  // Extract only content fields (not metadata/IDs)
  const text = getContentText(item, sourceTable);

  for (const keyword of REJECT_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) {
      return { action: 'pre_reject', reason: `Matches keyword: ${keyword}`, skipLLM: true };
    }
  }

  const category = (item.category || '').toLowerCase();
  if (category && REJECT_CATEGORIES.includes(category)) {
    return { action: 'pre_reject', reason: `Category: ${item.category}`, skipLLM: true };
  }

  if (sourceTable === 'staging_spec_suggestions') {
    const parameter = (item.parameter || '').toLowerCase();
    if (parameter.includes('regulatory') || parameter.includes('compliance')) {
      return { action: 'pre_reject', reason: `Parameter: ${item.parameter}`, skipLLM: true };
    }
  }

  return { action: 'evaluate', skipLLM: false };
}

/**
 * Acquire run lock
 */
async function acquireLock(options) {
  const STALE_THRESHOLD_MS = 30 * 60 * 1000;

  // Check for existing running batch
  const { data: existing } = await supabase
    .from('agent_runs')
    .select('id, started_at')
    .eq('agent_type', 'dip')
    .eq('status', 'running')
    .maybeSingle();

  if (existing) {
    const age = Date.now() - new Date(existing.started_at).getTime();
    if (age > STALE_THRESHOLD_MS) {
      console.log(`Recovering stale lock from ${(age / 60000).toFixed(1)} minutes ago`);
      await supabase.from('agent_runs')
        .update({ status: 'failed', error_message: 'Stale lock recovered' })
        .eq('id', existing.id);
    } else {
      throw new Error(`Another batch is running (started ${(age / 60000).toFixed(1)} min ago)`);
    }
  }

  // Create new run
  const { data: run, error } = await supabase
    .from('agent_runs')
    .insert({ agent_type: 'dip', config: options })
    .select()
    .single();

  if (error) throw new Error(`Failed to acquire lock: ${error.message}`);

  return run.id;
}

/**
 * Atomically claim pending items using UPDATE...RETURNING
 * This prevents race conditions when multiple batch processors run
 */
async function claimPendingItems(runId, maxItems, specificTable = null) {
  const items = [];
  const tables = specificTable ? [specificTable] : STAGING_TABLES;
  const perTable = Math.ceil(maxItems / tables.length);

  for (const table of tables) {
    if (items.length >= maxItems) break;

    const remaining = Math.min(perTable, maxItems - items.length);

    // First, get IDs of items to claim
    const { data: candidates, error: fetchError } = await supabase
      .from(table)
      .select('id')
      .eq('status', 'pending')
      .is('processing_run_id', null)
      .limit(remaining);

    if (fetchError || !candidates?.length) {
      if (fetchError) console.error(`Error fetching from ${table}:`, fetchError.message);
      continue;
    }

    const idsToClain = candidates.map(c => c.id);

    // Atomically claim these items by setting processing_run_id
    const { data: claimed, error: claimError } = await supabase
      .from(table)
      .update({
        processing_run_id: runId,
        processing_started_at: new Date().toISOString()
      })
      .in('id', idsToClain)
      .is('processing_run_id', null)  // Only claim if still unclaimed
      .select('*');

    if (claimError) {
      console.error(`Error claiming items from ${table}:`, claimError.message);
      continue;
    }

    for (const item of (claimed || [])) {
      items.push({ table, item });
    }
  }

  return items;
}

/**
 * Release unclaimed items (cleanup on failure)
 */
async function releaseItems(runId) {
  for (const table of STAGING_TABLES) {
    await supabase
      .from(table)
      .update({ processing_run_id: null, processing_started_at: null })
      .eq('processing_run_id', runId);
  }
}

/**
 * Get agent config
 */
async function getAgentConfig() {
  const { data } = await supabase
    .from('agent_config')
    .select('*')
    .eq('agent_type', 'dip')
    .single();

  return data || {
    auto_approve_threshold: 0.90,
    auto_reject_threshold: 0.90,
    escalate_below: 0.80,
    learned_criteria: null,
    example_approvals: null,
    example_rejections: null
  };
}

/**
 * Evaluate item with LLM
 * Uses dynamic import for ES module
 */
async function evaluateWithLLM(item, table, config) {
  // Dynamic import of ES module
  const { evaluateItem } = await import('../../src/services/agents/dip-review-agent.service.js');
  return await evaluateItem(item, table);
}

// NOTE: Policy logic is now in dip-confidence.service.js (v3.0 margin-based)
// The batch processor uses evaluation.confidenceBreakdown.action directly

/**
 * Log item processing to agent_run_items
 */
async function logRunItem(runId, table, item, action, confidence, reason, errorMessage = null) {
  await supabase.from('agent_run_items').insert({
    run_id: runId,
    source_table: table,
    source_id: item.id,
    action: action,
    confidence: confidence,
    reason: reason,
    error_message: errorMessage
  });
}

/**
 * Execute action on item
 * @param {string} mode - 'report' | 'active' | 'full'
 * @param {string} runId - The run ID for logging
 */
async function executeAction(table, item, action, evaluation, mode, runId) {
  const confidence = evaluation?.confidence || null;
  const reason = evaluation?.reasoning || action;

  // Always log to agent_run_items (regardless of mode)
  await logRunItem(runId, table, item, action, confidence, reason);

  // In report mode, we log but don't change status or send telegram
  if (mode === 'report') {
    // Still record training decision for learning, but mark as is_weak_label if pre_filter
    const decisionSource = action.startsWith('pre_') ? 'pre_filter' : 'agent';
    const decision = action === 'auto_approved' ? 'approved' :
                     action === 'auto_rejected' ? 'rejected' :
                     action === 'pre_reject' ? 'rejected' :
                     action === 'escalate' ? evaluation?.decision : null;

    if (decision) {
      await supabase.from('agent_training_decisions').insert({
        agent_type: 'dip',
        source_table: table,
        source_id: item.id,
        item_snapshot: item,
        decision: decision,
        reasoning: reason,
        decision_source: decisionSource,
        confidence: confidence,
        is_weak_label: action === 'pre_reject'  // Pre-filter decisions are weak labels
      });
    }

    // Clear processing_run_id but don't change status
    await supabase.from(table)
      .update({ processing_run_id: null, processing_started_at: null })
      .eq('id', item.id);

    return true;
  }

  // Active/Full mode: actually execute the action
  const decision = action === 'auto_approved' ? 'approved' :
                   action === 'auto_rejected' ? 'rejected' :
                   action === 'pre_reject' ? 'rejected' : null;

  if (decision) {
    // Update item status
    await supabase.from(table)
      .update({ status: decision, processing_run_id: null, processing_started_at: null })
      .eq('id', item.id);

    // Record training decision
    const decisionSource = action.startsWith('pre_') ? 'pre_filter' : 'agent';
    await supabase.from('agent_training_decisions').insert({
      agent_type: 'dip',
      source_table: table,
      source_id: item.id,
      item_snapshot: item,
      decision: decision,
      reasoning: reason,
      decision_source: decisionSource,
      confidence: confidence,
      is_weak_label: action === 'pre_reject'  // Pre-filter decisions are weak labels
    });
  } else {
    // For escalate/queued, just clear processing state
    await supabase.from(table)
      .update({ processing_run_id: null, processing_started_at: null })
      .eq('id', item.id);
  }

  if (action === 'escalate') {
    // Send to Telegram (only in active/full mode)
    await sendTelegramEscalation(item, table, evaluation);
    // Extra delay after Telegram send to avoid flooding
    await sleep(2000);
  }

  return true;
}

/**
 * Send escalation to Telegram using the shared service
 * This ensures:
 * - Consistent message format with system header
 * - pendingEscalations populated for reasoning capture
 * - Rejection reason buttons work
 */
async function sendTelegramEscalation(item, table, evaluation) {
  try {
    const service = await getTelegramService();

    // Initialize bot if not already (without polling - we'll start polling separately)
    if (!service.getBot()) {
      const TelegramBot = require('node-telegram-bot-api');
      service.bot = new TelegramBot(process.env.TELEGRAM_DIP_BOT_TOKEN, { polling: false });
      service.env = process.env;
    }

    const sent = await service.sendEscalation(item, table, evaluation);
    if (!sent) {
      console.warn('Failed to send escalation for', item.id);
    }
  } catch (err) {
    console.error('Failed to send Telegram:', err.message);
  }
}

/**
 * Save run stats
 */
async function saveRunStats(runId, counters, status, errorMessage = null) {
  await supabase.from('agent_runs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      items_processed: counters.items,
      llm_calls: counters.llmCalls,
      auto_approved: counters.autoApproved,
      auto_rejected: counters.autoRejected,
      escalated: counters.escalations,
      pre_filtered: counters.preFiltered,
      errors: counters.errors,
      error_message: errorMessage
    })
    .eq('id', runId);
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  const options = parseArgs();

  console.log('\n=== DIP Batch Processor ===');
  console.log(`Mode: ${options.mode.toUpperCase()}`);
  console.log(`Max Items: ${options.maxItems}`);
  console.log(`Max LLM Calls: ${options.maxLLMCalls}`);
  console.log(`Max Escalations: ${options.maxEscalations}`);
  console.log(`Rate Limit: ${options.rateLimitMs}ms`);
  if (options.table) console.log(`Table Filter: ${options.table}`);
  console.log('');

  if (options.mode === 'report') {
    console.log('📋 REPORT MODE: Decisions logged but status NOT changed, Telegram NOT sent\n');
  } else if (options.mode === 'full') {
    console.log('🚀 FULL MODE: Active + auto-rebuild criteria (future feature)\n');
  }

  // Counters
  const counters = {
    items: 0,
    llmCalls: 0,
    autoApproved: 0,
    autoRejected: 0,
    escalations: 0,
    preFiltered: 0,
    queued: 0,
    errors: 0
  };

  let runId = null;

  try {
    // Acquire lock
    console.log('Acquiring run lock...');
    runId = await acquireLock(options);
    console.log(`Run ID: ${runId}\n`);

    // Get config
    const config = await getAgentConfig();

    // Show per-table thresholds if available
    // v3.0 margin-based logic (from dip-confidence.service.js)
    console.log('v3.0 Margin Thresholds:');
    console.log('  Approve: margin >= +0.08 AND LLM agrees');
    console.log('  Reject:  margin <= -0.12 AND LLM agrees');
    console.log('  Escalate: LLM uncertain');
    console.log('  Queue: everything else');
    console.log('');

    // Claim pending items atomically
    console.log('Claiming pending items...');
    const items = await claimPendingItems(runId, options.maxItems, options.table);
    console.log(`Claimed ${items.length} items for processing\n`);

    if (items.length === 0) {
      console.log('No items to process!');
      await saveRunStats(runId, counters, 'completed');
      return;
    }

    // Process each item
    console.log('Processing items...\n');

    for (const { table, item } of items) {
      counters.items++;
      const progress = `[${counters.items}/${items.length}]`;

      // Check limits
      if (counters.llmCalls >= options.maxLLMCalls && counters.items > counters.preFiltered) {
        console.log(`${progress} LLM call limit reached, stopping`);
        break;
      }

      try {
        // Pre-filter
        const preResult = preFilter(item, table);

        if (preResult.skipLLM) {
          counters.preFiltered++;
          if (options.verbose) {
            console.log(`${progress} PRE-REJECT: ${preResult.reason}`);
          }

          await executeAction(table, item, 'pre_reject', { reasoning: preResult.reason }, options.mode, runId);
          continue;
        }

        // LLM evaluation (uses v3.0 margin-based confidence)
        counters.llmCalls++;
        if (options.verbose) {
          console.log(`${progress} Evaluating with LLM...`);
        }

        const evaluation = await evaluateWithLLM(item, table, config);
        const breakdown = evaluation.confidenceBreakdown || {};

        // Use action from v3.0 confidence service (margin-based)
        // Maps: auto_commit -> auto_approved/auto_rejected, queue, escalate
        let action = breakdown.action || 'escalate';
        let reason = breakdown.rule || 'unknown';

        // Convert auto_commit to specific action based on decision
        if (action === 'auto_commit') {
          const decision = breakdown.decision || evaluation.decision;
          action = decision === 'approved' ? 'auto_approved' : 'auto_rejected';
          reason = `margin=${breakdown.margin?.toFixed(3)}, rule=${breakdown.rule}`;
        } else if (action === 'queue') {
          action = 'queued';  // Normalize to 'queued'
          reason = `margin=${breakdown.margin?.toFixed(3)} insufficient`;
        } else if (action === 'escalate') {
          reason = breakdown.rule === 'llm_uncertain' ? 'LLM uncertain' : 'needs review';
        }

        // Check escalation limit
        if (action === 'escalate' && counters.escalations >= options.maxEscalations) {
          action = 'queued';
          reason = 'escalation limit reached';
        }

        // Update counters
        switch (action) {
          case 'auto_approved': counters.autoApproved++; break;
          case 'auto_rejected': counters.autoRejected++; break;
          case 'escalate': counters.escalations++; break;
          case 'queued': counters.queued++; break;
        }

        // Log result
        const shortTable = table.replace('staging_', '').slice(0, 8);
        const score = breakdown.final || Math.round(evaluation.confidence * 100);
        console.log(`${progress} ${shortTable}: ${action.toUpperCase()} (${score}%) - ${reason}`);

        // Execute action with mode
        await executeAction(table, item, action, evaluation, options.mode, runId);

        // Rate limit
        await sleep(options.rateLimitMs);

      } catch (error) {
        counters.errors++;
        console.error(`${progress} ERROR: ${error.message}`);

        // Log error to agent_run_items
        await logRunItem(runId, table, item, 'error', null, null, error.message);

        // Clear processing state on error
        await supabase.from(table)
          .update({ processing_run_id: null, processing_started_at: null })
          .eq('id', item.id);

        // Continue processing other items
        await sleep(options.rateLimitMs);
      }
    }

    // Save stats
    await saveRunStats(runId, counters, 'completed');

    // Print summary
    console.log('\n=== Run Complete ===');
    console.log(`Mode: ${options.mode.toUpperCase()}`);
    console.log(`Items Processed: ${counters.items}`);
    console.log(`Pre-Filtered: ${counters.preFiltered}`);
    console.log(`LLM Calls: ${counters.llmCalls}`);
    console.log(`Auto-Approved: ${counters.autoApproved}`);
    console.log(`Auto-Rejected: ${counters.autoRejected}`);
    console.log(`Escalated: ${counters.escalations}`);
    console.log(`Queued: ${counters.queued}`);
    console.log(`Errors: ${counters.errors}`);

    if (options.mode === 'report') {
      console.log('\n📋 Items logged to agent_run_items. Status NOT changed.');
      console.log('To review: SELECT * FROM agent_run_items WHERE run_id = \'' + runId + '\' ORDER BY created_at;');
    }

    // If --poll and we had escalations, start polling to receive callbacks
    if (options.poll && counters.escalations > 0) {
      console.log('\n=== Starting Telegram Polling ===');
      console.log(`Waiting for ${counters.escalations} escalation responses...`);
      console.log('Press Ctrl+C to stop\n');

      const service = await getTelegramService();
      await service.start();

      // Keep running until Ctrl+C
      await new Promise((resolve) => {
        process.on('SIGINT', async () => {
          console.log('\nStopping polling...');
          await service.stop();
          resolve();
        });
      });
    } else if (counters.escalations > 0 && !options.poll) {
      console.log('\n⚠️  Escalations sent but --poll not enabled.');
      console.log('Run with --poll to receive callback responses, or start polling separately:');
      console.log('  node scripts/test-dip-bot-polling.cjs');
    }

  } catch (error) {
    console.error('\nFATAL ERROR:', error.message);

    if (runId) {
      // Release any claimed items
      await releaseItems(runId);
      await saveRunStats(runId, counters, 'failed', error.message);
    }

    process.exit(1);
  }
}

// Run
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
