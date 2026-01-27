/**
 * DIP Review Agent Service
 * Evaluates DIP staging items using learned criteria and few-shot examples
 */

import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { oaiJson } from '../../clients/openai.client.js';
import { getEnv } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { getSimilarDecisions, storeDecisionEmbedding, checkEmbeddingReadiness } from './dip-exemplar.service.js';
import { computeConfidence } from './dip-confidence.service.js';

const moduleLogger = logger.createModuleLogger('dip-review-agent');

// Cache for agent config (refreshed every 5 minutes)
let configCache = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get agent configuration with caching
 */
async function getAgentConfig() {
  const now = Date.now();
  if (configCache && (now - configCacheTime) < CONFIG_CACHE_TTL) {
    return configCache;
  }

  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from('agent_config')
    .select('*')
    .eq('agent_type', 'dip')
    .single();

  if (error) {
    moduleLogger.error('Failed to fetch agent config', { error: error.message });
    throw new Error('Failed to fetch agent configuration');
  }

  configCache = data;
  configCacheTime = now;
  return data;
}

/**
 * Build evaluation prompt with few-shot examples
 *
 * @param {Object} item - Item to evaluate
 * @param {string} sourceTable - Source table name
 * @param {Object} config - Agent config
 * @param {Object} dynamicExamples - Dynamic examples from retrieval (optional)
 */
function buildEvaluationPrompt(item, sourceTable, config, dynamicExamples = null) {
  const criteria = config.learned_criteria || {};

  // Use dynamic examples if available, otherwise fall back to static
  let approvalExamples = [];
  let rejectionExamples = [];

  if (dynamicExamples && (dynamicExamples.approvals?.length > 0 || dynamicExamples.rejections?.length > 0)) {
    // Use retrieval-based examples (from similar past decisions)
    approvalExamples = dynamicExamples.approvals.map(d => ({
      table: d.source_table,
      content: d.item_snapshot,
      reasoning: d.reasoning,
      similarity: d.similarity
    }));
    rejectionExamples = dynamicExamples.rejections.map(d => ({
      table: d.source_table,
      content: d.item_snapshot,
      reasoning: d.reasoning,
      similarity: d.similarity
    }));
  } else {
    // Fall back to static examples from config
    const staticApprovals = config.example_approvals || [];
    const staticRejections = config.example_rejections || [];

    approvalExamples = staticApprovals.filter(e => e.table === sourceTable).slice(0, 2);
    rejectionExamples = staticRejections.filter(e => e.table === sourceTable).slice(0, 2);

    if (approvalExamples.length < 2) {
      approvalExamples.push(...staticApprovals.filter(e => e.table !== sourceTable).slice(0, 2 - approvalExamples.length));
    }
    if (rejectionExamples.length < 2) {
      rejectionExamples.push(...staticRejections.filter(e => e.table !== sourceTable).slice(0, 2 - rejectionExamples.length));
    }
  }

  let prompt = `You are evaluating a DIP (Documentation Intelligence Pipeline) item for a marine boat operating system.

## Decision Criteria

### REJECT if:
${(criteria.reject_if || []).map(r => `- ${r}`).join('\n')}

### APPROVE if:
${(criteria.approve_if || []).map(a => `- ${a}`).join('\n')}

## Few-Shot Examples (Similar Past Decisions)

### Approved Examples:
`;

  approvalExamples.forEach((ex, i) => {
    const content = ex.content || {};
    const simNote = ex.similarity ? ` [${(ex.similarity * 100).toFixed(0)}% similar]` : '';
    prompt += `
Example ${i + 1} (${ex.table})${simNote}:
Content: ${JSON.stringify(content, null, 2).slice(0, 500)}
Decision: APPROVED
Reasoning: ${ex.reasoning}
`;
  });

  prompt += `
### Rejected Examples:
`;

  rejectionExamples.forEach((ex, i) => {
    const content = ex.content || {};
    const simNote = ex.similarity ? ` [${(ex.similarity * 100).toFixed(0)}% similar]` : '';
    prompt += `
Example ${i + 1} (${ex.table})${simNote}:
Content: ${JSON.stringify(content, null, 2).slice(0, 500)}
Decision: REJECTED
Reasoning: ${ex.reasoning}
`;
  });

  prompt += `
## Item to Evaluate

Table: ${sourceTable}
Content:
${JSON.stringify(item, null, 2)}

## Your Task

Evaluate this item and respond with a JSON object containing:
- decision: "approved" | "rejected" | "uncertain"
- reasoning: brief explanation (1-2 sentences)
- matched_criteria: which criteria triggered this decision

If you are genuinely unsure, return "uncertain" as the decision.
`;

  return prompt;
}

/**
 * Evaluate a single DIP item
 * @param {Object} item - The item to evaluate
 * @param {string} sourceTable - The source table name
 * @param {Object} options - Optional overrides (e.g., preFilterMatch)
 * @returns {Object} - { decision, confidence, reasoning, matchedCriteria, confidenceBreakdown }
 */
export async function evaluateItem(item, sourceTable, options = {}) {
  const config = await getAgentConfig();

  // Check if agent is ready
  if (!config.learned_criteria || !config.example_approvals) {
    throw new Error('Agent not trained yet - missing learned criteria');
  }

  // Try to get dynamic examples from retrieval (if embeddings are available)
  let dynamicExamples = null;
  let usedRetrieval = false;
  let similaritySignals = {
    simToApproved: 0,
    simToRejected: 0,
    a1: 0, a2: 0, r1: 0, r2: 0,
    approvedCount: 0,
    rejectedCount: 0
  };

  try {
    const readiness = await checkEmbeddingReadiness();
    if (readiness.ready) {
      dynamicExamples = await getSimilarDecisions(item, sourceTable);
      usedRetrieval = (dynamicExamples.approvals?.length > 0 || dynamicExamples.rejections?.length > 0);

      // Extract similarity signals for external confidence computation
      similaritySignals = {
        simToApproved: dynamicExamples.simToApproved ?? 0,
        simToRejected: dynamicExamples.simToRejected ?? 0,
        a1: dynamicExamples.a1 ?? 0,
        a2: dynamicExamples.a2 ?? 0,
        r1: dynamicExamples.r1 ?? 0,
        r2: dynamicExamples.r2 ?? 0,
        approvedCount: dynamicExamples.approvedCount ?? 0,
        rejectedCount: dynamicExamples.rejectedCount ?? 0
      };

      if (usedRetrieval) {
        moduleLogger.debug('Using retrieval-based examples', {
          approvals: dynamicExamples.approvals?.length || 0,
          rejections: dynamicExamples.rejections?.length || 0,
          simToApproved: similaritySignals.simToApproved,
          simToRejected: similaritySignals.simToRejected
        });
      }
    }
  } catch (error) {
    moduleLogger.warn('Retrieval failed, using static examples', { error: error.message });
  }

  const systemPrompt = `You are a DIP item reviewer for a marine boat operating system.
Your job is to determine if extracted documentation content is operationally valuable.
Respond ONLY with valid JSON. No markdown, no explanation outside the JSON.`;

  const userPrompt = buildEvaluationPrompt(item, sourceTable, config, dynamicExamples);

  try {
    const env = getEnv();
    const response = await oaiJson({
      system: systemPrompt,
      user: userPrompt,
      model: env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
      maxOutputTokens: 300
    });

    // Parse the JSON response
    const content = response.choices[0].message.content;
    const result = JSON.parse(content);

    const llmDecision = (result.decision || 'uncertain').toLowerCase();

    // Compute external confidence v2.1 (don't trust LLM's confidence)
    const { score, breakdown } = computeConfidence({
      llmDecision,
      simToApproved: similaritySignals.simToApproved,
      simToRejected: similaritySignals.simToRejected,
      a1: similaritySignals.a1,
      a2: similaritySignals.a2,
      r1: similaritySignals.r1,
      r2: similaritySignals.r2,
      approvedCount: similaritySignals.approvedCount,
      rejectedCount: similaritySignals.rejectedCount,
      preFilterMatch: options.preFilterMatch || false
    });

    // Convert 0-100 to 0.0-1.0 for threshold comparisons
    const confidence = score / 100;

    moduleLogger.debug('External confidence v2.1 computed', {
      llmDecision,
      externalScore: score,
      confidence,
      breakdown: {
        margin: breakdown.core?.margin,
        strength: breakdown.core?.strength,
        agrees: breakdown.core?.llmAgreesWithEmbedding,
        coreAdj: breakdown.core?.adjustment,
        separationAdj: breakdown.separation?.adjustment
      }
    });

    return {
      decision: llmDecision,
      confidence,
      reasoning: result.reasoning || 'No reasoning provided',
      matchedCriteria: result.matched_criteria || [],
      confidenceBreakdown: breakdown,
      usedRetrieval
    };

  } catch (error) {
    moduleLogger.error('Evaluation failed', { error: error.message, sourceTable, itemId: item.id });

    // Return uncertain on error with low confidence
    return {
      decision: 'uncertain',
      confidence: 0.0,
      reasoning: `Evaluation error: ${error.message}`,
      matchedCriteria: [],
      confidenceBreakdown: { error: error.message }
    };
  }
}

/**
 * Record an agent decision to the training table
 * Also stores embedding for future retrieval-based learning
 */
export async function recordAgentDecision(item, sourceTable, evaluation) {
  const supabase = await getSupabaseClient();

  const { data, error } = await supabase
    .from('agent_training_decisions')
    .insert({
      agent_type: 'dip',
      source_table: sourceTable,
      source_id: item.id,
      item_snapshot: item,
      decision: evaluation.decision,
      reasoning: evaluation.reasoning,
      decision_source: 'agent',
      confidence: evaluation.confidence
    })
    .select('id')
    .single();

  if (error) {
    moduleLogger.error('Failed to record agent decision', { error: error.message });
    return;
  }

  // Store embedding asynchronously (non-blocking)
  if (data?.id) {
    storeDecisionEmbedding(data.id, item, sourceTable).catch(err => {
      moduleLogger.warn('Failed to store embedding', { error: err.message, decisionId: data.id });
    });
  }
}

/**
 * Update item status in source table
 */
export async function updateItemStatus(sourceTable, itemId, status) {
  const supabase = await getSupabaseClient();

  const { error } = await supabase
    .from(sourceTable)
    .update({ status })
    .eq('id', itemId);

  if (error) {
    moduleLogger.error('Failed to update item status', { error: error.message, sourceTable, itemId });
    return false;
  }
  return true;
}

/**
 * Process a single item through the agent
 * Uses v3.0 margin-based logic from computeConfidence:
 * - auto_commit: execute decision (approve OR reject)
 * - queue: batch review (margin insufficient)
 * - escalate: real-time Telegram (LLM uncertain)
 *
 * @param {Object} item - The item to process
 * @param {string} sourceTable - The source table name
 * @returns {Object} - { action, evaluation }
 */
export async function processItem(item, sourceTable) {
  const evaluation = await evaluateItem(item, sourceTable);
  const { confidenceBreakdown } = evaluation;

  // Use action from v3.0 confidence computation
  const action = confidenceBreakdown?.action || 'escalate';

  // Decision can come from confidence (pre-filter) or LLM
  const decision = confidenceBreakdown?.decision || evaluation.decision;

  if (action === 'auto_commit') {
    // Execute the decision (from margin+LLM or pre-filter)
    await updateItemStatus(sourceTable, item.id, decision);
    await recordAgentDecision(item, sourceTable, { ...evaluation, decision });
    return { action: decision === 'approved' ? 'auto_approved' : 'auto_rejected', evaluation };
  }

  if (action === 'escalate') {
    // Escalate to Telegram (LLM said uncertain)
    return { action: 'escalate', evaluation };
  }

  // Queue for batch review (margin didn't support LLM's opinion)
  return { action: 'queued', evaluation };
}

/**
 * Get pending items for processing
 * @param {number} limit - Maximum items to fetch
 * @returns {Array} - Array of { table, item } objects
 */
export async function getPendingItems(limit = 10) {
  const supabase = await getSupabaseClient();
  const tables = [
    'staging_spec_suggestions',
    'staging_playbook_hints',
    'staging_intent_router',
    'staging_golden_tests'
  ];

  const items = [];

  for (const table of tables) {
    if (items.length >= limit) break;

    const remaining = limit - items.length;
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('status', 'pending')
      .limit(remaining);

    if (!error && data) {
      data.forEach(item => items.push({ table, item }));
    }
  }

  return items;
}

/**
 * Get agent stats
 */
export async function getAgentStats() {
  const config = await getAgentConfig();
  const supabase = await getSupabaseClient();

  // Get decision counts
  const { data: decisions } = await supabase
    .from('agent_training_decisions')
    .select('decision, decision_source')
    .eq('agent_type', 'dip');

  const stats = {
    isActive: config.is_active,
    totalDecisions: config.total_decisions,
    minToActivate: config.min_decisions_to_activate,
    thresholds: {
      autoApprove: config.auto_approve_threshold,
      autoReject: config.auto_reject_threshold,
      escalateBelow: config.escalate_below
    },
    bySource: {
      human: 0,
      agent: 0,
      telegram: 0,
      pre_filter: 0
    },
    byDecision: {
      approved: 0,
      rejected: 0
    }
  };

  if (decisions) {
    decisions.forEach(d => {
      stats.bySource[d.decision_source] = (stats.bySource[d.decision_source] || 0) + 1;
      stats.byDecision[d.decision] = (stats.byDecision[d.decision] || 0) + 1;
    });
  }

  return stats;
}

export default {
  evaluateItem,
  processItem,
  recordAgentDecision,
  updateItemStatus,
  getPendingItems,
  getAgentStats,
  getAgentConfig
};
