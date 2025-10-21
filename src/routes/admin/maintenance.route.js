import express from 'express';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();
const requestLogger = logger.createRequestLogger();

// GET /admin/maintenance/tasks - Get pending maintenance tasks
router.get('/tasks', async (req, res, next) => {
  try {
    const { status = 'pending', limit = 100 } = req.query;

    const supabase = await getSupabaseClient();

    const { data: tasks, error } = await supabase
      .from('maintenance_tasks_queue')
      .select('*')
      .eq('status', status)
      .order('confidence', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) {
      requestLogger.error('Failed to fetch maintenance tasks', { error: error.message });
      return res.status(500).json({
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: error.message
        }
      });
    }

    requestLogger.info('Fetched maintenance tasks', { count: tasks.length, status });

    return res.json({
      success: true,
      data: {
        tasks,
        count: tasks.length
      }
    });
  } catch (e) {
    return next(e);
  }
});

// GET /admin/maintenance/stats - Get statistics
router.get('/stats', async (req, res, next) => {
  try {
    const supabase = await getSupabaseClient();

    // Get counts by status
    const { data: statusCounts, error: statusError } = await supabase
      .from('maintenance_tasks_queue')
      .select('status')
      .then(({ data }) => {
        const counts = {
          pending: 0,
          approved: 0,
          rejected: 0,
          total: data?.length || 0
        };
        data?.forEach(task => {
          counts[task.status] = (counts[task.status] || 0) + 1;
        });
        return { data: counts, error: null };
      });

    // Get counts by criticality (pending only)
    const { data: criticalityCounts, error: critError } = await supabase
      .from('maintenance_tasks_queue')
      .select('criticality')
      .eq('status', 'pending')
      .then(({ data }) => {
        const counts = {};
        data?.forEach(task => {
          counts[task.criticality] = (counts[task.criticality] || 0) + 1;
        });
        return { data: counts, error: null };
      });

    // Get counts by system (pending only)
    const { data: systemCounts, error: sysError } = await supabase
      .from('maintenance_tasks_queue')
      .select('system_name')
      .eq('status', 'pending')
      .then(({ data }) => {
        const counts = {};
        data?.forEach(task => {
          if (task.system_name) {
            counts[task.system_name] = (counts[task.system_name] || 0) + 1;
          }
        });
        return { data: counts, error: null };
      });

    if (statusError || critError || sysError) {
      const error = statusError || critError || sysError;
      requestLogger.error('Failed to fetch maintenance stats', { error: error.message });
      return res.status(500).json({
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: error.message
        }
      });
    }

    return res.json({
      success: true,
      data: {
        byStatus: statusCounts,
        byCriticality: criticalityCounts,
        bySystem: systemCounts
      }
    });
  } catch (e) {
    return next(e);
  }
});

// POST /admin/maintenance/tasks/:id/approve - Approve a task
router.post('/tasks/:id/approve', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const supabase = await getSupabaseClient();

    const { data, error } = await supabase
      .from('maintenance_tasks_queue')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: 'admin', // TODO: Get from auth when available
        review_notes: notes || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      requestLogger.error('Failed to approve task', { taskId: id, error: error.message });
      return res.status(500).json({
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: error.message
        }
      });
    }

    requestLogger.info('Task approved', { taskId: id });

    return res.json({
      success: true,
      data: { task: data }
    });
  } catch (e) {
    return next(e);
  }
});

// POST /admin/maintenance/tasks/:id/reject - Reject a task
router.post('/tasks/:id/reject', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Rejection reason is required'
        }
      });
    }

    const supabase = await getSupabaseClient();

    const { data, error } = await supabase
      .from('maintenance_tasks_queue')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: 'admin', // TODO: Get from auth when available
        review_notes: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      requestLogger.error('Failed to reject task', { taskId: id, error: error.message });
      return res.status(500).json({
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: error.message
        }
      });
    }

    requestLogger.info('Task rejected', { taskId: id, reason });

    return res.json({
      success: true,
      data: { task: data }
    });
  } catch (e) {
    return next(e);
  }
});

export default router;
