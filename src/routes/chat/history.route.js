import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validate } from '../../middleware/validate.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { 
  chatHistoryQuerySchema,
  chatHistoryResponseSchema 
} from '../../schemas/chat.schema.js';

const router = express.Router();

// GET /chat/enhanced/history - Get chat history
router.get('/', 
  validate(chatHistoryQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { threadId, limit } = req.query;
      
      const messages = await enhancedChatService.getChatHistory(threadId, { limit });
      
      // Transform the data to match the schema
      const transformedMessages = messages.map(message => ({
        id: message.id,
        content: message.content,
        role: message.role,
        createdAt: message.created_at,
        metadata: message.metadata || {}
      }));
      
      const envelope = {
        success: true,
        data: {
          threadId,
          messages: transformedMessages,
          count: transformedMessages.length
        },
        timestamp: new Date().toISOString()
      };

      return res.json(enforceResponse(chatHistoryResponseSchema, envelope));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
