/**
 * Guardianage Task Routes
 * Task detail, completion, reopening, events.
 */

import express from 'express';
import { z } from 'zod';
import multer from 'multer';
import { getSupabaseClient } from '../repositories/supabase.js';
import { uploadTaskPhoto, softDeletePhoto, resolvePublicUrl } from '../services/photo.service.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// GET /api/tasks/:taskId — task detail with events
router.get('/:taskId', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { taskId } = req.params;

    const { data: task, error } = await supabase
      .from('guardianage_tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (error || !task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // Get events
    const { data: events } = await supabase
      .from('guardianage_task_events')
      .select('*')
      .eq('task_id', taskId)
      .order('occurred_at', { ascending: true });

    // Get photos (non-deleted)
    const { data: photos } = await supabase
      .from('guardianage_task_photos')
      .select('*')
      .eq('task_id', taskId)
      .or('is_deleted.is.null,is_deleted.eq.false')
      .order('uploaded_at', { ascending: true });

    // Resolve public URLs for photos
    const photosWithUrls = (photos || []).map(p => ({
      ...p,
      url: resolvePublicUrl(p.storage_bucket, p.storage_path),
    }));

    return res.json({
      success: true,
      data: {
        task,
        events: events || [],
        photos: photosWithUrls,
      },
    });
  } catch (error) {
    console.error('Task detail error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load task' });
  }
});

const CompleteSchema = z.object({
  note: z.string().optional(),
});

// POST /api/tasks/:taskId/complete
router.post('/:taskId/complete', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { taskId } = req.params;
    const user = req.guardianageUser;
    const parsed = CompleteSchema.safeParse(req.body);

    const { data: task, error: taskError } = await supabase
      .from('guardianage_tasks')
      .select('id, status, task_type')
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    if (task.status === 'complete') {
      return res.status(400).json({ success: false, error: 'Task is already complete' });
    }

    if (task.status === 'cancelled') {
      return res.status(400).json({ success: false, error: 'Cannot complete a cancelled task' });
    }

    const now = new Date().toISOString();

    // Update task
    const { error: updateError } = await supabase
      .from('guardianage_tasks')
      .update({
        status: 'complete',
        completed_at: now,
        completed_by_user_id: user.id,
        updated_at: now,
      })
      .eq('id', taskId);

    if (updateError) throw new Error(`Failed to complete task: ${updateError.message}`);

    // Create event
    await supabase
      .from('guardianage_task_events')
      .insert({
        task_id: taskId,
        actor_user_id: user.id,
        event_type: 'completed',
        note_text: parsed.data?.note || null,
        occurred_at: now,
      });

    return res.json({ success: true, data: { task_id: taskId, status: 'complete' } });
  } catch (error) {
    console.error('Complete task error:', error);
    return res.status(500).json({ success: false, error: 'Failed to complete task' });
  }
});

// POST /api/tasks/:taskId/reopen
router.post('/:taskId/reopen', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { taskId } = req.params;
    const user = req.guardianageUser;

    const { data: task, error: taskError } = await supabase
      .from('guardianage_tasks')
      .select('id, status, task_type')
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    if (task.status !== 'complete') {
      return res.status(400).json({ success: false, error: 'Task is not complete' });
    }

    // Major items: admin only
    if (task.task_type === 'monthly_major' && user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only admin can reopen major items' });
    }

    const now = new Date().toISOString();

    // Update task — clear completion fields
    const { error: updateError } = await supabase
      .from('guardianage_tasks')
      .update({
        status: 'open',
        completed_at: null,
        completed_by_user_id: null,
        updated_at: now,
      })
      .eq('id', taskId);

    if (updateError) throw new Error(`Failed to reopen task: ${updateError.message}`);

    // Create event
    await supabase
      .from('guardianage_task_events')
      .insert({
        task_id: taskId,
        actor_user_id: user.id,
        event_type: 'reopened',
        occurred_at: now,
      });

    return res.json({ success: true, data: { task_id: taskId, status: 'open' } });
  } catch (error) {
    console.error('Reopen task error:', error);
    return res.status(500).json({ success: false, error: 'Failed to reopen task' });
  }
});

// POST /api/tasks/:taskId/photos — upload photos (up to 10 at a time, max 40 per task)
router.post('/:taskId/photos', upload.array('photos', 10), async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { taskId } = req.params;
    const user = req.guardianageUser;

    // Verify task exists
    const { data: task } = await supabase
      .from('guardianage_tasks')
      .select('id, status, task_type')
      .eq('id', taskId)
      .single();

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // Check existing photo count
    const { data: existingPhotos } = await supabase
      .from('guardianage_task_photos')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', taskId)
      .or('is_deleted.is.null,is_deleted.eq.false');

    const currentCount = existingPhotos?.length ?? 0;
    const newCount = (req.files || []).length;

    if (currentCount + newCount > 40) {
      return res.status(400).json({
        success: false,
        error: `Photo limit exceeded. Current: ${currentCount}, adding: ${newCount}, max: 40`,
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No photos provided' });
    }

    const uploaded = [];
    for (const file of req.files) {
      const photo = await uploadTaskPhoto({ taskId, file, userId: user.id });
      uploaded.push({ ...photo, url: resolvePublicUrl(photo.storage_bucket, photo.storage_path) });
    }

    return res.json({ success: true, data: { photos: uploaded } });
  } catch (error) {
    console.error('Photo upload error:', error);
    return res.status(500).json({ success: false, error: 'Failed to upload photos' });
  }
});

// DELETE /api/tasks/:taskId/photos/:photoId — soft-delete (admin only)
router.delete('/:taskId/photos/:photoId', async (req, res) => {
  try {
    const user = req.guardianageUser;
    if (user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only admin can delete photos' });
    }

    const photo = await softDeletePhoto(req.params.photoId, user.id);
    return res.json({ success: true, data: { photo_id: photo.id } });
  } catch (error) {
    console.error('Photo delete error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete photo' });
  }
});

export default router;
