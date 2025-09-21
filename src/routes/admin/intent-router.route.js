// src/routes/admin/intent-router.route.js
import { Router } from 'express';
import { adminOnly } from '../../middleware/admin.js';
import { logger } from '../../utils/logger.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';

const router = Router();

/**
 * POST /admin/api/intent-router/approve
 * Bulk approve multiple intent router entries
 */
router.post('/approve', adminOnly, async (req, res) => {
  try {
    const { itemIds, approved_by } = req.body;

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'BAD_REQUEST', message: 'itemIds array is required' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    if (!approved_by) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'BAD_REQUEST', message: 'approved_by is required' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    const supabaseClient = await getSupabaseClient();
    if (!supabaseClient) {
      return res.status(503).json({
        success: false,
        data: null,
        error: { code: 'SUPABASE_DISABLED', message: 'Database not available' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    let approvedCount = 0;
    const errors = [];

    for (const id of itemIds) {
      try {
        // First, get the staging record
        const { data: stagingRecord, error: fetchError } = await supabaseClient
          .from('staging_intent_router')
          .select('*')
          .eq('id', id)
          .eq('status', 'pending')
          .single();

        if (fetchError || !stagingRecord) {
          errors.push(`Item ${id}: Staging record not found or already processed`);
          continue;
        }

        // Copy all fields from staging to production (preserving ID)
        const productionData = {
          ...stagingRecord,
          status: 'approved',
          approved_by: approved_by,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        // Insert into production table
        const { error: insertError } = await supabaseClient
          .from('intent_router')
          .insert(productionData);

        if (insertError) {
          errors.push(`Item ${id}: Failed to insert into production - ${insertError.message}`);
          continue;
        }

        // Update staging status to approved
        const { error: updateError } = await supabaseClient
          .from('staging_intent_router')
          .update({ 
            status: 'approved',
            updated_at: new Date().toISOString()
          })
          .eq('id', id);

        if (updateError) {
          errors.push(`Item ${id}: Failed to update staging status - ${updateError.message}`);
          continue;
        }

        approvedCount++;

      } catch (error) {
        errors.push(`Item ${id}: ${error.message}`);
      }
    }

    logger.info('Bulk approved intent router entries', { 
      totalRequested: itemIds.length,
      approvedCount,
      errors: errors.length
    });

    return res.status(200).json({
      success: true,
      data: {
        approved_count: approvedCount,
        total_requested: itemIds.length,
        errors: errors,
        message: `Successfully approved ${approvedCount} of ${itemIds.length} intent router entries`
      },
      error: null,
      requestId: res.locals?.requestId ?? null,
    });

  } catch (error) {
    logger.error('Intent router bulk approve route error', { error: error.message });
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected error occurred' },
      requestId: res.locals?.requestId ?? null,
    });
  }
});

/**
 * GET /admin/api/intent-router/pending
 * Get all pending intent router entries with document info
 */
router.get('/pending', adminOnly, async (req, res) => {
  try {
    const { docId } = req.query;
    
    // Build the query conditions
    const conditions = { status: 'pending' };
    if (docId) {
      conditions.doc_id = docId;
    }

    const supabaseClient = await getSupabaseClient();
    if (!supabaseClient) {
      return res.status(503).json({
        success: false,
        data: null,
        error: { code: 'SUPABASE_DISABLED', message: 'Database not available' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    const { data: intentRouterEntries, error } = await supabaseClient
      .from('staging_intent_router')
      .select(`
        *,
        documents!inner(
          model_norm,
          manufacturer_norm,
          model,
          manufacturer
        )
      `)
      .match(conditions)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch pending intent router entries', { error: error.message });
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch intent router entries' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    return res.status(200).json({
      success: true,
      data: intentRouterEntries,
      error: null,
      requestId: res.locals?.requestId ?? null,
    });

  } catch (error) {
    logger.error('Intent router pending route error', { error: error.message });
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected error occurred' },
      requestId: res.locals?.requestId ?? null,
    });
  }
});

/**
 * POST /admin/api/intent-router/:id/approve
 * Approve an intent router entry
 */
router.post('/:id/approve', adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { approved_by } = req.body;

    if (!approved_by) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'BAD_REQUEST', message: 'approved_by is required' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    const supabaseClient = await getSupabaseClient();
    if (!supabaseClient) {
      return res.status(503).json({
        success: false,
        data: null,
        error: { code: 'SUPABASE_DISABLED', message: 'Database not available' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    // First, get the staging record
    const { data: stagingRecord, error: fetchError } = await supabaseClient
      .from('staging_intent_router')
      .select('*')
      .eq('id', id)
      .eq('status', 'pending')
      .single();

    if (fetchError || !stagingRecord) {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Staging record not found or already processed' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    // Copy all fields from staging to production (preserving ID)
    const productionData = {
      ...stagingRecord,
      status: 'approved',
      approved_by: approved_by,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Insert into production table
    const { data: insertedData, error: insertError } = await supabaseClient
      .from('intent_router')
      .insert(productionData)
      .select()
      .single();

    if (insertError) {
      logger.error('Failed to insert into production table', { id, error: insertError.message });
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'DATABASE_ERROR', message: 'Failed to insert into production table' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    // Update staging status to approved
    const { error: updateError } = await supabaseClient
      .from('staging_intent_router')
      .update({ 
        status: 'approved',
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) {
      logger.error('Failed to update staging status', { id, error: updateError.message });
      // Don't fail the request, but log the error
    }

    if (!insertedData) {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Failed to create production record' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    logger.info('Intent router entry approved', { id, approved_by });
    return res.status(200).json({
      success: true,
      data: insertedData,
      error: null,
      requestId: res.locals?.requestId ?? null,
    });

  } catch (error) {
    logger.error('Intent router entry approve route error', { error: error.message });
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected error occurred' },
      requestId: res.locals?.requestId ?? null,
    });
  }
});

/**
 * POST /admin/api/intent-router/:id/reject
 * Reject an intent router entry
 */
router.post('/:id/reject', adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { rejected_by, reason } = req.body;

    if (!rejected_by) {
      return res.status(400).json({
        success: false,
        data: null,
        error: { code: 'BAD_REQUEST', message: 'rejected_by is required' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    const supabaseClient = await getSupabaseClient();
    if (!supabaseClient) {
      return res.status(503).json({
        success: false,
        data: null,
        error: { code: 'SUPABASE_DISABLED', message: 'Database not available' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    const { data, error } = await supabaseClient
      .from('staging_intent_router')
      .update({
        status: 'rejected',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('status', 'pending') // Only reject pending items
      .select()
      .single();

    if (error) {
      logger.error('Failed to reject intent router entry', { id, error: error.message });
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'DATABASE_ERROR', message: 'Failed to reject intent router entry' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Intent router entry not found or already processed' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    logger.info('Intent router entry rejected', { id, rejected_by, reason });
    return res.status(200).json({
      success: true,
      data: data,
      error: null,
      requestId: res.locals?.requestId ?? null,
    });

  } catch (error) {
    logger.error('Intent router entry reject route error', { error: error.message });
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected error occurred' },
      requestId: res.locals?.requestId ?? null,
    });
  }
});

export default router;