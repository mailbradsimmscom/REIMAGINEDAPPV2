import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validate } from '../../middleware/validate.js';
import { 
  chatListQuerySchema,
  chatListResponseSchema 
} from '../../schemas/chat.schema.js';

const router = express.Router();

// GET /chat/enhanced/list - List chat sessions
router.get('/', 
  validate(chatListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { limit, cursor } = req.query;
      
      const chats = await enhancedChatService.listUserChats({ limit, cursor });
      
      res.json({
        success: true,
        data: {
          chats: chats.chats,
          count: chats.chats.length,
          nextCursor: chats.nextCursor
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
