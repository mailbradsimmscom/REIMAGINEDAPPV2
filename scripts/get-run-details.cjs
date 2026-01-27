const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Field mappings per table
const TABLE_FIELDS = {
  'staging_spec_suggestions': { system: 'manufacturer_norm', param: 'parameter', value: 'value', cat: 'category' },
  'staging_playbook_hints': { system: 'manufacturer_norm', param: 'title', value: 'description', cat: 'model_norm' },
  'staging_intent_router': { system: 'manufacturer_norm', param: 'question', value: 'answer', cat: 'question_type' },
  'staging_golden_tests': { system: 'manufacturer_norm', param: 'test_name', value: 'expected_result', cat: 'category' }
};

const TABLE_SHORT = {
  'staging_spec_suggestions': 'spec_sug',
  'staging_playbook_hints': 'playbook',
  'staging_intent_router': 'intent_r',
  'staging_golden_tests': 'golden_t'
};

function formatItem(decision) {
  const snap = decision.item_snapshot || {};
  const table = decision.source_table;
  const f = TABLE_FIELDS[table] || {};

  return {
    table: TABLE_SHORT[table] || table,
    system: snap[f.system] || snap.system_name || snap.source_label || '-',
    parameter: (snap[f.param] || snap.parameter || snap.question || snap.step_title || snap.test_name || '-').substring(0, 70),
    value: (snap[f.value] || snap.value || snap.answer || snap.step_content || snap.expected_result || '-').substring(0, 90),
    category: snap[f.cat] || snap.category || snap.intent || '-',
    confidence: decision.confidence,
    reasoning: (decision.reasoning || '-').substring(0, 110),
    decision_source: decision.decision_source
  };
}

async function main() {
  const minutesAgo = parseInt(process.argv[2]) || 15;

  // Get all decisions from recent time window
  const { data: decisions, error } = await supabase
    .from('agent_training_decisions')
    .select('*')
    .eq('agent_type', 'dip')
    .gte('created_at', new Date(Date.now() - minutesAgo*60*1000).toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('=== Last ' + minutesAgo + ' minutes: ' + decisions.length + ' decisions ===\n');

  const autoApproved = [];
  const preFiltered = [];
  const autoRejected = [];

  for (const d of decisions) {
    const item = formatItem(d);

    if (d.decision_source === 'pre_filter') {
      preFiltered.push(item);
    } else if (d.decision === 'approved') {
      autoApproved.push(item);
    } else if (d.decision === 'rejected') {
      autoRejected.push(item);
    }
  }

  // Print AUTO-APPROVED
  console.log('=== AUTO-APPROVED (' + autoApproved.length + ') ===\n');
  autoApproved.forEach((item, i) => {
    console.log((i+1) + '. [' + item.table + '] System: ' + item.system);
    console.log('   Parameter: ' + item.parameter);
    console.log('   Value: ' + item.value);
    console.log('   Category: ' + item.category);
    console.log('   Confidence: ' + (item.confidence * 100).toFixed(0) + '%');
    console.log('   Reasoning: ' + item.reasoning);
    console.log('');
  });

  // Print PRE-FILTERED
  console.log('\n=== PRE-FILTERED REJECTS (' + preFiltered.length + ') ===\n');
  preFiltered.forEach((item, i) => {
    console.log((i+1) + '. [' + item.table + '] System: ' + item.system);
    console.log('   Parameter: ' + item.parameter);
    console.log('   Value: ' + item.value);
    console.log('   Reason: ' + item.reasoning);
    console.log('');
  });

  // Print AUTO-REJECTED
  if (autoRejected.length > 0) {
    console.log('\n=== AUTO-REJECTED by LLM (' + autoRejected.length + ') ===\n');
    autoRejected.forEach((item, i) => {
      console.log((i+1) + '. [' + item.table + '] System: ' + item.system);
      console.log('   Parameter: ' + item.parameter);
      console.log('   Value: ' + item.value);
      console.log('   Confidence: ' + (item.confidence * 100).toFixed(0) + '%');
      console.log('   Reasoning: ' + item.reasoning);
      console.log('');
    });
  }

  console.log('\n=== SUMMARY ===');
  console.log('Auto-Approved: ' + autoApproved.length);
  console.log('Pre-Filtered: ' + preFiltered.length);
  console.log('Auto-Rejected: ' + autoRejected.length);
  console.log('Total decisions: ' + decisions.length);
  console.log('(Note: Queued items are not recorded to DB - only shown in batch processor output)');
}

main();
