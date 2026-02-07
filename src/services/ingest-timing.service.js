// src/services/ingest-timing.service.js
import { insertTimingRows, getTimingByDocId, getTimingByRunId, getRecentTimingRows, getSystemNamesForDocs } from '../repositories/ingest-timing.repository.js';
import { logger } from '../utils/logger.js';

const requestLogger = logger.createRequestLogger ? logger.createRequestLogger() : logger;

const VALID_STEPS = new Set([
    'upload', 'parse', 'detect', 'document', 'vision', 'indexing',
    'dip_specs', 'dip_troubleshooting', 'dip_procedures',
    'dip_golden_rules', 'dip_intent_router'
]);

/**
 * Validate and save timing payload.
 * Accepts partial payloads (any subset of canonical step names).
 * Unknown step names are rejected; missing steps are fine.
 *
 * @param {string} ingestRunId - UUID for this ingest run
 * @param {string} docId - Document ID
 * @param {Array<Object>} steps - Array of { step, started_at, ended_at, duration_ms, status, metadata }
 * @returns {Object} { inserted: number, rejected: string[] }
 */
export async function saveTimingPayload(ingestRunId, docId, steps) {
    if (!ingestRunId || !docId) {
        throw new Error('ingest_run_id and doc_id are required');
    }

    if (!Array.isArray(steps) || steps.length === 0) {
        throw new Error('steps array is required and must not be empty');
    }

    const validSteps = [];
    const rejected = [];

    for (const step of steps) {
        if (!step.step || !VALID_STEPS.has(step.step)) {
            rejected.push(step.step || '(missing)');
            continue;
        }
        validSteps.push(step);
    }

    if (rejected.length > 0) {
        requestLogger.warn('Rejected unknown step names in timing payload', {
            rejected, docId, ingestRunId
        });
    }

    if (validSteps.length === 0) {
        throw new Error('No valid steps in payload');
    }

    const result = await insertTimingRows(ingestRunId, docId, validSteps);

    requestLogger.info('Saved ingest timing', {
        ingestRunId,
        docId,
        inserted: result.inserted,
        rejected: rejected.length
    });

    return { inserted: result.inserted, rejected };
}

/**
 * Retrieve all timing runs for a document.
 */
export async function getTimingForDocument(docId) {
    const rows = await getTimingByDocId(docId);

    // Group by ingest_run_id
    const runs = {};
    for (const row of rows) {
        if (!runs[row.ingest_run_id]) {
            runs[row.ingest_run_id] = { ingest_run_id: row.ingest_run_id, steps: [] };
        }
        runs[row.ingest_run_id].steps.push(row);
    }

    return Object.values(runs);
}

/**
 * Retrieve timing for a specific ingest run.
 */
export async function getTimingForRun(docId, ingestRunId) {
    return await getTimingByRunId(docId, ingestRunId);
}

/**
 * Retrieve recent ingest timing runs across all documents.
 * Groups rows by ingest_run_id, computes total duration per run.
 * @param {number} limit - Max rows to fetch (default 200)
 * @returns {Array<Object>} Array of run objects with steps and totals
 */
export async function getRecentIngestTimingRuns(limit = 200) {
    const rows = await getRecentTimingRows(limit);

    // Group by ingest_run_id
    const runs = {};
    for (const row of rows) {
        if (!runs[row.ingest_run_id]) {
            runs[row.ingest_run_id] = {
                ingest_run_id: row.ingest_run_id,
                doc_id: row.doc_id,
                created_at: row.created_at,
                steps: []
            };
        }
        runs[row.ingest_run_id].steps.push({
            step_name: row.step_name,
            duration_ms: row.duration_ms,
            status: row.status,
            started_at: row.started_at,
            ended_at: row.ended_at,
            metadata: row.metadata
        });
        // Track earliest created_at for the run
        if (row.created_at < runs[row.ingest_run_id].created_at) {
            runs[row.ingest_run_id].created_at = row.created_at;
        }
    }

    // Compute totals and sort steps within each run
    const STEP_ORDER = [
        'upload', 'parse', 'detect', 'document', 'vision', 'indexing',
        'dip_specs', 'dip_troubleshooting', 'dip_procedures',
        'dip_golden_rules', 'dip_intent_router'
    ];

    const result = Object.values(runs).map(run => {
        // Sort steps by canonical order
        run.steps.sort((a, b) => {
            const ai = STEP_ORDER.indexOf(a.step_name);
            const bi = STEP_ORDER.indexOf(b.step_name);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });

        // Compute total duration (sum of all step durations)
        const totalMs = run.steps.reduce((sum, s) => sum + (s.duration_ms || 0), 0);
        run.total_duration_ms = totalMs;
        run.step_count = run.steps.length;

        return run;
    });

    // Sort runs by created_at descending (most recent first)
    result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Enrich with system names (manufacturer / model)
    const uniqueDocIds = [...new Set(result.map(r => r.doc_id))];
    const nameMap = await getSystemNamesForDocs(uniqueDocIds);
    for (const run of result) {
        const info = nameMap[run.doc_id];
        run.system_name = info?.name || run.doc_id.substring(0, 12);
    }

    return result;
}

export default { saveTimingPayload, getTimingForDocument, getTimingForRun, getRecentIngestTimingRuns };
