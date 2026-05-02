// src/routes/supplies/quick-add.route.js
// Self-contained route for supply audit quick-add tool.
// Uses its own tables (supply_audit_locations, supply_audit_items) and
// its own storage bucket (supply-audit). Zero production table dependencies.

import express from 'express';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();
const BUCKET = 'supply-audit';
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB decoded

async function getSupabase() {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    const error = new Error('Supabase client not available');
    error.status = 503;
    throw error;
  }
  return supabase;
}

// ============================================================
// Location endpoints
// ============================================================

/**
 * GET /api/supplies/quick-add/locations
 * List all audit locations with usage counts
 */
router.get('/locations', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const supabase = await getSupabase();

    // Get all audit locations
    const { data: locations, error } = await supabase
      .from('supply_audit_locations')
      .select('*')
      .order('name');

    if (error) throw new Error(`Failed to list locations: ${error.message}`);

    // Get usage counts from audit items
    const { data: usageCounts, error: countError } = await supabase
      .from('supply_audit_items')
      .select('location');

    if (countError) throw new Error(`Failed to get usage counts: ${countError.message}`);

    // Build count map
    const countMap = {};
    for (const row of (usageCounts || [])) {
      if (row.location) {
        countMap[row.location] = (countMap[row.location] || 0) + 1;
      }
    }

    // Attach counts
    const result = (locations || []).map(loc => ({
      ...loc,
      item_count: countMap[loc.name] || 0
    }));

    return res.json({ success: true, data: result });
  } catch (error) {
    requestLogger.error('Error listing audit locations', { error: error.message });
    return res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/supplies/quick-add/locations
 * Create a new audit location
 */
router.post('/locations', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const supabase = await getSupabase();
    const name = (req.body.name || '').trim();

    if (!name) {
      return res.status(400).json({ success: false, error: 'Location name is required' });
    }

    const { data, error } = await supabase
      .from('supply_audit_locations')
      .insert({ name })
      .select()
      .single();

    if (error) {
      // Unique constraint violation
      if (error.code === '23505') {
        return res.status(409).json({ success: false, error: 'A location with that name already exists' });
      }
      throw new Error(`Failed to create location: ${error.message}`);
    }

    requestLogger.info('Audit location created', { id: data.id, name: data.name });
    return res.status(201).json({ success: true, data: { ...data, item_count: 0 } });
  } catch (error) {
    requestLogger.error('Error creating audit location', { error: error.message });
    return res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/supplies/quick-add/locations/:id
 * Rename an audit location (cascades to audit items via RPC)
 */
router.put('/locations/:id', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const supabase = await getSupabase();
    const { id } = req.params;
    const newName = (req.body.name || '').trim();

    if (!newName) {
      return res.status(400).json({ success: false, error: 'New location name is required' });
    }

    const { data, error } = await supabase.rpc('rename_audit_location', {
      location_id: id,
      new_name: newName
    });

    if (error) {
      // Surface RPC exceptions as user-friendly errors
      const msg = error.message || 'Rename failed';
      const status = msg.includes('already exists') ? 409 : 400;
      return res.status(status).json({ success: false, error: msg });
    }

    requestLogger.info('Audit location renamed', data);
    return res.json({ success: true, data });
  } catch (error) {
    requestLogger.error('Error renaming audit location', { error: error.message });
    return res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/supplies/quick-add/locations/:id
 * Delete an audit location (blocked if any audit items use it)
 */
router.delete('/locations/:id', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const supabase = await getSupabase();
    const { id } = req.params;

    // Get the location name first
    const { data: location, error: fetchError } = await supabase
      .from('supply_audit_locations')
      .select('name')
      .eq('id', id)
      .single();

    if (fetchError || !location) {
      return res.status(404).json({ success: false, error: 'Location not found' });
    }

    // Check if any audit items use this location
    const { count, error: countError } = await supabase
      .from('supply_audit_items')
      .select('*', { count: 'exact', head: true })
      .eq('location', location.name);

    if (countError) throw new Error(`Failed to check usage: ${countError.message}`);

    if (count > 0) {
      return res.status(409).json({
        success: false,
        error: `Cannot delete: ${count} audit item(s) use this location`
      });
    }

    // Safe to delete
    const { error: deleteError } = await supabase
      .from('supply_audit_locations')
      .delete()
      .eq('id', id);

    if (deleteError) throw new Error(`Failed to delete location: ${deleteError.message}`);

    requestLogger.info('Audit location deleted', { id, name: location.name });
    return res.json({ success: true, data: { id, name: location.name } });
  } catch (error) {
    requestLogger.error('Error deleting audit location', { error: error.message });
    return res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// ============================================================
// Item endpoints
// ============================================================

/**
 * POST /api/supplies/quick-add/item
 * Create a new audit item
 */
router.post('/item', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const supabase = await getSupabase();

    const itemName = (req.body.item_name || '').trim();
    if (!itemName) {
      return res.status(400).json({ success: false, error: 'item_name is required' });
    }

    const currentStock = parseFloat(req.body.current_stock) || 0;
    if (currentStock < 0) {
      return res.status(400).json({ success: false, error: 'current_stock cannot be negative' });
    }

    const location = (req.body.location || '').trim() || null;
    const notes = (req.body.notes || '').trim() || null;

    const { data, error } = await supabase
      .from('supply_audit_items')
      .insert({
        item_name: itemName,
        current_stock: currentStock,
        location,
        notes
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create audit item: ${error.message}`);

    requestLogger.info('Audit item created', { id: data.id, item_name: data.item_name, location: data.location });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    requestLogger.error('Error creating audit item', { error: error.message });
    return res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/supplies/quick-add/item/:id/photo
 * Upload a photo for an audit item to the supply-audit bucket
 */
router.post('/item/:id/photo', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const supabase = await getSupabase();
    const { id } = req.params;
    const { imageBase64, photoIndex } = req.body;

    // Validate photoIndex
    const index = parseInt(photoIndex);
    if (!Number.isInteger(index) || index < 1 || index > MAX_PHOTOS) {
      return res.status(400).json({ success: false, error: `photoIndex must be 1-${MAX_PHOTOS}` });
    }

    // Validate base64 format
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ success: false, error: 'imageBase64 is required' });
    }

    const matches = imageBase64.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ success: false, error: 'Invalid image format. Must be data:image/(jpeg|png|webp);base64,...' });
    }

    const imageType = matches[1];
    const base64Content = matches[2];
    const buffer = Buffer.from(base64Content, 'base64');

    // Check decoded size
    if (buffer.length > MAX_PHOTO_BYTES) {
      return res.status(400).json({ success: false, error: `Photo exceeds ${MAX_PHOTO_BYTES / 1024 / 1024}MB limit` });
    }

    // Verify the audit item exists
    const { data: item, error: itemError } = await supabase
      .from('supply_audit_items')
      .select('id, photos')
      .eq('id', id)
      .single();

    if (itemError || !item) {
      return res.status(404).json({ success: false, error: 'Audit item not found' });
    }

    // Upload to supply-audit bucket
    const extension = imageType === 'jpeg' ? 'jpg' : imageType;
    const filePath = `${id}-${index}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, buffer, {
        contentType: `image/${imageType}`,
        upsert: true
      });

    if (uploadError) throw new Error(`Failed to upload photo: ${uploadError.message}`);

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(filePath);

    const photoUrl = urlData.publicUrl;

    // Update photos array on the audit item
    const existingPhotos = item.photos || [];
    const updatedPhotos = [...existingPhotos];
    updatedPhotos[index - 1] = photoUrl;

    const { error: updateError } = await supabase
      .from('supply_audit_items')
      .update({ photos: updatedPhotos, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) throw new Error(`Failed to update photos: ${updateError.message}`);

    requestLogger.info('Audit photo uploaded', { itemId: id, photoIndex: index, filePath });

    return res.json({
      success: true,
      data: { url: photoUrl, photos: updatedPhotos }
    });
  } catch (error) {
    requestLogger.error('Error uploading audit photo', { error: error.message, itemId: req.params.id });
    return res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

export default router;
