import express from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { anchorWatchService } from '../../services/anchor-watch.service.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();
const requestLogger = logger.createRequestLogger();

// Unified response schema for all anchor watch endpoints
const AnchorWatchEnvelopeSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  requestId: z.string().optional()
});

// Request schemas
const PositionsQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).default('20')
});

const ActivateBodySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_meters: z.number().min(10).max(2000)
});

const UpdateRadiusBodySchema = z.object({
  radius_meters: z.number().min(10).max(2000)
});

// Apply unified response validation to all routes
router.use(validateResponse(AnchorWatchEnvelopeSchema));

// Request schema for safe-box
const SafeBoxQuerySchema = z.object({
  interval: z.string().regex(/^\d+$/).default('60')
});

// GET /admin/api/anchor-watch/safe-box
router.get('/safe-box',
  validate(SafeBoxQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const interval = parseInt(req.query.interval);
      const result = await anchorWatchService.getSafeBox(interval);

      return res.json({
        success: true,
        data: result,
        requestId: res.locals.requestId
      });
    } catch (error) {
      requestLogger.error('Error getting safe box', { error: error.message });
      const status = error.message.includes('No active anchorage') ? 404 : 500;
      return res.status(status).json({
        success: false,
        error: error.message,
        requestId: res.locals.requestId
      });
    }
  }
);

// GET /admin/api/anchor-watch/status
router.get('/status', async (req, res, next) => {
  try {
    const status = await anchorWatchService.getStatus();

    return res.json({
      success: true,
      data: status,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting anchor watch status', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to get anchor watch status',
      requestId: res.locals.requestId
    });
  }
});

// GET /admin/api/anchor-watch/positions
router.get('/positions',
  validate(PositionsQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const limit = parseInt(req.query.limit);
      const result = await anchorWatchService.getPositionsWithDistance(limit);

      return res.json({
        success: true,
        data: result,
        requestId: res.locals.requestId
      });
    } catch (error) {
      requestLogger.error('Error getting positions', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to get GPS positions',
        requestId: res.locals.requestId
      });
    }
  }
);

// POST /admin/api/anchor-watch/infer
router.post('/infer', async (req, res, next) => {
  try {
    const centroid = await anchorWatchService.calculateCentroid();

    return res.json({
      success: true,
      data: centroid,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error calculating centroid', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to calculate anchor position. Ensure GPS data is available.',
      requestId: res.locals.requestId
    });
  }
});

// POST /admin/api/anchor-watch/activate
router.post('/activate',
  validate(ActivateBodySchema, 'body'),
  async (req, res, next) => {
    try {
      const { latitude, longitude, radius_meters } = req.body;
      await anchorWatchService.activate(latitude, longitude, radius_meters);

      return res.json({
        success: true,
        data: { message: 'Anchor watch activated' },
        requestId: res.locals.requestId
      });
    } catch (error) {
      requestLogger.error('Error activating anchor watch', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to activate anchor watch',
        requestId: res.locals.requestId
      });
    }
  }
);

// POST /admin/api/anchor-watch/deactivate
router.post('/deactivate', async (req, res, next) => {
  try {
    await anchorWatchService.deactivate();

    return res.json({
      success: true,
      data: { message: 'Anchor watch deactivated' },
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error deactivating anchor watch', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to deactivate anchor watch',
      requestId: res.locals.requestId
    });
  }
});

// PUT /admin/api/anchor-watch/radius
router.put('/radius',
  validate(UpdateRadiusBodySchema, 'body'),
  async (req, res, next) => {
    try {
      const { radius_meters } = req.body;
      await anchorWatchService.updateRadius(radius_meters);

      return res.json({
        success: true,
        data: { message: 'Radius updated' },
        requestId: res.locals.requestId
      });
    } catch (error) {
      requestLogger.error('Error updating radius', { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Failed to update radius',
        requestId: res.locals.requestId
      });
    }
  }
);

export default router;
