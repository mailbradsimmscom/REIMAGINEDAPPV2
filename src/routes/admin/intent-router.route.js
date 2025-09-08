import express from 'express';
import { z } from 'zod';
import { adminOnly } from '../../middleware/admin.js';
import { validate } from '../../middleware/validate.js';
import intentRepository from '../../repositories/intent.repository.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();
const requestLogger = logger.createRequestLogger();

// Validation schemas
const createIntentRouteSchema = z.object({
  pattern: z.string().min(1, 'Pattern is required').max(200, 'Pattern too long'),
  intent: z.string().min(1, 'Intent is required').max(100, 'Intent too long'),
  route_to: z.string().min(1, 'Route destination is required').max(200, 'Route too long'),
  intent_hint_id: z.string().uuid().optional().nullable()
});

const updateIntentRouteSchema = createIntentRouteSchema.partial();

const intentRouteParamsSchema = z.object({
  id: z.string().uuid('Invalid route ID')
});

// GET /admin/intent-router - Get all intent routes
router.get('/', adminOnly, async (req, res) => {
  try {
    const filters = {
      pattern: req.query.pattern,
      intent: req.query.intent
    };

    const result = await intentRepository.getAllIntentRoutes(filters);
    
    res.json({
      success: true,
      data: result.data,
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('Failed to get intent routes', { error: error.message, query: req.query });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve intent routes',
      requestId: req.id
    });
  }
});

// GET /admin/intent-router/stats - Get intent route statistics
router.get('/stats', adminOnly, async (req, res) => {
  try {
    const result = await intentRepository.getIntentRouteStats();
    
    res.json({
      success: true,
      data: result.data,
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('Failed to get intent route stats', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve intent route statistics',
      requestId: req.id
    });
  }
});

// GET /admin/intent-router/:id - Get specific intent route
router.get('/:id', adminOnly, validate(intentRouteParamsSchema, 'params'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await intentRepository.getIntentRouteById(id);
    
    if (!result.data) {
      return res.status(404).json({
        success: false,
        error: 'Intent route not found',
        requestId: req.id
      });
    }
    
    res.json({
      success: true,
      data: result.data,
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('Failed to get intent route by ID', { error: error.message, id: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve intent route',
      requestId: req.id
    });
  }
});

// POST /admin/intent-router - Create new intent route
router.post('/', adminOnly, validate(createIntentRouteSchema, 'body'), async (req, res) => {
  try {
    const routeData = req.body;
    const createdBy = req.user?.id || 'admin';
    
    const result = await intentRepository.createIntentRoute(routeData, createdBy);
    
    requestLogger.info('Intent route created', { 
      id: result.data.id, 
      pattern: result.data.pattern,
      intent: result.data.intent,
      createdBy 
    });
    
    res.status(201).json({
      success: true,
      data: result.data,
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('Failed to create intent route', { error: error.message, body: req.body });
    res.status(500).json({
      success: false,
      error: 'Failed to create intent route',
      requestId: req.id
    });
  }
});

// PUT /admin/intent-router/:id - Update intent route
router.put('/:id', adminOnly, validate(updateIntentRouteSchema, 'body'), validate(intentRouteParamsSchema, 'params'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const updatedBy = req.user?.id || 'admin';
    
    // Check if route exists
    const existingRoute = await intentRepository.getIntentRouteById(id);
    if (!existingRoute.data) {
      return res.status(404).json({
        success: false,
        error: 'Intent route not found',
        requestId: req.id
      });
    }
    
    const result = await intentRepository.updateIntentRoute(id, updates, updatedBy);
    
    requestLogger.info('Intent route updated', { 
      id, 
      updates,
      updatedBy 
    });
    
    res.json({
      success: true,
      data: result.data,
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('Failed to update intent route', { error: error.message, id: req.params.id, body: req.body });
    res.status(500).json({
      success: false,
      error: 'Failed to update intent route',
      requestId: req.id
    });
  }
});

// DELETE /admin/intent-router/:id - Delete intent route
router.delete('/:id', adminOnly, validate(intentRouteParamsSchema, 'params'), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if route exists
    const existingRoute = await intentRepository.getIntentRouteById(id);
    if (!existingRoute.data) {
      return res.status(404).json({
        success: false,
        error: 'Intent route not found',
        requestId: req.id
      });
    }
    
    await intentRepository.deleteIntentRoute(id);
    
    requestLogger.info('Intent route deleted', { id });
    
    res.json({
      success: true,
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('Failed to delete intent route', { error: error.message, id: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to delete intent route',
      requestId: req.id
    });
  }
});

// POST /admin/intent-router/match - Find matching route for a query
router.post('/match', adminOnly, validate(z.object({ query: z.string().min(1, 'Query is required') }), 'body'), async (req, res) => {
  try {
    const { query } = req.body;
    const result = await intentRepository.findMatchingRoute(query);
    
    res.json({
      success: true,
      data: result.data,
      requestId: req.id
    });
  } catch (error) {
    requestLogger.error('Failed to find matching route', { error: error.message, query: req.body.query });
    res.status(500).json({
      success: false,
      error: 'Failed to find matching route',
      requestId: req.id
    });
  }
});

export default router;
