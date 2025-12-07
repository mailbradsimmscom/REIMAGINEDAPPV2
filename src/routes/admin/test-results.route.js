import express from 'express';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

/**
 * GET /admin/api/test-results
 * Get the most recent test run results
 */
router.get('/', async (req, res, next) => {
  try {
    const supabase = await getSupabaseClient();

    const { data, error } = await supabase
      .from('test_results')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      data: data?.[0] || null
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /admin/api/test-results/history
 * Get test results from the last 7 days
 */
router.get('/history', async (req, res, next) => {
  try {
    const supabase = await getSupabaseClient();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('test_results')
      .select('run_id, run_type, created_at, total_tests, passed, failed, skipped, git_branch')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      data: data || []
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /admin/api/test-results/:runId
 * Get a specific test run by ID
 */
router.get('/:runId', async (req, res, next) => {
  try {
    const { runId } = req.params;
    const supabase = await getSupabaseClient();

    const { data, error } = await supabase
      .from('test_results')
      .select('*')
      .eq('run_id', runId)
      .single();

    if (error) {
      return res.status(404).json({
        success: false,
        error: 'Test run not found'
      });
    }

    return res.json({
      success: true,
      data
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * POST /admin/api/test-results/trigger
 * Manually trigger a nightly sweep (placeholder - requires GitHub token)
 */
router.post('/trigger', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  // This would require a GitHub token with workflow permissions
  // For now, just return instructions
  requestLogger.info('Manual test sweep trigger requested');

  return res.json({
    success: true,
    message: 'To trigger a sweep, go to GitHub Actions > Nightly Sweep > Run workflow',
    instructions: [
      '1. Go to repository on GitHub',
      '2. Click "Actions" tab',
      '3. Click "Nightly Sweep" workflow',
      '4. Click "Run workflow" button'
    ]
  });
});

export default router;
