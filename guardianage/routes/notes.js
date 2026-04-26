/**
 * Guardianage Month Notes Routes
 * Get and save monthly notes with revision history.
 */

import express from 'express';
import { z } from 'zod';
import { getSupabaseClient } from '../repositories/supabase.js';

const router = express.Router();

// GET /api/months/:monthId/notes
router.get('/:monthId/notes', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { monthId } = req.params;

    const { data: note } = await supabase
      .from('guardianage_month_notes')
      .select('*')
      .eq('month_id', monthId)
      .maybeSingle();

    // Get last saved user display name
    let lastSavedBy = null;
    if (note?.last_saved_by_user_id) {
      const { data: user } = await supabase
        .from('guardianage_users')
        .select('display_name')
        .eq('id', note.last_saved_by_user_id)
        .maybeSingle();
      lastSavedBy = user?.display_name || null;
    }

    return res.json({
      success: true,
      data: {
        note: note ? {
          id: note.id,
          current_text: note.current_text,
          last_saved_at: note.last_saved_at,
          last_saved_by: lastSavedBy,
        } : null,
      },
    });
  } catch (error) {
    console.error('Get notes error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load notes' });
  }
});

const SaveNoteSchema = z.object({
  text: z.string(),
});

// POST /api/months/:monthId/notes/save
router.post('/:monthId/notes/save', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { monthId } = req.params;
    const user = req.guardianageUser;

    const parsed = SaveNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Text is required' });
    }

    const { text } = parsed.data;
    const now = new Date().toISOString();
    const isClearing = text.trim() === '';

    // Get or create the note record
    let { data: note } = await supabase
      .from('guardianage_month_notes')
      .select('id')
      .eq('month_id', monthId)
      .maybeSingle();

    if (!note) {
      // Create
      const { data: newNote, error } = await supabase
        .from('guardianage_month_notes')
        .insert({
          month_id: monthId,
          current_text: text,
          last_saved_by_user_id: user.id,
          last_saved_at: now,
        })
        .select()
        .single();
      if (error) throw new Error(`Failed to create note: ${error.message}`);
      note = newNote;

      // First revision
      await supabase
        .from('guardianage_month_note_revisions')
        .insert({
          month_note_id: note.id,
          month_id: monthId,
          revision_number: 1,
          full_text: text,
          action_type: 'created',
          saved_by_user_id: user.id,
          saved_at: now,
        });
    } else {
      // Update
      await supabase
        .from('guardianage_month_notes')
        .update({
          current_text: text,
          last_saved_by_user_id: user.id,
          last_saved_at: now,
          updated_at: now,
        })
        .eq('id', note.id);

      // Get next revision number
      const { data: lastRev } = await supabase
        .from('guardianage_month_note_revisions')
        .select('revision_number')
        .eq('month_note_id', note.id)
        .order('revision_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextRevision = (lastRev?.revision_number || 0) + 1;

      await supabase
        .from('guardianage_month_note_revisions')
        .insert({
          month_note_id: note.id,
          month_id: monthId,
          revision_number: nextRevision,
          full_text: text,
          action_type: isClearing ? 'cleared' : 'updated',
          saved_by_user_id: user.id,
          saved_at: now,
        });
    }

    // Audit log (lightweight summary only)
    await supabase
      .from('guardianage_audit_log')
      .insert({
        actor_user_id: user.id,
        entity_type: 'month_note',
        entity_id: note.id,
        action_type: 'note_saved',
        summary: `Month note saved for ${monthId}`,
      });

    return res.json({
      success: true,
      data: {
        last_saved_at: now,
        last_saved_by: user.display_name,
      },
    });
  } catch (error) {
    console.error('Save note error:', error);
    return res.status(500).json({ success: false, error: 'Failed to save note' });
  }
});

// GET /api/months/:monthId/notes/revisions (admin only)
router.get('/:monthId/notes/revisions', async (req, res) => {
  try {
    if (req.guardianageUser.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const supabase = await getSupabaseClient();
    const { monthId } = req.params;

    const { data: revisions } = await supabase
      .from('guardianage_month_note_revisions')
      .select('*')
      .eq('month_id', monthId)
      .order('revision_number', { ascending: false });

    // Resolve user names
    const userIds = [...new Set((revisions || []).map(r => r.saved_by_user_id).filter(Boolean))];
    const userMap = {};
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from('guardianage_users')
        .select('id, display_name')
        .in('id', userIds);
      for (const u of (users || [])) userMap[u.id] = u.display_name;
    }

    const enriched = (revisions || []).map(r => ({
      ...r,
      saved_by_name: userMap[r.saved_by_user_id] || null,
    }));

    return res.json({ success: true, data: { revisions: enriched } });
  } catch (error) {
    console.error('Note revisions error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load revisions' });
  }
});

export default router;
