/**
 * Boat Now Routes
 * API endpoint for current boat status and historical data
 */

import express from 'express';
import * as boatNowService from '../../services/boat-now/boat-now.service.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

/**
 * GET /api/boat-now
 * Get current boat status with weather and 5-hour history
 */
router.get('/', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const hoursBack = parseInt(req.query.hours) || 5;

    requestLogger.info('Fetching boat status', { hoursBack });

    const status = await boatNowService.getBoatStatus(hoursBack);

    return res.json({
      success: true,
      data: status,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error fetching boat status', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

export default router;
