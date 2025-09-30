import { Router } from 'express';
import { createChatSessionWithId, getChatSession } from '../../repositories/chat.repository.js';
import { logger } from '../../utils/logger.js';

const router = Router();

router.post('/sessions', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id, name, description, metadata } = req.body;

    if (!id) {
      return res.status(400).json({
        error: 'Session ID is required',
        details: 'Frontend must provide session ID'
      });
    }

    requestLogger.info('Creating chat session with frontend-provided ID', {
      sessionId: id,
      name: name || 'New Chat'
    });

    const session = await createChatSessionWithId({
      id,
      name,
      description,
      metadata
    });

    requestLogger.info('✅ Chat session created', {
      sessionId: session.id
    });

    return res.status(201).json({
      success: true,
      session
    });

  } catch (error) {
    requestLogger.error('❌ Failed to create chat session', {
      error: error.message,
      sessionId: req.body.id
    });

    return res.status(500).json({
      error: 'Failed to create chat session',
      details: error.message
    });
  }
});

router.get('/sessions/:sessionId', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { sessionId } = req.params;

    requestLogger.info('Fetching chat session', { sessionId });

    const session = await getChatSession(sessionId);

    return res.status(200).json({
      success: true,
      session
    });

  } catch (error) {
    requestLogger.error('❌ Failed to fetch chat session', {
      error: error.message,
      sessionId: req.params.sessionId
    });

    if (error.message.includes('No chat session found')) {
      return res.status(404).json({
        error: 'Session not found',
        details: error.message
      });
    }

    return res.status(500).json({
      error: 'Failed to fetch chat session',
      details: error.message
    });
  }
});

export default router;