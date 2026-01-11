/**
 * Season Recap Routes
 * API endpoints for generating and retrieving season recaps
 */

import express from 'express';
import * as seasonRecapService from '../../services/season-recap/season-recap.service.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

/**
 * GET /api/season-recap
 * Get all stored recaps (boring, exciting, unhinged)
 */
router.get('/', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const recaps = await seasonRecapService.getAllRecaps();

    return res.json({
      success: true,
      data: recaps,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error fetching recaps', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/season-recap/:style
 * Get a specific recap by style
 */
router.get('/:style', async (req, res) => {
  const requestLogger = logger.createRequestLogger();
  const { style } = req.params;

  if (!['boring', 'exciting', 'unhinged'].includes(style)) {
    return res.status(400).json({
      success: false,
      error: 'Style must be "boring", "exciting", or "unhinged"',
      requestId: res.locals.requestId
    });
  }

  try {
    const recap = await seasonRecapService.getRecap(style);

    return res.json({
      success: true,
      data: recap,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error fetching recap', { style, error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/season-recap/:style/generate
 * Generate a new recap for the specified style
 */
router.post('/:style/generate', async (req, res) => {
  const requestLogger = logger.createRequestLogger();
  const { style } = req.params;

  if (!['boring', 'exciting', 'unhinged'].includes(style)) {
    return res.status(400).json({
      success: false,
      error: 'Style must be "boring", "exciting", or "unhinged"',
      requestId: res.locals.requestId
    });
  }

  try {
    requestLogger.info('Generating recap', { style });

    const recap = await seasonRecapService.generateRecap(style);

    requestLogger.info('Recap generated successfully', {
      style,
      id: recap.id,
      contentLength: recap.content?.length
    });

    return res.json({
      success: true,
      data: recap,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error generating recap', { style, error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

export default router;
