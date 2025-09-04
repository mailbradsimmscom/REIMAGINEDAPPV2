import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validate } from '../../middleware/validate.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { ChatContextEnvelope } from '../../schemas/chat.schema.js';
import { 
  chatContextQuerySchema
} from '../../schemas/chat.schema.js';

const router = express.Router();

// Apply response validation to all routes in this file
router.use(validateResponse(ChatContextEnvelope));

// GET /chat/enhanced/context - Get chat context
router.get('/', 
  validate(chatContextQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { threadId } = req.query;
      
      const context = await enhancedChatService.getChatContext(threadId);
      
      // Transform the data to match the schema
      const transformedSession = {
        id: context.session.id,
        name: context.session.name,
        description: context.session.description || '',
        createdAt: context.session.created_at,
        updatedAt: context.session.updated_at
      };
      
      const transformedThread = {
        id: context.thread.id,
        name: context.thread.name,
        createdAt: context.thread.created_at,
        updatedAt: context.thread.updated_at,
        metadata: context.thread.metadata || {}
      };
      
      const transformedMessages = context.messages.map(message => ({
        id: message.id,
        content: message.content,
        role: message.role,
        createdAt: message.created_at,
        metadata: message.metadata || {}
      }));
      
      const envelope = {
        success: true,
        data: {
          session: transformedSession,
          thread: transformedThread,
          messages: transformedMessages,
          context: context.context
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
