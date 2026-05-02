/**
 * Guardianage Season Context Routes
 * Get and save season-level rich-text context notes with revision history.
 * All authenticated users can read; only admin can edit.
 */

import express from 'express';
import { z } from 'zod';
import { getSupabaseClient } from '../repositories/supabase.js';

const router = express.Router();

// GET /api/seasons/:seasonId/context
router.get('/:seasonId/context', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { seasonId } = req.params;

    const { data: note } = await supabase
      .from('guardianage_season_notes')
      .select('*')
      .eq('season_id', seasonId)
      .maybeSingle();

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
          current_html: note.current_html,
          last_saved_at: note.last_saved_at,
          last_saved_by: lastSavedBy,
        } : null,
      },
    });
  } catch (error) {
    console.error('Get season context error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load season context' });
  }
});

const SaveContextSchema = z.object({
  html: z.string(),
});

// POST /api/seasons/:seasonId/context/save (admin only)
router.post('/:seasonId/context/save', async (req, res) => {
  try {
    const user = req.guardianageUser;
    if (user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const supabase = await getSupabaseClient();
    const { seasonId } = req.params;

    const parsed = SaveContextSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'HTML content is required' });
    }

    const { html } = parsed.data;
    const now = new Date().toISOString();
    // Strip leftover contenteditable artifacts before checking empty
    const stripped = html.replace(/<br\s*\/?>/gi, '').replace(/<div><br\s*\/?><\/div>/gi, '').trim();
    const isClearing = stripped === '' || stripped === '<br>';

    let { data: note } = await supabase
      .from('guardianage_season_notes')
      .select('id')
      .eq('season_id', seasonId)
      .maybeSingle();

    if (!note) {
      const { data: newNote, error } = await supabase
        .from('guardianage_season_notes')
        .insert({
          season_id: seasonId,
          current_html: html,
          last_saved_by_user_id: user.id,
          last_saved_at: now,
        })
        .select()
        .single();
      if (error) throw new Error(`Failed to create season context: ${error.message}`);
      note = newNote;

      await supabase
        .from('guardianage_season_note_revisions')
        .insert({
          season_note_id: note.id,
          season_id: seasonId,
          revision_number: 1,
          full_html: html,
          action_type: 'created',
          saved_by_user_id: user.id,
          saved_at: now,
        });
    } else {
      await supabase
        .from('guardianage_season_notes')
        .update({
          current_html: html,
          last_saved_by_user_id: user.id,
          last_saved_at: now,
          updated_at: now,
        })
        .eq('id', note.id);

      const { data: lastRev } = await supabase
        .from('guardianage_season_note_revisions')
        .select('revision_number')
        .eq('season_note_id', note.id)
        .order('revision_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextRevision = (lastRev?.revision_number || 0) + 1;

      await supabase
        .from('guardianage_season_note_revisions')
        .insert({
          season_note_id: note.id,
          season_id: seasonId,
          revision_number: nextRevision,
          full_html: html,
          action_type: isClearing ? 'cleared' : 'updated',
          saved_by_user_id: user.id,
          saved_at: now,
        });
    }

    await supabase
      .from('guardianage_audit_log')
      .insert({
        actor_user_id: user.id,
        entity_type: 'season_note',
        entity_id: note.id,
        action_type: 'note_saved',
        summary: `Season context saved for ${seasonId}`,
      });

    return res.json({
      success: true,
      data: {
        last_saved_at: now,
        last_saved_by: user.display_name,
      },
    });
  } catch (error) {
    console.error('Save season context error:', error);
    return res.status(500).json({ success: false, error: 'Failed to save season context' });
  }
});

// GET /api/seasons/:seasonId/context/revisions (admin only)
router.get('/:seasonId/context/revisions', async (req, res) => {
  try {
    if (req.guardianageUser.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const supabase = await getSupabaseClient();
    const { seasonId } = req.params;

    const { data: revisions } = await supabase
      .from('guardianage_season_note_revisions')
      .select('*')
      .eq('season_id', seasonId)
      .order('revision_number', { ascending: false });

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
    console.error('Season context revisions error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load revisions' });
  }
});

export default router;
