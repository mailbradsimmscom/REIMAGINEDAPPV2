import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validateResponse } from '../../middleware/responseValidation.js';
import { chatListResponseSchema } from '../../schemas/chat.schema.js';

const router = express.Router();

// GET /chat/enhanced/list - List chat sessions
router.get('/', validateResponse(chatListResponseSchema, 'chat'), async (req, res, next) => {
  try {
    const { limit, cursor } = req.query;

    const chats = await enhancedChatService.listUserChats({ limit, cursor });

    const responseData = {
      success: true,
      data: {
        chats: chats.map(chat => ({
          id: chat.id,
          name: chat.name,
          description: chat.description,
          createdAt: chat.created_at,
          updatedAt: chat.updated_at,
          latestThread: chat.latestThread ? {
            id: chat.latestThread.id,
            name: chat.latestThread.name,
            createdAt: chat.latestThread.created_at,
            updatedAt: chat.latestThread.updated_at,
            metadata: chat.latestThread.metadata
          } : undefined
        })),
        count: chats.length,
        nextCursor: chats.length > 0 ? chats[chats.length - 1].id : undefined
      },
      timestamp: new Date().toISOString()
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

export default router;
