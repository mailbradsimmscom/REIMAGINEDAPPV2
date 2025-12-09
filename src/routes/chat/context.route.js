import express from 'express';
import { getChatThread, getChatSession, getChatMessages } from '../../repositories/chat.repository.js';
import { getWeightedConversationContext } from '../../services/conversation-context.service.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { ChatContextEnvelope } from '../../schemas/chat.schema.js';
import {
  chatContextQuerySchema
} from '../../schemas/chat.schema.js';

const router = express.Router();

// Apply response validation to all routes in this file
router.use(validateResponse(ChatContextEnvelope));

// GET /chat/context - Get chat context with conversation memory
router.get('/',
  validate(chatContextQuerySchema, 'query'),
  requireServices(['supabase']),
  async (req, res, next) => {
    try {
      const { threadId } = req.query;

      // Get thread, session, messages, and weighted context
      const thread = await getChatThread(threadId);
      const session = await getChatSession(thread.session_id);
      const messages = await getChatMessages(threadId, { limit: 50 });
      const conversationContext = await getWeightedConversationContext(threadId);

      const context = {
        session,
        thread,
        messages,
        context: conversationContext
      };
      
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

      return res.json(envelope);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
