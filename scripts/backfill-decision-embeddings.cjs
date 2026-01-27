/**
 * Backfill embeddings for existing agent_training_decisions
 *
 * Usage:
 *   node scripts/backfill-decision-embeddings.cjs
 *   node scripts/backfill-decision-embeddings.cjs --limit=50
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Parse args
const args = process.argv.slice(2);
let limit = null;
for (const arg of args) {
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
      input: text
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Convert item snapshot to embeddable text
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

async function main() {
  console.log('=== Backfill Decision Embeddings ===\n');

  // Get decisions without embeddings
  let query = supabase
    .from('agent_training_decisions')
    .select('id, source_table, item_snapshot')
    .eq('agent_type', 'dip')
    .is('embedding', null);

  if (limit) {
    query = query.limit(limit);
  }

  const { data: decisions, error } = await query;

  if (error) {
    console.error('Error fetching decisions:', error.message);
    process.exit(1);
  }

  console.log(`Found ${decisions.length} decisions without embeddings\n`);

  if (decisions.length === 0) {
    console.log('Nothing to backfill!');
    return;
  }

  let success = 0;
  let errors = 0;

  for (let i = 0; i < decisions.length; i++) {
    const decision = decisions[i];
    const progress = `[${i + 1}/${decisions.length}]`;

    try {
      // Convert to text
      const text = itemToText(decision.item_snapshot, decision.source_table);

      if (!text || text.length < 10) {
        console.log(`${progress} Skipping - text too short`);
        continue;
      }

      // Get embedding
      const embedding = await getEmbedding(text);

      // Update decision
      const { error: updateError } = await supabase
        .from('agent_training_decisions')
        .update({ embedding })
        .eq('id', decision.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      success++;
      process.stdout.write(`${progress} Embedded\r`);

      // Rate limit
      await new Promise(r => setTimeout(r, 100));

    } catch (err) {
      errors++;
      console.log(`${progress} Error: ${err.message}`);
    }
  }

  console.log(`\n\n=== Complete ===`);
  console.log(`Success: ${success}`);
  console.log(`Errors: ${errors}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
