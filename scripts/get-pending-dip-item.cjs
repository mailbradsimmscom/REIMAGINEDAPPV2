const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const DIP_TABLES = [
  'staging_spec_suggestions',
  'staging_playbook_hints',
  'staging_intent_router',
  'staging_golden_tests'
];

/**
 * Get a pending item from a specific DIP table
 */
async function getPendingItem(tableName) {
  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .eq('status', 'pending')
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching from', tableName + ':', error.message);
    return null;
  }
  return data;
}

/**
 * Get pending counts for all DIP tables
 */
async function getPendingCounts() {
  const counts = {};

  for (const table of DIP_TABLES) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    counts[table] = error ? 'error' : count;
  }

  return counts;
}

/**
 * Get a random pending item from any DIP table
 */
async function getRandomPendingItem() {
  // Shuffle tables to randomize
  const shuffled = [...DIP_TABLES].sort(() => Math.random() - 0.5);

  for (const table of shuffled) {
    const item = await getPendingItem(table);
    if (item) {
      return { table, item };
    }
  }

  return null;
}

/**
 * Get next pending item, prioritizing tables with fewer training decisions
 */
async function getBalancedPendingItem() {
  // Get training decision counts by table
  const { data: decisions } = await supabase
    .from('agent_training_decisions')
    .select('source_table')
    .eq('agent_type', 'dip');

  const decisionCounts = {};
  DIP_TABLES.forEach(t => decisionCounts[t] = 0);
  if (decisions) {
    decisions.forEach(d => {
      decisionCounts[d.source_table] = (decisionCounts[d.source_table] || 0) + 1;
    });
  }

  // Sort tables by fewest decisions first
  const sorted = DIP_TABLES
    .map(t => ({ table: t, count: decisionCounts[t] }))
    .sort((a, b) => a.count - b.count);

  // Try each table in order
  for (const { table } of sorted) {
    const item = await getPendingItem(table);
    if (item) {
      return {
        table,
        item,
        trainingCount: decisionCounts[table]
      };
    }
  }

  return null;
}

/**
 * Format an item for display during training
 */
function formatItemForTraining(table, item) {
  let output = `\n=== ${table} ===\n`;
  output += `ID: ${item.id}\n`;

  // Format based on table type
  switch (table) {
    case 'staging_spec_suggestions':
      output += `System: ${item.system_name || 'N/A'}\n`;
      output += `Parameter: ${item.parameter_name || 'N/A'}\n`;
      output += `Value: ${item.value || 'N/A'}\n`;
      output += `Units: ${item.units || 'N/A'}\n`;
      if (item.source_context) output += `Context: ${item.source_context}\n`;
      break;

    case 'staging_playbook_hints':
      output += `System: ${item.system_name || 'N/A'}\n`;
      output += `Task: ${item.task_name || 'N/A'}\n`;
      output += `Hint: ${item.hint_text || 'N/A'}\n`;
      if (item.step_number) output += `Step: ${item.step_number}\n`;
      break;

    case 'staging_intent_router':
      output += `Question: ${item.question || 'N/A'}\n`;
      output += `Intent: ${item.intent || 'N/A'}\n`;
      output += `Answer: ${item.answer || 'N/A'}\n`;
      break;

    case 'staging_golden_tests':
      output += `System: ${item.system_name || 'N/A'}\n`;
      output += `Test: ${item.test_name || 'N/A'}\n`;
      output += `Input: ${item.input || 'N/A'}\n`;
      output += `Expected: ${item.expected_output || 'N/A'}\n`;
      break;

    default:
      // Generic output for unknown tables
      Object.entries(item).forEach(([key, value]) => {
        if (key !== 'id' && key !== 'status' && key !== 'created_at' && value) {
          output += `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}\n`;
        }
      });
  }

  return output;
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === 'counts') {
    getPendingCounts().then(counts => {
      console.log('\n=== Pending DIP Items ===\n');
      let total = 0;
      Object.entries(counts).forEach(([table, count]) => {
        console.log(table + ':', count);
        if (typeof count === 'number') total += count;
      });
      console.log('\nTotal pending:', total);
      process.exit(0);
    });
  } else if (args[0] === 'next') {
    getBalancedPendingItem().then(result => {
      if (result) {
        console.log(formatItemForTraining(result.table, result.item));
        console.log('---');
        console.log('Training decisions for this table:', result.trainingCount);
        console.log('\nTo record decision:');
        console.log(`node scripts/record-training-decision.cjs '${JSON.stringify({
          agentType: 'dip',
          sourceTable: result.table,
          sourceId: result.item.id,
          itemSnapshot: result.item,
          decision: '<approved|rejected>',
          reasoning: '<your reasoning>'
        })}'`);
      } else {
        console.log('No pending items found!');
      }
      process.exit(0);
    });
  } else if (args[0] === 'json') {
    // Output as JSON for programmatic use
    getBalancedPendingItem().then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    });
  } else {
    console.log('Usage:');
    console.log('  node scripts/get-pending-dip-item.cjs counts  - Show pending counts');
    console.log('  node scripts/get-pending-dip-item.cjs next    - Get next item for training');
    console.log('  node scripts/get-pending-dip-item.cjs json    - Get next item as JSON');
    process.exit(0);
  }
}

module.exports = { getPendingItem, getPendingCounts, getRandomPendingItem, getBalancedPendingItem, formatItemForTraining };
