/**
 * Test Analysis Service
 *
 * Business logic for retrieving and summarizing test failure analysis.
 * Follows routes → services → repositories pattern per .cursorrules.
 */

import { supabase } from '../repositories/supabaseClient.js';

/**
 * Get analysis results for a specific test run.
 *
 * @param {string} runId - UUID of the test run
 * @returns {Promise<{byFailureKey: Object, summary: Object}>}
 */
export async function getAnalysisForRun(runId) {
  const { data, error } = await supabase
    .from('test_analysis')
    .select('*')
    .eq('run_id', runId);

  if (error) {
    throw new Error(`Failed to fetch analysis: ${error.message}`);
  }

  // Transform to byFailureKey map
  const byFailureKey = {};
  const summary = {
    total: 0,
    resolved: 0,
    human_review_needed: 0,
    by_classification: {},
    by_root_cause: {}
  };

  for (const record of data || []) {
    byFailureKey[record.failure_key] = record;
    summary.total++;

    if (record.resolved) {
      summary.resolved++;
    }
    if (record.human_review_needed) {
      summary.human_review_needed++;
    }
    if (record.classification) {
      summary.by_classification[record.classification] =
        (summary.by_classification[record.classification] || 0) + 1;
    }
    if (record.root_cause_type) {
      summary.by_root_cause[record.root_cause_type] =
        (summary.by_root_cause[record.root_cause_type] || 0) + 1;
    }
  }

  return { byFailureKey, summary };
}

/**
 * Check if analysis exists for a run.
 *
 * @param {string} runId - UUID of the test run
 * @returns {Promise<boolean>}
 */
export async function hasAnalysisForRun(runId) {
  const { count, error } = await supabase
    .from('test_analysis')
    .select('*', { count: 'exact', head: true })
    .eq('run_id', runId);

  if (error) {
    throw new Error(`Failed to check analysis: ${error.message}`);
  }

  return count > 0;
}

/**
 * Get recent analysis runs with their summaries.
 *
 * @param {number} limit - Maximum number of runs to return
 * @returns {Promise<Array>}
 */
export async function getRecentAnalysisRuns(limit = 10) {
  const { data, error } = await supabase
    .from('test_analysis')
    .select('run_id, classification, resolved, human_review_needed, created_at')
    .order('created_at', { ascending: false })
    .limit(limit * 10); // Fetch more to group by run_id

  if (error) {
    throw new Error(`Failed to fetch recent analysis: ${error.message}`);
  }

  // Group by run_id and compute summaries
  const runMap = new Map();

  for (const record of data || []) {
    if (!runMap.has(record.run_id)) {
      runMap.set(record.run_id, {
        run_id: record.run_id,
        created_at: record.created_at,
        total: 0,
        resolved: 0,
        human_review_needed: 0
      });
    }

    const run = runMap.get(record.run_id);
    run.total++;
    if (record.resolved) run.resolved++;
    if (record.human_review_needed) run.human_review_needed++;
  }

  // Convert to array and limit
  return Array.from(runMap.values()).slice(0, limit);
}
