// src/routes/admin/playbook-hints.route.js
import { Router } from 'express';
import { adminOnly } from '../../middleware/admin.js';
import { logger } from '../../utils/logger.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';

const router = Router();

/**
 * GET /admin/api/playbook-hints/pending
 * Get all pending playbook hints with document info
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

    const { data: playbookHints, error } = await supabaseClient
      .from('staging_playbook_hints')
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
      logger.error('Failed to fetch pending playbook hints', { error: error.message });
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch playbook hints' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    return res.status(200).json({
      success: true,
      data: playbookHints,
      error: null,
      requestId: res.locals?.requestId ?? null,
    });

  } catch (error) {
    logger.error('Playbook hints pending route error', { error: error.message });
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected error occurred' },
      requestId: res.locals?.requestId ?? null,
    });
  }
});

/**
 * POST /admin/api/playbook-hints/:id/approve
 * Approve a playbook hint
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
      .from('staging_playbook_hints')
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
      .from('playbook_hints')
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
      .from('staging_playbook_hints')
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

    logger.info('Playbook hint approved', { id, approved_by });
    return res.status(200).json({
      success: true,
      data: insertedData,
      error: null,
      requestId: res.locals?.requestId ?? null,
    });

  } catch (error) {
    logger.error('Playbook hint approve route error', { error: error.message });
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected error occurred' },
      requestId: res.locals?.requestId ?? null,
    });
  }
});

/**
 * POST /admin/api/playbook-hints/:id/reject
 * Reject a playbook hint
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
      .from('staging_playbook_hints')
      .update({
        status: 'rejected',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('status', 'pending') // Only reject pending items
      .select()
      .single();

    if (error) {
      logger.error('Failed to reject playbook hint', { id, error: error.message });
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'DATABASE_ERROR', message: 'Failed to reject playbook hint' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Playbook hint not found or already processed' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    logger.info('Playbook hint rejected', { id, rejected_by, reason });
    return res.status(200).json({
      success: true,
      data: data,
      error: null,
      requestId: res.locals?.requestId ?? null,
    });

  } catch (error) {
    logger.error('Playbook hint reject route error', { error: error.message });
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected error occurred' },
      requestId: res.locals?.requestId ?? null,
    });
  }
});

/**
 * POST /admin/api/playbook-hints/approve
 * Bulk approve multiple playbook hints
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
          .from('staging_playbook_hints')
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
          .from('playbook_hints')
          .insert(productionData);

        if (insertError) {
          errors.push(`Item ${id}: Failed to insert into production - ${insertError.message}`);
          continue;
        }

        // Update staging status to approved
        const { error: updateError } = await supabaseClient
          .from('staging_playbook_hints')
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

    logger.info('Bulk approved playbook hints', { 
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
        message: `Successfully approved ${approvedCount} of ${itemIds.length} playbook hints`
      },
      error: null,
      requestId: res.locals?.requestId ?? null,
    });

  } catch (error) {
    logger.error('Playbook hints bulk approve route error', { error: error.message });
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected error occurred' },
      requestId: res.locals?.requestId ?? null,
    });
  }
});

export default router;
