/**
 * Trip Tracking Routes
 * API endpoints for trip management
 */

import express from 'express';
import * as tripsService from '../../services/trips/trips.service.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

/**
 * GET /api/trips
 * List trips with optional filters
 */
router.get('/', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { status, limit, offset } = req.query;

    const trips = await tripsService.listTrips({
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined
    });

    return res.json({
      success: true,
      data: trips,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error listing trips', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/trips/active
 * Get the currently active trip (if any)
 */
router.get('/active', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const trip = await tripsService.getActiveTrip();

    return res.json({
      success: true,
      data: trip, // null if no active trip
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting active trip', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/trips/:id
 * Get single trip with all related data
 */
router.get('/:id', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;

    const tripData = await tripsService.getTrip(id);

    return res.json({
      success: true,
      data: tripData,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting trip', { error: error.message, tripId: req.params.id });
    const status = error.message.includes('not found') ? 404 : 500;
    return res.status(status).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/trips/:id/stats
 * Get live stats for active trip
 */
router.get('/:id/stats', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;

    const stats = await tripsService.getActiveTripStats(id);

    return res.json({
      success: true,
      data: stats,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting trip stats', { error: error.message, tripId: req.params.id });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/trips/start
 * Start a new trip
 */
router.post('/start', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const trip = await tripsService.startTrip();

    requestLogger.info('Trip started', { tripId: trip.id });

    return res.status(201).json({
      success: true,
      data: trip,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error starting trip', { error: error.message });
    const status = error.message.includes('already in progress') ? 409 : 500;
    return res.status(status).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/trips/:id/stop
 * Stop an active trip
 */
router.post('/:id/stop', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;

    const trip = await tripsService.stopTrip(id);

    requestLogger.info('Trip stopped', { tripId: id });

    return res.json({
      success: true,
      data: trip,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error stopping trip', { error: error.message, tripId: req.params.id });
    const status = error.message.includes('not found') ? 404 :
                   error.message.includes('not active') ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/trips/:id/resume
 * Resume a recently stopped trip (within 30 min)
 */
router.post('/:id/resume', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;

    const trip = await tripsService.resumeTrip(id);

    requestLogger.info('Trip resumed', { tripId: id });

    return res.json({
      success: true,
      data: trip,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error resuming trip', { error: error.message, tripId: req.params.id });
    const status = error.message.includes('not found') ? 404 :
                   error.message.includes('Cannot resume') ? 400 :
                   error.message.includes('already in progress') ? 409 : 500;
    return res.status(status).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * PATCH /api/trips/:id
 * Update trip (title)
 */
router.patch('/:id', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;
    const { title } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'Title is required',
        requestId: res.locals.requestId
      });
    }

    const trip = await tripsService.updateTrip(id, { title });

    return res.json({
      success: true,
      data: trip,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error updating trip', { error: error.message, tripId: req.params.id });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * DELETE /api/trips/:id
 * Delete trip and all related data
 */
router.delete('/:id', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;

    await tripsService.deleteTrip(id);

    requestLogger.info('Trip deleted', { tripId: id });

    return res.json({
      success: true,
      message: 'Trip deleted successfully',
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error deleting trip', { error: error.message, tripId: req.params.id });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/trips/:id/sail-event
 * Record a sail configuration change
 */
router.post('/:id/sail-event', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;
    const { main_sail, jib, code_zero, asym_spinnaker, notes } = req.body;

    const sailEvent = await tripsService.recordSailEvent(id, {
      main_sail,
      jib,
      code_zero,
      asym_spinnaker,
      notes
    });

    requestLogger.info('Sail event recorded', { tripId: id, sailEventId: sailEvent.id });

    return res.status(201).json({
      success: true,
      data: sailEvent,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error recording sail event', { error: error.message, tripId: req.params.id });
    const status = error.message.includes('not found') ? 404 :
                   error.message.includes('active trips') ? 400 : 500;
    return res.status(status).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/trips/:id/sail-events
 * Get all sail events for a trip
 */
router.get('/:id/sail-events', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;

    const sailEvents = await tripsService.getSailEvents(id);

    return res.json({
      success: true,
      data: sailEvents,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting sail events', { error: error.message, tripId: req.params.id });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/trips/:id/sail-config
 * Get current (latest) sail configuration
 */
router.get('/:id/sail-config', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;

    const sailConfig = await tripsService.getCurrentSailConfig(id);

    return res.json({
      success: true,
      data: sailConfig,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting sail config', { error: error.message, tripId: req.params.id });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/trips/collect-weather
 * Manually trigger weather collection for active trips (admin/testing)
 */
router.post('/collect-weather', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { triggerWeatherCollection } = await import('../../services/trips/weather-collector.service.js');
    await triggerWeatherCollection();

    requestLogger.info('Manual weather collection triggered');

    return res.json({
      success: true,
      message: 'Weather collection triggered',
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error triggering weather collection', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/trips/:id/comments
 * Add a comment to a trip
 */
router.post('/:id/comments', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;
    const { comment } = req.body;

    if (!comment || !comment.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Comment text is required',
        requestId: res.locals.requestId
      });
    }

    const data = await tripsService.addComment(id, comment.trim());

    return res.status(201).json({
      success: true,
      data,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error adding comment', { error: error.message, tripId: req.params.id });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/trips/:id/comments
 * Get comments for a trip
 */
router.get('/:id/comments', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;
    const comments = await tripsService.getComments(id);

    return res.json({
      success: true,
      data: comments,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting comments', { error: error.message, tripId: req.params.id });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * DELETE /api/trips/:id/comments/:commentId
 * Delete a comment
 */
router.delete('/:id/comments/:commentId', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id, commentId } = req.params;
    await tripsService.deleteComment(id, commentId);

    return res.json({
      success: true,
      message: 'Comment deleted',
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error deleting comment', { error: error.message, tripId: req.params.id });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

export default router;
