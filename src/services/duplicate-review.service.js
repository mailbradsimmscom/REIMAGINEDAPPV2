/**
 * Duplicate Review Service
 * Business logic for human-in-the-loop deduplication
 */

import fs from 'fs';
import path from 'path';
import * as duplicateReviewRepository from '../repositories/duplicate-review.repository.js';
import pineconeRepository from '../repositories/pinecone.repository.js';

/**
 * Get the latest deduplication results file from maintenance-agent
 * @returns {string|null} File path or null if not found
 */
function getLatestDeduplicationFile() {
  try {
    // Point to maintenance-agent directory (in same repo)
    const resultsDir = path.join(process.cwd(), 'maintenance-agent');

    if (!fs.existsSync(resultsDir)) {
      console.warn('Maintenance-agent directory not found:', resultsDir);
      return null;
    }

    const files = fs.readdirSync(resultsDir)
      .filter(f => f.startsWith('deduplication-results-') && f.endsWith('.json'))
      .map(f => {
        const match = f.match(/deduplication-results-(\d+)\.json/);
        return {
          name: f,
          timestamp: parseInt(match?.[1] || '0')
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp); // Newest first

    if (files.length === 0) {
      console.warn('No deduplication results files found');
      return null;
    }

    const latestFile = path.join(resultsDir, files[0].name);
    return latestFile;
  } catch (error) {
    console.error('Error finding deduplication file:', error.message);
    return null;
  }
}

/**
 * Find a specific pair in the latest JSON file (bidirectional)
 * @param {string} taskAId - First task ID
 * @param {string} taskBId - Second task ID
 * @returns {Object|null} Pair object or null
 */
function findPairInLatestJSON(taskAId, taskBId) {
  const filePath = getLatestDeduplicationFile();
  if (!filePath) {
    console.warn('No deduplication file to search');
    return null;
  }

  try {
    const results = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Check both orientations (A,B) and (B,A)
    const pair = results.duplicate_pairs.find(p =>
      (p.taskA.id === taskAId && p.taskB.id === taskBId) ||
      (p.taskA.id === taskBId && p.taskB.id === taskAId)
    );

    return pair;
  } catch (error) {
    console.error('Error reading deduplication file:', error.message);
    return null;
  }
}

/**
 * Get duplicate candidates for human review
 * @returns {Promise<Object>} Candidates with review stats
 */
export async function getCandidates() {
  const filePath = getLatestDeduplicationFile();

  if (!filePath) {
    return {
      error: 'no_dedup_results',
      message: 'No deduplication results found. Run: node scripts/deduplicate-tasks-forreview.js',
      total: 0,
      reviewed: 0,
      remaining: 0,
      pairs: []
    };
  }

  try {
    // Load deduplication results
    const results = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Get all reviewed pairs
    const reviewedPairs = await duplicateReviewRepository.getReviewedPairs();

    // Get all deleted task IDs
    const deletedTasks = await duplicateReviewRepository.getDeletedTasks();
    const deletedSet = new Set(deletedTasks.map(d => d.pinecone_id));

    // Create set of reviewed pair keys (both orientations)
    const reviewedSet = new Set();
    reviewedPairs.forEach(r => {
      reviewedSet.add(`${r.task_a_id}:${r.task_b_id}`);
      reviewedSet.add(`${r.task_b_id}:${r.task_a_id}`); // Bidirectional
    });

    // Filter out already reviewed pairs AND pairs with deleted tasks
    const pairs = results.duplicate_pairs.map(pair => ({
      ...pair,
      already_reviewed: reviewedSet.has(`${pair.taskA.id}:${pair.taskB.id}`),
      has_deleted_task: deletedSet.has(pair.taskA.id) || deletedSet.has(pair.taskB.id)
    }));

    const remaining = pairs.filter(p => !p.already_reviewed && !p.has_deleted_task);

    return {
      total: pairs.length,
      reviewed: pairs.length - remaining.length,
      remaining: remaining.length,
      pairs: remaining
    };
  } catch (error) {
    console.error('Error getting candidates:', error.message);
    throw error;
  }
}

/**
 * Compute features from a task pair for ML training
 * @param {Object} pair - Task pair from deduplication results
 * @returns {Object} Computed features
 */
function computeFeatures(pair) {
  const taskA = pair.taskA;
  const taskB = pair.taskB;

  // Compute frequency difference percentage
  const frequencyDiff = computeFrequencyDiff(
    taskA.frequency_hours,
    taskB.frequency_hours
  );

  // Compute description length ratio
  const lengthRatio = taskA.description.length / (taskB.description.length || 1);

  return {
    similarity_score: pair.similarity_score,
    frequency_match: pair.frequency_match ?? null, // Handle undefined
    frequency_basis_match: taskA.frequency_basis === taskB.frequency_basis,
    task_type_match: taskA.task_type === taskB.task_type,
    system_match: taskA.system_name === taskB.system_name,
    asset_match: taskA.asset_uid === taskB.asset_uid,
    is_high_confidence_override: pair.similarity_score >= 0.95,
    frequency_hours_diff_percent: frequencyDiff,
    description_length_ratio: parseFloat(lengthRatio.toFixed(4))
  };
}

/**
 * Compute frequency difference percentage
 * @param {number|null} hoursA - First task frequency hours
 * @param {number|null} hoursB - Second task frequency hours
 * @returns {number|null} Percentage difference or null
 */
function computeFrequencyDiff(hoursA, hoursB) {
  if (hoursA === null || hoursB === null) return null;
  if (hoursA === 0 && hoursB === 0) return 0;

  const avg = (hoursA + hoursB) / 2;
  const diff = Math.abs(hoursA - hoursB);
  return parseFloat((diff / avg).toFixed(4));
}

/**
 * Submit a human decision on a duplicate pair
 * @param {Object} decisionData - Decision data from frontend
 * @returns {Promise<Object>} Result with action taken
 */
export async function submitDecision(decisionData) {
  const { task_a_id, task_b_id, human_decision, confidence, notes, delete_which } = decisionData;

  // 1. Find the pair in the latest JSON file
  const pair = findPairInLatestJSON(task_a_id, task_b_id);
  if (!pair) {
    throw new Error('Pair not found in deduplication results');
  }

  // 2. Compute features (backend owns this)
  const features = computeFeatures(pair);

  // 3. Take action based on decision (FAIL FAST on Pinecone errors)
  let action_taken;

  if (human_decision === 'duplicate') {
    if (delete_which === 'both') {
      // Delete BOTH tasks from Pinecone
      try {
        await pineconeRepository.deleteVectors([task_a_id, task_b_id], 'MAINTENANCE_TASKS');
        action_taken = 'deleted_both';

        // Save both to audit trail
        await duplicateReviewRepository.saveDeletedTask({
          pinecone_id: task_a_id,
          was_duplicate_of: task_b_id,
          original_description: pair.taskA.description,
          original_asset_uid: pair.taskA.asset_uid,
          original_system_name: pair.taskA.system_name,
          original_frequency_basis: pair.taskA.frequency_basis,
          original_frequency_hours: pair.taskA.frequency_hours,
          deleted_by: 'admin'
        });

        await duplicateReviewRepository.saveDeletedTask({
          pinecone_id: task_b_id,
          was_duplicate_of: task_a_id,
          original_description: pair.taskB.description,
          original_asset_uid: pair.taskB.asset_uid,
          original_system_name: pair.taskB.system_name,
          original_frequency_basis: pair.taskB.frequency_basis,
          original_frequency_hours: pair.taskB.frequency_hours,
          deleted_by: 'admin'
        });
      } catch (error) {
        // Pinecone delete failed - DON'T save the decision
        throw new Error(`Failed to delete both from Pinecone: ${error.message}`);
      }
    } else {
      // Determine which task to delete based on user choice
      const deleteTaskId = delete_which === 'task_a' ? task_a_id : task_b_id;
      const keepTaskId = delete_which === 'task_a' ? task_b_id : task_a_id;
      const deleteTaskData = delete_which === 'task_a' ? pair.taskA : pair.taskB;

      try {
        // Delete chosen task from Pinecone (CRITICAL - fail if this breaks)
        await pineconeRepository.deleteVectors([deleteTaskId], 'MAINTENANCE_TASKS');
        action_taken = delete_which === 'task_a' ? 'deleted_task_a' : 'deleted_task_b';

        // Save to audit trail
        await duplicateReviewRepository.saveDeletedTask({
          pinecone_id: deleteTaskId,
          was_duplicate_of: keepTaskId,
          original_description: deleteTaskData.description,
          original_asset_uid: deleteTaskData.asset_uid,
          original_system_name: deleteTaskData.system_name,
          original_frequency_basis: deleteTaskData.frequency_basis,
          original_frequency_hours: deleteTaskData.frequency_hours,
          deleted_by: 'admin'
        });
      } catch (error) {
        // Pinecone delete failed - DON'T save the decision
        throw new Error(`Failed to delete from Pinecone: ${error.message}`);
      }
    }
  } else {
    // Keep both tasks
    action_taken = 'kept_both';
  }

  // 4. Save the decision (only if action succeeded)
  await duplicateReviewRepository.saveReviewDecision({
    task_a_pinecone_id: task_a_id,
    task_b_pinecone_id: task_b_id,
    reviewer: 'admin',
    human_decision,
    confidence: confidence || null,
    notes: notes || null,
    action_taken,
    ...features
  });

  // 5. Mark pair as reviewed
  await duplicateReviewRepository.markPairAsReviewed({
    task_a_id,
    task_b_id,
    decision: human_decision
  });

  return {
    success: true,
    action_taken,
    task_a_id,
    task_b_id
  };
}

/**
 * Get review statistics for dashboard
 * @returns {Promise<Object>} Aggregated stats
 */
export async function getStats() {
  try {
    const decisions = await duplicateReviewRepository.getReviewStats();

    if (decisions.length === 0) {
      return {
        total_reviews: 0,
        marked_duplicate: 0,
        kept_both: 0,
        duplicate_rate: '0.0%',
        score_buckets: {},
        ready_for_ml: false,
        sample_size: 0
      };
    }

    const total = decisions.length;
    const duplicates = decisions.filter(d => d.human_decision === 'duplicate').length;
    const kept = decisions.filter(d => d.human_decision === 'keep_both').length;

    // Group by similarity score buckets (0.7, 0.8, 0.9, etc.)
    const scoreBuckets = {};
    decisions.forEach(d => {
      const bucket = Math.floor(d.similarity_score * 10) / 10;
      const bucketKey = bucket.toFixed(1);

      if (!scoreBuckets[bucketKey]) {
        scoreBuckets[bucketKey] = { duplicate: 0, keep_both: 0, total: 0 };
      }

      scoreBuckets[bucketKey][d.human_decision]++;
      scoreBuckets[bucketKey].total++;
    });

    // Calculate duplicate rate for each bucket
    Object.keys(scoreBuckets).forEach(bucket => {
      const data = scoreBuckets[bucket];
      data.duplicate_rate = ((data.duplicate / data.total) * 100).toFixed(1) + '%';
    });

    return {
      total_reviews: total,
      marked_duplicate: duplicates,
      kept_both: kept,
      duplicate_rate: ((duplicates / total) * 100).toFixed(1) + '%',
      score_buckets: scoreBuckets,
      ready_for_ml: total >= 50, // Need 50+ samples for ML
      sample_size: total
    };
  } catch (error) {
    console.error('Error getting stats:', error.message);
    throw error;
  }
}
