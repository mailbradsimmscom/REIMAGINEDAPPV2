// src/services/ingest-timing.service.js
import { insertTimingRows, getTimingByDocId, getTimingByRunId, getRecentTimingRows, getSystemNamesForDocs, getJobsForDocs } from '../repositories/ingest-timing.repository.js';
import { logger } from '../utils/logger.js';

const requestLogger = logger.createRequestLogger ? logger.createRequestLogger() : logger;

const VALID_STEPS = new Set([
    'upload', 'parse', 'detect', 'document', 'vision', 'indexing',
    'dip_specs', 'dip_troubleshooting', 'dip_procedures',
    'dip_golden_rules', 'dip_intent_router'
]);

// ── Job enrichment helpers ──────────────────────────────────────────────

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Determine status for a synthesized step from its counter data.
 * Rules: .error → 'error', .warning (no .error) → 'warning', else → 'complete'
 */
function determineStatus(counterData) {
    if (!counterData) return 'complete';
    if (counterData.error) return 'error';
    if (counterData.warning && !counterData.error) return 'warning';
    return 'complete';
}

/**
 * Build a synthesized timing step from job counter data.
 */
function synthesizeStep(stepName, counterData, job) {
    return {
        step_name: stepName,
        duration_ms: counterData.duration_ms || 0,
        status: determineStatus(counterData),
        started_at: null,
        ended_at: null,
        metadata: {
            source: 'job_enrichment',
            job_id: job.job_id,
            job_type: job.job_type,
            ...counterData
        }
    };
}

/**
 * Find the best matching job for a doc_id by type, time proximity, and ordering.
 * @param {Array} jobs - All jobs for this doc_id
 * @param {string} jobType - 'v5_parse_detect' or 'v5_ingest'
 * @param {string} uploadTimestamp - ISO timestamp of the upload timing row
 * @param {Object} [previousJob] - For v5_ingest: must be created after this job
 * @returns {Object|null} Best matching job or null
 */
function findMatchingJob(jobs, jobType, uploadTimestamp, previousJob) {
    if (!jobs || jobs.length === 0) return null;

    const uploadTime = new Date(uploadTimestamp).getTime();

    const candidates = jobs
        .filter(j => j.job_type === jobType)
        .filter(j => {
            const jobCreated = new Date(j.created_at).getTime();
            if (jobType === 'v5_parse_detect') {
                // Must be within 5 minutes of upload
                return Math.abs(jobCreated - uploadTime) <= FIVE_MINUTES_MS;
            }
            if (jobType === 'v5_ingest' && previousJob) {
                // Must be created after the parse-detect job
                return jobCreated > new Date(previousJob.created_at).getTime();
            }
            return false;
        });

    if (candidates.length === 0) return null;

    // Most recent first (jobs already ordered desc from repo)
    return candidates[0];
}

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
        'dip',
        'dip_specs', 'dip_troubleshooting', 'dip_procedures',
        'dip_golden_rules', 'dip_intent_router'
    ];

    const runList = Object.values(runs);

    // ── Enrich background-ingest runs with server-side job durations ─────
    // Only enrich 1-step upload-only runs (background ingest flow).
    // Old 11-step runs are never touched.
    const backgroundRuns = runList.filter(
        r => r.steps.length === 1 && r.steps[0].step_name === 'upload'
    );

    if (backgroundRuns.length > 0) {
        const bgDocIds = [...new Set(backgroundRuns.map(r => r.doc_id))];
        let jobsByDoc = {};
        try {
            jobsByDoc = await getJobsForDocs(bgDocIds);
        } catch (err) {
            requestLogger.warn('Job enrichment query failed, skipping', { error: err.message });
        }

        for (const run of backgroundRuns) {
            const docJobs = jobsByDoc[run.doc_id];
            if (!docJobs || docJobs.length === 0) continue;

            const uploadTimestamp = run.created_at;

            // Match parse-detect job (within 5 min of upload)
            const pdJob = findMatchingJob(docJobs, 'v5_parse_detect', uploadTimestamp);
            if (!pdJob || !pdJob.counters) continue;

            // Synthesize parse + detect steps
            const pdCounters = pdJob.counters;
            if (pdCounters.parse && !pdCounters.parse.skipped) {
                run.steps.push(synthesizeStep('parse', pdCounters.parse, pdJob));
            }
            if (pdCounters.detect && !pdCounters.detect.skipped) {
                run.steps.push(synthesizeStep('detect', pdCounters.detect, pdJob));
            }

            // Match ingest job (created after parse-detect)
            const ingJob = findMatchingJob(docJobs, 'v5_ingest', uploadTimestamp, pdJob);
            if (ingJob && ingJob.counters) {
                const ingCounters = ingJob.counters;

                if (ingCounters.vision && !ingCounters.vision.skipped) {
                    run.steps.push(synthesizeStep('vision', ingCounters.vision, ingJob));
                }
                if (ingCounters.indexing && !ingCounters.indexing.skipped) {
                    run.steps.push(synthesizeStep('indexing', ingCounters.indexing, ingJob));
                }
                if (ingCounters.dip && !ingCounters.dip.skipped) {
                    run.steps.push(synthesizeStep('dip', ingCounters.dip, ingJob));
                }

                // Compute review_pause: gap between parse-detect completion and ingest creation
                if (pdJob.completed_at && ingJob.created_at) {
                    const gapMs = new Date(ingJob.created_at).getTime() - new Date(pdJob.completed_at).getTime();
                    if (gapMs > 0 && gapMs < TWENTY_FOUR_HOURS_MS) {
                        run.review_pause = {
                            duration_ms: gapMs,
                            started_at: pdJob.completed_at,
                            ended_at: ingJob.created_at
                        };
                    } else {
                        run.review_pause = null;
                    }
                }
            }
        }
    }

    // Sort steps, compute totals
    const result = runList.map(run => {
        run.steps.sort((a, b) => {
            const ai = STEP_ORDER.indexOf(a.step_name);
            const bi = STEP_ORDER.indexOf(b.step_name);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });

        const totalMs = run.steps.reduce((sum, s) => sum + (s.duration_ms || 0), 0);
        run.total_duration_ms = totalMs;
        run.step_count = run.steps.length;
        // review_pause is NOT included in total_duration_ms or step_count

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
