import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validateResponse } from '../../middleware/responseValidation.js';
import { chatHistoryResponseSchema } from '../../schemas/chat.schema.js';

const router = express.Router();

// GET /chat/enhanced/history - Get chat history
router.get('/', validateResponse(chatHistoryResponseSchema, 'chat'), async (req, res, next) => {
  try {
    const { threadId, limit } = req.query;

    const messages = await enhancedChatService.getChatHistory(threadId, { limit });

    const responseData = {
      success: true,
      data: {
        threadId: threadId,
        messages: messages.map(msg => ({
          id: msg.id,
          content: msg.content,
          role: msg.role,
          createdAt: msg.created_at,
          metadata: msg.metadata
        })),
        count: messages.length
      },
      timestamp: new Date().toISOString()
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

export default router;
