import express from 'express';
import { validate } from '../../middleware/validate.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { logger } from '../../utils/logger.js';
import { getEnv } from '../../config/env.js';
import chatFastService from '../../services/chat-fast.service.js';
import { fastChatRequestSchema, fastChatResponseSchema } from '../../schemas/chat.schema.js';

const router = express.Router();

router.use(requireServices(['supabase', 'openai', 'pinecone']));

// Fast chat endpoint for two-call mode
router.post('/',
  validate(fastChatRequestSchema, 'body'),
  async (req, res, next) => {
    const env = getEnv();
    const requestLogger = logger.createRequestLogger();

    // Check if two-call mode is enabled
    if (env.TWO_CALL_MODE !== 'true') {
      return res.status(503).json({
        success: false,
        error: {
          code: 'FEATURE_DISABLED',
          message: 'Two-call mode is disabled',
          details: 'This endpoint is only available when TWO_CALL_MODE is enabled'
        }
      });
    }

    try {
      const { message, threadId, sessionId, sequenceNumber, synthesisModel } = req.body;

      requestLogger.info('📨 Fast chat request received', {
        threadId,
        sessionId,
        sequenceNumber,
        messageLength: message.length
      });

      // Process fast chat
      const result = await chatFastService.processFastChat({
        message,
        threadId,
        sessionId,
        sequenceNumber,
        synthesisModel
      });

      requestLogger.info('✅ Fast chat response sent', {
        userMessageId: result.userMessage.id,
        assistantMessageId: result.assistantMessage.id,
        hasCachedState: !!result.cachedState
      });

      // Return fast response
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      requestLogger.error('❌ Fast chat failed', {
        error: error.message,
        stack: error.stack
      });

      // Handle specific error types
      if (error.message.includes('Python sidecar is not running')) {
        return res.status(503).json({
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Chat service is temporarily unavailable',
            details: error.message
          }
        });
      }

      if (error.message.includes('TWO_CALL_MODE')) {
        return res.status(503).json({
          success: false,
          error: {
            code: 'FEATURE_DISABLED',
            message: error.message
          }
        });
      }

      // Generic error response
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process chat message',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }
      });
    }
  }
);

// Reject non-POST methods
router.all('/', (req, res) => {
  res.status(405).json({
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `Method ${req.method} not allowed. Use POST.`
    }
  });
});

export default router;