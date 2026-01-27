const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  const { data } = await supabase
    .from('agent_training_decisions')
    .select('*')
    .eq('agent_type', 'dip')
    .order('created_at', { ascending: true });

  // Extract rejection patterns
  const rejections = data.filter(d => d.decision === 'rejected');
  const approvals = data.filter(d => d.decision === 'approved');

  // Build rejection criteria from reasoning
  const rejectionKeywords = new Set();
  rejections.forEach(r => {
    const reason = r.reasoning.toLowerCase();
    if (reason.includes('compliance')) rejectionKeywords.add('compliance');
    if (reason.includes('regulatory')) rejectionKeywords.add('regulatory');
    if (reason.includes('legal')) rejectionKeywords.add('legal');
    if (reason.includes('warranty')) rejectionKeywords.add('warranty');
    if (reason.includes('installation') && reason.indexOf('repair') === -1) rejectionKeywords.add('installation-only');
    if (reason.includes('outdated')) rejectionKeywords.add('static-outdated');
    if (reason.includes('zero value') || reason.includes('obvious')) rejectionKeywords.add('zero-value');
    if (reason.includes('generic')) rejectionKeywords.add('too-generic');
  });

  // Build approval criteria
  const approvalKeywords = new Set();
  approvals.forEach(a => {
    const reason = a.reasoning.toLowerCase();
    if (reason.includes('operational')) approvalKeywords.add('operational');
    if (reason.includes('spec')) approvalKeywords.add('specification');
    if (reason.includes('process')) approvalKeywords.add('process');
    if (reason.includes('troubleshoot')) approvalKeywords.add('troubleshooting');
    if (reason.includes('repair')) approvalKeywords.add('repair-relevant');
    if (reason.includes('safety')) approvalKeywords.add('safety');
    if (reason.includes('maintenance')) approvalKeywords.add('maintenance');
  });

  // Select best few-shot examples (diverse by table)
  const exampleApprovals = [];
  const exampleRejections = [];

  const tables = ['staging_spec_suggestions', 'staging_playbook_hints', 'staging_intent_router', 'staging_golden_tests'];

  tables.forEach(table => {
    const tableApprovals = approvals.filter(a => a.source_table === table);
    const tableRejections = rejections.filter(r => r.source_table === table);

    // Pick 2 best from each table
    if (tableApprovals.length > 0) {
      exampleApprovals.push(...tableApprovals.slice(0, 2));
    }
    if (tableRejections.length > 0) {
      exampleRejections.push(...tableRejections.slice(0, 2));
    }
  });

  // Build learned criteria object
  const learnedCriteria = {
    version: '1.0',
    trained_at: new Date().toISOString(),
    total_decisions: data.length,
    approval_rate: (approvals.length / data.length * 100).toFixed(1) + '%',

    reject_if: [
      'Content is about regulatory compliance (CE, UKCA, FCC, certifications)',
      'Content is legal disclaimers or trademark information',
      'Content is about warranty documentation access',
      'Content is installation-only with no repair value',
      'Content is static data that becomes outdated (e.g., specific firmware version numbers)',
      'Content is obvious/common knowledge with zero value add',
      'Content is too generic and not specific to the actual system'
    ],

    approve_if: [
      'Content is a legitimate operational specification (current, voltage, pressure, dimensions, capacity)',
      'Content is a step-by-step operational procedure',
      'Content is troubleshooting info with expected values and failure indicators',
      'Content is repair-relevant (even if categorized as installation)',
      'Content is safety or maintenance procedure',
      'Content answers a practical question an owner might ask'
    ],

    rejection_keywords: Array.from(rejectionKeywords),
    approval_keywords: Array.from(approvalKeywords)
  };

  // Format examples for few-shot
  const formatExample = (d, decision) => ({
    table: d.source_table,
    content: d.item_snapshot,
    decision: decision,
    reasoning: d.reasoning
  });

  const fewShotApprovals = exampleApprovals.map(a => formatExample(a, 'approved'));
  const fewShotRejections = exampleRejections.map(r => formatExample(r, 'rejected'));

  // Update agent_config
  const { error } = await supabase
    .from('agent_config')
    .update({
      learned_criteria: learnedCriteria,
      example_approvals: fewShotApprovals,
      example_rejections: fewShotRejections,
      updated_at: new Date().toISOString()
    })
    .eq('agent_type', 'dip');

  if (error) {
    console.error('Error updating agent_config:', error.message);
  } else {
    console.log('Agent config updated successfully!');
    console.log('');
    console.log('=== Learned Criteria ===');
    console.log(JSON.stringify(learnedCriteria, null, 2));
    console.log('');
    console.log('Few-shot approvals:', fewShotApprovals.length);
    console.log('Few-shot rejections:', fewShotRejections.length);
  }
})();
