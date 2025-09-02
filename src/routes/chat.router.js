import express from 'express';
import * as enhancedChatService from '../services/enhanced-chat.service.js';
import { validate } from '../middleware/validate.js';
import { 
  chatListQuerySchema, 
  chatListResponseSchema,
  chatProcessRequestSchema,
  chatHistoryQuerySchema,
  chatHistoryResponseSchema,
  chatContextQuerySchema,
  chatContextResponseSchema,
  chatDeleteRequestSchema,
  chatDeleteResponseSchema,
  chatDeletePathSchema
} from '../schemas/chat.schema.js';

const router = express.Router();

// POST /chat/enhanced/process - Process chat message
router.post('/process', async (req, res, next) => {
  try {
    const { message, sessionId, threadId } = req.body;
    
    if (!message || typeof message !== 'string') {
      const error = new Error('Message is required and must be a string');
      error.status = 400;
      throw error;
    }

    const result = await enhancedChatService.processUserMessage(message, {
      sessionId,
      threadId,
      contextSize: 5
    });

    res.json({
      success: true,
      data: {
        sessionId: result.sessionId,
        threadId: result.threadId,
        userMessage: {
          id: result.userMessage.id,
          content: result.userMessage.content,
          role: result.userMessage.role,
          createdAt: result.userMessage.created_at
        },
        assistantMessage: {
          id: result.assistantMessage.id,
          content: result.assistantMessage.content,
          role: result.assistantMessage.role,
          createdAt: result.assistantMessage.created_at,
          sources: result.assistantMessage.metadata?.sources || []
        },
        systemsContext: result.systemsContext,
        enhancedQuery: result.enhancedQuery,
        sources: result.sources
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

// GET /chat/enhanced/history - Get chat history
router.get('/history', async (req, res, next) => {
  try {
    const { threadId, limit } = req.query;

    const messages = await enhancedChatService.getChatHistory(threadId, { limit });

    const responseData = {
      success: true,
      data: {
        threadId: threadId,
        messages: messages.map(msg => ({
          id: msg.id,
          content: msg.content,
          role: msg.role,
          createdAt: msg.created_at,
          metadata: msg.metadata
        })),
        count: messages.length
      },
      timestamp: new Date().toISOString()
    };

    // Validate response data
    const responseValidation = chatHistoryResponseSchema.safeParse(responseData);
    if (!responseValidation.success) {
      throw new Error('Invalid response format');
    }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /chat/enhanced/list - List chat sessions
router.get('/list', async (req, res, next) => {
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

    // Validate response data
    const responseValidation = chatListResponseSchema.safeParse(responseData);
    if (!responseValidation.success) {
      throw new Error('Invalid response format');
    }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /chat/enhanced/context - Get chat context
router.get('/context', async (req, res, next) => {
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

    // Validate response data
    const responseValidation = chatContextResponseSchema.safeParse(responseData);
    if (!responseValidation.success) {
      throw new Error('Invalid response format');
    }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// DELETE /chat/enhanced/delete - Delete chat session
router.delete('/delete', async (req, res, next) => {
  try {
    const { sessionId } = req.body;

    await enhancedChatService.deleteChatSession(sessionId);

    const responseData = {
      success: true,
      data: {
        sessionId: sessionId,
        deleted: true
      },
      timestamp: new Date().toISOString()
    };

    // Validate response data
    const responseValidation = chatDeleteResponseSchema.safeParse(responseData);
    if (!responseValidation.success) {
      throw new Error('Invalid response format');
    }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// DELETE /chat/enhanced/:sessionId - Delete chat session by path parameter
router.delete('/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;

    await enhancedChatService.deleteChatSession(sessionId);

    const responseData = {
      success: true,
      data: {
        sessionId: sessionId,
        deleted: true
      },
      timestamp: new Date().toISOString()
    };

    // Validate response data
    const responseValidation = chatDeleteResponseSchema.safeParse(responseData);
    if (!responseValidation.success) {
      throw new Error('Invalid response format');
    }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

export default router;
