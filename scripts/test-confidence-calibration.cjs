/**
 * Test external confidence v2.1 against known human decisions
 *
 * Usage:
 *   node scripts/test-confidence-calibration.cjs
 *   node scripts/test-confidence-calibration.cjs --decision=approved --limit=25
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Parse args
const args = process.argv.slice(2);
let filterDecision = 'approved';
let limit = 25;

for (const arg of args) {
  if (arg.startsWith('--decision=')) {
    filterDecision = arg.split('=')[1];
  }
  if (arg.startsWith('--limit=')) {
    limit = parseInt(arg.split('=')[1], 10);
  }
}

/**
 * Get embedding from OpenAI
 */
async function getEmbedding(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000)
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${await response.text()}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Convert item to text for embedding
 */
function itemToText(item, sourceTable) {
  switch (sourceTable) {
    case 'staging_spec_suggestions':
      return [
        item.parameter || '',
        item.value || '',
        item.units || '',
        item.notes || '',
        item.category || ''
      ].filter(Boolean).join(' ');

    case 'staging_playbook_hints':
      return [
        item.title || '',
        item.description || '',
        ...(item.steps || [])
      ].filter(Boolean).join(' ');

    case 'staging_intent_router':
      return [
        item.question || '',
        item.answer || '',
        item.expected_intent || ''
      ].filter(Boolean).join(' ');

    case 'staging_golden_tests':
      return [
        item.query || '',
        item.expected || '',
        item.context || ''
      ].filter(Boolean).join(' ');

    default:
      return JSON.stringify(item);
  }
}

/**
 * Compute external confidence v2.1 (matches dip-confidence.service.js)
 */
function computeConfidence({ llmDecision, simToApproved, simToRejected, a1, a2, r1, r2, approvedCount, rejectedCount }) {
  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  if (llmDecision === 'uncertain') {
    return { score: 60, breakdown: { override: 'llm_uncertain' } };
  }

  // ---------- Core v2.1 calculation ----------
  const base = 75;

  // Direction: positive = closer to approved, negative = closer to rejected
  const margin = simToApproved - simToRejected;

  // Signal strength: how confident can we be in any direction?
  const strength = Math.max(simToApproved, simToRejected);

  // Square strength to reduce mid-similarity overconfidence
  const strengthSquared = strength * strength;

  // Core adjustment: direction * confidence in that direction
  const scale = 60;
  const coreAdj = Math.round(margin * strengthSquared * scale);

  let score = base + coreAdj;

  // ---------- Gated novelty penalty ----------
  const noveltyFloor = 0.35;
  let noveltyAdj = 0;

  if (strength < noveltyFloor) {
    noveltyAdj = -Math.round((noveltyFloor - strength) * 40);
    score += noveltyAdj;
  }

  // ---------- Top-k separation (neighborhood consistency) ----------
  const separation = (a1 - a2) - (r1 - r2);
  const separationAdj = clamp(Math.round(separation * 20), -6, 6);
  score += separationAdj;

  // ---------- LLM-similarity agreement ----------
  const hasEnoughPrecedent = approvedCount >= 3 && rejectedCount >= 3;
  const absMargin = Math.abs(margin);
  let agreementAdj = 0;

  if (hasEnoughPrecedent && absMargin >= 0.10) {
    const llmAgreesWithSimilarity =
      (llmDecision === 'approved' && margin > 0) ||
      (llmDecision === 'rejected' && margin < 0);

    if (llmAgreesWithSimilarity) {
      agreementAdj = 6;
    } else if (absMargin > 0.20) {
      agreementAdj = -10;
    } else {
      agreementAdj = -4;
    }

    score += agreementAdj;
  }

  return {
    score: clamp(Math.round(score), 0, 100),
    breakdown: {
      base,
      simToApproved,
      simToRejected,
      margin,
      strength,
      strengthSquared,
      coreAdj,
      noveltyAdj,
      separationAdj,
      agreementAdj,
      hasEnoughPrecedent
    }
  };
}

async function main() {
  console.log(`\n=== Testing External Confidence v2.1 Against Human ${filterDecision.toUpperCase()} Decisions ===\n`);

  // Get human decisions
  const { data: decisions, error } = await supabase
    .from('agent_training_decisions')
    .select('id, source_table, item_snapshot, decision, reasoning')
    .eq('agent_type', 'dip')
    .eq('decision_source', 'human')
    .eq('decision', filterDecision)
    .limit(limit);

  if (error) {
    console.error('Error fetching decisions:', error.message);
    process.exit(1);
  }

  console.log(`Found ${decisions.length} human ${filterDecision} decisions to test\n`);

  const results = [];

  for (let i = 0; i < decisions.length; i++) {
    const decision = decisions[i];
    const progress = `[${i + 1}/${decisions.length}]`;

    try {
      // Get embedding for this item
      const text = itemToText(decision.item_snapshot, decision.source_table);
      const embedding = await getEmbedding(text);

      // Find similar approved decisions (excluding this one)
      const { data: approvedMatches } = await supabase.rpc('match_training_decisions', {
        query_embedding: embedding,
        match_count: 8,
        filter_table: decision.source_table,
        filter_decision: 'approved',
        exclude_weak_labels: true
      });

      // Find similar rejected decisions
      const { data: rejectedMatches } = await supabase.rpc('match_training_decisions', {
        query_embedding: embedding,
        match_count: 8,
        filter_table: decision.source_table,
        filter_decision: 'rejected',
        exclude_weak_labels: true
      });

      // Filter out self-match
      const approvedFiltered = (approvedMatches || []).filter(m => m.id !== decision.id);
      const rejectedFiltered = (rejectedMatches || []).filter(m => m.id !== decision.id);

      // Use avg(top-3) for main signals
      const avgTop3 = (arr) => arr.length > 0 ? arr.slice(0, 3).reduce((a, b) => a + b.similarity, 0) / Math.min(arr.length, 3) : 0;

      const simToApproved = avgTop3(approvedFiltered);
      const simToRejected = avgTop3(rejectedFiltered);

      // Top-2 for separation signal
      const a1 = approvedFiltered[0]?.similarity ?? 0;
      const a2 = approvedFiltered[1]?.similarity ?? 0;
      const r1 = rejectedFiltered[0]?.similarity ?? 0;
      const r2 = rejectedFiltered[1]?.similarity ?? 0;

      // Compute confidence as if LLM agreed with human decision
      const { score, breakdown } = computeConfidence({
        llmDecision: decision.decision,
        simToApproved,
        simToRejected,
        a1, a2, r1, r2,
        approvedCount: approvedFiltered.length,
        rejectedCount: rejectedFiltered.length
      });

      results.push({
        table: decision.source_table.replace('staging_', '').replace('_suggestions', '').replace('_hints', ''),
        score,
        simToApproved: simToApproved.toFixed(2),
        simToRejected: simToRejected.toFixed(2),
        margin: breakdown.margin.toFixed(2),
        strength: breakdown.strength.toFixed(2),
        coreAdj: breakdown.coreAdj,
        sepAdj: breakdown.separationAdj,
        agrAdj: breakdown.agreementAdj
      });

      process.stdout.write(`${progress} ${score}%\r`);

      // Rate limit
      await new Promise(r => setTimeout(r, 100));

    } catch (err) {
      console.log(`${progress} Error: ${err.message}`);
    }
  }

  console.log('\n\n=== Results (v2.1: base=75, s², gated novelty, top-k sep) ===\n');

  // Sort by score
  results.sort((a, b) => a.score - b.score);

  // Print table
  console.log('Table      | Score | SimAppr | SimRej | Margin | Strngth | Core | Sep | Agr');
  console.log('-----------|-------|---------|--------|--------|---------|------|-----|----');
  for (const r of results) {
    console.log(`${r.table.padEnd(10)} | ${String(r.score).padStart(4)}% | ${r.simToApproved.padStart(7)} | ${r.simToRejected.padStart(6)} | ${r.margin.padStart(6)} | ${r.strength.padStart(7)} | ${String(r.coreAdj).padStart(4)} | ${String(r.sepAdj).padStart(3)} | ${String(r.agrAdj).padStart(3)}`);
  }

  // Stats
  const scores = results.map(r => r.score);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const min = Math.min(...scores);
  const max = Math.max(...scores);

  console.log('\n=== Stats ===');
  console.log(`Min: ${min}%`);
  console.log(`Max: ${max}%`);
  console.log(`Avg: ${avg.toFixed(1)}%`);
  console.log(`Would auto-${filterDecision} (>=85%): ${scores.filter(s => s >= 85).length}/${scores.length}`);
  console.log(`Would escalate (<75%): ${scores.filter(s => s < 75).length}/${scores.length}`);
  console.log(`In queue zone (75-84%): ${scores.filter(s => s >= 75 && s < 85).length}/${scores.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
