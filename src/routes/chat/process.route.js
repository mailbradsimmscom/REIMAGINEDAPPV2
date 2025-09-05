import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { methodNotAllowed } from '../../utils/methodNotAllowed.js';
import { getEnv } from '../../config/env.js';
import { 
  ChatProcessEnvelope,
  chatProcessRequestSchema,
  chatProcessResponseSchema 
} from '../../schemas/chat.schema.js';

const router = express.Router();

// DEBUG: Add process route tracing
router.use((req, res, next) => {
  console.log('🔍 [PROCESS] ROUTE:', req.method, req.originalUrl, '→', req.url, 'path:', req.path);
  next();
});

router.use(requireServices(['supabase','openai','pinecone']));
router.use(validateResponse(ChatProcessEnvelope));

// MUST be '/'
router.post(
  '/',
  validate(chatProcessRequestSchema, 'body'),
  async (req, res, next) => {
    try {
      const { message, sessionId, threadId } = req.body;

      const env = getEnv();
      const contextSize = parseInt(env.CHAT_CONTEXT_SIZE) || 5;
      
      const result = await enhancedChatService.processUserMessage(message, {
        sessionId,
        threadId,
        contextSize
      });

      const envelope = {
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
        }
      };

      return res.json(envelope);
    } catch (error) {
      next(error);
    }
  }
);

// Catch-all AFTER; allow only POST on this leaf
router.all('/', methodNotAllowed);

export default router;
