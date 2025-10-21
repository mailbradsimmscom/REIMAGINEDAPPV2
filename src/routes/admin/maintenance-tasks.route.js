/**
 * Maintenance Tasks Routes
 * API endpoints for browsing maintenance tasks
 */

import express from 'express';
import { Pinecone } from '@pinecone-database/pinecone';
import { logger } from '../../utils/logger.js';
import { getEnv } from '../../config/env.js';

const router = express.Router();

const env = getEnv();
const pinecone = new Pinecone({ apiKey: env.PINECONE_API_KEY });

/**
 * GET /admin/api/maintenance-tasks/list
 * Get all maintenance tasks from Pinecone
 */
router.get('/list', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();

  try {
    requestLogger.info('Fetching all maintenance tasks');

    // Fetch all tasks from Pinecone directly
    const index = pinecone.index(env.PINECONE_INDEX);
    const namespace = index.namespace('MAINTENANCE_TASKS');

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

    // Fetch full records with embeddings
    const fetchResponse = await namespace.fetch(allVectors.map(v => v.id));
    const records = Object.values(fetchResponse.records || {});

    // Transform to simpler format
    const tasks = records.map(record => ({
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
      task_category_confidence: record.metadata.task_category_confidence ?? null
    }));

    requestLogger.info('Fetched tasks', { count: tasks.length });

    return res.json({
      success: true,
      data: {
        tasks,
        total: tasks.length
      }
    });
  } catch (error) {
    requestLogger.error('Error fetching tasks', { error: error.message });
    return next(error);
  }
});

/**
 * PATCH /admin/api/maintenance-tasks/:taskId
 * Update task metadata (category, frequency, basis, type)
 */
router.patch('/:taskId', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();
  const { taskId } = req.params;
  const {
    task_category,
    frequency_value,
    frequency_type,
    frequency_basis,
    task_type
  } = req.body;

  try {
    requestLogger.info('Updating task metadata', { taskId, updates: req.body });

    // Validate category if provided
    if (task_category) {
      const validCategories = ['MAINTENANCE', 'INSTALLATION', 'PRE_USE_CHECK', 'VAGUE'];
      if (!validCategories.includes(task_category)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_CATEGORY',
            message: `Invalid category. Must be one of: ${validCategories.join(', ')}`
          }
        });
      }
    }

    // Validate frequency_basis if provided
    if (frequency_basis) {
      const validBasis = ['calendar', 'usage', 'event', 'condition', 'unknown'];
      if (!validBasis.includes(frequency_basis)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_BASIS',
            message: `Invalid basis. Must be one of: ${validBasis.join(', ')}`
          }
        });
      }
    }

    // Validate frequency_type if provided
    if (frequency_type) {
      const validTypes = ['hours', 'days', 'weeks', 'months', 'years'];
      if (!validTypes.includes(frequency_type)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_FREQUENCY_TYPE',
            message: `Invalid frequency type. Must be one of: ${validTypes.join(', ')}`
          }
        });
      }
    }

    // Get the index
    const index = pinecone.index(env.PINECONE_INDEX);
    const namespace = index.namespace('MAINTENANCE_TASKS');

    // Fetch existing task
    const fetchResponse = await namespace.fetch([taskId]);
    const existing = fetchResponse.records[taskId];

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TASK_NOT_FOUND',
          message: `Task ${taskId} not found`
        }
      });
    }

    // Build updates object (only include provided fields)
    const updates = {};
    if (task_category !== undefined) updates.task_category = task_category;
    if (frequency_value !== undefined) updates.frequency_value = frequency_value;
    if (frequency_type !== undefined) updates.frequency_type = frequency_type;
    if (frequency_basis !== undefined) updates.frequency_basis = frequency_basis;
    if (task_type !== undefined) updates.task_type = task_type;

    // Calculate frequency_hours if frequency changed
    if (frequency_value !== undefined || frequency_type !== undefined) {
      const val = frequency_value !== undefined ? frequency_value : existing.metadata.frequency_value;
      const type = frequency_type !== undefined ? frequency_type : existing.metadata.frequency_type;

      if (val && type) {
        const conversions = {
          'hours': 1,
          'days': 24,
          'weeks': 168,
          'months': 730,
          'years': 8760
        };
        updates.frequency_hours = val * (conversions[type] || 1);
      }
    }

    // Update metadata
    const updatedMetadata = {
      ...existing.metadata,
      ...updates,
      updated_at: new Date().toISOString()
    };

    // Upsert with updated metadata
    await namespace.upsert([{
      id: taskId,
      values: existing.values,
      metadata: updatedMetadata
    }]);

    requestLogger.info('Task metadata updated', { taskId, updates });

    return res.json({
      success: true,
      data: {
        taskId,
        updates
      }
    });
  } catch (error) {
    requestLogger.error('Error updating task', { taskId, error: error.message });
    return next(error);
  }
});

/**
 * DELETE /admin/api/maintenance-tasks/:taskId
 * Delete a task from Pinecone
 */
router.delete('/:taskId', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();
  const { taskId } = req.params;

  try {
    requestLogger.info('Deleting task', { taskId });

    // Get the index
    const index = pinecone.index(env.PINECONE_INDEX);
    const namespace = index.namespace('MAINTENANCE_TASKS');

    // Delete the task
    await namespace.deleteOne(taskId);

    requestLogger.info('Task deleted', { taskId });

    return res.json({
      success: true,
      data: {
        taskId,
        deleted: true
      }
    });
  } catch (error) {
    requestLogger.error('Error deleting task', { taskId, error: error.message });
    return next(error);
  }
});

export default router;
