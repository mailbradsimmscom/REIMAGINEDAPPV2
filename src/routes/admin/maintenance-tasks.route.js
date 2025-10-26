/**
 * Maintenance Tasks Routes
 * API endpoints for browsing maintenance tasks
 *
 * Architecture: Route → Service → Repository
 * This file handles HTTP concerns only (validation, responses)
 */

import express from 'express';
import { logger } from '../../utils/logger.js';
import maintenanceTasksService from '../../services/maintenance-tasks.service.js';

const router = express.Router();

/**
 * GET /admin/api/maintenance-tasks/list
 * Get all maintenance tasks
 */
router.get('/list', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();

  try {
    requestLogger.info('Fetching all maintenance tasks');

    const result = await maintenanceTasksService.getAllTasks();

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    requestLogger.error('Error fetching tasks', { error: error.message });
    return next(error);
  }
});

/**
 * GET /admin/api/maintenance-tasks/:taskId
 * Get a single task by ID
 */
router.get('/:taskId', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();
  const { taskId } = req.params;

  try {
    requestLogger.info('Fetching single task', { taskId });

    const task = await maintenanceTasksService.getTask(taskId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TASK_NOT_FOUND',
          message: `Task ${taskId} not found`
        }
      });
    }

    return res.json({
      success: true,
      data: task
    });
  } catch (error) {
    requestLogger.error('Error fetching task', { taskId, error: error.message });
    return next(error);
  }
});

/**
 * PATCH /admin/api/maintenance-tasks/:taskId
 * Update task metadata (category, frequency, basis, type, description)
 */
router.patch('/:taskId', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();
  const { taskId } = req.params;
  const {
    description,
    task_category,
    frequency_value,
    frequency_type,
    frequency_basis,
    task_type,
    is_recurring,
    review_status
  } = req.body;

  try {
    requestLogger.info('Updating task metadata', { taskId, updates: req.body });

    const result = await maintenanceTasksService.updateTask(taskId, {
      description,
      task_category,
      frequency_value,
      frequency_type,
      frequency_basis,
      task_type,
      is_recurring,
      review_status
    });

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    // Handle validation errors with 400
    if (error.message.includes('Invalid') || error.message.includes('must be') || error.message.includes('cannot be')) {
      requestLogger.warn('Validation error', { taskId, error: error.message });
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message
        }
      });
    }

    // Handle not found errors with 404
    if (error.message.includes('not found')) {
      requestLogger.warn('Task not found', { taskId });
      return res.status(404).json({
        success: false,
        error: {
          code: 'TASK_NOT_FOUND',
          message: `Task ${taskId} not found`
        }
      });
    }

    requestLogger.error('Error updating task', { taskId, error: error.message });
    return next(error);
  }
});

/**
 * DELETE /admin/api/maintenance-tasks/:taskId
 * Delete a task
 */
router.delete('/:taskId', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();
  const { taskId } = req.params;

  try {
    requestLogger.info('Deleting task', { taskId });

    const result = await maintenanceTasksService.deleteTask(taskId);

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    requestLogger.error('Error deleting task', { taskId, error: error.message });
    return next(error);
  }
});

/**
 * POST /admin/api/maintenance-tasks/bulk-update-status
 * Bulk update review status for multiple tasks
 */
router.post('/bulk-update-status', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();
  const { task_ids, review_status } = req.body;

  try {
    requestLogger.info('Bulk updating task status', { count: task_ids?.length, status: review_status });

    const result = await maintenanceTasksService.bulkUpdateStatus(task_ids, review_status);

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    // Handle validation errors with 400
    if (error.message.includes('must be') || error.message.includes('Invalid')) {
      requestLogger.warn('Validation error', { error: error.message });
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message
        }
      });
    }

    requestLogger.error('Error bulk updating status', { error: error.message });
    return next(error);
  }
});

/**
 * GET /admin/api/maintenance-tasks/stats
 * Get review status statistics
 */
router.get('/stats', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();

  try {
    requestLogger.info('Fetching task statistics');

    const stats = await maintenanceTasksService.getStats();

    return res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    requestLogger.error('Error fetching stats', { error: error.message });
    return next(error);
  }
});

export default router;
