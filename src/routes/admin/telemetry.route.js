import express from 'express';
import { z } from 'zod';
import { validateResponse } from '../../middleware/validateResponse.js';
import { telemetryService } from '../../services/telemetry.service.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();
const requestLogger = logger.createRequestLogger();

// Unified response schema for all telemetry endpoints
const TelemetryEnvelopeSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  requestId: z.string().optional()
});

// Apply unified response validation to all routes
router.use(validateResponse(TelemetryEnvelopeSchema));

// GET /admin/api/telemetry/current
// Returns all current telemetry data grouped by category
router.get('/current', async (req, res) => {
  try {
    const telemetry = await telemetryService.getCurrentTelemetry();

    return res.json({
      success: true,
      data: telemetry,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting current telemetry', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to get telemetry data',
      requestId: res.locals.requestId
    });
  }
});

// GET /admin/api/telemetry/battery
// Returns detailed battery information
router.get('/battery', async (req, res) => {
  try {
    const battery = await telemetryService.getBatteryDetails();

    return res.json({
      success: true,
      data: battery,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting battery telemetry', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to get battery data',
      requestId: res.locals.requestId
    });
  }
});

// GET /admin/api/telemetry/solar
// Returns solar charger information
router.get('/solar', async (req, res) => {
  try {
    const solar = await telemetryService.getSolarDetails();

    return res.json({
      success: true,
      data: solar,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting solar telemetry', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to get solar data',
      requestId: res.locals.requestId
    });
  }
});

// GET /admin/api/telemetry/tanks
// Returns tank level information
router.get('/tanks', async (req, res) => {
  try {
    const tanks = await telemetryService.getTankDetails();

    return res.json({
      success: true,
      data: tanks,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting tank telemetry', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to get tank data',
      requestId: res.locals.requestId
    });
  }
});

export default router;
