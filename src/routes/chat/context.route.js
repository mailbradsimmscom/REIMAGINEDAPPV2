import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validate } from '../../middleware/validate.js';
import { 
  chatContextQuerySchema,
  chatContextResponseSchema 
} from '../../schemas/chat.schema.js';

const router = express.Router();

// GET /chat/enhanced/context - Get chat context
router.get('/', 
  validate(chatContextQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { threadId } = req.query;
      
      const context = await enhancedChatService.getChatContext(threadId);
      
      res.json({
        success: true,
        data: {
          session: context.session,
          thread: context.thread,
          messages: context.messages,
          context: context.context
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
