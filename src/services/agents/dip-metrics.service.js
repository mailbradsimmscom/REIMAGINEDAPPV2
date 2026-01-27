/**
 * DIP Metrics Service
 *
 * Handles observability for batch runs:
 * - Run tracking (start, complete, fail)
 * - Event logging
 * - Stats aggregation
 * - Report generation
 */

import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { logger } from '../../utils/logger.js';

const moduleLogger = logger.createModuleLogger('dip-metrics');

/**
 * Run Metrics Tracker
 * Tracks events and stats for a single batch run
 */
export class RunMetrics {
  constructor(runId, agentType = 'dip') {
    this.runId = runId;
    this.agentType = agentType;
    this.startTime = Date.now();
    this.events = [];
    this.stats = {
      itemsProcessed: 0,
      llmCalls: 0,
      autoApproved: 0,
      autoRejected: 0,
      escalated: 0,
      preFiltered: 0,
      queued: 0,
      errors: 0
    };
  }

  /**
   * Record an event
   */
  recordEvent(type, data = {}) {
    const event = {
      type,
      timestamp: Date.now(),
      elapsed: Date.now() - this.startTime,
      ...data
    };
    this.events.push(event);

    // Update stats based on event type
    switch (type) {
      case 'item_processed':
        this.stats.itemsProcessed++;
        break;
      case 'llm_call':
        this.stats.llmCalls++;
        break;
      case 'auto_approved':
        this.stats.autoApproved++;
        break;
      case 'auto_rejected':
        this.stats.autoRejected++;
        break;
      case 'escalated':
        this.stats.escalated++;
        break;
      case 'pre_filtered':
        this.stats.preFiltered++;
        break;
      case 'queued':
        this.stats.queued++;
        break;
      case 'error':
        this.stats.errors++;
        break;
    }

    moduleLogger.debug('Event recorded', { type, runId: this.runId });
  }

  /**
   * Get current stats
   */
  getStats() {
    return {
      ...this.stats,
      elapsedMs: Date.now() - this.startTime,
      elapsedMinutes: ((Date.now() - this.startTime) / 60000).toFixed(1)
    };
  }

  /**
   * Save final stats to database
   */
  async saveCompleted() {
    const supabase = await getSupabaseClient();

    const { error } = await supabase
      .from('agent_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        items_processed: this.stats.itemsProcessed,
        llm_calls: this.stats.llmCalls,
        auto_approved: this.stats.autoApproved,
        auto_rejected: this.stats.autoRejected,
        escalated: this.stats.escalated,
        pre_filtered: this.stats.preFiltered,
        errors: this.stats.errors
      })
      .eq('id', this.runId);

    if (error) {
      moduleLogger.error('Failed to save run stats', { error: error.message, runId: this.runId });
      throw error;
    }

    moduleLogger.info('Run completed', { runId: this.runId, stats: this.stats });
  }

  /**
   * Mark run as failed
   */
  async saveFailed(errorMessage) {
    const supabase = await getSupabaseClient();

    const { error } = await supabase
      .from('agent_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        items_processed: this.stats.itemsProcessed,
        llm_calls: this.stats.llmCalls,
        auto_approved: this.stats.autoApproved,
        auto_rejected: this.stats.autoRejected,
        escalated: this.stats.escalated,
        pre_filtered: this.stats.preFiltered,
        errors: this.stats.errors,
        error_message: errorMessage
      })
      .eq('id', this.runId);

    if (error) {
      moduleLogger.error('Failed to save run failure', { error: error.message, runId: this.runId });
    }

    moduleLogger.error('Run failed', { runId: this.runId, errorMessage, stats: this.stats });
  }

  /**
   * Generate markdown report
   */
  generateReport() {
    const stats = this.getStats();

    return `# DIP Batch Run Report

**Run ID:** ${this.runId}
**Agent Type:** ${this.agentType}
**Duration:** ${stats.elapsedMinutes} minutes

## Summary

| Metric | Count |
|--------|-------|
| Items Processed | ${stats.itemsProcessed} |
| LLM Calls | ${stats.llmCalls} |
| Pre-Filtered | ${stats.preFiltered} |
| Auto-Approved | ${stats.autoApproved} |
| Auto-Rejected | ${stats.autoRejected} |
| Escalated | ${stats.escalated} |
| Queued | ${stats.queued} |
| Errors | ${stats.errors} |

## Efficiency

- **Pre-filter rate:** ${stats.itemsProcessed > 0 ? ((stats.preFiltered / stats.itemsProcessed) * 100).toFixed(1) : 0}%
- **Auto-decision rate:** ${stats.llmCalls > 0 ? (((stats.autoApproved + stats.autoRejected) / stats.llmCalls) * 100).toFixed(1) : 0}%
- **Escalation rate:** ${stats.llmCalls > 0 ? ((stats.escalated / stats.llmCalls) * 100).toFixed(1) : 0}%
- **LLM calls saved by pre-filter:** ${stats.preFiltered}
`;
  }
}

// ============================================================================
// Run Management Functions
// ============================================================================

/**
 * Acquire a run lock
 * Creates a new run record and checks for existing running batches
 *
 * @param {string} agentType - The agent type ('dip' or 'maintenance')
 * @param {Object} config - Config to store with the run
 * @returns {Promise<{ runId: string, metrics: RunMetrics }>}
 */
export async function acquireRunLock(agentType, config = {}) {
  const supabase = await getSupabaseClient();
  const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

  // Check for existing running batch
  const { data: existing, error: checkError } = await supabase
    .from('agent_runs')
    .select('id, started_at')
    .eq('agent_type', agentType)
    .eq('status', 'running')
    .maybeSingle();

  if (checkError) {
    moduleLogger.error('Error checking for existing run', { error: checkError.message });
    throw new Error(`Failed to check run lock: ${checkError.message}`);
  }

  if (existing) {
    const startedAt = new Date(existing.started_at).getTime();
    const age = Date.now() - startedAt;

    if (age > STALE_THRESHOLD_MS) {
      // Stale lock - mark as failed and continue
      moduleLogger.warn('Recovering stale lock', { staleRunId: existing.id, ageMinutes: (age / 60000).toFixed(1) });

      await supabase
        .from('agent_runs')
        .update({
          status: 'failed',
          error_message: 'Stale lock recovered by new run',
          completed_at: new Date().toISOString()
        })
        .eq('id', existing.id);
    } else {
      // Active lock - cannot proceed
      throw new Error(`Another batch is already running (started ${(age / 60000).toFixed(1)} minutes ago)`);
    }
  }

  // Create new run record
  const { data: run, error: insertError } = await supabase
    .from('agent_runs')
    .insert({
      agent_type: agentType,
      status: 'running',
      config: config
    })
    .select()
    .single();

  if (insertError) {
    moduleLogger.error('Failed to create run record', { error: insertError.message });
    throw new Error(`Failed to acquire run lock: ${insertError.message}`);
  }

  moduleLogger.info('Run lock acquired', { runId: run.id, agentType });

  return {
    runId: run.id,
    metrics: new RunMetrics(run.id, agentType)
  };
}

/**
 * Clear stale processing marks from items
 * Items marked for processing by a failed run should be reset
 *
 * @param {string} agentType - The agent type
 */
export async function clearStaleProcessingMarks(agentType) {
  const supabase = await getSupabaseClient();

  // Find failed runs
  const { data: failedRuns } = await supabase
    .from('agent_runs')
    .select('id')
    .eq('agent_type', agentType)
    .eq('status', 'failed');

  if (!failedRuns || failedRuns.length === 0) {
    return 0;
  }

  const failedRunIds = failedRuns.map(r => r.id);
  let totalCleared = 0;

  // Clear marks from each staging table
  const tables = [
    'staging_spec_suggestions',
    'staging_playbook_hints',
    'staging_intent_router',
    'staging_golden_tests'
  ];

  for (const table of tables) {
    const { count } = await supabase
      .from(table)
      .update({
        processing_run_id: null,
        processing_started_at: null
      })
      .in('processing_run_id', failedRunIds);

    totalCleared += count || 0;
  }

  if (totalCleared > 0) {
    moduleLogger.info('Cleared stale processing marks', { count: totalCleared });
  }

  return totalCleared;
}

/**
 * Get recent run history
 *
 * @param {string} agentType - The agent type
 * @param {number} limit - Number of runs to fetch
 */
export async function getRunHistory(agentType, limit = 10) {
  const supabase = await getSupabaseClient();

  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('agent_type', agentType)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    moduleLogger.error('Failed to fetch run history', { error: error.message });
    return [];
  }

  return data;
}

/**
 * Get the most recent run
 */
export async function getLastRun(agentType) {
  const history = await getRunHistory(agentType, 1);
  return history[0] || null;
}
