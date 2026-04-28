/**
 * Guardianage Admin Routes
 * User management, template management, audit/activity views.
 * All routes require admin role.
 */

import express from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { getSupabaseClient } from '../repositories/supabase.js';
import { hashPassword } from '../services/auth.service.js';
import { revokeAllUserSessions, writeAuditLog } from '../repositories/auth.repository.js';

const router = express.Router();

// All admin routes require admin role
router.use(requireAdmin);

// =========================================================================
// USER MANAGEMENT
// =========================================================================

// GET /api/admin/users — list all users
router.get('/users', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { data: users, error } = await supabase
      .from('guardianage_users')
      .select('id, login_id, display_name, role, is_active, last_login_at, created_at')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return res.json({ success: true, data: { users: users || [] } });
  } catch (error) {
    console.error('Admin list users error:', error);
    return res.status(500).json({ success: false, error: 'Failed to list users' });
  }
});

const CreateUserSchema = z.object({
  login_id: z.string().min(1, 'Login ID is required').max(50),
  password: z.string().min(4, 'Password must be at least 4 characters'),
  display_name: z.string().min(1, 'Display name is required').max(100),
  role: z.enum(['team_user', 'admin']),
});

// POST /api/admin/users — create new user
router.post('/users', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const parsed = CreateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid input' });
    }

    // Check uniqueness
    const { data: existing } = await supabase
      .from('guardianage_users')
      .select('id')
      .eq('login_id', parsed.data.login_id)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ success: false, error: 'Login ID already exists' });
    }

    const passwordHash = await hashPassword(parsed.data.password);

    const { data: user, error } = await supabase
      .from('guardianage_users')
      .insert({
        login_id: parsed.data.login_id,
        password_hash: passwordHash,
        display_name: parsed.data.display_name,
        role: parsed.data.role,
        is_active: true,
      })
      .select('id, login_id, display_name, role, is_active, created_at')
      .single();

    if (error) throw error;

    await writeAuditLog({
      actorUserId: req.guardianageUser.id,
      entityType: 'user',
      entityId: user.id,
      actionType: 'user_created',
      summary: `User created: ${parsed.data.login_id} (${parsed.data.role})`,
    });

    return res.json({ success: true, data: { user } });
  } catch (error) {
    console.error('Admin create user error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create user' });
  }
});

const UpdateUserSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  role: z.enum(['team_user', 'admin']).optional(),
  is_active: z.boolean().optional(),
});

// PATCH /api/admin/users/:userId — update user
router.patch('/users/:userId', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { userId } = req.params;
    const parsed = UpdateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid input' });
    }

    const updateData = { ...parsed.data, updated_at: new Date().toISOString() };

    const { data: user, error } = await supabase
      .from('guardianage_users')
      .update(updateData)
      .eq('id', userId)
      .select('id, login_id, display_name, role, is_active')
      .single();

    if (error) throw error;

    await writeAuditLog({
      actorUserId: req.guardianageUser.id,
      entityType: 'user',
      entityId: userId,
      actionType: 'user_updated',
      summary: `User updated: ${user.login_id}`,
      metadataJson: parsed.data,
    });

    return res.json({ success: true, data: { user } });
  } catch (error) {
    console.error('Admin update user error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

const ResetPasswordSchema = z.object({
  password: z.string().min(4, 'Password must be at least 4 characters'),
});

// POST /api/admin/users/:userId/reset-password
router.post('/users/:userId/reset-password', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { userId } = req.params;
    const parsed = ResetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid input' });
    }

    const passwordHash = await hashPassword(parsed.data.password);

    const { error } = await supabase
      .from('guardianage_users')
      .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) throw error;

    // Revoke all sessions — forces re-login
    await revokeAllUserSessions(userId);

    await writeAuditLog({
      actorUserId: req.guardianageUser.id,
      entityType: 'user',
      entityId: userId,
      actionType: 'password_reset',
      summary: 'Password reset by admin',
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Admin reset password error:', error);
    return res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
});

// PATCH /api/admin/users/:userId/deactivate
router.patch('/users/:userId/deactivate', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { userId } = req.params;

    // Prevent self-deactivation
    if (userId === req.guardianageUser.id) {
      return res.status(400).json({ success: false, error: 'Cannot deactivate your own account' });
    }

    const { error } = await supabase
      .from('guardianage_users')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) throw error;

    await revokeAllUserSessions(userId);

    await writeAuditLog({
      actorUserId: req.guardianageUser.id,
      entityType: 'user',
      entityId: userId,
      actionType: 'user_deactivated',
      summary: 'User deactivated',
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Admin deactivate user error:', error);
    return res.status(500).json({ success: false, error: 'Failed to deactivate user' });
  }
});

// =========================================================================
// TEMPLATE MANAGEMENT
// =========================================================================

// GET /api/admin/templates — list all templates
router.get('/templates', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { data: templates, error } = await supabase
      .from('guardianage_task_templates')
      .select('*')
      .order('task_type', { ascending: true })
      .order('display_order', { ascending: true });

    if (error) throw error;
    return res.json({ success: true, data: { templates: templates || [] } });
  } catch (error) {
    console.error('Admin list templates error:', error);
    return res.status(500).json({ success: false, error: 'Failed to list templates' });
  }
});

const CreateTemplateSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().optional(),
  task_type: z.enum(['weekly_recurring', 'monthly_recurring', 'monthly_major']),
  default_instructions: z.string().optional(),
  target_month_id: z.string().uuid().optional(), // required for monthly_major
});

// POST /api/admin/templates — create template + auto-propagate
router.post('/templates', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const parsed = CreateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid input' });
    }

    // Get max display_order for this type
    const { data: maxRow } = await supabase
      .from('guardianage_task_templates')
      .select('display_order')
      .eq('task_type', parsed.data.task_type)
      .order('display_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextOrder = (maxRow?.display_order || 0) + 1;

    const { data: template, error } = await supabase
      .from('guardianage_task_templates')
      .insert({
        title: parsed.data.title,
        description: parsed.data.description || null,
        task_type: parsed.data.task_type,
        default_instructions: parsed.data.default_instructions || null,
        is_active: true,
        display_order: nextOrder,
      })
      .select()
      .single();

    if (error) throw error;

    // Auto-propagate: create task instances for current + future periods
    const instanceCount = await propagateTemplate(supabase, template, parsed.data.target_month_id);

    await writeAuditLog({
      actorUserId: req.guardianageUser.id,
      entityType: 'template',
      entityId: template.id,
      actionType: 'template_created',
      summary: `Template created: ${parsed.data.title} (${parsed.data.task_type}), ${instanceCount} tasks propagated`,
    });

    return res.json({ success: true, data: { template, instancesCreated: instanceCount } });
  } catch (error) {
    console.error('Admin create template error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create template' });
  }
});

const UpdateTemplateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  default_instructions: z.string().optional(),
});

// PATCH /api/admin/templates/:templateId — update template metadata
router.patch('/templates/:templateId', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { templateId } = req.params;
    const parsed = UpdateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid input' });
    }

    const { data: template, error } = await supabase
      .from('guardianage_task_templates')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', templateId)
      .select()
      .single();

    if (error) throw error;

    // Propagate changes to open task instances
    const taskUpdate = {};
    if (parsed.data.title) taskUpdate.title = parsed.data.title;
    if (parsed.data.default_instructions !== undefined) taskUpdate.instructions = parsed.data.default_instructions;
    if (Object.keys(taskUpdate).length > 0) {
      taskUpdate.updated_at = new Date().toISOString();
      const { data: updated } = await supabase
        .from('guardianage_tasks')
        .update(taskUpdate)
        .eq('task_template_id', templateId)
        .eq('status', 'open')
        .select('id');

      var tasksUpdated = updated?.length || 0;
    }

    await writeAuditLog({
      actorUserId: req.guardianageUser.id,
      entityType: 'template',
      entityId: templateId,
      actionType: 'template_updated',
      summary: `Template updated: ${template.title}${tasksUpdated ? `, ${tasksUpdated} tasks updated` : ''}`,
    });

    return res.json({ success: true, data: { template, tasksUpdated: tasksUpdated || 0 } });
  } catch (error) {
    console.error('Admin update template error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update template' });
  }
});

// POST /api/admin/templates/:templateId/deactivate — soft-cancel future instances
router.post('/templates/:templateId/deactivate', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { templateId } = req.params;

    // Deactivate the template
    const { data: template, error: tplError } = await supabase
      .from('guardianage_task_templates')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', templateId)
      .select()
      .single();

    if (tplError) throw tplError;

    // Soft-cancel open tasks in current + future weeks/months
    const now = new Date();
    const astNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const todayStr = astNow.toISOString().slice(0, 10);

    // Cancel open tasks whose due window hasn't ended yet (current + future)
    const { data: cancelled, error: cancelError } = await supabase
      .from('guardianage_tasks')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('task_template_id', templateId)
      .eq('status', 'open')
      .gte('due_end_date', todayStr)
      .select('id');

    if (cancelError) throw cancelError;

    const cancelledCount = cancelled?.length || 0;

    await writeAuditLog({
      actorUserId: req.guardianageUser.id,
      entityType: 'template',
      entityId: templateId,
      actionType: 'template_deactivated',
      summary: `Template deactivated: ${template.title}, ${cancelledCount} tasks cancelled`,
    });

    return res.json({ success: true, data: { template, tasksCancelled: cancelledCount } });
  } catch (error) {
    console.error('Admin deactivate template error:', error);
    return res.status(500).json({ success: false, error: 'Failed to deactivate template' });
  }
});

// =========================================================================
// AUDIT / ACTIVITY
// =========================================================================

// GET /api/admin/audit — paginated audit log
router.get('/audit', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const entityType = req.query.entity_type || null;
    const actionType = req.query.action_type || null;

    let query = supabase
      .from('guardianage_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (entityType) query = query.eq('entity_type', entityType);
    if (actionType) query = query.eq('action_type', actionType);

    const { data: entries, error } = await query;
    if (error) throw error;

    // Resolve actor names
    const actorIds = [...new Set((entries || []).map(e => e.actor_user_id).filter(Boolean))];
    const actorMap = {};
    if (actorIds.length > 0) {
      const { data: users } = await supabase
        .from('guardianage_users')
        .select('id, display_name')
        .in('id', actorIds);
      for (const u of (users || [])) actorMap[u.id] = u.display_name;
    }

    const enriched = (entries || []).map(e => ({
      ...e,
      actor_name: actorMap[e.actor_user_id] || null,
    }));

    return res.json({ success: true, data: { entries: enriched, limit, offset } });
  } catch (error) {
    console.error('Admin audit error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load audit log' });
  }
});

// GET /api/admin/task-events — all task events across all tasks
router.get('/task-events', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const { data: events, error } = await supabase
      .from('guardianage_task_events')
      .select('*')
      .order('occurred_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Resolve actor names and task titles
    const actorIds = [...new Set((events || []).map(e => e.actor_user_id).filter(Boolean))];
    const taskIds = [...new Set((events || []).map(e => e.task_id).filter(Boolean))];

    const actorMap = {};
    if (actorIds.length > 0) {
      const { data: users } = await supabase
        .from('guardianage_users')
        .select('id, display_name')
        .in('id', actorIds);
      for (const u of (users || [])) actorMap[u.id] = u.display_name;
    }

    const taskMap = {};
    if (taskIds.length > 0) {
      const { data: tasks } = await supabase
        .from('guardianage_tasks')
        .select('id, title')
        .in('id', taskIds);
      for (const t of (tasks || [])) taskMap[t.id] = t.title;
    }

    const enriched = (events || []).map(e => ({
      ...e,
      actor_name: actorMap[e.actor_user_id] || null,
      task_title: taskMap[e.task_id] || null,
    }));

    return res.json({ success: true, data: { events: enriched, limit, offset } });
  } catch (error) {
    console.error('Admin task events error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load task events' });
  }
});

// =========================================================================
// HELPERS
// =========================================================================

/**
 * Auto-propagate a new template into task instances for current + future periods.
 * For weekly_recurring: create one task per current/future week.
 * For monthly_recurring: create one task per current/future month.
 * For monthly_major: create one task for the target month only.
 */
async function propagateTemplate(supabase, template, targetMonthId) {
  const now = new Date();
  const astNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const todayStr = astNow.toISOString().slice(0, 10);

  // Get active season
  const { data: season } = await supabase
    .from('guardianage_seasons')
    .select('id')
    .eq('status', 'active')
    .maybeSingle();

  if (!season) return 0;

  let created = 0;

  if (template.task_type === 'weekly_recurring') {
    // Get all current + future weeks
    const { data: weeks } = await supabase
      .from('guardianage_weeks')
      .select('id, month_id, week_start_date, week_end_date, display_name')
      .gte('week_end_date', todayStr)
      .order('week_start_date', { ascending: true });

    // Get month info for season_id lookup
    const monthIds = [...new Set((weeks || []).map(w => w.month_id))];
    const { data: months } = await supabase
      .from('guardianage_months')
      .select('id, season_id')
      .in('id', monthIds)
      .eq('season_id', season.id);
    const validMonthIds = new Set((months || []).map(m => m.id));

    for (const week of (weeks || [])) {
      if (!validMonthIds.has(week.month_id)) continue;

      // Check if task already exists for this template + week
      const { data: existing } = await supabase
        .from('guardianage_tasks')
        .select('id')
        .eq('task_template_id', template.id)
        .eq('week_id', week.id)
        .maybeSingle();

      if (!existing) {
        await supabase.from('guardianage_tasks').insert({
          season_id: season.id,
          month_id: week.month_id,
          week_id: week.id,
          task_template_id: template.id,
          task_type: 'weekly_recurring',
          title: template.title,
          instructions: template.default_instructions || null,
          status: 'open',
          due_start_date: week.week_start_date,
          due_end_date: week.week_end_date,
          display_order: template.display_order,
        });
        created++;
      }
    }
  } else if (template.task_type === 'monthly_recurring') {
    // Get all current + future months
    const { data: months } = await supabase
      .from('guardianage_months')
      .select('id, season_id, month_start_date, month_end_date')
      .eq('season_id', season.id)
      .gte('month_end_date', todayStr)
      .order('sort_order', { ascending: true });

    for (const month of (months || [])) {
      const { data: existing } = await supabase
        .from('guardianage_tasks')
        .select('id')
        .eq('task_template_id', template.id)
        .eq('month_id', month.id)
        .is('week_id', null)
        .maybeSingle();

      if (!existing) {
        await supabase.from('guardianage_tasks').insert({
          season_id: season.id,
          month_id: month.id,
          week_id: null,
          task_template_id: template.id,
          task_type: 'monthly_recurring',
          title: template.title,
          instructions: template.default_instructions || null,
          status: 'open',
          due_start_date: month.month_start_date,
          due_end_date: month.month_end_date,
          display_order: template.display_order,
        });
        created++;
      }
    }
  } else if (template.task_type === 'monthly_major' && targetMonthId) {
    // Major items: create for the specified target month only
    const { data: month } = await supabase
      .from('guardianage_months')
      .select('id, season_id, month_start_date, month_end_date')
      .eq('id', targetMonthId)
      .eq('season_id', season.id)
      .maybeSingle();

    if (month) {
      const { data: existing } = await supabase
        .from('guardianage_tasks')
        .select('id')
        .eq('task_template_id', template.id)
        .eq('month_id', month.id)
        .maybeSingle();

      if (!existing) {
        await supabase.from('guardianage_tasks').insert({
          season_id: season.id,
          month_id: month.id,
          week_id: null,
          task_template_id: template.id,
          task_type: 'monthly_major',
          title: template.title,
          instructions: template.default_instructions || null,
          status: 'open',
          due_start_date: month.month_start_date,
          due_end_date: month.month_end_date,
          display_order: template.display_order,
        });
        created++;
      }
    }
  }

  return created;
}

export default router;
