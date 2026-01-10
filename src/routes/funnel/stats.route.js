/**
 * Funnel Stats Route
 * GET /api/funnel/stats - Returns pipeline statistics
 */

import express from 'express';
import * as funnelService from '../../services/funnel/funnel.service.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

/**
 * GET /api/funnel/stats
 * Returns the full funnel statistics
 */
router.get('/', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const stats = await funnelService.getFunnelStats();

    return res.json({
      success: true,
      data: stats,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting funnel stats', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

export default router;
