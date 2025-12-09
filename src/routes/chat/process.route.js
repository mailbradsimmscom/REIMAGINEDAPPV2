import express from 'express';
import { processChatMessage } from '../../services/chat-proxy.service.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { methodNotAllowed } from '../../utils/methodNotAllowed.js';
import { logger } from '../../utils/logger.js';
import { chatDebug } from '../../utils/chat-debug-logger.js';
import {
  ChatProcessEnvelope,
  chatProcessRequestSchema,
  chatProcessResponseSchema
} from '../../schemas/chat.schema.js';

const router = express.Router();

// Chat processing endpoint - delegates to chat-proxy service
// Validation runs first, then service guards check availability
router.post(
  '/',
  validate(chatProcessRequestSchema, 'body'),
  requireServices(['supabase', 'openai', 'pinecone', 'sidecar']),
  validateResponse(ChatProcessEnvelope),
  async (req, res, next) => {
    const startTime = Date.now();
    const requestLogger = logger.createRequestLogger();

    try {
      // Accept both message/threadId (UI) and query/thread_id (Python format)
      const message = req.body.message || req.body.query;
      const threadId = req.body.threadId || req.body.thread_id;

      if (!message) {
        throw new Error('Message or query is required');
      }

      chatDebug.step('ROUTE_RECEIVED', {
        threadId,
        messageLength: message.length,
        hasMessage: !!message
      });

      // Structured chat logging
      await logger.chat('CHAT', 'User message received', {
        query: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
        thread_id: threadId || 'new',
        message_length: message.length
      }, { correlationId: requestLogger.requestId });

      requestLogger.debug('🔍 [PROCESS] Chat request received', {
        threadId,
        messageLength: message.length
      });

      // Call chat-proxy service (handles all intelligence and Python workflow)
      const result = await processChatMessage({
        query: message,
        threadId
      });

      // Build envelope response
      const envelope = {
        success: true,
        data: {
          threadId,
          userMessage: {
            id: `user-${Date.now()}`,
            content: message,
            role: 'user',
            createdAt: new Date().toISOString()
          },
          assistantMessage: {
            id: `assistant-${Date.now()}`,
            content: result.response,
            role: 'assistant',
            createdAt: new Date().toISOString(),
            sources: result.sources || []
          },
          systemsContext: (result.systems_context || []).map(s => ({
            asset_uid: s.asset_uid,
            manufacturer: s.manufacturer,
            model: s.model,
            score: s.rank || s.score
          })),
          enhancedQuery: message,
          sources: result.sources || [],
          telemetry: {
            workflow: 'python-sequential',
            processing_time_ms: result.processing_time_ms || (Date.now() - startTime),
            classification: result.classification,
            score: result.score,
            metadata: result.metadata
          },
          detailed_metrics: result.detailed_metrics || null  // Pass through detailed metrics from Python
        }
      };

      // Debug: Log response structure
      requestLogger.info('🎯 Route response structure:', {
        hasDetailedMetrics: !!envelope.data.detailed_metrics,
        responseKeys: Object.keys(envelope.data),
        telemetryKeys: Object.keys(envelope.data.telemetry || {})
      });

      const totalDuration = Date.now() - startTime;

      chatDebug.timing('ROUTE_COMPLETE', totalDuration, {
        systemsCount: result.systems_context?.length || 0,
        sourcesCount: result.sources?.length || 0
      });

      // Structured success logging
      await logger.chat('SUCCESS', 'Chat request completed', {
        total_duration_ms: `${totalDuration}ms`,
        systems_found: result.systems_context?.length || 0,
        sources_found: result.sources?.length || 0,
        classification: result.classification?.primary || 'unknown',
        response_length: result.response?.length || 0
      }, { correlationId: requestLogger.requestId });

      requestLogger.performance('chat_processing', totalDuration, {
        systems_found: result.systems_context?.length || 0,
        sources_found: result.sources?.length || 0,
        classification: result.classification?.primary || 'unknown'
      });

      return res.json(envelope);
    } catch (error) {
      const totalDuration = Date.now() - startTime;

      chatDebug.error('ROUTE_ERROR', error, {
        threadId: req.body.threadId || req.body.thread_id,
        duration: totalDuration
      });

      // Structured error logging
      await logger.chat('ERROR', 'Chat request failed', {
        error: error.message,
        thread_id: req.body.threadId || req.body.thread_id,
        duration_ms: `${totalDuration}ms`,
        stack: error.stack?.split('\n').slice(0, 3).join('\n')  // First 3 lines of stack
      }, { correlationId: requestLogger.requestId });

      requestLogger.performance('chat_processing_failed', totalDuration, {
        error: error.message
      });
      next(error);
    }
  }
);

// Catch-all AFTER; allow only POST on this leaf
router.all('/', methodNotAllowed);

export default router;
