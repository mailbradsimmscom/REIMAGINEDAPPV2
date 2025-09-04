import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validate } from '../../middleware/validate.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { ChatHistoryEnvelope } from '../../schemas/chat.schema.js';
import { 
  chatHistoryQuerySchema
} from '../../schemas/chat.schema.js';

const router = express.Router();

// Apply response validation to all routes in this file
router.use(validateResponse(ChatHistoryEnvelope));

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

      return enforceResponse(res, envelope, 200);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
