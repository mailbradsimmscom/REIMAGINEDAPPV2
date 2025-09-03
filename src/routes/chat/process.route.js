import express from 'express';
import * as enhancedChatService from '../../services/enhanced-chat.service.js';
import { validate } from '../../middleware/validate.js';
import { enforceResponse } from '../../middleware/enforceResponse.js';
import { methodNotAllowed } from '../../middleware/methodNotAllowed.js';
import { 
  chatProcessRequestSchema,
  chatProcessResponseSchema 
} from '../../schemas/chat.schema.js';

const router = express.Router();

// Add method not allowed for non-POST requests
router.all('/', methodNotAllowed);

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
