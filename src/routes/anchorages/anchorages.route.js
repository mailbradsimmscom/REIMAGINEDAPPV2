/**
 * Anchorages Routes
 * API endpoints for anchorage and mooring management
 */

import express from 'express';
import * as anchoragesService from '../../services/anchorages/anchorages.service.js';
import { uploadAnchoragePhoto } from '../../services/supplies/photo-storage.service.js';
import { anchoragesRepository } from '../../repositories/anchorages.repository.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

/**
 * GET /api/anchorages
 * List all anchorages with formatted fields
 */
router.get('/', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const anchorages = await anchoragesService.listAnchorages();

    return res.json({
      success: true,
      data: anchorages,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error listing anchorages', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/anchorages/:id
 * Get single anchorage by ID
 */
router.get('/:id', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;
    const anchorage = await anchoragesService.getAnchorage(id);

    if (!anchorage) {
      return res.status(404).json({
        success: false,
        error: 'Anchorage not found',
        requestId: res.locals.requestId
      });
    }

    return res.json({
      success: true,
      data: anchorage,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting anchorage', { error: error.message, id: req.params.id });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/anchorages/populate-names
 * Populate location names using reverse geocoding
 */
router.post('/populate-names', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const result = await anchoragesService.populateLocationNames();

    requestLogger.info('Location names populated', { updated: result.updated });

    return res.json({
      success: true,
      data: result,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error populating location names', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/anchorages/detect
 * Detect new anchorages from GPS history
 */
router.post('/detect', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { minHours } = req.body;
    const result = await anchoragesService.detectNewAnchorages(minHours || 2);

    requestLogger.info('Anchorage detection complete', {
      detected: result.detected,
      inserted: result.inserted
    });

    return res.json({
      success: true,
      data: result,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error detecting anchorages', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/anchorages
 * Create anchorage manually
 */
router.post('/', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const {
      location_name,
      latitude,
      longitude,
      arrived_at,
      departed_at,
      anchorage_type,
      scope_meters,
      avg_wind_speed,
      avg_wind_direction,
      notes
    } = req.body;

    if (!latitude || !longitude || !arrived_at) {
      return res.status(400).json({
        success: false,
        error: 'latitude, longitude, and arrived_at are required',
        requestId: res.locals.requestId
      });
    }

    const anchorage = await anchoragesService.createAnchorage({
      location_name,
      latitude,
      longitude,
      arrived_at,
      departed_at,
      anchorage_type: anchorage_type || 'anchor',
      scope_meters,
      avg_wind_speed,
      avg_wind_direction,
      notes
    });

    return res.status(201).json({
      success: true,
      data: anchorage,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error creating anchorage', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * PATCH /api/anchorages/:id
 * Update anchorage (location_name, type, scope, notes)
 */
router.patch('/:id', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;
    const { location_name, anchorage_type, scope_meters, notes, ratings } = req.body;

    // Validate ratings if provided
    const VALID_RATING_KEYS = [
      'entry_complexity', 'water_clarity', 'swell', 'wind',
      'sleep', 'swim', 'shore_landing', 'noise'
    ];

    if (ratings !== undefined) {
      if (ratings !== null && (typeof ratings !== 'object' || Array.isArray(ratings))) {
        return res.status(400).json({
          success: false,
          error: 'ratings must be a plain object or null',
          requestId: res.locals.requestId
        });
      }
      if (ratings !== null) {
        for (const [key, val] of Object.entries(ratings)) {
          if (!VALID_RATING_KEYS.includes(key)) {
            return res.status(400).json({
              success: false,
              error: `Invalid rating key: ${key}`,
              requestId: res.locals.requestId
            });
          }
          if (val !== null && (!Number.isInteger(val) || val < 1 || val > 10)) {
            return res.status(400).json({
              success: false,
              error: `Rating values must be integers 1-10 or null`,
              requestId: res.locals.requestId
            });
          }
        }
      }
    }

    const updates = {};
    if (location_name !== undefined) updates.location_name = location_name;
    if (anchorage_type !== undefined) updates.anchorage_type = anchorage_type;
    if (scope_meters !== undefined) updates.scope_meters = scope_meters;
    if (notes !== undefined) updates.notes = notes;
    if (ratings !== undefined) updates.ratings = ratings;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update',
        requestId: res.locals.requestId
      });
    }

    const anchorage = await anchoragesService.updateAnchorage(id, updates);

    return res.json({
      success: true,
      data: anchorage,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error updating anchorage', { error: error.message, id: req.params.id });
    const status = error.message.includes('not found') ? 404 : 500;
    return res.status(status).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/anchorages/:id/photo
 * Upload a photo for an anchorage
 */
router.post('/:id/photo', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;
    const { imageBase64, photoIndex = 1 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: 'imageBase64 is required',
        requestId: res.locals.requestId
      });
    }

    // Get current anchorage to check it exists and get existing photos
    const anchorage = await anchoragesRepository.findById(id);
    if (!anchorage) {
      return res.status(404).json({
        success: false,
        error: 'Anchorage not found',
        requestId: res.locals.requestId
      });
    }

    // Upload photo to Supabase Storage
    const photoUrl = await uploadAnchoragePhoto(id, imageBase64, photoIndex);

    // Update photos array in database
    const existingPhotos = anchorage.photos || [];
    const updatedPhotos = [...existingPhotos];
    updatedPhotos[photoIndex - 1] = photoUrl;

    await anchoragesRepository.update(id, { photos: updatedPhotos });

    requestLogger.info('Anchorage photo uploaded', { id, photoIndex, photoUrl });

    return res.json({
      success: true,
      data: { url: photoUrl, photos: updatedPhotos },
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error uploading anchorage photo', { error: error.message, id: req.params.id });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * DELETE /api/anchorages/:id
 * Delete anchorage
 */
router.delete('/:id', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;
    await anchoragesService.deleteAnchorage(id);

    return res.json({
      success: true,
      message: 'Anchorage deleted successfully',
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error deleting anchorage', { error: error.message, id: req.params.id });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

export default router;
