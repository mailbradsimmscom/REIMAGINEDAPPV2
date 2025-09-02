import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validateResponse } from '../../middleware/responseValidation.js';
import { chatProcessResponseSchema } from '../../schemas/chat.schema.js';

const router = express.Router();

// POST /chat/enhanced/process - Process chat message
router.post('/', validateResponse(chatProcessResponseSchema, 'chat'), async (req, res, next) => {
  try {
    const { message, sessionId, threadId } = req.body;
    
    if (!message || typeof message !== 'string') {
      const error = new Error('Message is required and must be a string');
      error.status = 400;
      throw error;
    }

    const result = await enhancedChatService.processUserMessage(message, {
      sessionId,
      threadId,
      contextSize: 5
    });

    res.json({
      success: true,
      data: {
        sessionId: result.sessionId,
        threadId: result.threadId,
        userMessage: {
          id: result.userMessage.id,
          content: result.userMessage.content,
          role: result.userMessage.role,
          createdAt: result.userMessage.created_at
        },
        assistantMessage: {
          id: result.assistantMessage.id,
          content: result.assistantMessage.content,
          role: result.assistantMessage.role,
          createdAt: result.assistantMessage.created_at,
          sources: result.assistantMessage.metadata?.sources || []
        },
        systemsContext: result.systemsContext,
        enhancedQuery: result.enhancedQuery,
        sources: result.sources
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

export default router;
