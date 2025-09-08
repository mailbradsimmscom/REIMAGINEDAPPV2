import express from 'express';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { methodNotAllowed } from '../../utils/methodNotAllowed.js';
import { z } from 'zod';
import chatRepository from '../../repositories/chat.repository.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

// Schema for path parameters
const threadBySessionSchema = z.object({
  sessionId: z.string().uuid()
});

// Schema for response envelope
const ThreadResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    sessionId: z.string(),
    threads: z.array(z.object({
      id: z.string(),
      name: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      metadata: z.record(z.any()).optional(),
      messages: z.array(z.object({
        id: z.string(),
        content: z.string(),
        role: z.enum(['user', 'assistant']),
        createdAt: z.string(),
        metadata: z.record(z.any()).optional()
      }))
    }))
  }).optional(),
  error: z.object({
    code: z.string(),
    message: z.string()
  }).optional(),
  requestId: z.string().optional()
});

router.use(validateResponse(ThreadResponseSchema));

// GET /chat/thread/:sessionId - Get chat threads with messages for a session
router.get(
  '/:sessionId',
  validate(threadBySessionSchema, 'params'),
  async (req, res, next) => {
    try {
      const { sessionId } = req.params;
      const requestLogger = logger.createRequestLogger();
      
      requestLogger.info('Getting chat threads for session', { sessionId });
      
      // Get all threads for this session
      const threads = await chatRepository.listChatThreads(sessionId, { limit: 50 });
      
      // For each thread, get its messages
      const threadsWithMessages = await Promise.all(
        threads.map(async (thread) => {
          try {
            const messages = await chatRepository.getChatMessages(thread.id, { limit: 100 });
            return {
              id: thread.id,
              name: thread.name,
              createdAt: thread.created_at,
              updatedAt: thread.updated_at,
              metadata: thread.metadata || {},
              messages: messages.map(msg => ({
                id: msg.id,
                content: msg.content,
                role: msg.role,
                createdAt: msg.created_at,
                metadata: msg.metadata || {}
              }))
            };
          } catch (error) {
            requestLogger.warn('Failed to get messages for thread', { 
              threadId: thread.id, 
              error: error.message 
            });
            return {
              id: thread.id,
              name: thread.name,
              createdAt: thread.created_at,
              updatedAt: thread.updated_at,
              metadata: thread.metadata || {},
              messages: []
            };
          }
        })
      );
      
      const envelope = {
        success: true,
        data: {
          sessionId,
          threads: threadsWithMessages
        }
      };

      return res.json(envelope);
    } catch (error) {
      next(error);
    }
  }
);

// Catch-all for unsupported methods
router.all('/:sessionId', methodNotAllowed);

export default router;
