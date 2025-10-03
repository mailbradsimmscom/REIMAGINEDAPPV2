import express from 'express';
import { searchSystems } from '../../repositories/systems.repository.js';
import { getSystemSvc } from '../../services/systems.service.js';
import { updateChatThread } from '../../repositories/chat.repository.js';
import { searchAllDIPTables } from '../../services/dip-retriever.service.js';
import { searchDocuments } from '../../services/pinecone-rag.service.js';
import { processChatCompletion } from '../../services/chat-completion.service.js';
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

/**
 * Enrich search results with full equipment data
 * @param {Array} searchResults - Results from searchSystems() with {asset_uid, rank}
 * @returns {Promise<Array>} - Full equipment context with all fields
 */
async function enrichSystemsContext(searchResults) {
  const requestLogger = logger.createRequestLogger();
  const systemsContext = [];

  for (const equipment of searchResults) {
    try {
      const fullSystem = await getSystemSvc(equipment.asset_uid);

      systemsContext.push({
        asset_uid: fullSystem.asset_uid,
        manufacturer: fullSystem.manufacturer_norm || fullSystem.manufacturer,
        model: fullSystem.model_norm || fullSystem.model,
        description: fullSystem.description,
        synonyms_fts: fullSystem.synonyms_fts,
        synonyms_human: fullSystem.synonyms_human,
        rank: equipment.rank || 1.0
      });

      requestLogger.debug('Enriched equipment data', {
        assetUid: fullSystem.asset_uid,
        manufacturer: fullSystem.manufacturer_norm || fullSystem.manufacturer,
        model: fullSystem.model_norm || fullSystem.model
      });
    } catch (error) {
      requestLogger.warn('Failed to fetch full system details', {
        asset_uid: equipment.asset_uid,
        error: error.message
      });
      // Fallback to basic data if fetch fails
      systemsContext.push({
        asset_uid: equipment.asset_uid,
        manufacturer: 'Unknown',
        model: 'Unknown',
        description: 'Equipment details unavailable',
        rank: equipment.rank || 0.5
      });
    }
  }

  return systemsContext;
}

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

      // Step 1: Query systems/equipment context
      const systemsStart = Date.now();
      const searchResults = await searchSystems(normalizedMessage || message);

      requestLogger.debug('Search results retrieved', {
        count: searchResults.length
      });

      // Step 2: Enrich search results with full equipment data
      const systemsContext = await enrichSystemsContext(searchResults);
      const systemsDuration = Date.now() - systemsStart;

      requestLogger.debug('Systems context enriched', {
        count: systemsContext.length,
        duration: systemsDuration
      });

      // Step 2a: Store equipment context in thread table
      if (systemsContext.length > 0) {
        try {
          await updateChatThread(threadId, {
            equipment_context: systemsContext
          });

          requestLogger.debug('Equipment context saved to thread', {
            threadId,
            equipmentCount: systemsContext.length
          });
        } catch (error) {
          requestLogger.warn('Failed to save equipment context to thread', {
            threadId,
            error: error.message
          });
          // Don't block the request if save fails
        }
      }

      // Step 3: Query DIP tables
      const dipStart = Date.now();
      const dipResults = await searchAllDIPTables(normalizedMessage || message, 3);
      const dipDuration = Date.now() - dipStart;

      requestLogger.debug('DIP results retrieved', {
        tables: dipResults.length,
        duration: dipDuration
      });

      // Step 4: Query Pinecone for document chunks
      const pineconeStart = Date.now();
      const documentChunks = await searchDocuments({
        query: normalizedMessage || message,
        equipmentContext: systemsContext,
        limit: 5
      });
      const pineconeDuration = Date.now() - pineconeStart;

      requestLogger.debug('Pinecone documents retrieved', {
        count: documentChunks.length,
        duration: pineconeDuration
      });

      // Step 5: Process chat completion
      const chatStart = Date.now();
      const { response, usage } = await processChatCompletion({
        query: normalizedMessage || message,
        threadId,
        systemsContext,
        dipResults,
        documentChunks
      });
      const chatDuration = Date.now() - chatStart;

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
            content: response,
            role: 'assistant',
            createdAt: new Date().toISOString(),
            sources: []
          },
          systemsContext: systemsContext.map(s => ({
            asset_uid: s.asset_uid,
            manufacturer: s.manufacturer,
            model: s.model,
            score: s.score
          })),
          enhancedQuery: normalizedMessage || message,
          sources: [],
          telemetry: {
            workflow: 'nodejs-direct',
            processing_time_ms: Date.now() - startTime,
            systems_duration_ms: systemsDuration,
            dip_duration_ms: dipDuration,
            pinecone_duration_ms: pineconeDuration,
            chat_duration_ms: chatDuration,
            tokens: usage
          }
        }
      };

      const totalDuration = Date.now() - startTime;
      requestLogger.performance('chat_processing', totalDuration, {
        systems_duration_ms: systemsDuration,
        dip_duration_ms: dipDuration,
        pinecone_duration_ms: pineconeDuration,
        chat_duration_ms: chatDuration,
        systems_found: systemsContext.length,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens
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
