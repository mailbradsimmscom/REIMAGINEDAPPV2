/**
 * Guardianage Supplies Routes
 * Create, edit, list supplies with revision history and receipt uploads.
 */

import express from 'express';
import { z } from 'zod';
import multer from 'multer';
import { getSupabaseClient } from '../repositories/supabase.js';
import { uploadReceiptPhoto, resolvePublicUrl } from '../services/photo.service.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// GET /api/months/:monthId/supplies
router.get('/:monthId/supplies', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { monthId } = req.params;

    const { data: supplies } = await supabase
      .from('guardianage_month_supplies')
      .select('*')
      .eq('month_id', monthId)
      .order('purchase_date', { ascending: false });

    // Get receipts for all supplies
    const supplyIds = (supplies || []).map(s => s.id);
    let receipts = [];
    if (supplyIds.length > 0) {
      const { data } = await supabase
        .from('guardianage_month_supply_receipts')
        .select('*')
        .in('month_supply_id', supplyIds)
        .order('uploaded_at', { ascending: true });
      receipts = data || [];
    }

    // Group receipts by supply
    const receiptsBySupply = {};
    for (const r of receipts) {
      if (!receiptsBySupply[r.month_supply_id]) receiptsBySupply[r.month_supply_id] = [];
      receiptsBySupply[r.month_supply_id].push(r);
    }

    // Resolve user names
    const userIds = [...new Set((supplies || []).map(s => s.entered_by_user_id).filter(Boolean))];
    const userMap = {};
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from('guardianage_users')
        .select('id, display_name')
        .in('id', userIds);
      for (const u of (users || [])) userMap[u.id] = u.display_name;
    }

    const enriched = (supplies || []).map(s => ({
      ...s,
      entered_by_name: userMap[s.entered_by_user_id] || null,
      receipts: (receiptsBySupply[s.id] || []).map(r => ({
        ...r,
        url: resolvePublicUrl(r.storage_bucket, r.storage_path),
      })),
    }));

    return res.json({ success: true, data: { supplies: enriched } });
  } catch (error) {
    console.error('List supplies error:', error);
    return res.status(500).json({ success: false, error: 'Failed to load supplies' });
  }
});

const CreateSupplySchema = z.object({
  item_name: z.string().min(1, 'Item name is required'),
  purchase_date: z.string().optional(),
  category: z.string().optional(),
  vendor: z.string().optional(),
  amount: z.number().optional(),
  currency_code: z.enum(['USD', 'XCD']).default('USD'),
  note: z.string().optional(),
  related_task_id: z.string().uuid().optional(),
});

// POST /api/months/:monthId/supplies
router.post('/:monthId/supplies', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { monthId } = req.params;
    const user = req.guardianageUser;

    const parsed = CreateSupplySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Invalid input',
      });
    }

    const now = new Date().toISOString();
    const supplyData = {
      month_id: monthId,
      ...parsed.data,
      entered_by_user_id: user.id,
    };

    const { data: supply, error } = await supabase
      .from('guardianage_month_supplies')
      .insert(supplyData)
      .select()
      .single();

    if (error) throw new Error(`Failed to create supply: ${error.message}`);

    // Create initial revision
    await supabase
      .from('guardianage_month_supply_revisions')
      .insert({
        month_supply_id: supply.id,
        revision_number: 1,
        item_name: parsed.data.item_name,
        category: parsed.data.category || null,
        vendor: parsed.data.vendor || null,
        amount: parsed.data.amount || null,
        currency_code: parsed.data.currency_code,
        note: parsed.data.note || null,
        action_type: 'created',
        saved_by_user_id: user.id,
        saved_at: now,
      });

    // Audit log
    await supabase
      .from('guardianage_audit_log')
      .insert({
        actor_user_id: user.id,
        entity_type: 'supply',
        entity_id: supply.id,
        action_type: 'supply_created',
        summary: `Supply added: ${parsed.data.item_name}`,
      });

    return res.json({ success: true, data: { supply } });
  } catch (error) {
    console.error('Create supply error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create supply' });
  }
});

const UpdateSupplySchema = z.object({
  item_name: z.string().min(1).optional(),
  purchase_date: z.string().optional(),
  category: z.string().optional(),
  vendor: z.string().optional(),
  amount: z.number().optional(),
  currency_code: z.enum(['USD', 'XCD']).optional(),
  note: z.string().optional(),
  related_task_id: z.string().uuid().nullable().optional(),
});

// PATCH /api/supplies/:supplyId
router.patch('/:supplyId', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { supplyId } = req.params;
    const user = req.guardianageUser;

    const parsed = UpdateSupplySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: parsed.error.issues[0]?.message || 'Invalid input',
      });
    }

    const now = new Date().toISOString();

    // Update supply
    const { data: updated, error } = await supabase
      .from('guardianage_month_supplies')
      .update({ ...parsed.data, updated_at: now })
      .eq('id', supplyId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update supply: ${error.message}`);

    // Get next revision number
    const { data: lastRev } = await supabase
      .from('guardianage_month_supply_revisions')
      .select('revision_number')
      .eq('month_supply_id', supplyId)
      .order('revision_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextRevision = (lastRev?.revision_number || 0) + 1;

    // Create revision with full current state
    await supabase
      .from('guardianage_month_supply_revisions')
      .insert({
        month_supply_id: supplyId,
        revision_number: nextRevision,
        item_name: updated.item_name,
        category: updated.category,
        vendor: updated.vendor,
        amount: updated.amount,
        currency_code: updated.currency_code,
        note: updated.note,
        action_type: 'updated',
        saved_by_user_id: user.id,
        saved_at: now,
      });

    return res.json({ success: true, data: { supply: updated } });
  } catch (error) {
    console.error('Update supply error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update supply' });
  }
});

// POST /api/supplies/:supplyId/receipt — upload receipt photo
router.post('/:supplyId/receipt', upload.array('receipts', 5), async (req, res) => {
  try {
    const user = req.guardianageUser;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No receipt photos provided' });
    }

    const uploaded = [];
    for (const file of req.files) {
      const receipt = await uploadReceiptPhoto({
        supplyId: req.params.supplyId,
        file,
        userId: user.id,
      });
      uploaded.push({ ...receipt, url: resolvePublicUrl(receipt.storage_bucket, receipt.storage_path) });
    }

    return res.json({ success: true, data: { receipts: uploaded } });
  } catch (error) {
    console.error('Receipt upload error:', error);
    return res.status(500).json({ success: false, error: 'Failed to upload receipt' });
  }
});

export default router;
