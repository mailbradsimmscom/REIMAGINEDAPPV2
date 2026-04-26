/**
 * Guardianage Month Routes
 * Month view with all tasks grouped by week, monthly recurring, and major items.
 */

import express from 'express';
import { getSupabaseClient } from '../repositories/supabase.js';

const router = express.Router();

// GET /api/months — list all months for the active season
router.get('/', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();

    const { data: season } = await supabase
      .from('guardianage_seasons')
      .select('id')
      .eq('status', 'active')
      .maybeSingle();

    if (!season) {
      return res.json({ success: true, data: { months: [] } });
    }

    const { data: months } = await supabase
      .from('guardianage_months')
      .select('id, month_key, display_name, month_start_date, month_end_date, sort_order')
      .eq('season_id', season.id)
      .order('sort_order', { ascending: true });

    return res.json({ success: true, data: { months: months || [] } });
  } catch (error) {
    console.error('List months error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load months' });
  }
});

// GET /api/months/:monthId — full month view with tasks
router.get('/:monthId', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { monthId } = req.params;

    // Get month
    const { data: month, error: monthError } = await supabase
      .from('guardianage_months')
      .select('*')
      .eq('id', monthId)
      .single();

    if (monthError || !month) {
      return res.status(404).json({ success: false, error: 'Month not found' });
    }

    // Get weeks for this month
    const { data: weeks } = await supabase
      .from('guardianage_weeks')
      .select('*')
      .eq('month_id', monthId)
      .order('sort_order', { ascending: true });

    // Get all tasks for this month (exclude cancelled for team view)
    const { data: tasks } = await supabase
      .from('guardianage_tasks')
      .select('id, title, task_type, status, due_start_date, due_end_date, week_id, completed_at, completed_by_user_id, display_order')
      .eq('month_id', monthId)
      .neq('status', 'cancelled')
      .order('display_order', { ascending: true });

    // Compute overdue (AST)
    const now = new Date();
    const astNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const todayStr = astNow.toISOString().slice(0, 10);

    // Group tasks
    const weeklyByWeek = {};
    const monthlyRecurring = [];
    const majorItems = [];

    for (const task of (tasks || [])) {
      const isOverdue = task.status === 'open' && task.due_end_date && todayStr > task.due_end_date;
      const enriched = { ...task, is_overdue: isOverdue };

      if (task.task_type === 'weekly_recurring' && task.week_id) {
        if (!weeklyByWeek[task.week_id]) weeklyByWeek[task.week_id] = [];
        weeklyByWeek[task.week_id].push(enriched);
      } else if (task.task_type === 'monthly_recurring') {
        monthlyRecurring.push(enriched);
      } else if (task.task_type === 'monthly_major') {
        majorItems.push(enriched);
      }
    }

    // Build week summaries
    const weekSummaries = (weeks || []).map(week => {
      const weekTasks = weeklyByWeek[week.id] || [];
      const total = weekTasks.length;
      const complete = weekTasks.filter(t => t.status === 'complete').length;
      const hasOverdue = weekTasks.some(t => t.is_overdue);

      let weekStatus = 'empty';
      if (total > 0) {
        weekStatus = complete === total ? 'complete' : (hasOverdue ? 'attention' : 'incomplete');
      }

      return {
        ...week,
        tasks: weekTasks,
        status: weekStatus,
        total,
        complete,
      };
    });

    // Month status
    const allTasks = tasks || [];
    const totalActive = allTasks.length;
    const totalComplete = allTasks.filter(t => t.status === 'complete').length;
    const hasOverdue = allTasks.some(t => t.status === 'open' && t.due_end_date && todayStr > t.due_end_date);

    let monthStatus = 'empty';
    if (totalActive > 0) {
      monthStatus = totalComplete === totalActive ? 'complete' : (hasOverdue ? 'attention' : 'incomplete');
    }

    return res.json({
      success: true,
      data: {
        month,
        monthStatus,
        summary: { total: totalActive, complete: totalComplete, open: totalActive - totalComplete },
        weeks: weekSummaries,
        monthlyRecurring,
        majorItems,
      },
    });
  } catch (error) {
    console.error('Month view error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load month' });
  }
});

export default router;
