// src/routes/supplies/config.route.js
// CRUD endpoints for supply configuration tables (categories, units, locations)

import express from 'express';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

// ============================================
// CATEGORIES
// ============================================

/**
 * GET /api/supplies/config/categories
 * List all categories (flat list)
 * Query params:
 *   - withCounts=true: include item_count for each category
 */
router.get('/categories', async (req, res) => {
  try {
    const { withCounts } = req.query;
    const supabase = await getSupabaseClient();

    const { data, error } = await supabase
      .from('supply_categories')
      .select('id, category_name, display_order, is_active, icon')
      .eq('is_active', true)
      .order('display_order');

    if (error) throw error;

    let categories = data || [];

    // Add item counts if requested (for admin page)
    if (withCounts === 'true') {
      const { data: counts } = await supabase
        .from('supplies')
        .select('category_id');

      const countMap = {};
      (counts || []).forEach(s => {
        countMap[s.category_id] = (countMap[s.category_id] || 0) + 1;
      });

      categories = categories.map(cat => ({
        ...cat,
        item_count: countMap[cat.id] || 0
      }));
    }

    return res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    logger.error('Error listing categories', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/supplies/config/categories
 * Create new category (flat list - just name)
 */
router.post('/categories', async (req, res) => {
  try {
    const { category_name } = req.body;

    if (!category_name || !category_name.trim()) {
      return res.status(400).json({ success: false, error: 'category_name is required' });
    }

    const supabase = await getSupabaseClient();

    // Get max display_order to append at end
    const { data: maxOrder } = await supabase
      .from('supply_categories')
      .select('display_order')
      .order('display_order', { ascending: false })
      .limit(1)
      .single();

    const nextOrder = (maxOrder?.display_order || 0) + 1;

    const { data, error } = await supabase
      .from('supply_categories')
      .insert({
        category_name: category_name.trim(),
        display_order: nextOrder,
        is_active: true
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ success: false, error: 'Category already exists' });
      }
      throw error;
    }

    logger.info('Category created', { categoryId: data.id, name: data.category_name });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    logger.error('Error creating category', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/supplies/config/categories/:id
 * Update category (name only for flat list)
 */
router.put('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { category_name } = req.body;

    if (!category_name || !category_name.trim()) {
      return res.status(400).json({ success: false, error: 'category_name is required' });
    }

    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('supply_categories')
      .update({ category_name: category_name.trim() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ success: false, error: 'Category already exists' });
      }
      throw error;
    }

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Error updating category', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/supplies/config/categories/:id
 * Delete category
 */
router.delete('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const supabase = await getSupabaseClient();

    // Check if category is in use
    const { count } = await supabase
      .from('supplies')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', id);

    if (count > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete: ${count} supplies use this category`
      });
    }

    const { error } = await supabase
      .from('supply_categories')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.json({ success: true, message: 'Category deleted' });
  } catch (error) {
    logger.error('Error deleting category', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// UNITS
// ============================================

/**
 * GET /api/supplies/config/units
 * List all units
 */
router.get('/units', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('supply_units')
      .select('*')
      .order('unit_name');

    if (error) throw error;

    return res.json({
      success: true,
      data: data || []
    });
  } catch (error) {
    logger.error('Error listing units', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/supplies/config/units
 * Create new unit
 */
router.post('/units', async (req, res) => {
  try {
    const { unit_name, abbreviation } = req.body;

    if (!unit_name || !abbreviation) {
      return res.status(400).json({ success: false, error: 'unit_name and abbreviation are required' });
    }

    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('supply_units')
      .insert({ unit_name, abbreviation })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, data });
  } catch (error) {
    logger.error('Error creating unit', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/supplies/config/units/:id
 * Update unit
 */
router.put('/units/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { unit_name, abbreviation } = req.body;

    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('supply_units')
      .update({ unit_name, abbreviation })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Error updating unit', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/supplies/config/units/:id
 * Delete unit
 */
router.delete('/units/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const supabase = await getSupabaseClient();

    // Check if unit is in use
    const { count } = await supabase
      .from('supplies')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', id);

    if (count > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete: ${count} supplies use this unit`
      });
    }

    const { error } = await supabase
      .from('supply_units')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.json({ success: true, message: 'Unit deleted' });
  } catch (error) {
    logger.error('Error deleting unit', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// LOCATIONS
// ============================================

/**
 * GET /api/supplies/config/locations
 * List all locations
 */
router.get('/locations', async (req, res) => {
  try {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('supply_locations')
      .select('*')
      .order('name');

    if (error) throw error;

    return res.json({
      success: true,
      data: data || []
    });
  } catch (error) {
    logger.error('Error listing locations', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/supplies/config/locations
 * Create new location
 */
router.post('/locations', async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }

    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('supply_locations')
      .insert({ name, description })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, data });
  } catch (error) {
    logger.error('Error creating location', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/supplies/config/locations/:id
 * Update location
 */
router.put('/locations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from('supply_locations')
      .update({ name, description, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Error updating location', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/supplies/config/locations/:id
 * Delete location
 */
router.delete('/locations/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const supabase = await getSupabaseClient();

    // Check if location is in use (once we add location_id to supplies)
    // For now, just delete
    const { error } = await supabase
      .from('supply_locations')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.json({ success: true, message: 'Location deleted' });
  } catch (error) {
    logger.error('Error deleting location', { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
