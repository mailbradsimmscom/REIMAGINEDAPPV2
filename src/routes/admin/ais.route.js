import express from 'express';
import { aisService } from '../../services/ais.service.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();
const requestLogger = logger.createRequestLogger();

/**
 * GET /admin/api/ais/around-us
 * Get vessels around us sorted by distance
 */
router.get('/around-us', async (req, res) => {
  try {
    const result = await aisService.getVesselsAroundUs();

    return res.json({
      success: true,
      data: result,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error in GET /ais/around-us', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /admin/api/ais/friends
 * Get friends list with position data
 */
router.get('/friends', async (req, res) => {
  try {
    const result = await aisService.getFriendsWithPositions();

    return res.json({
      success: true,
      data: result,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error in GET /ais/friends', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /admin/api/ais/friends
 * Add a vessel as a friend
 * Body: { mmsi, name, ship_type? }
 */
router.post('/friends', async (req, res) => {
  try {
    const { mmsi, name, ship_type } = req.body;

    if (!mmsi || !name) {
      return res.status(400).json({
        success: false,
        error: 'MMSI and name are required',
        requestId: res.locals.requestId
      });
    }

    const friend = await aisService.addFriend(mmsi, name, ship_type);

    return res.status(201).json({
      success: true,
      data: friend,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error in POST /ais/friends', { error: error.message });

    const status = error.message.includes('already a friend') ? 409 : 500;
    return res.status(status).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * DELETE /admin/api/ais/friends/:mmsi
 * Remove a vessel from friends
 */
router.delete('/friends/:mmsi', async (req, res) => {
  try {
    const { mmsi } = req.params;

    await aisService.removeFriend(mmsi);

    return res.json({
      success: true,
      data: { mmsi, removed: true },
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error in DELETE /ais/friends', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

export default router;
