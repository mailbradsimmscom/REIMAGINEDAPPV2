/**
 * Maintenance Tasks Repository
 * Direct Pinecone operations for MAINTENANCE_TASKS namespace
 *
 * This repository uses Pinecone SDK directly (not sidecar proxy)
 * to manage maintenance task vectors in the MAINTENANCE_TASKS namespace.
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';

class MaintenanceTasksRepository {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
    const env = getEnv();
    this.pinecone = new Pinecone({ apiKey: env.PINECONE_API_KEY });
    this.indexName = env.PINECONE_INDEX;
    this.namespace = 'MAINTENANCE_TASKS';
  }

  /**
   * Get Pinecone index and namespace
   * @private
   * @returns {Object} Pinecone namespace object
   */
  _getNamespace() {
    const index = this.pinecone.index(this.indexName);
    return index.namespace(this.namespace);
  }

  /**
   * List all maintenance tasks with pagination
   * @returns {Promise<Array>} Array of task records
   */
  async listAllTasks() {
    try {
      this.requestLogger.debug('Listing all maintenance tasks');

      const namespace = this._getNamespace();
      let allVectors = [];
      let paginationToken = undefined;

      // Paginate through all vectors
      do {
        const listResponse = await namespace.listPaginated({
          prefix: 'task-',
          limit: 100,
          paginationToken
        });

        if (listResponse.vectors) {
          allVectors.push(...listResponse.vectors);
        }

        paginationToken = listResponse.pagination?.next;
      } while (paginationToken);

      // Fetch full records with metadata
      const fetchResponse = await namespace.fetch(allVectors.map(v => v.id));
      const records = Object.values(fetchResponse.records || {});

      this.requestLogger.debug('Listed all maintenance tasks', { count: records.length });

      return records;
    } catch (error) {
      this.requestLogger.error('Failed to list maintenance tasks', { error: error.message });
      throw error;
    }
  }

  /**
   * Get a single task by ID
   * @param {string} taskId - Task ID
   * @returns {Promise<Object|null>} Task record or null if not found
   */
  async getTaskById(taskId) {
    try {
      this.requestLogger.debug('Fetching task by ID', { taskId });

      const namespace = this._getNamespace();
      const fetchResponse = await namespace.fetch([taskId]);
      const record = fetchResponse.records[taskId];

      if (!record) {
        this.requestLogger.debug('Task not found', { taskId });
        return null;
      }

      this.requestLogger.debug('Task fetched', { taskId });
      return record;
    } catch (error) {
      this.requestLogger.error('Failed to fetch task', { taskId, error: error.message });
      throw error;
    }
  }

  /**
   * Update task metadata
   * @param {string} taskId - Task ID
   * @param {Object} updates - Metadata updates to apply
   * @returns {Promise<Object>} Updated record
   */
  async updateTaskMetadata(taskId, updates) {
    try {
      this.requestLogger.debug('Updating task metadata', { taskId, updates });

      const namespace = this._getNamespace();

      // Fetch existing task
      const existing = await this.getTaskById(taskId);
      if (!existing) {
        throw new Error(`Task ${taskId} not found`);
      }

      // Merge updates with existing metadata
      const updatedMetadata = {
        ...existing.metadata,
        ...updates,
        updated_at: new Date().toISOString()
      };

      // Upsert with updated metadata (keep original vectors)
      await namespace.upsert([{
        id: taskId,
        values: existing.values,
        metadata: updatedMetadata
      }]);

      this.requestLogger.info('Task metadata updated', { taskId, updates });

      return {
        id: taskId,
        metadata: updatedMetadata
      };
    } catch (error) {
      this.requestLogger.error('Failed to update task metadata', { taskId, error: error.message });
      throw error;
    }
  }

  /**
   * Delete a task
   * @param {string} taskId - Task ID
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteTask(taskId) {
    try {
      this.requestLogger.debug('Deleting task', { taskId });

      const namespace = this._getNamespace();
      await namespace.deleteOne(taskId);

      this.requestLogger.info('Task deleted', { taskId });
      return true;
    } catch (error) {
      this.requestLogger.error('Failed to delete task', { taskId, error: error.message });
      throw error;
    }
  }

  /**
   * Bulk update task statuses
   * @param {Array<string>} taskIds - Array of task IDs
   * @param {Object} updates - Updates to apply to all tasks (e.g., { review_status: 'approved' })
   * @returns {Promise<Object>} Results with successful and failed arrays
   */
  async bulkUpdateTasks(taskIds, updates) {
    try {
      this.requestLogger.debug('Bulk updating tasks', { count: taskIds.length, updates });

      const namespace = this._getNamespace();
      const results = { successful: [], failed: [] };

      for (const taskId of taskIds) {
        try {
          const existing = await this.getTaskById(taskId);

          if (!existing) {
            results.failed.push({ taskId, error: 'Task not found' });
            continue;
          }

          const updatedMetadata = {
            ...existing.metadata,
            ...updates,
            updated_at: new Date().toISOString()
          };

          await namespace.upsert([{
            id: taskId,
            values: existing.values,
            metadata: updatedMetadata
          }]);

          results.successful.push(taskId);
        } catch (error) {
          results.failed.push({ taskId, error: error.message });
        }
      }

      this.requestLogger.info('Bulk update complete', {
        total: taskIds.length,
        successful: results.successful.length,
        failed: results.failed.length
      });

      return results;
    } catch (error) {
      this.requestLogger.error('Failed to bulk update tasks', { error: error.message });
      throw error;
    }
  }

  /**
   * Get task statistics (counts by review status)
   * @returns {Promise<Object>} Statistics object
   */
  async getTaskStats() {
    try {
      this.requestLogger.debug('Fetching task statistics');

      const records = await this.listAllTasks();

      const stats = {
        total: records.length,
        pending: records.filter(r => (r.metadata.review_status || 'pending') === 'pending').length,
        approved: records.filter(r => r.metadata.review_status === 'approved').length,
        rejected: records.filter(r => r.metadata.review_status === 'rejected').length
      };

      this.requestLogger.debug('Task statistics calculated', stats);

      return stats;
    } catch (error) {
      this.requestLogger.error('Failed to get task statistics', { error: error.message });
      throw error;
    }
  }
}

export default new MaintenanceTasksRepository();
