/**
 * Maintenance Tasks Service
 * Business logic for maintenance task management
 *
 * This service provides validation, business logic, and orchestrates
 * calls to the maintenance-tasks repository.
 */

import maintenanceTasksRepository from '../repositories/maintenance-tasks.repository.js';
import { logger } from '../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Frequency type to hours conversion
 */
const FREQUENCY_CONVERSIONS = {
  hours: 1,
  days: 24,
  weeks: 168,
  months: 730,
  years: 8760
};

/**
 * Valid task categories
 */
const VALID_CATEGORIES = ['MAINTENANCE', 'INSTALLATION', 'PRE_USE_CHECK', 'VAGUE'];

/**
 * Valid frequency bases
 */
const VALID_FREQUENCY_BASES = ['calendar', 'usage', 'event', 'condition', 'unknown'];

/**
 * Valid frequency types
 */
const VALID_FREQUENCY_TYPES = ['hours', 'days', 'weeks', 'months', 'years'];

/**
 * Valid review statuses
 */
const VALID_REVIEW_STATUSES = ['pending', 'approved', 'rejected'];

/**
 * Validate and sanitize description
 * @param {string} description - Task description
 * @returns {Object} { valid: boolean, sanitized?: string, error?: string }
 */
function validateDescription(description) {
  if (typeof description !== 'string') {
    return { valid: false, error: 'Description must be a string' };
  }

  const trimmed = description.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: 'Description cannot be empty' };
  }

  if (trimmed.length > 100) {
    return { valid: false, error: 'Description must be 100 characters or less' };
  }

  return { valid: true, sanitized: trimmed };
}

/**
 * Calculate frequency in hours
 * @param {number} value - Frequency value
 * @param {string} type - Frequency type (hours, days, weeks, months, years)
 * @returns {number} Frequency in hours
 */
function calculateFrequencyHours(value, type) {
  if (!value || !type) {
    return null;
  }
  const conversion = FREQUENCY_CONVERSIONS[type];
  if (!conversion) {
    return null;
  }
  return value * conversion;
}

/**
 * Transform repository record to API format
 * @param {Object} record - Pinecone record
 * @returns {Object} Formatted task object
 */
function formatTask(record) {
  return {
    id: record.id,
    description: record.metadata.description,
    asset_uid: record.metadata.asset_uid,
    system_name: record.metadata.system_name,
    frequency_basis: record.metadata.frequency_basis,
    frequency_type: record.metadata.frequency_type ?? null,
    frequency_value: record.metadata.frequency_value ?? null,
    frequency_hours: record.metadata.frequency_hours ?? null,
    task_type: record.metadata.task_type,
    criticality: record.metadata.criticality ?? null,
    confidence: record.metadata.confidence ?? null,
    source: record.metadata.source ?? null,
    task_category: record.metadata.task_category ?? null,
    task_category_confidence: record.metadata.task_category_confidence ?? null,
    is_recurring: record.metadata.is_recurring ?? null,
    review_status: record.metadata.review_status ?? 'pending',
    is_completed: record.metadata.is_completed ?? false
  };
}

/**
 * Get all maintenance tasks
 * @returns {Promise<Object>} { tasks: Array, total: number }
 */
export async function getAllTasks() {
  try {
    requestLogger.info('Fetching all maintenance tasks');

    const records = await maintenanceTasksRepository.listAllTasks();
    const tasks = records.map(formatTask);

    requestLogger.info('Fetched tasks', { count: tasks.length });

    return {
      tasks,
      total: tasks.length
    };
  } catch (error) {
    requestLogger.error('Failed to get all tasks', { error: error.message });
    throw error;
  }
}

/**
 * Get a single task by ID
 * @param {string} taskId - Task ID
 * @returns {Promise<Object|null>} Task object or null
 */
export async function getTask(taskId) {
  try {
    requestLogger.info('Fetching task', { taskId });

    const record = await maintenanceTasksRepository.getTaskById(taskId);

    if (!record) {
      return null;
    }

    return formatTask(record);
  } catch (error) {
    requestLogger.error('Failed to get task', { taskId, error: error.message });
    throw error;
  }
}

/**
 * Update a task
 * @param {string} taskId - Task ID
 * @param {Object} updates - Updates to apply
 * @param {string} [updates.description] - Task description (max 50 chars)
 * @param {string} [updates.task_category] - Task category
 * @param {number} [updates.frequency_value] - Frequency value
 * @param {string} [updates.frequency_type] - Frequency type
 * @param {string} [updates.frequency_basis] - Frequency basis
 * @param {string} [updates.task_type] - Task type
 * @param {boolean} [updates.is_recurring] - Is recurring
 * @param {string} [updates.review_status] - Review status
 * @returns {Promise<Object>} Update result
 */
export async function updateTask(taskId, updates) {
  try {
    requestLogger.info('Updating task', { taskId, updates });

    // Validate task_category
    if (updates.task_category !== undefined) {
      if (!VALID_CATEGORIES.includes(updates.task_category)) {
        throw new Error(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
      }
    }

    // Validate frequency_basis
    if (updates.frequency_basis !== undefined) {
      if (!VALID_FREQUENCY_BASES.includes(updates.frequency_basis)) {
        throw new Error(`Invalid basis. Must be one of: ${VALID_FREQUENCY_BASES.join(', ')}`);
      }
    }

    // Validate frequency_type
    if (updates.frequency_type !== undefined) {
      if (!VALID_FREQUENCY_TYPES.includes(updates.frequency_type)) {
        throw new Error(`Invalid frequency type. Must be one of: ${VALID_FREQUENCY_TYPES.join(', ')}`);
      }
    }

    // Validate review_status
    if (updates.review_status !== undefined) {
      if (!VALID_REVIEW_STATUSES.includes(updates.review_status)) {
        throw new Error(`Invalid review status. Must be one of: ${VALID_REVIEW_STATUSES.join(', ')}`);
      }
    }

    // Validate and sanitize description
    if (updates.description !== undefined) {
      const validation = validateDescription(updates.description);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
      updates.description = validation.sanitized;
    }

    // Build metadata updates
    const metadataUpdates = {};

    if (updates.task_category !== undefined) metadataUpdates.task_category = updates.task_category;
    if (updates.frequency_value !== undefined) metadataUpdates.frequency_value = updates.frequency_value;
    if (updates.frequency_type !== undefined) metadataUpdates.frequency_type = updates.frequency_type;
    if (updates.frequency_basis !== undefined) metadataUpdates.frequency_basis = updates.frequency_basis;
    if (updates.task_type !== undefined) metadataUpdates.task_type = updates.task_type;
    if (updates.is_recurring !== undefined) metadataUpdates.is_recurring = updates.is_recurring;
    if (updates.description !== undefined) metadataUpdates.description = updates.description;

    // Add review status with timestamp
    if (updates.review_status !== undefined) {
      metadataUpdates.review_status = updates.review_status;
      metadataUpdates.reviewed_at = new Date().toISOString();
      metadataUpdates.reviewed_by = 'user';
    }

    // Calculate frequency_hours if frequency changed
    if (updates.frequency_value !== undefined || updates.frequency_type !== undefined) {
      // Get existing task to merge values
      const existing = await maintenanceTasksRepository.getTaskById(taskId);
      if (!existing) {
        throw new Error(`Task ${taskId} not found`);
      }

      const val = updates.frequency_value !== undefined
        ? updates.frequency_value
        : existing.metadata.frequency_value;

      const type = updates.frequency_type !== undefined
        ? updates.frequency_type
        : existing.metadata.frequency_type;

      const hours = calculateFrequencyHours(val, type);
      if (hours !== null) {
        metadataUpdates.frequency_hours = hours;
      }
    }

    // Update in repository
    const result = await maintenanceTasksRepository.updateTaskMetadata(taskId, metadataUpdates);

    requestLogger.info('Task updated', { taskId, updates: metadataUpdates });

    return {
      taskId,
      updates: metadataUpdates
    };
  } catch (error) {
    requestLogger.error('Failed to update task', { taskId, error: error.message });
    throw error;
  }
}

/**
 * Delete a task
 * @param {string} taskId - Task ID
 * @returns {Promise<Object>} Deletion result
 */
export async function deleteTask(taskId) {
  try {
    requestLogger.info('Deleting task', { taskId });

    await maintenanceTasksRepository.deleteTask(taskId);

    requestLogger.info('Task deleted', { taskId });

    return {
      taskId,
      deleted: true
    };
  } catch (error) {
    requestLogger.error('Failed to delete task', { taskId, error: error.message });
    throw error;
  }
}

/**
 * Bulk update review status for multiple tasks
 * @param {Array<string>} taskIds - Array of task IDs
 * @param {string} reviewStatus - Review status (pending, approved, rejected)
 * @returns {Promise<Object>} Results with successful/failed counts
 */
export async function bulkUpdateStatus(taskIds, reviewStatus) {
  try {
    requestLogger.info('Bulk updating task status', { count: taskIds.length, status: reviewStatus });

    // Validate inputs
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      throw new Error('task_ids must be a non-empty array');
    }

    if (!VALID_REVIEW_STATUSES.includes(reviewStatus)) {
      throw new Error(`review_status must be one of: ${VALID_REVIEW_STATUSES.join(', ')}`);
    }

    // Prepare updates
    const updates = {
      review_status: reviewStatus,
      reviewed_at: new Date().toISOString(),
      reviewed_by: 'user'
    };

    // Bulk update via repository
    const results = await maintenanceTasksRepository.bulkUpdateTasks(taskIds, updates);

    requestLogger.info('Bulk update complete', {
      total: taskIds.length,
      successful: results.successful.length,
      failed: results.failed.length
    });

    return {
      total_requested: taskIds.length,
      successful: results.successful.length,
      failed: results.failed.length,
      failed_details: results.failed
    };
  } catch (error) {
    requestLogger.error('Failed to bulk update status', { error: error.message });
    throw error;
  }
}

/**
 * Get task statistics
 * @returns {Promise<Object>} Statistics
 */
export async function getStats() {
  try {
    requestLogger.info('Fetching task statistics');

    const stats = await maintenanceTasksRepository.getTaskStats();

    requestLogger.info('Stats calculated', stats);

    return stats;
  } catch (error) {
    requestLogger.error('Failed to get stats', { error: error.message });
    throw error;
  }
}

export default {
  getAllTasks,
  getTask,
  updateTask,
  deleteTask,
  bulkUpdateStatus,
  getStats
};
