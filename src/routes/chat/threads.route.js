import { Router } from 'express';
import { createChatThreadWithId, getChatThread } from '../../repositories/chat.repository.js';
import { logger } from '../../utils/logger.js';

const router = Router();

router.post('/threads', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id, name, metadata } = req.body;

    if (!id) {
      return res.status(400).json({
        error: 'Thread ID is required',
        details: 'Frontend must provide thread ID'
      });
    }

    requestLogger.info('Creating chat thread with frontend-provided ID', {
      threadId: id,
      name: name || 'New Thread'
    });

    const thread = await createChatThreadWithId({
      id,
      name,
      metadata
    });

    requestLogger.info('✅ Chat thread created', {
      threadId: thread.id
    });

    return res.status(201).json({
      success: true,
      thread
    });

  } catch (error) {
    requestLogger.error('❌ Failed to create chat thread', {
      error: error.message,
      threadId: req.body.id
    });

    return res.status(500).json({
      error: 'Failed to create chat thread',
      details: error.message
    });
  }
});

router.get('/threads/:threadId', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { threadId } = req.params;

    requestLogger.info('Fetching chat thread', { threadId });

    const thread = await getChatThread(threadId);

    return res.status(200).json({
      success: true,
      thread
    });

  } catch (error) {
    requestLogger.error('❌ Failed to fetch chat thread', {
      error: error.message,
      threadId: req.params.threadId
    });

    if (error.message.includes('No chat thread found')) {
      return res.status(404).json({
        error: 'Thread not found',
        details: error.message
      });
    }

    return res.status(500).json({
      error: 'Failed to fetch chat thread',
      details: error.message
    });
  }
});

export default router;