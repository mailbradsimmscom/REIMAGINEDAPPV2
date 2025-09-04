import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { 
  ChatListEnvelope,
  chatListQuerySchema,
  chatListResponseSchema 
} from '../../schemas/chat.schema.js';

const router = express.Router();

// Apply response validation to all routes in this file
router.use(validateResponse(ChatListEnvelope));

// GET /chat/enhanced/list - List chat sessions
router.get('/', 
  validate(chatListQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { limit, cursor } = req.query;
      
      const chats = await enhancedChatService.listUserChats({ limit, cursor });
      
      // Transform the data to match the schema
      const transformedChats = chats.map(chat => ({
        id: chat.id,
        name: chat.name,
        description: chat.description || '',
        createdAt: chat.created_at,
        updatedAt: chat.updated_at,
        latestThread: chat.latestThread ? {
          id: chat.latestThread.id,
          name: chat.latestThread.name,
          createdAt: chat.latestThread.created_at,
          updatedAt: chat.latestThread.updated_at,
          metadata: chat.latestThread.metadata || {}
        } : undefined
      }));
      
      const envelope = {
        success: true,
        data: {
          chats: transformedChats,
          count: transformedChats.length,
          nextCursor: null // TODO: implement cursor pagination
        }
      };

      return enforceResponse(res, envelope, 200);
    } catch (error) {
      next(error);
    }
  }
);

// Method not allowed for all other methods
router.all('/', (req, res) => {
  return enforceResponse(res, {
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  }, 405);
});

export default router;
