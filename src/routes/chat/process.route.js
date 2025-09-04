import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { 
  ChatProcessEnvelope,
  chatProcessRequestSchema,
  chatProcessResponseSchema 
} from '../../schemas/chat.schema.js';

const router = express.Router();

// Apply service guards - chat processing requires Supabase, OpenAI, and Pinecone
router.use(requireServices(['supabase', 'openai', 'pinecone']));

// Apply response validation to all routes in this file
router.use(validateResponse(ChatProcessEnvelope));

// POST /chat/enhanced/process - Process chat message
router.post('/', 
  validate(chatProcessRequestSchema, 'body'),
  async (req, res, next) => {
    try {
      const { message, sessionId, threadId } = req.body;

      const result = await enhancedChatService.processUserMessage(message, {
        sessionId,
        threadId,
        contextSize: 5
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

// Method not allowed for all other methods
router.all('/', (req, res) => {
  return res.json({
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  }, 405);
});

export default router;
