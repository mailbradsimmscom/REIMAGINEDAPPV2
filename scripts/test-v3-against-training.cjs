const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function testAgainstTraining() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Get 10 approved human decisions
  const { data: approved } = await supabase
    .from('agent_training_decisions')
    .select('*')
    .eq('agent_type', 'dip')
    .eq('decision', 'approved')
    .eq('decision_source', 'human')
    .limit(10);

  // Get 10 rejected human decisions
  const { data: rejected } = await supabase
    .from('agent_training_decisions')
    .select('*')
    .eq('agent_type', 'dip')
    .eq('decision', 'rejected')
    .eq('decision_source', 'human')
    .limit(10);

  console.log(`Found ${approved?.length || 0} approved, ${rejected?.length || 0} rejected decisions\n`);

  const { evaluateItem } = await import('../src/services/agents/dip-review-agent.service.js');
  const { preFilter } = await import('../src/services/agents/dip-policy.service.js');

  let results = {
    approved: { correct: 0, wrong: 0, details: [] },
    rejected: { correct: 0, wrong: 0, details: [] }
  };

  // Test approved items
  console.log('=== Testing 10 APPROVED items ===\n');
  for (const decision of (approved || [])) {
    const item = decision.item_snapshot;
    const table = decision.source_table;

    try {
      const result = await evaluateItem(item, table);
      const b = result.confidenceBreakdown;

      const wouldApprove = b.action === 'auto_commit' && result.decision === 'approved';
      const wouldQueue = b.action === 'queue';
      const wouldEscalate = b.action === 'escalate';

      const status = wouldApprove ? '✅ CORRECT' : (wouldQueue ? '⏸️ QUEUE' : '❌ WRONG');

      if (wouldApprove) results.approved.correct++;
      else results.approved.wrong++;

      const shortTable = table.replace('staging_', '').slice(0, 8);
      const param = item.parameter || item.title || item.question || 'N/A';

      console.log(`${status} | ${shortTable} | margin=${b.margin?.toFixed(3)} | ${param.slice(0, 40)}`);

      results.approved.details.push({
        table: shortTable,
        margin: b.margin,
        action: b.action,
        llmDecision: result.decision,
        correct: wouldApprove
      });

    } catch (err) {
      console.log(`❌ ERROR | ${table} | ${err.message}`);
      results.approved.wrong++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n=== Testing 10 REJECTED items ===\n');
  for (const decision of (rejected || [])) {
    const item = decision.item_snapshot;
    const table = decision.source_table;

    try {
      // Check pre-filter FIRST (like batch processor does)
      const pf = preFilter(item, table);

      if (pf.skipLLM) {
        // Pre-filter caught it - correct rejection without LLM
        results.rejected.correct++;
        const shortTable = table.replace('staging_', '').slice(0, 8);
        const param = item.parameter || item.title || item.question || 'N/A';
        console.log(`✅ PRE-FILTER | ${shortTable} | ${pf.reason.slice(0, 30)} | ${param.slice(0, 30)}`);
        continue;
      }

      const result = await evaluateItem(item, table);
      const b = result.confidenceBreakdown;

      const wouldReject = b.action === 'auto_commit' && result.decision === 'rejected';
      const wouldQueue = b.action === 'queue';
      const wouldEscalate = b.action === 'escalate';

      const status = wouldReject ? '✅ CORRECT' : (wouldQueue ? '⏸️ QUEUE' : '❌ WRONG');

      if (wouldReject) results.rejected.correct++;
      else results.rejected.wrong++;

      const shortTable = table.replace('staging_', '').slice(0, 8);
      const param = item.parameter || item.title || item.question || 'N/A';

      console.log(`${status} | ${shortTable} | margin=${b.margin?.toFixed(3)} | LLM=${result.decision} | ${param.slice(0, 35)}`);

      results.rejected.details.push({
        table: shortTable,
        margin: b.margin,
        action: b.action,
        llmDecision: result.decision,
        correct: wouldReject
      });

    } catch (err) {
      console.log(`❌ ERROR | ${table} | ${err.message}`);
      results.rejected.wrong++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Approved items: ${results.approved.correct}/10 correct (${results.approved.wrong} queued/wrong)`);
  console.log(`Rejected items: ${results.rejected.correct}/10 correct (${results.rejected.wrong} queued/wrong)`);

  const totalCorrect = results.approved.correct + results.rejected.correct;
  console.log(`\nOverall: ${totalCorrect}/20 would auto-commit correctly (${(totalCorrect/20*100).toFixed(0)}%)`);
}

testAgainstTraining().catch(console.error);
