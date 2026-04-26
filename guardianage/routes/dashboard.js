/**
 * Guardianage Dashboard Route
 * Returns current season overview data.
 */

import express from 'express';
import { getSupabaseClient } from '../repositories/supabase.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();

    // Get active season
    const { data: season } = await supabase
      .from('guardianage_seasons')
      .select('*')
      .eq('status', 'active')
      .maybeSingle();

    if (!season) {
      return res.json({ success: true, data: { season: null, message: 'No active season' } });
    }

    // Get all months for this season
    const { data: months } = await supabase
      .from('guardianage_months')
      .select('*')
      .eq('season_id', season.id)
      .order('sort_order', { ascending: true });

    // Find current month based on today in AST (UTC-4)
    const now = new Date();
    const astNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const todayStr = astNow.toISOString().slice(0, 10);

    let currentMonth = months?.find(m =>
      todayStr >= m.month_start_date && todayStr <= m.month_end_date
    );

    // Outside season: show nearest month
    if (!currentMonth && months?.length > 0) {
      if (todayStr < months[0].month_start_date) {
        currentMonth = months[0];
      } else {
        currentMonth = months[months.length - 1];
      }
    }

    // Get current week
    let currentWeek = null;
    if (currentMonth) {
      const { data: weeks } = await supabase
        .from('guardianage_weeks')
        .select('*')
        .eq('month_id', currentMonth.id)
        .order('sort_order', { ascending: true });

      currentWeek = weeks?.find(w =>
        todayStr >= w.week_start_date && todayStr <= w.week_end_date
      );

      // If outside all weeks in current month, show first or last
      if (!currentWeek && weeks?.length > 0) {
        if (todayStr < weeks[0].week_start_date) {
          currentWeek = weeks[0];
        } else {
          currentWeek = weeks[weeks.length - 1];
        }
      }
    }

    // Get tasks for current month
    const { data: tasks } = currentMonth
      ? await supabase
          .from('guardianage_tasks')
          .select('id, title, task_type, status, due_start_date, due_end_date, week_id')
          .eq('month_id', currentMonth.id)
          .neq('status', 'cancelled')
          .order('display_order', { ascending: true })
      : { data: [] };

    // Categorize tasks
    const weeklyTasks = tasks?.filter(t => t.task_type === 'weekly_recurring' && t.week_id === currentWeek?.id) || [];
    const monthlyTasks = tasks?.filter(t => t.task_type === 'monthly_recurring') || [];
    const majorItems = tasks?.filter(t => t.task_type === 'monthly_major') || [];

    // Calculate overdue (AST)
    const overdueTasks = tasks?.filter(t =>
      t.status === 'open' && t.due_end_date && todayStr > t.due_end_date
    ) || [];

    return res.json({
      success: true,
      data: {
        season: { id: season.id, name: season.name, status: season.status },
        currentMonth: currentMonth ? { id: currentMonth.id, display_name: currentMonth.display_name, month_key: currentMonth.month_key } : null,
        currentWeek: currentWeek ? { id: currentWeek.id, display_name: currentWeek.display_name } : null,
        weeklyTasksDue: weeklyTasks,
        monthlyTasksOpen: monthlyTasks.filter(t => t.status === 'open'),
        majorItemsOpen: majorItems.filter(t => t.status === 'open'),
        overdueTasks,
        summary: {
          totalTasks: tasks?.length || 0,
          completedTasks: tasks?.filter(t => t.status === 'complete').length || 0,
          openTasks: tasks?.filter(t => t.status === 'open').length || 0,
          overdueCount: overdueTasks.length,
        },
      },
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load dashboard' });
  }
});

export default router;
