import express from 'express';
import * as enhancedChatService from '../services/enhanced-chat.service.js';
import { 
  chatListQuerySchema, 
  chatListResponseSchema,
  chatProcessRequestSchema,
  chatHistoryQuerySchema,
  chatHistoryResponseSchema,
  chatDeleteRequestSchema,
  chatDeleteResponseSchema
} from '../schemas/chat.schema.js';

const router = express.Router();

// POST /chat/enhanced/process - Process chat message
router.post('/process', async (req, res, next) => {
  try {
    const { message, sessionId, threadId } = req.body;
    
    // Validate request body
    const validationResult = chatProcessRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      const error = new Error('Invalid request data');
      error.name = 'ZodError';
      error.errors = validationResult.error.errors;
      throw error;
    }

    const { message: validatedMessage, sessionId: validatedSessionId, threadId: validatedThreadId } = validationResult.data;
    
    if (!validatedMessage || typeof validatedMessage !== 'string') {
      const error = new Error('Message is required and must be a string');
      error.status = 400;
      throw error;
    }

    const result = await enhancedChatService.processUserMessage(validatedMessage, {
      sessionId: validatedSessionId,
      threadId: validatedThreadId,
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

    // Validate query parameters
    const validationResult = chatHistoryQuerySchema.safeParse({ threadId, limit });
    if (!validationResult.success) {
      const error = new Error('Invalid query parameters');
      error.name = 'ZodError';
      error.errors = validationResult.error.errors;
      throw error;
    }

    const { threadId: validatedThreadId, limit: validatedLimit } = validationResult.data;

    const messages = await enhancedChatService.getChatHistory(validatedThreadId, { limit: validatedLimit });

    const responseData = {
      success: true,
      data: {
        threadId: validatedThreadId,
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
    // TODO: Re-enable response validation after debugging Zod schema issues
    // const responseValidation = chatHistoryResponseSchema.safeParse(responseData);
    // if (!responseValidation.success) {
    //   throw new Error('Invalid response format');
    // }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /chat/enhanced/list - List chat sessions
router.get('/list', async (req, res, next) => {
  try {
    const { limit, cursor } = req.query;

    // Validate query parameters
    const validationResult = chatListQuerySchema.safeParse({ limit, cursor });
    if (!validationResult.success) {
      const error = new Error('Invalid query parameters');
      error.name = 'ZodError';
      error.errors = validationResult.error.errors;
      throw error;
    }

    const { limit: validatedLimit, cursor: validatedCursor } = validationResult.data;

    const chats = await enhancedChatService.listUserChats({ limit: validatedLimit, cursor: validatedCursor });

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
    // TODO: Re-enable response validation after debugging
    // const responseValidation = chatListResponseSchema.safeParse(responseData);
    // if (!responseValidation.success) {
    //   throw new Error('Invalid response format');
    // }

    res.json(responseData);
  } catch (error) {
    next(error);
  }
});

// GET /chat/enhanced/context - Get chat context
router.get('/context', async (req, res, next) => {
  try {
    const { threadId } = req.query;

    if (!threadId) {
      const error = new Error('threadId is required');
      error.status = 400;
      throw error;
    }

    const context = await enhancedChatService.getChatContext(threadId);

    res.json({
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
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /chat/enhanced/delete - Delete chat session
router.delete('/delete', async (req, res, next) => {
  try {
    const { sessionId } = req.body;

    // Validate request body
    const validationResult = chatDeleteRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      const error = new Error('Invalid request data');
      error.name = 'ZodError';
      error.errors = validationResult.error.errors;
      throw error;
    }

    const { sessionId: validatedSessionId } = validationResult.data;

    await enhancedChatService.deleteChatSession(validatedSessionId);

    const responseData = {
      success: true,
      data: {
        sessionId: validatedSessionId,
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
