/**
 * Test Analysis Route
 *
 * GET /admin/api/test-analysis/:runId
 *
 * Returns AI analysis results for test failures from a specific run.
 * Protected by parent router's adminOnly middleware.
 */

import { Router } from 'express';
import { getAnalysisForRun } from '../../services/test-analysis.service.js';
import { TestAnalysisParamsSchema } from '../../schemas/test-analysis.schema.js';

const router = Router();

/**
 * GET /:runId
 *
 * Fetch analysis results for a test run.
 *
 * @param {string} runId - UUID of the test run
 * @returns {Object} { success: true, data: { byFailureKey, summary } }
 */
router.get('/:runId', async (req, res, next) => {
  try {
    // Validate params
    const parseResult = TestAnalysisParamsSchema.safeParse(req.params);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PARAMS',
          message: 'Invalid run ID format',
          details: parseResult.error.flatten()
        }
      });
    }

    const { runId } = parseResult.data;
    const data = await getAnalysisForRun(runId);

    return res.json({
      success: true,
      data,
      requestId: res.locals.requestId
    });
  } catch (err) {
    next(err);
  }
});

export default router;
