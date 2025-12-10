import express from 'express';
import { randomUUID } from 'crypto';
import { processChatMessage } from '../../services/chat-proxy.service.js';
import { validate } from '../../middleware/validate.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { methodNotAllowed } from '../../utils/methodNotAllowed.js';
import { logger } from '../../utils/logger.js';
import { chatProcessRequestSchema } from '../../schemas/chat.schema.js';

const router = express.Router();

// Simple chat processing endpoint - returns string assistantMessage
// Used by tests and external callers expecting a simple contract
router.post(
  '/',
  validate(chatProcessRequestSchema, 'body'),
  requireServices(['supabase', 'openai', 'pinecone', 'sidecar']),
  async (req, res, next) => {
    const startTime = Date.now();
    // Use requestId from middleware (req_ format) instead of creating new UUID
    const requestId = req.requestId || res.locals?.requestId;
    const requestLogger = logger.createRequestLogger(requestId);

    try {
      const message = req.body.message || req.body.query;
      const threadId = req.body.threadId || req.body.thread_id;

      if (!message) {
        throw new Error('Message or query is required');
      }

      requestLogger.debug('Simple chat request received', {
        threadId,
        messageLength: message.length
      });

      // Call chat-proxy service
      const result = await processChatMessage({
        query: message,
        threadId
      });

      // Normalize response to simple format
      // assistantMessage is always a STRING (not an object)
      let assistantMessage = result?.response;
      if (typeof assistantMessage !== 'string') {
        assistantMessage = result?.assistant_message ??
                          result?.assistantMessage ??
                          'Sorry, I was unable to generate a response.';
      }

      // sessionId for tests that expect it
      const sessionId = result?.sessionId ??
                       result?.session_id ??
                       threadId ??
                       randomUUID();

      const totalDuration = Date.now() - startTime;

      requestLogger.performance('simple_chat_processing', totalDuration, {
        responseLength: assistantMessage.length
      });

      // Simple envelope - assistantMessage is a string
      return res.json({
        success: true,
        data: {
          requestId, // Add requestId for traceability
          sessionId,
          assistantMessage,
          threadId: threadId || sessionId,
          telemetry: {
            requestId, // Also in telemetry for consistency
            processing_time_ms: result.processing_time_ms || totalDuration
          }
        }
      });
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      requestLogger.performance('simple_chat_processing_failed', totalDuration, {
        error: error.message
      });
      next(error);
    }
  }
);

// Catch-all AFTER; allow only POST on this leaf
router.all('/', methodNotAllowed);

export default router;
