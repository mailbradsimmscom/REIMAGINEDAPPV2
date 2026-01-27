/**
 * DIP Exemplar Service
 *
 * Retrieval-based few-shot example selection using pgvector embeddings.
 * Finds the most similar past decisions to use as examples for LLM evaluation.
 */

import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { getEnv } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const moduleLogger = logger.createModuleLogger('dip-exemplar');

/**
 * Get embedding from OpenAI
 *
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - 1536-dimensional embedding vector
 */
export async function getEmbedding(text) {
  const env = getEnv();

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text.slice(0, 8000) // Limit to ~8k chars
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI embedding error: ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Convert item to embeddable text based on table type
 *
 * @param {Object} item - The item to convert
 * @param {string} sourceTable - The source table name
 * @returns {string} - Text representation for embedding
 */
export function itemToText(item, sourceTable) {
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
 * Apply diversity filter to exemplar candidates
 * Removes items that are too similar to already-selected items
 *
 * @param {Array} candidates - Sorted candidates (highest similarity first)
 * @param {number} targetCount - Number of diverse examples to select
 * @param {number} diversityThreshold - Skip items with similarity > this to selected items (default: 0.95)
 * @returns {Array} - Diverse subset of candidates
 */
function selectDiverseExamples(candidates, targetCount, diversityThreshold = 0.95) {
  if (!candidates || candidates.length === 0) return [];

  const selected = [];

  for (const candidate of candidates) {
    if (selected.length >= targetCount) break;

    // Check if this candidate is too similar to any already-selected item
    // We use a simple heuristic: if the candidate's similarity score is very close
    // to another selected item's score AND they're both high, they're likely duplicates
    const isDuplicate = selected.some(sel => {
      // If both have very high similarity to query and similar scores, likely duplicates
      if (candidate.similarity > 0.90 && sel.similarity > 0.90) {
        const scoreDiff = Math.abs(candidate.similarity - sel.similarity);
        return scoreDiff < 0.02; // Within 2% similarity score = likely same content
      }
      return false;
    });

    if (!isDuplicate) {
      selected.push(candidate);
    }
  }

  return selected;
}

/**
 * Find similar past decisions for few-shot examples
 *
 * @param {Object} item - The item to find examples for
 * @param {string} sourceTable - The source table name
 * @param {Object} options - Options
 * @param {number} options.approvalCount - Number of approval examples (default: 4)
 * @param {number} options.rejectionCount - Number of rejection examples (default: 4)
 * @param {boolean} options.excludeWeakLabels - Exclude pre-filter decisions (default: true)
 * @param {number} options.minSimilarity - Minimum similarity threshold (default: 0.60)
 * @returns {Promise<{approvals: Array, rejections: Array}>}
 */
export async function getSimilarDecisions(item, sourceTable, options = {}) {
  const {
    approvalCount = 4,
    rejectionCount = 4,
    excludeWeakLabels = true,
    minSimilarity = 0.60
  } = options;

  const supabase = await getSupabaseClient();

  // Request 2x candidates to allow for filtering
  const fetchMultiplier = 2;

  try {
    // Get embedding for the item
    const text = itemToText(item, sourceTable);
    const embedding = await getEmbedding(text);

    // Find similar approvals (fetch extra for filtering)
    const { data: rawApprovals, error: approvalError } = await supabase.rpc(
      'match_training_decisions',
      {
        query_embedding: embedding,
        match_count: approvalCount * fetchMultiplier,
        filter_table: sourceTable,
        filter_decision: 'approved',
        exclude_weak_labels: excludeWeakLabels
      }
    );

    if (approvalError) {
      moduleLogger.error('Error finding approval examples', { error: approvalError.message });
    }

    // Find similar rejections (fetch extra for filtering)
    const { data: rawRejections, error: rejectionError } = await supabase.rpc(
      'match_training_decisions',
      {
        query_embedding: embedding,
        match_count: rejectionCount * fetchMultiplier,
        filter_table: sourceTable,
        filter_decision: 'rejected',
        exclude_weak_labels: excludeWeakLabels
      }
    );

    if (rejectionError) {
      moduleLogger.error('Error finding rejection examples', { error: rejectionError.message });
    }

    // Apply min similarity filter
    const filteredApprovals = (rawApprovals || []).filter(d => d.similarity >= minSimilarity);
    const filteredRejections = (rawRejections || []).filter(d => d.similarity >= minSimilarity);

    // Apply diversity filter
    const approvals = selectDiverseExamples(filteredApprovals, approvalCount);
    const rejections = selectDiverseExamples(filteredRejections, rejectionCount);

    // Extract similarity signals for confidence computation
    // Use avg(top-3) for more robust signal (less sensitive to outliers)
    const approvedSims = (rawApprovals || []).slice(0, 3).map(d => d.similarity);
    const rejectedSims = (rawRejections || []).slice(0, 3).map(d => d.similarity);

    const avgTop3 = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const simToApproved = avgTop3(approvedSims);
    const simToRejected = avgTop3(rejectedSims);

    // Top-2 signals for consistency/separation check
    const a1 = rawApprovals?.[0]?.similarity ?? 0;
    const a2 = rawApprovals?.[1]?.similarity ?? 0;
    const r1 = rawRejections?.[0]?.similarity ?? 0;
    const r2 = rawRejections?.[1]?.similarity ?? 0;

    moduleLogger.debug('Found similar decisions', {
      rawApprovals: rawApprovals?.length || 0,
      rawRejections: rawRejections?.length || 0,
      afterMinSim: { approvals: filteredApprovals.length, rejections: filteredRejections.length },
      afterDiversity: { approvals: approvals.length, rejections: rejections.length },
      simToApproved: simToApproved.toFixed(3),
      simToRejected: simToRejected.toFixed(3),
      topK: { a1: a1.toFixed(3), a2: a2.toFixed(3), r1: r1.toFixed(3), r2: r2.toFixed(3) },
      minSimilarity,
      sourceTable
    });

    return {
      approvals,
      rejections,
      // Similarity signals for external confidence computation (avg top-3)
      simToApproved,
      simToRejected,
      // Top-2 for separation signal
      a1, a2, r1, r2,
      approvedCount: rawApprovals?.length ?? 0,
      rejectedCount: rawRejections?.length ?? 0
    };

  } catch (error) {
    moduleLogger.error('getSimilarDecisions failed', { error: error.message });

    // Return empty arrays on error (will fall back to static examples)
    return {
      approvals: [],
      rejections: [],
      simToApproved: 0,
      simToRejected: 0,
      a1: 0, a2: 0, r1: 0, r2: 0,
      approvedCount: 0,
      rejectedCount: 0
    };
  }
}

/**
 * Store embedding for a new decision
 *
 * @param {string} decisionId - The decision ID
 * @param {Object} item - The item that was decided on
 * @param {string} sourceTable - The source table name
 */
export async function storeDecisionEmbedding(decisionId, item, sourceTable) {
  const supabase = await getSupabaseClient();

  try {
    const text = itemToText(item, sourceTable);

    if (!text || text.length < 10) {
      moduleLogger.debug('Skipping embedding - text too short', { decisionId });
      return;
    }

    const embedding = await getEmbedding(text);

    const { error } = await supabase
      .from('agent_training_decisions')
      .update({ embedding })
      .eq('id', decisionId);

    if (error) {
      moduleLogger.error('Failed to store embedding', { error: error.message, decisionId });
    } else {
      moduleLogger.debug('Stored embedding', { decisionId });
    }

  } catch (error) {
    // Non-fatal - decision is still recorded, just without embedding
    moduleLogger.error('storeDecisionEmbedding failed', { error: error.message, decisionId });
  }
}

/**
 * Check if we have enough embeddings for retrieval-based learning
 *
 * @returns {Promise<{ready: boolean, count: number, minRequired: number}>}
 */
export async function checkEmbeddingReadiness() {
  const supabase = await getSupabaseClient();
  const minRequired = 50; // Minimum decisions with embeddings

  const { count, error } = await supabase
    .from('agent_training_decisions')
    .select('*', { count: 'exact', head: true })
    .eq('agent_type', 'dip')
    .not('embedding', 'is', null);

  if (error) {
    moduleLogger.error('Failed to check embedding readiness', { error: error.message });
    return { ready: false, count: 0, minRequired };
  }

  return {
    ready: count >= minRequired,
    count: count || 0,
    minRequired
  };
}

export default {
  getEmbedding,
  itemToText,
  getSimilarDecisions,
  storeDecisionEmbedding,
  checkEmbeddingReadiness
};
