const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function testEvaluate() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Get one pending item
  const { data: items } = await supabase
    .from('staging_spec_suggestions')
    .select('*')
    .eq('status', 'pending')
    .limit(1);

  if (!items || items.length === 0) {
    console.log('No pending items');
    return;
  }

  const item = items[0];
  console.log('=== Item ===');
  console.log('ID:', item.id);
  console.log('Parameter:', item.parameter);
  console.log('Value:', item.value);
  console.log('System:', item.manufacturer_norm, item.model_norm);
  console.log('');

  // Import and evaluate
  const { evaluateItem } = await import('../src/services/agents/dip-review-agent.service.js');
  const result = await evaluateItem(item, 'staging_spec_suggestions');

  console.log('=== Evaluation Result ===');
  console.log('Decision:', result.decision);
  console.log('Confidence:', (result.confidence * 100).toFixed(1) + '%');
  console.log('Reasoning:', result.reasoning);
  console.log('Used Retrieval:', result.usedRetrieval);
  console.log('');

  console.log('=== Confidence Breakdown (v3.0) ===');
  const b = result.confidenceBreakdown;
  console.log('Rule:', b.rule);
  console.log('simToApproved:', b.simToApproved?.toFixed(3));
  console.log('simToRejected:', b.simToRejected?.toFixed(3));
  console.log('margin:', b.margin?.toFixed(3));
  console.log('LLM Decision:', b.llmDecision);
  if (b.threshold !== undefined) {
    console.log('Threshold:', b.threshold);
  }
  console.log('');
  console.log('Final Score:', b.final);
  console.log('Action:', b.action);
}

testEvaluate().catch(console.error);
