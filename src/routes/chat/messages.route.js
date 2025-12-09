import { Router } from 'express';
import {
  createChatMessageWithSequence,
  getMessagesByThreadWithSequence,
  incrementThreadMessageCount,
  decrementThreadMessageCount,
  deleteChatMessageBySequence
} from '../../repositories/chat.repository.js';
import { checkAndGenerateSummary, checkAndGenerateQASummary } from '../../services/thread-summary.service.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { logger } from '../../utils/logger.js';
import { getEnv } from '../../config/env.js';

const router = Router();

router.post('/messages', requireServices(['supabase']), async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { threadId, role, content, sequenceNumber, metadata } = req.body;

    if (!threadId) {
      return res.status(400).json({
        error: 'Thread ID is required',
        details: 'Must provide thread ID for message'
      });
    }

    if (!sequenceNumber) {
      return res.status(400).json({
        error: 'Sequence number is required',
        details: 'Frontend must provide sequence number'
      });
    }

    if (!role || !['user', 'assistant'].includes(role)) {
      return res.status(400).json({
        error: 'Invalid role',
        details: 'Role must be "user" or "assistant"'
      });
    }

    requestLogger.info('Creating chat message with sequence', {
      threadId,
      role,
      sequenceNumber,
      contentLength: content?.length || 0
    });

    const message = await createChatMessageWithSequence({
      threadId,
      role,
      content,
      sequenceNumber,
      metadata
    });

    await incrementThreadMessageCount(threadId);

    requestLogger.info('✅ Chat message created', {
      messageId: message.id,
      threadId: message.thread_id,
      sequenceNumber: message.sequence_number
    });

    // Check if we need to generate a thread summary (async, don't block response)
    checkAndGenerateSummary(threadId, sequenceNumber, role);

    // Check if we need to generate a QA summary (async, don't block response)
    checkAndGenerateQASummary(threadId, sequenceNumber, role);

    return res.status(201).json({
      success: true,
      message
    });

  } catch (error) {
    requestLogger.error('❌ Failed to create chat message', {
      error: error.message,
      stack: error.stack,
      threadId: req.body.threadId,
      sequenceNumber: req.body.sequenceNumber,
      role: req.body.role
    });

    const env = getEnv();
    return res.status(500).json({
      error: 'Failed to create chat message',
      details: error.message,
      stack: env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

router.get('/messages/:threadId', requireServices(['supabase']), async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { threadId } = req.params;
    const { limit, afterSequence } = req.query;

    requestLogger.info('Fetching chat messages', {
      threadId,
      limit: limit ? parseInt(limit) : 50,
      afterSequence: afterSequence ? parseInt(afterSequence) : null
    });

    const messages = await getMessagesByThreadWithSequence(threadId, {
      limit: limit ? parseInt(limit) : 50,
      afterSequence: afterSequence ? parseInt(afterSequence) : null
    });

    return res.status(200).json({
      success: true,
      messages,
      count: messages.length
    });

  } catch (error) {
    requestLogger.error('❌ Failed to fetch chat messages', {
      error: error.message,
      threadId: req.params.threadId
    });

    return res.status(500).json({
      error: 'Failed to fetch chat messages',
      details: error.message
    });
  }
});

router.delete('/messages/:threadId/:sequenceNumber', requireServices(['supabase']), async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { threadId, sequenceNumber } = req.params;

    requestLogger.info('Deleting chat message', {
      threadId,
      sequenceNumber: parseInt(sequenceNumber)
    });

    await deleteChatMessageBySequence(threadId, parseInt(sequenceNumber));

    await decrementThreadMessageCount(threadId);

    requestLogger.info('✅ Chat message deleted', {
      threadId,
      sequenceNumber: parseInt(sequenceNumber)
    });

    return res.status(200).json({
      success: true,
      message: 'Message deleted successfully'
    });

  } catch (error) {
    requestLogger.error('❌ Failed to delete chat message', {
      error: error.message,
      threadId: req.params.threadId,
      sequenceNumber: req.params.sequenceNumber
    });

    return res.status(500).json({
      error: 'Failed to delete chat message',
      details: error.message
    });
  }
});

export default router;