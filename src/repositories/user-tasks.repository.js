/**
 * User Tasks Repository
 * Creates user tasks from chat when equipment is mentioned but not in inventory.
 * Tasks appear in the maintenance agent's todo list.
 */

import { getSupabaseClient } from './supabaseClient.js';
import { isSupabaseConfigured } from '../services/guards/index.js';
import { logger } from '../utils/logger.js';

const TABLE = 'user_tasks';
const requestLogger = logger.createRequestLogger();

/**
 * Check if Supabase is available
 * @returns {Promise<Object>} Supabase client
 * @throws {Error} If Supabase is not configured or unavailable
 */
async function checkSupabaseAvailability() {
  if (!isSupabaseConfigured()) {
    const error = new Error('Supabase not configured');
    error.code = 'SUPABASE_DISABLED';
    throw error;
  }
  const supabase = await getSupabaseClient();
  if (!supabase) {
    const error = new Error('Supabase client not available');
    error.code = 'SUPABASE_DISABLED';
    throw error;
  }
  return supabase;
}

/**
 * Check if a similar task already exists (prevent duplicates)
 * @param {string} equipmentName - Equipment name to search for
 * @returns {Promise<boolean>} true if similar task exists
 */
export async function hasExistingTask(equipmentName) {
  try {
    const supabase = await checkSupabaseAvailability();

    const { data, error } = await supabase
      .from(TABLE)
      .select('id')
      .eq('created_by', 'chat_suggestion')
      .eq('status', 'active')
      .ilike('description', `%${equipmentName}%`)
      .limit(1);

    if (error) {
      requestLogger.warn('Failed to check existing tasks', { error: error.message });
      return false; // On error, allow creation
    }

    return data && data.length > 0;
  } catch (err) {
    // If Supabase unavailable, allow creation attempt (will fail gracefully)
    requestLogger.warn('hasExistingTask check failed', { error: err.message });
    return false;
  }
}

/**
 * Create a user task
 * @param {Object} task - Task data
 * @param {string} task.description - Task description (required)
 * @param {string|null} task.asset_uid - Related system asset_uid (null for general)
 * @param {string} task.due_date - ISO date string for when due
 * @param {boolean} task.is_recurring - Whether task repeats (default: false)
 * @param {string} task.notes - Additional notes
 * @param {string} task.created_by - Source of task (e.g., 'chat_suggestion')
 * @param {string} task.priority - Priority level ('low', 'normal', 'high')
 * @returns {Promise<Object>} Created task
 * @throws {Error} If creation fails
 */
export async function createUserTask(task) {
  const supabase = await checkSupabaseAvailability();

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      description: task.description,
      asset_uid: task.asset_uid || null,
      due_date: task.due_date,
      is_recurring: task.is_recurring ?? false,
      notes: task.notes || null,
      created_by: task.created_by || 'user',
      priority: task.priority || 'normal',
      status: 'active'
    })
    .select()
    .single();

  if (error) {
    requestLogger.error('Failed to create user task', {
      error: error.message,
      description: task.description?.substring(0, 50)
    });
    const err = new Error(`Failed to create user task: ${error.message}`);
    err.cause = error;
    err.context = { operation: 'create', table: TABLE };
    throw err;
  }

  requestLogger.info('Created user task', {
    taskId: data.id,
    created_by: task.created_by
  });

  return data;
}

/**
 * Check if a document exists and is processed for an asset
 * @param {string} assetUid - Asset UID to check
 * @returns {Promise<{hasDoc: boolean, isProcessed: boolean}>}
 */
export async function checkDocumentStatus(assetUid) {
  try {
    const supabase = await checkSupabaseAvailability();

    const { data, error } = await supabase
      .from('documents')
      .select('chunk_count')
      .eq('asset_uid', assetUid)
      .limit(1)
      .single();

    if (error || !data) {
      return { hasDoc: false, isProcessed: false };
    }

    return {
      hasDoc: true,
      isProcessed: data.chunk_count > 0
    };
  } catch (err) {
    requestLogger.warn('checkDocumentStatus failed', { error: err.message });
    return { hasDoc: false, isProcessed: false };
  }
}

/**
 * Complete document ingest tasks matching a doc_id and optional task type.
 * Finds tasks created_by='document_ingest', status='active', parses notes JSON
 * to match doc_id. Completes all matching tasks.
 *
 * Note: user_tasks.notes is TEXT not JSONB — filter by indexed created_by + status first,
 * then parse notes JSON in app code to match doc_id.
 *
 * @param {string} docId - Document ID to match
 * @param {string} [taskType] - Optional type filter (e.g. 'detection_complete')
 * @returns {Promise<number>} Number of tasks completed
 */
export async function completeDocumentIngestTask(docId, taskType = null) {
  try {
    const supabase = await checkSupabaseAvailability();

    // Query active document_ingest tasks (both columns are indexed)
    const { data: tasks, error } = await supabase
      .from(TABLE)
      .select('id, notes')
      .eq('created_by', 'document_ingest')
      .eq('status', 'active');

    if (error) {
      requestLogger.error('Failed to query document ingest tasks', { error: error.message, docId });
      return 0;
    }

    if (!tasks || tasks.length === 0) return 0;

    // Parse notes JSON and find matching tasks
    const matchingIds = [];
    for (const task of tasks) {
      try {
        const notes = JSON.parse(task.notes);
        if (notes.doc_id === docId && (!taskType || notes.type === taskType)) {
          matchingIds.push(task.id);
        }
      } catch {
        // Skip tasks with invalid JSON notes
      }
    }

    if (matchingIds.length === 0) return 0;

    // Complete all matching tasks
    const { error: updateError } = await supabase
      .from(TABLE)
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .in('id', matchingIds);

    if (updateError) {
      requestLogger.error('Failed to complete document ingest tasks', { error: updateError.message, docId, count: matchingIds.length });
      return 0;
    }

    requestLogger.info('Completed document ingest tasks', { docId, taskType, count: matchingIds.length });
    return matchingIds.length;

  } catch (err) {
    requestLogger.warn('completeDocumentIngestTask failed', { error: err.message, docId });
    return 0;
  }
}

export default { createUserTask, hasExistingTask, checkDocumentStatus, completeDocumentIngestTask };
