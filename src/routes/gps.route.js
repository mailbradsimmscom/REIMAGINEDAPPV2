import express from 'express';
import { gpsRepository } from '../repositories/gps.repository.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const requestLogger = logger.createRequestLogger();

/**
 * GET /api/gps/current
 * Returns the most recent GPS position
 */
router.get('/current', async (req, res) => {
  try {
    const position = await gpsRepository.getCurrentPosition();

    if (!position) {
      return res.json({
        success: true,
        data: null,
        message: 'No GPS data available',
        requestId: res.locals.requestId
      });
    }

    return res.json({
      success: true,
      data: {
        latitude: position.latitude,
        longitude: position.longitude,
        timestamp: position.timestamp,
        speed_over_ground: position.speed_over_ground,
        course_over_ground: position.course_over_ground,
        depth: position.depth,
        true_wind_speed: position.true_wind_speed,
        true_wind_direction: position.true_wind_direction
      },
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error fetching GPS position', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch GPS position',
      requestId: res.locals.requestId
    });
  }
});

export default router;
