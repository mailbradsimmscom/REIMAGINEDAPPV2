import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validateResponse } from '../../middleware/responseValidation.js';
import { validate } from '../../middleware/validate.js';
import { 
  chatHistoryQuerySchema,
  chatHistoryResponseSchema 
} from '../../schemas/chat.schema.js';

const router = express.Router();

// GET /chat/enhanced/history - Get chat history
router.get('/', 
  validate(chatHistoryQuerySchema, 'query'),
  validateResponse(chatHistoryResponseSchema, 'chat'), 
  async (req, res, next) => {
    try {
      const { threadId, limit } = req.query;
      
      const history = await enhancedChatService.getChatHistory(threadId, { limit });
      
      res.json({
        success: true,
        data: {
          threadId,
          messages: history.messages,
          count: history.messages.length
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
