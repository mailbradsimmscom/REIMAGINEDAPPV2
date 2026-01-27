/**
 * DIP Confidence Service v3.0
 *
 * Margin-based decision logic - training data first, LLM confirms.
 *
 * v3.0 Logic:
 * 1. Pre-filter match → auto_reject (no LLM needed)
 * 2. LLM uncertain → escalate (Telegram)
 * 3. margin >= +0.08 AND LLM approve → auto_commit (approve)
 * 4. margin >= +0.12 AND LLM reject → auto_commit (reject)
 * 5. Everything else → queue
 *
 * Where margin = simToApproved - simToRejected
 * Positive margin = embeddings lean toward approved
 * Negative margin = embeddings lean toward rejected
 */

import { logger } from '../../utils/logger.js';

const moduleLogger = logger.createModuleLogger('dip-confidence');

// Margin thresholds (v3.0)
const APPROVE_MARGIN_THRESHOLD = 0.04;  // Embeddings must lean approved by 4%+
const REJECT_MARGIN_THRESHOLD = 0.12;   // Higher bar for reject (riskier)

/**
 * Compute confidence and action based on margin + LLM agreement.
 *
 * @param {Object} input
 * @param {string} input.llmDecision - 'approved' | 'rejected' | 'uncertain'
 * @param {number} input.simToApproved - Avg similarity to top-3 approved examples (0-1)
 * @param {number} input.simToRejected - Avg similarity to top-3 rejected examples (0-1)
 * @param {boolean} input.preFilterMatch - Did the pre-filter match (hard reject)?
 * @returns {{ score: number, action: string, breakdown: Object }}
 */
export function computeConfidence(input) {
  const s = input ?? {};

  const simToApproved = s.simToApproved ?? 0;
  const simToRejected = s.simToRejected ?? 0;
  const margin = simToApproved - simToRejected;

  // Normalize LLM decision to lowercase
  const llmDecision = (s.llmDecision || '').toLowerCase();

  // ---------- 1. Pre-filter match → auto-reject ----------
  if (s.preFilterMatch) {
    moduleLogger.debug('Pre-filter match → auto_reject', { margin });
    return {
      score: 95,
      action: 'auto_commit',
      decision: 'rejected',
      breakdown: {
        rule: 'pre_filter',
        margin,
        simToApproved,
        simToRejected,
        final: 95,
        action: 'auto_commit'
      }
    };
  }

  // ---------- 2. LLM uncertain → escalate ----------
  if (llmDecision === 'uncertain') {
    moduleLogger.debug('LLM uncertain → escalate', { margin });
    return {
      score: 50,
      action: 'escalate',
      breakdown: {
        rule: 'llm_uncertain',
        margin,
        simToApproved,
        simToRejected,
        final: 50,
        action: 'escalate'
      }
    };
  }

  // ---------- 3. Margin + LLM approve → auto-approve ----------
  if (llmDecision === 'approved' && margin >= APPROVE_MARGIN_THRESHOLD) {
    const score = Math.round(80 + (margin * 100));  // 80-100 range
    moduleLogger.debug('Margin + LLM approve → auto_commit', { margin, score });
    return {
      score: Math.min(score, 99),
      action: 'auto_commit',
      breakdown: {
        rule: 'margin_approve',
        margin,
        threshold: APPROVE_MARGIN_THRESHOLD,
        simToApproved,
        simToRejected,
        llmDecision,
        final: Math.min(score, 99),
        action: 'auto_commit'
      }
    };
  }

  // ---------- 4. Margin + LLM reject → auto-reject ----------
  // Note: margin is negative when leaning toward rejected
  if (llmDecision === 'rejected' && margin <= -REJECT_MARGIN_THRESHOLD) {
    const score = Math.round(80 + (Math.abs(margin) * 100));  // 80-100 range
    moduleLogger.debug('Margin + LLM reject → auto_commit', { margin, score });
    return {
      score: Math.min(score, 99),
      action: 'auto_commit',
      breakdown: {
        rule: 'margin_reject',
        margin,
        threshold: -REJECT_MARGIN_THRESHOLD,
        simToApproved,
        simToRejected,
        llmDecision,
        final: Math.min(score, 99),
        action: 'auto_commit'
      }
    };
  }

  // ---------- 5. Everything else → queue ----------
  // LLM has opinion but margin doesn't support it strongly enough
  const score = Math.round(60 + (Math.abs(margin) * 50));  // 60-75 range
  moduleLogger.debug('Insufficient margin → queue', {
    margin,
    llmDecision,
    score
  });

  return {
    score: Math.min(score, 74),
    action: 'queue',
    breakdown: {
      rule: 'insufficient_margin',
      margin,
      approveThreshold: APPROVE_MARGIN_THRESHOLD,
      rejectThreshold: -REJECT_MARGIN_THRESHOLD,
      simToApproved,
      simToRejected,
      llmDecision,
      final: Math.min(score, 74),
      action: 'queue'
    }
  };
}

export default { computeConfidence };
