/**
 * Duplicate Review Repository
 * Database operations for human-in-the-loop deduplication
 */

import { getSupabaseClient } from './supabaseClient.js';
import { isSupabaseConfigured } from '../services/guards/index.js';

// Helper function to check if Supabase is available
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
 * Get all reviewed task pairs
 * @returns {Promise<Array>} Reviewed pairs with task IDs
 */
export async function getReviewedPairs() {
  const supabase = await checkSupabaseAvailability();

  const { data, error } = await supabase
    .from('reviewed_task_pairs')
    .select('*')
    .order('reviewed_at', { ascending: false });

  if (error) {
    const err = new Error(`Failed to fetch reviewed pairs: ${error.message}`);
    err.cause = error;
    throw err;
  }

  return data || [];
}

/**
 * Check if a pair has been reviewed (bidirectional check)
 * @param {string} taskAId - First task ID
 * @param {string} taskBId - Second task ID
 * @returns {Promise<boolean>} True if pair has been reviewed
 */
export async function isPairReviewed(taskAId, taskBId) {
  const supabase = await checkSupabaseAvailability();

  const { data, error } = await supabase
    .from('reviewed_task_pairs')
    .select('*')
    .or(`and(task_a_id.eq.${taskAId},task_b_id.eq.${taskBId}),and(task_a_id.eq.${taskBId},task_b_id.eq.${taskAId})`);

  if (error) {
    const err = new Error(`Failed to check if pair reviewed: ${error.message}`);
    err.cause = error;
    err.context = { taskAId, taskBId };
    throw err;
  }

  return data && data.length > 0;
}

/**
 * Save a review decision with all features
 * @param {Object} decisionData - Decision data with features
 * @returns {Promise<Object>} Created decision record
 */
export async function saveReviewDecision(decisionData) {
  const supabase = await checkSupabaseAvailability();

  const { data, error } = await supabase
    .from('duplicate_review_decisions')
    .insert(decisionData)
    .select()
    .single();

  if (error) {
    const err = new Error(`Failed to save review decision: ${error.message}`);
    err.cause = error;
    err.context = { decisionData };
    throw err;
  }

  return data;
}

/**
 * Mark a task pair as reviewed (UPSERT - safe for duplicates)
 * @param {Object} pairData - Pair data with task IDs and decision
 * @returns {Promise<Object>} Created/updated reviewed pair record
 */
export async function markPairAsReviewed(pairData) {
  const supabase = await checkSupabaseAvailability();

  // Use upsert to handle case where pair was already reviewed
  const { data, error } = await supabase
    .from('reviewed_task_pairs')
    .upsert(pairData, { onConflict: 'task_a_id,task_b_id' })
    .select()
    .single();

  if (error) {
    const err = new Error(`Failed to mark pair as reviewed: ${error.message}`);
    err.cause = error;
    err.context = { pairData };
    throw err;
  }

  return data;
}

/**
 * Save a deleted task to audit trail (UPSERT - safe for duplicates)
 * @param {Object} taskData - Deleted task data
 * @returns {Promise<Object>} Created/updated deleted task record
 */
export async function saveDeletedTask(taskData) {
  const supabase = await checkSupabaseAvailability();

  // Use upsert to handle case where task was already deleted
  const { data, error } = await supabase
    .from('deleted_duplicate_tasks')
    .upsert(taskData, { onConflict: 'pinecone_id' })
    .select()
    .single();

  if (error) {
    const err = new Error(`Failed to save deleted task: ${error.message}`);
    err.cause = error;
    err.context = { taskData };
    throw err;
  }

  return data;
}

/**
 * Get review statistics
 * @returns {Promise<Array>} Review stats
 */
export async function getReviewStats() {
  const supabase = await checkSupabaseAvailability();

  const { data, error } = await supabase
    .from('duplicate_review_decisions')
    .select('*');

  if (error) {
    const err = new Error(`Failed to fetch review stats: ${error.message}`);
    err.cause = error;
    throw err;
  }

  return data || [];
}

/**
 * Get all deleted tasks
 * @returns {Promise<Array>} List of deleted tasks
 */
export async function getDeletedTasks() {
  const supabase = await checkSupabaseAvailability();

  const { data, error } = await supabase
    .from('deleted_duplicate_tasks')
    .select('*')
    .order('deleted_at', { ascending: false });

  if (error) {
    const err = new Error(`Failed to fetch deleted tasks: ${error.message}`);
    err.cause = error;
    throw err;
  }

  return data || [];
}

/**
 * Get deleted task by Pinecone ID
 * @param {string} pineconeId - Task ID from Pinecone
 * @returns {Promise<Object|null>} Deleted task or null
 */
export async function getDeletedTask(pineconeId) {
  const supabase = await checkSupabaseAvailability();

  const { data, error } = await supabase
    .from('deleted_duplicate_tasks')
    .select('*')
    .eq('pinecone_id', pineconeId)
    .single();

  if (error && error.code !== 'PGRST116') {
    const err = new Error(`Failed to fetch deleted task: ${error.message}`);
    err.cause = error;
    err.context = { pineconeId };
    throw err;
  }

  return data;
}
