import express from 'express';
import { validate } from '../../middleware/validate.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { logger } from '../../utils/logger.js';
import { getEnv } from '../../config/env.js';
import chatFastService from '../../services/chat-fast.service.js';
import { webEnrichRequestSchema, webEnrichResponseSchema } from '../../schemas/chat.schema.js';

const router = express.Router();

router.use(requireServices(['supabase', 'openai', 'pinecone']));

// Web enrichment endpoint for two-call mode
router.post('/',
  validate(webEnrichRequestSchema, 'body'),
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
      const { threadId, sequenceNumber, messageId, cachedState } = req.body;

      requestLogger.info('🌐 Web enrichment request received', {
        threadId,
        messageId,
        sequenceNumber,
        hasCachedState: !!cachedState
      });

      // Process web enrichment
      const result = await chatFastService.processWebEnrichment({
        threadId,
        sequenceNumber,
        messageId,
        cachedState
      });

      requestLogger.info('✅ Web enrichment completed', {
        messageId: result.messageId,
        sourcesCount: result.webSources?.length || 0,
        isComplete: result.isComplete
      });

      // Return enriched response
      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      requestLogger.error('❌ Web enrichment failed', {
        error: error.message,
        messageId: req.body.messageId,
        stack: error.stack
      });

      // Handle specific error types
      if (error.message.includes('Python sidecar is not running')) {
        return res.status(503).json({
          success: false,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Enrichment service is temporarily unavailable',
            details: error.message
          }
        });
      }

      if (error.message.includes('timed out')) {
        return res.status(504).json({
          success: false,
          error: {
            code: 'TIMEOUT',
            message: 'Web enrichment timed out',
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
          message: 'Failed to enrich message with web content',
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