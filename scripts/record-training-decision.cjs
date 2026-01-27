const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * Records a training decision for the autonomous agent
 *
 * Usage: node scripts/record-training-decision.cjs <args as JSON>
 *
 * Example:
 * node scripts/record-training-decision.cjs '{"agentType":"dip","sourceTable":"staging_spec_suggestions","sourceId":"uuid-here","itemSnapshot":{},"decision":"approved","reasoning":"Valid spec"}'
 */
async function recordDecision({ agentType, sourceTable, sourceId, itemSnapshot, decision, reasoning }) {
  // Insert the decision
  const { data, error } = await supabase
    .from('agent_training_decisions')
    .insert({
      agent_type: agentType,
      source_table: sourceTable,
      source_id: sourceId,
      item_snapshot: itemSnapshot,
      decision: decision,
      reasoning: reasoning,
      decision_source: 'human'
    })
    .select()
    .single();

  if (error) {
    console.error('Error recording decision:', error.message);
    return null;
  }

  // Update total_decisions count in agent_config
  const { data: config } = await supabase
    .from('agent_config')
    .select('total_decisions')
    .eq('agent_type', agentType)
    .single();

  if (config) {
    await supabase
      .from('agent_config')
      .update({
        total_decisions: (config.total_decisions || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('agent_type', agentType);
  }

  return data;
}

/**
 * Updates the status of an item in its source table
 */
async function updateItemStatus(sourceTable, sourceId, status) {
  const { error } = await supabase
    .from(sourceTable)
    .update({ status: status })
    .eq('id', sourceId);

  if (error) {
    console.error('Error updating item status:', error.message);
    return false;
  }
  return true;
}

/**
 * Get current training stats for an agent
 */
async function getTrainingStats(agentType) {
  // Get config
  const { data: config } = await supabase
    .from('agent_config')
    .select('*')
    .eq('agent_type', agentType)
    .single();

  // Get decision counts by table
  const { data: decisions } = await supabase
    .from('agent_training_decisions')
    .select('source_table, decision')
    .eq('agent_type', agentType);

  const byTable = {};
  const byDecision = { approved: 0, rejected: 0 };

  if (decisions) {
    decisions.forEach(d => {
      byTable[d.source_table] = (byTable[d.source_table] || 0) + 1;
      byDecision[d.decision] = (byDecision[d.decision] || 0) + 1;
    });
  }

  return {
    config,
    totalDecisions: decisions?.length || 0,
    byTable,
    byDecision,
    readyToActivate: (decisions?.length || 0) >= (config?.min_decisions_to_activate || 50)
  };
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === 'stats') {
    const agentType = args[1] || 'dip';
    getTrainingStats(agentType).then(stats => {
      console.log('\n=== Training Stats for', agentType.toUpperCase(), 'Agent ===\n');
      console.log('Total Decisions:', stats.totalDecisions);
      console.log('Min to Activate:', stats.config?.min_decisions_to_activate || 50);
      console.log('Ready:', stats.readyToActivate ? 'YES' : 'NO');
      console.log('\nBy Decision:');
      console.log('  Approved:', stats.byDecision.approved);
      console.log('  Rejected:', stats.byDecision.rejected);
      console.log('\nBy Table:');
      Object.entries(stats.byTable).forEach(([table, count]) => {
        console.log(' ', table + ':', count);
      });
      process.exit(0);
    });
  } else if (args[0]) {
    try {
      const params = JSON.parse(args[0]);
      recordDecision(params).then(result => {
        if (result) {
          console.log('Decision recorded:', result.id);
          // Also update the source item status
          updateItemStatus(params.sourceTable, params.sourceId, params.decision).then(ok => {
            if (ok) console.log('Item status updated to:', params.decision);
            process.exit(0);
          });
        } else {
          process.exit(1);
        }
      });
    } catch (e) {
      console.error('Invalid JSON argument:', e.message);
      process.exit(1);
    }
  } else {
    console.log('Usage:');
    console.log('  node scripts/record-training-decision.cjs stats [agentType]');
    console.log('  node scripts/record-training-decision.cjs \'{"agentType":"dip",...}\'');
    process.exit(0);
  }
}

module.exports = { recordDecision, updateItemStatus, getTrainingStats };
