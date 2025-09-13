// src/routes/admin/golden-tests.route.js
import { Router } from 'express';
import { adminOnly } from '../../middleware/admin.js';
import { logger } from '../../utils/logger.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';

const router = Router();

/**
 * GET /admin/api/golden-tests/pending
 * Get all pending golden tests with document info
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

    const { data: goldenTests, error } = await supabaseClient
      .from('golden_tests')
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
      logger.error('Failed to fetch pending golden tests', { error: error.message });
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch golden tests' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    return res.status(200).json({
      success: true,
      data: goldenTests,
      error: null,
      requestId: res.locals?.requestId ?? null,
    });

  } catch (error) {
    logger.error('Golden tests pending route error', { error: error.message });
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected error occurred' },
      requestId: res.locals?.requestId ?? null,
    });
  }
});

/**
 * POST /admin/api/golden-tests/:id/approve
 * Approve a golden test
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

    const { data, error } = await supabaseClient
      .from('golden_tests')
      .update({
        status: 'approved',
        approved_by: approved_by,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('status', 'pending') // Only approve pending items
      .select()
      .single();

    if (error) {
      logger.error('Failed to approve golden test', { id, error: error.message });
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'DATABASE_ERROR', message: 'Failed to approve golden test' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Golden test not found or already processed' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    logger.info('Golden test approved', { id, approved_by });
    return res.status(200).json({
      success: true,
      data: data,
      error: null,
      requestId: res.locals?.requestId ?? null,
    });

  } catch (error) {
    logger.error('Golden test approve route error', { error: error.message });
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected error occurred' },
      requestId: res.locals?.requestId ?? null,
    });
  }
});

/**
 * POST /admin/api/golden-tests/:id/reject
 * Reject a golden test
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
      .from('golden_tests')
      .update({
        status: 'rejected',
        approved_by: rejected_by, // Store who rejected it
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // Store rejection reason in a comment field if available
        ...(reason && { context: reason })
      })
      .eq('id', id)
      .eq('status', 'pending') // Only reject pending items
      .select()
      .single();

    if (error) {
      logger.error('Failed to reject golden test', { id, error: error.message });
      return res.status(500).json({
        success: false,
        data: null,
        error: { code: 'DATABASE_ERROR', message: 'Failed to reject golden test' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        data: null,
        error: { code: 'NOT_FOUND', message: 'Golden test not found or already processed' },
        requestId: res.locals?.requestId ?? null,
      });
    }

    logger.info('Golden test rejected', { id, rejected_by, reason });
    return res.status(200).json({
      success: true,
      data: data,
      error: null,
      requestId: res.locals?.requestId ?? null,
    });

  } catch (error) {
    logger.error('Golden test reject route error', { error: error.message });
    return res.status(500).json({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected error occurred' },
      requestId: res.locals?.requestId ?? null,
    });
  }
});

export default router;

