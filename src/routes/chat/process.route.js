import express from 'express';
import { processChatMessage } from '../../services/chat-proxy.service.js';
import { normalizeQuery } from '../../services/query-normalizer.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { methodNotAllowed } from '../../utils/methodNotAllowed.js';
import { getEnv } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import {
  ChatProcessEnvelope,
  chatProcessRequestSchema,
  chatProcessResponseSchema
} from '../../schemas/chat.schema.js';

const router = express.Router();

// DEBUG: Add process route tracing
router.use((req, res, next) => {
  const requestLogger = logger.createRequestLogger();
  requestLogger.debug('🔍 [PROCESS] ROUTE', {
    method: req.method,
    originalUrl: req.originalUrl,
    url: req.url,
    path: req.path
  });
  next();
});

router.use(requireServices(['supabase','openai','pinecone']));
router.use(validateResponse(ChatProcessEnvelope));

// MUST be '/'
router.post(
  '/',
  validate(chatProcessRequestSchema, 'body'),
  async (req, res, next) => {
    const startTime = Date.now();
    const requestLogger = logger.createRequestLogger();

    try {
      logger.debug('🔍 [PROCESS] Request body received', {
        body: JSON.stringify(req.body),
        hasMessage: !!req.body.message,
        hasQuery: !!req.body.query
      });

      // Accept both message/threadId (UI) and query/thread_id (Python format)
      const message = req.body.message || req.body.query;
      const threadId = req.body.threadId || req.body.thread_id;

      if (!message) {
        throw new Error('Message or query is required');
      }

      // Normalize the user input at the route edge
      const normalizedMessage = normalizeQuery(message);

      const env = getEnv();
      const contextSize = parseInt(env.CHAT_CONTEXT_SIZE) || 5;

      // Route to Python-sidecar LangGraph instead of Node.js orchestrator
      const sidecarStart = Date.now();
      const result = await processChatMessage({
        query: normalizedMessage || message,
        threadId
      });
      const sidecarDuration = Date.now() - sidecarStart;

      // Convert Python response to expected Node.js envelope format
      const envelope = {
        success: true,
        data: {
          threadId: result.thread_id || threadId,
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
          systemsContext: result.systems_context || [],
          enhancedQuery: normalizedMessage || message,
          sources: result.sources || [],
          telemetry: {
            workflow: 'python-langgraph',
            processing_time_ms: result.processing_time_ms,
            classification: result.classification,
            score: result.score
          }
        }
      };

      const totalDuration = Date.now() - startTime;
      requestLogger.performance('chat_processing', totalDuration, {
        sidecar_duration_ms: sidecarDuration,
        python_workflow_ms: result.processing_time_ms,
        classification: result.classification,
        systems_found: result.systems_context?.length || 0
      });

      return res.json(envelope);
    } catch (error) {
      const totalDuration = Date.now() - startTime;
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
