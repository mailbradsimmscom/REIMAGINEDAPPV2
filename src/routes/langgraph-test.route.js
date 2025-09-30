// src/routes/langgraph-test.route.js
// Test routes for LangGraph proof-of-concept

import { Router } from 'express';
import { processUserMessage, compareOrchestrators, getOrchestratorStatus } from '../services/langgraph-integration.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * Test LangGraph orchestrator with a simple query
 */
router.post('/test', async (req, res) => {
  try {
    const { query, sessionId, threadId } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const result = await processUserMessage(query, { sessionId, threadId });

    res.json({
      success: true,
      result,
      meta: {
        orchestrator: process.env.USE_LANGGRAPH === 'true' ? 'LangGraph' : 'Current',
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('LangGraph test failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Compare both orchestrators with the same query
 */
router.post('/compare', async (req, res) => {
  try {
    const { query, sessionId, threadId } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const comparison = await compareOrchestrators(query, { sessionId, threadId });

    res.json({
      success: true,
      comparison,
      meta: {
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Orchestrator comparison failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get orchestrator status
 */
router.get('/status', async (req, res) => {
  try {
    const status = getOrchestratorStatus();

    res.json({
      success: true,
      status,
      meta: {
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Failed to get orchestrator status', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Health check for LangGraph services
 */
router.get('/health', async (req, res) => {
  try {
    // Basic health check - ensure services can be imported
    const { chatWorkflow } = await import('../services/langgraph-chat.service.js');

    res.json({
      success: true,
      health: {
        langGraph: 'available',
        workflow: 'compiled',
        dependencies: 'loaded'
      },
      meta: {
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('LangGraph health check failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
      health: {
        langGraph: 'unavailable',
        workflow: 'failed',
        dependencies: 'error'
      }
    });
  }
});

export default router;