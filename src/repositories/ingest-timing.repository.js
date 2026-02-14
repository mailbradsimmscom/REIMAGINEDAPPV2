// src/repositories/ingest-timing.repository.js
import { getSupabaseClient } from './supabaseClient.js';
import { logger } from '../utils/logger.js';

const TABLE = 'ingest_timing';
const requestLogger = logger.createRequestLogger ? logger.createRequestLogger() : logger;

/**
 * Bulk insert timing rows for an ingest run (single transaction via Supabase).
 * @param {string} ingestRunId - UUID grouping all rows for one ingest attempt
 * @param {string} docId - Document ID (FK to documents.doc_id)
 * @param {Array<Object>} steps - Array of step timing objects
 * @returns {Object} { inserted: number }
 */
export async function insertTimingRows(ingestRunId, docId, steps) {
    const supabase = await getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    const rows = steps.map(step => ({
        ingest_run_id: ingestRunId,
        doc_id: docId,
        step_name: step.step,
        started_at: step.started_at ? new Date(step.started_at).toISOString() : null,
        ended_at: step.ended_at ? new Date(step.ended_at).toISOString() : null,
        duration_ms: step.duration_ms ?? null,
        status: step.status || 'complete',
        metadata: step.metadata || null
    }));

    const { data, error } = await supabase
        .from(TABLE)
        .insert(rows)
        .select('id');

    if (error) {
        requestLogger.error('Failed to insert ingest timing rows', {
            error: error.message,
            ingestRunId,
            docId,
            stepCount: steps.length
        });
        const err = new Error(`Failed to insert timing rows: ${error.message}`);
        err.cause = error;
        throw err;
    }

    return { inserted: data?.length || 0 };
}

/**
 * Get all timing runs for a document.
 * @param {string} docId
 * @returns {Array} Array of timing rows grouped by ingest_run_id
 */
export async function getTimingByDocId(docId) {
    const supabase = await getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('doc_id', docId)
        .order('created_at', { ascending: false });

    if (error) {
        requestLogger.error('Failed to query ingest timing', { error: error.message, docId });
        const err = new Error(`Failed to query timing: ${error.message}`);
        err.cause = error;
        throw err;
    }

    return data || [];
}

/**
 * Get timing for a specific ingest run.
 * @param {string} docId
 * @param {string} ingestRunId
 * @returns {Array} Timing rows for that run
 */
export async function getTimingByRunId(docId, ingestRunId) {
    const supabase = await getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('doc_id', docId)
        .eq('ingest_run_id', ingestRunId)
        .order('started_at', { ascending: true });

    if (error) {
        requestLogger.error('Failed to query ingest timing by run', {
            error: error.message, docId, ingestRunId
        });
        const err = new Error(`Failed to query timing: ${error.message}`);
        err.cause = error;
        throw err;
    }

    return data || [];
}

/**
 * Get recent timing rows across all documents.
 * @param {number} limit - Max number of rows to return (default 200)
 * @returns {Array} Timing rows ordered by created_at desc
 */
export async function getRecentTimingRows(limit = 200) {
    const supabase = await getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        requestLogger.error('Failed to query recent ingest timing', { error: error.message });
        const err = new Error(`Failed to query recent timing: ${error.message}`);
        err.cause = error;
        throw err;
    }

    return data || [];
}

/**
 * Look up system display names for a set of doc_ids.
 * Uses manufacturer_norm and model_norm directly from documents table.
 * @param {string[]} docIds
 * @returns {Object} Map of doc_id → { manufacturer, model, name }
 */
export async function getSystemNamesForDocs(docIds) {
    if (!docIds || docIds.length === 0) return {};

    const supabase = await getSupabaseClient();
    if (!supabase) return {};

    const { data: docs, error } = await supabase
        .from('documents')
        .select('doc_id, manufacturer_norm, model_norm')
        .in('doc_id', docIds);

    if (error || !docs) return {};

    const result = {};
    for (const doc of docs) {
        const manufacturer = doc.manufacturer_norm || '';
        const model = doc.model_norm || '';
        result[doc.doc_id] = {
            manufacturer,
            model,
            name: manufacturer && model ? `${manufacturer} / ${model}` : manufacturer || doc.doc_id.substring(0, 12)
        };
    }

    return result;
}

/**
 * Get terminal-state jobs for a set of doc_ids (v5_parse_detect + v5_ingest).
 * Returns { doc_id: [job, ...] } map — one query, no N+1.
 * @param {string[]} docIds
 * @returns {Object} Map of doc_id → array of job rows
 */
export async function getJobsForDocs(docIds) {
    if (!docIds || docIds.length === 0) return {};

    const supabase = await getSupabaseClient();
    if (!supabase) return {};

    // 90-day cutoff
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
        .from('jobs')
        .select('job_id, doc_id, job_type, status_v2, counters, created_at, started_at, completed_at')
        .in('doc_id', docIds)
        .in('job_type', ['v5_parse_detect', 'v5_ingest'])
        .in('status_v2', ['detection_complete', 'completed', 'failed', 'indexing_failed', 'dip_partial'])
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false });

    if (error) {
        requestLogger.error('Failed to query jobs for timing enrichment', {
            error: error.message,
            docIdCount: docIds.length
        });
        return {};
    }

    // Group by doc_id
    const result = {};
    for (const job of (data || [])) {
        if (!result[job.doc_id]) result[job.doc_id] = [];
        result[job.doc_id].push(job);
    }

    return result;
}

export default { insertTimingRows, getTimingByDocId, getTimingByRunId, getRecentTimingRows, getSystemNamesForDocs, getJobsForDocs };
