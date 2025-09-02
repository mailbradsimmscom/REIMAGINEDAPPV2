import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validateResponse } from '../../middleware/responseValidation.js';
import { chatContextResponseSchema } from '../../schemas/chat.schema.js';

const router = express.Router();

// GET /chat/enhanced/context - Get chat context
router.get('/', validateResponse(chatContextResponseSchema, 'chat'), async (req, res, next) => {
  try {
    const { threadId } = req.query;

    const context = await enhancedChatService.getChatContext(threadId);

    const responseData = {
      success: true,
      data: {
        session: {
          id: context.session.id,
          name: context.session.name,
          description: context.session.description,
          createdAt: context.session.created_at,
          updatedAt: context.session.updated_at
        },
        thread: {
          id: context.thread.id,
          name: context.thread.name,
          createdAt: context.thread.created_at,
          updatedAt: context.thread.updated_at,
          metadata: context.thread.metadata
        },
        messages: context.messages.map(msg => ({
          id: msg.id,
          content: msg.content,
          role: msg.role,
          createdAt: msg.created_at,
          metadata: msg.metadata
        })),
        context: context.context
      },
      timestamp: new Date().toISOString()
    };

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

export default router;
