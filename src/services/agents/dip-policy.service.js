/**
 * DIP Policy Service
 *
 * Handles:
 * - Deterministic pre-filtering (skip obvious rejects without LLM)
 * - Policy engine (gatekeeper that decides whether to trust LLM judgment)
 * - Throughput controls (rate limiting, caps)
 */

import { logger } from '../../utils/logger.js';

const moduleLogger = logger.createModuleLogger('dip-policy');

// ============================================================================
// THROUGHPUT CONTROLS
// ============================================================================

/**
 * Default limits for batch runs
 * Can be overridden per run via CLI args
 */
export const DEFAULT_LIMITS = {
  maxItemsPerRun: 200,
  maxLLMCallsPerRun: 200,
  maxEscalationsPerRun: 20,
  rateLimitMs: 1000,
  concurrentEvaluations: 1  // Sequential for v1
};

/**
 * Runtime limit tracker
 * Tracks counters and enforces caps during a batch run
 */
export class RunLimits {
  constructor(limits = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.counters = {
      items: 0,
      llmCalls: 0,
      escalations: 0,
      preFiltered: 0,
      autoApproved: 0,
      autoRejected: 0,
      queued: 0,
      errors: 0
    };
  }

  // Check if we can continue
  canProcessMore() {
    return this.counters.items < this.limits.maxItemsPerRun;
  }

  canCallLLM() {
    return this.counters.llmCalls < this.limits.maxLLMCallsPerRun;
  }

  canEscalate() {
    return this.counters.escalations < this.limits.maxEscalationsPerRun;
  }

  // Record events
  recordItem() { this.counters.items++; }
  recordLLMCall() { this.counters.llmCalls++; }
  recordEscalation() { this.counters.escalations++; }
  recordPreFilter() { this.counters.preFiltered++; }
  recordAutoApprove() { this.counters.autoApproved++; }
  recordAutoReject() { this.counters.autoRejected++; }
  recordQueued() { this.counters.queued++; }
  recordError() { this.counters.errors++; }

  // Get summary
  getSummary() {
    return {
      ...this.counters,
      limits: this.limits
    };
  }
}

// ============================================================================
// PRE-FILTER (Deterministic, no LLM needed)
// ============================================================================

/**
 * Keywords that trigger immediate rejection
 * These are patterns we've learned from training that are always rejected
 */
const REJECT_KEYWORDS = [
  // Compliance/regulatory (from training rejections)
  'ce marking',
  'ukca',
  'fcc part',
  'industry canada',
  'acma',
  'rsm',
  'regulatory compliance',
  'compliance documentation',
  'certified',
  'certification mark',
  'class a',      // Regulatory device classification
  'class b',      // Regulatory device classification

  // Legal/trademark (avoid ® and ™ symbols - too many false positives in brand names)
  'trademark of',
  'registered trademark of',
  'trademarks are property',
  'warranty card',
  'warranty documentation',
  'legal disclaimer',
  'liability',

  // Zero value content
  'download our app',
  'visit our website',
  'contact customer support',
  'english is the official language',
  'software version',   // Static data that becomes outdated

  // Installation-only (unless repair-relevant)
  'tools required for installation',
  'installation tools needed'
];

/**
 * Categories that are usually rejected
 */
const REJECT_CATEGORIES = [
  'compliance',
  'regulatory',
  'legal',
  'warranty',
  'trademark',
  'certification'
];

/**
 * Extract content text from item based on table type
 * This prevents false positives from matching on metadata fields like IDs
 *
 * @param {Object} item - The item
 * @param {string} sourceTable - The source table name
 * @returns {string} - Searchable content text
 */
export function getContentText(item, sourceTable) {
  switch (sourceTable) {
    case 'staging_spec_suggestions':
      return [
        item.parameter || '',
        item.value || '',
        item.notes || '',
        item.category || '',
        item.units || ''
      ].join(' ').toLowerCase();

    case 'staging_playbook_hints':
      return [
        item.title || '',
        item.description || '',
        ...(item.steps || [])
      ].join(' ').toLowerCase();

    case 'staging_intent_router':
      return [
        item.question || '',
        item.answer || '',
        item.expected_intent || ''
      ].join(' ').toLowerCase();

    case 'staging_golden_tests':
      return [
        item.query || '',
        item.expected || '',
        item.context || ''
      ].join(' ').toLowerCase();

    default:
      // Fallback to relevant fields only (not full JSON)
      return Object.entries(item)
        .filter(([k]) => !['id', 'created_at', 'updated_at', 'status', 'processing_run_id', 'document_id', 'page_number'].includes(k))
        .map(([, v]) => typeof v === 'string' ? v : '')
        .join(' ')
        .toLowerCase();
  }
}

/**
 * Pre-filter an item before LLM evaluation
 * Returns action and whether to skip LLM
 *
 * @param {Object} item - The item to filter
 * @param {string} sourceTable - The source table name
 * @returns {{ action: string, reason: string, skipLLM: boolean }}
 */
export function preFilter(item, sourceTable) {
  // Extract only content fields (not metadata/IDs)
  const text = getContentText(item, sourceTable);

  // Check reject keywords
  for (const keyword of REJECT_KEYWORDS) {
    if (text.includes(keyword.toLowerCase())) {
      moduleLogger.debug('Pre-filter reject (keyword)', { keyword, itemId: item.id });
      return {
        action: 'pre_reject',
        reason: `Matches reject keyword: ${keyword}`,
        skipLLM: true
      };
    }
  }

  // Check reject categories
  const category = (item.category || '').toLowerCase();
  if (category && REJECT_CATEGORIES.includes(category)) {
    moduleLogger.debug('Pre-filter reject (category)', { category, itemId: item.id });
    return {
      action: 'pre_reject',
      reason: `Category in reject list: ${item.category}`,
      skipLLM: true
    };
  }

  // Check for parameter-based rejections (specific to spec_suggestions)
  if (sourceTable === 'staging_spec_suggestions') {
    const parameter = (item.parameter || '').toLowerCase();
    if (parameter.includes('regulatory') || parameter.includes('compliance')) {
      moduleLogger.debug('Pre-filter reject (parameter)', { parameter, itemId: item.id });
      return {
        action: 'pre_reject',
        reason: `Parameter indicates compliance: ${item.parameter}`,
        skipLLM: true
      };
    }
  }

  // Pass to LLM evaluation
  return {
    action: 'evaluate',
    reason: null,
    skipLLM: false
  };
}

// ============================================================================
// POLICY ENGINE (Gatekeeper)
// ============================================================================

/**
 * Get per-table thresholds from config
 * Falls back to global thresholds if table-specific not defined
 *
 * @param {Object} config - Agent config from database
 * @param {string} sourceTable - The source table name
 * @returns {{ approve: number, reject: number, escalateBelow: number }}
 */
export function getTableThresholds(config, sourceTable) {
  const tableThresholds = config?.learned_criteria?.table_thresholds?.[sourceTable];

  if (tableThresholds) {
    return {
      approve: tableThresholds.approve,
      reject: tableThresholds.reject,
      escalateBelow: tableThresholds.escalate_below
    };
  }

  // Fall back to global thresholds
  return {
    approve: config?.auto_approve_threshold || 0.90,
    reject: config?.auto_reject_threshold || 0.90,
    escalateBelow: config?.escalate_below || 0.80
  };
}

/**
 * Policy Engine: The Gatekeeper
 *
 * LLM is the judge - it evaluates the item and provides:
 * - decision (approved/rejected/uncertain)
 * - confidence (0.0-1.0)
 * - reasoning
 *
 * Policy engine decides whether to TRUST that judgment:
 * - High confidence + approval → auto-approve
 * - High confidence + rejection → auto-reject
 * - Low confidence → escalate to human
 * - Can also override based on hard rules (e.g., new manufacturer)
 *
 * @param {Object} evaluation - LLM evaluation result
 * @param {Object} item - The original item
 * @param {string} sourceTable - The source table name
 * @param {RunLimits} runLimits - Current run limits tracker
 * @param {Object} config - Agent config from database
 * @returns {{ action: string, reason: string }}
 */
export function applyPolicy(evaluation, item, sourceTable, runLimits, config) {
  const { decision, confidence, reasoning } = evaluation;

  // Get per-table thresholds (falls back to global if not defined)
  const thresholds = getTableThresholds(config, sourceTable);
  const autoApproveThreshold = thresholds.approve;
  const autoRejectThreshold = thresholds.reject;
  const escalateBelow = thresholds.escalateBelow;

  // Hard rule: If LLM call limit reached, we shouldn't be here
  // This is a safety check
  if (!runLimits.canCallLLM()) {
    moduleLogger.warn('Policy check called but LLM limit reached');
    return { action: 'skipped', reason: 'LLM call limit reached' };
  }

  // Record the LLM call
  runLimits.recordLLMCall();

  // Decision logic based on confidence and decision

  // High confidence approval
  if (decision === 'approved' && confidence >= autoApproveThreshold) {
    runLimits.recordAutoApprove();
    return {
      action: 'auto_approved',
      reason: `High confidence approval (${(confidence * 100).toFixed(0)}%)`
    };
  }

  // High confidence rejection
  if (decision === 'rejected' && confidence >= autoRejectThreshold) {
    runLimits.recordAutoReject();
    return {
      action: 'auto_rejected',
      reason: `High confidence rejection (${(confidence * 100).toFixed(0)}%)`
    };
  }

  // Low confidence or uncertain → escalate if we can
  if (confidence < escalateBelow || decision === 'uncertain') {
    if (runLimits.canEscalate()) {
      runLimits.recordEscalation();
      return {
        action: 'escalate',
        reason: `Low confidence (${(confidence * 100).toFixed(0)}%), needs human review`
      };
    } else {
      runLimits.recordQueued();
      return {
        action: 'queued',
        reason: 'Would escalate but limit reached'
      };
    }
  }

  // Medium confidence (between escalate threshold and auto-action threshold)
  // Queue for later batch review
  runLimits.recordQueued();
  return {
    action: 'queued',
    reason: `Medium confidence (${(confidence * 100).toFixed(0)}%), queued for batch review`
  };
}

// ============================================================================
// HELPER: Rate limiting
// ============================================================================

/**
 * Sleep for rate limiting
 * @param {number} ms - Milliseconds to sleep
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Rate limit wrapper
 * Ensures minimum delay between operations
 *
 * @param {number} rateLimitMs - Minimum ms between operations
 * @returns {Function} - Function to call after each operation
 */
export function createRateLimiter(rateLimitMs = 1000) {
  let lastCall = 0;

  return async function rateLimit() {
    const now = Date.now();
    const elapsed = now - lastCall;

    if (elapsed < rateLimitMs) {
      await sleep(rateLimitMs - elapsed);
    }

    lastCall = Date.now();
  };
}
