import { searchSystems } from '../repositories/systems.repository.js';
import pineconeService from './pinecone.service.js';
import { enhanceQuery, summarizeConversation, generateChatName, synthesizeAnswer, classifyQueryIntent, generateAssetSummary } from './llm.service.js';
import { decideStyle } from '../utils/intent-style.js';
import chatRepository, { deleteChatMessages, deleteChatThreads, deleteChatSession as deleteSessionFromRepo } from '../repositories/chat.repository.js';
import { logger } from '../utils/logger.js';
import { personality } from '../config/personality.js';
import { isSupabaseConfigured, isOpenAIConfigured, isPineconeConfigured } from '../services/guards/index.js';
import { filterSpecLike } from '../utils/specFilter.js';
import { rerankChunks } from './rerank.service.js';
import knowledgeRepository from '../repositories/knowledge.repository.js';
import { formatFactAnswer } from '../utils/formatter.js';

// ---------- Context & Follow-up Detection ----------
function isFollowUpQuestion(query) {
  const q = query.trim().toLowerCase();
  const patterns = [
    /^(what|which)\s+(pressure|voltage|amperage|wattage|capacity|size|dimensions|weight|temperature|speed|flow|rate)\b/,
    /^(how\s+(much|many|long|fast|hot|cold|big|small|heavy|light))\b/,
    /^how\s+(do|to)\b/,
    /^(can|could|would|should|will)\s+(i|we|you|it|this|that)\b/,
    /^(does|do|is|are|was|were)\s+(it|this|that|there)\b/,
    /^(how|what|does|do|is|are|can)\b.*\b(it|this|that)\b/
  ];
  return patterns.some(rx => rx.test(q));
}

function containsAmbiguousPronoun(query) {
  return /\b(it|this|that|them)\b/i.test(query);
}

function extractEquipmentTerms(query) {
  // Remove common question prefixes and extract core equipment terms
  const cleanedQuery = query.toLowerCase()
    .replace(/tell me about (my |the |a |an )?/g, '')
    .replace(/what is (my |the |a |an )?/g, '')
    .replace(/how does (my |the |a |an )?/g, '')
    .replace(/where is (my |the |a |an )?/g, '')
    .replace(/show me (my |the |a |an )?/g, '')
    .replace(/describe (my |the |a |an )?/g, '')
    .replace(/explain (my |the |a |an )?/g, '')
    .replace(/^about /g, '')
    .replace(/^the /g, '')
    .replace(/^a /g, '')
    .replace(/^an /g, '')
    .trim();
  
  return cleanedQuery;
}

function hasExistingSystemsContext(threadMetadata, recentMessages) {
  // Check if we have existing systems context from thread metadata or recent messages
  const threadSystemsContext = threadMetadata?.systemsContext || [];
  const recentSystemsContext = recentMessages
    .filter(msg => msg.metadata?.systemsContext && msg.metadata.systemsContext.length > 0)
    .flatMap(msg => msg.metadata.systemsContext);
  
  return threadSystemsContext.length > 0 || recentSystemsContext.length > 0;
}

function getExistingSystemsContext(threadMetadata, recentMessages) {
  // Get existing systems context from thread metadata or recent messages
  const threadSystemsContext = threadMetadata?.systemsContext || [];
  const recentSystemsContext = recentMessages
    .filter(msg => msg.metadata?.systemsContext && msg.metadata.systemsContext.length > 0)
    .flatMap(msg => msg.metadata.systemsContext);
  
  // Return the most recent systems context (from recent messages first, then thread metadata)
  if (recentSystemsContext.length > 0) {
    return recentSystemsContext;
  }
  return threadSystemsContext;
}

function contextRewrite(query, systemsContext) {
  if (!systemsContext?.length) return query;
  const sys = systemsContext[0];
  const make = (sys.manufacturer_norm || sys.manufacturer || '').trim();
  const model = (sys.model_norm || sys.model || '').trim();
  const label = [make, model].filter(Boolean).join(' ').trim() || sys.system_norm || 'this system';
  const q = query.trim();
  if (label && new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(q)) {
    return q;
  }
  const itRegex = /\b(it|this|that|them)\b/i;
  if (itRegex.test(q)) {
    return q.replace(itRegex, `the ${label}`);
  }
  if (/^how\s+does\b/i.test(q)) return q.replace(/^how\s+does\b/i, `how does the ${label}`);
  if (/^how\s+to\b/i.test(q))   return q.replace(/^how\s+to\b/i,   `how to use the ${label}`);
  return `${q} — ${label}`;
}

function withTimeout(promise, ms, onTimeoutMsg = 'Timed out') {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(onTimeoutMsg)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// Helper function to check if required services are available
async function checkServiceAvailability() {
  const errors = [];
  
  if (!isSupabaseConfigured()) {
    errors.push('SUPABASE_DISABLED');
  }
  
  if (!isOpenAIConfigured()) {
    errors.push('OPENAI_DISABLED');
  }
  
  if (!isPineconeConfigured()) {
    errors.push('PINECONE_DISABLED');
  }
  
  if (errors.length > 0) {
    const error = new Error(`Required services not configured: ${errors.join(', ')}`);
    error.code = errors[0]; // Use the first error code
    error.disabledServices = errors;
    throw error;
  }
}

// Spec-biased retrieval function
export async function retrieveWithSpecBias({ query, namespace }) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    // DEBUG: Log the query being searched
    requestLogger.info('🔍 [SPEC BIAS RETRIEVAL] Query', { query });
    requestLogger.info('🔍 [SPEC BIAS RETRIEVAL] Contains "pressure"', { containsPressure: query.toLowerCase().includes('pressure') });
    
    const { getEnv } = await import('../config/env.js');
    const env = getEnv();
    const topK = 40; // widen recall
    const floor = Number(env.SEARCH_RANK_FLOOR ?? 0.50);

    requestLogger.info('Starting spec-biased retrieval', { 
      query: query.substring(0, 100),
      topK,
      floor,
      namespace: namespace ?? env.PINECONE_NAMESPACE
    });

    // 1) Wide recall from Pinecone (keep original call signature)
    const searchContext = {
      manufacturer: null,
      model: null,
      previousMessages: []
    };
    
    const pineconeResponse = await pineconeService.searchDocuments(query, searchContext);
    const results = pineconeResponse?.results || [];
    
    // Extract chunks from grouped results
    const hits = results.flatMap(result => result.chunks || []);

    // DEBUG: Log Pinecone search results
    requestLogger.info('🔍 [SPEC BIAS RETRIEVAL] Pinecone results count', { resultsCount: results.length });
    requestLogger.info('🔍 [SPEC BIAS RETRIEVAL] Pinecone hits count', { hitsCount: hits.length });
    requestLogger.info('🔍 [SPEC BIAS RETRIEVAL] First few hits', { 
      firstHits: hits.slice(0, 3).map(h => ({
        score: h.score,
        relevanceScore: h.relevanceScore,
        content: h.content?.substring(0, 100) || 'No content'
      }))
    });

    const rawCount = hits.length;

    // 2) Apply dense score floor
    const passedFloor = hits.filter(h => (h.score ?? 0) >= floor);
    
    // DEBUG: Log floor filtering
    requestLogger.info('🔍 [SPEC BIAS RETRIEVAL] Passed floor count', { passedFloorCount: passedFloor.length });

    // 3) Regex post-filter for spec-like chunks (now includes maintenance content)
    const specy = await filterSpecLike(passedFloor);
    
    // DEBUG: Log spec filtering
    requestLogger.info('🔍 [SPEC BIAS RETRIEVAL] Spec-filtered count', { specFilteredCount: specy.length });
    requestLogger.info('🔍 [SPEC BIAS RETRIEVAL] Spec-filtered content', { 
      specFilteredContent: specy.map(h => ({
        content: h.content?.substring(0, 100) || 'No content'
      }))
    });

    // 4) Fallback if none survived spec filter
    const pool = specy.length ? specy : passedFloor;

    // 5) Tiny LLM rerank (small set only)
    const reranked = await rerankChunks(query, pool);

    // 6) Take top few for answer assembly
    const finalists = reranked.slice(0, Math.min(5, pool.length));
    
    // DEBUG: Log final results
    requestLogger.info('🔍 [SPEC BIAS RETRIEVAL] Finalists count', { finalistsCount: finalists.length });
    requestLogger.info('🔍 [SPEC BIAS RETRIEVAL] Finalists content', { 
      finalistsContent: finalists.map(h => ({
        content: h.content?.substring(0, 100) || 'No content'
      }))
    });

    // 7) Return with observability
    const result = {
      finalists,
      meta: {
        rawCount,
        passedFloorCount: passedFloor.length,
        filteredCount: specy.length,
        usedFallback: specy.length === 0,
        floor,
        topK,
      },
    };

    requestLogger.info('Spec-biased retrieval completed', result.meta);
    return result;

  } catch (error) {
    requestLogger.error('Spec-biased retrieval failed', { 
      error: error.message,
      query: query.substring(0, 100)
    });
    
    // Fallback to empty results
    const { getEnv } = await import('../config/env.js');
    const env = getEnv();
    return {
      finalists: [],
      meta: {
        rawCount: 0,
        passedFloorCount: 0,
        filteredCount: 0,
        usedFallback: true,
        floor: Number(env.SEARCH_RANK_FLOOR ?? 0.50),
        topK: 40,
        error: error.message
      }
    };
  }
}

export async function processUserMessage(userQuery, { sessionId, threadId, contextSize = 5 } = {}) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    // Check service availability before processing
    await checkServiceAvailability();
    
    requestLogger.info('Processing user message', { 
      userQuery: userQuery.substring(0, 100), 
      sessionId, 
      threadId 
    });
    
    // Step 0: Intent classification - route to appropriate pipeline
    const intent = await classifyQueryIntent(userQuery);
    requestLogger.info('Query intent classified', { intent, userQuery: userQuery.substring(0, 50) });

    // ---------- Summary branch (no hardcoding) ----------
    if (intent === 'asset_summary') {
      const searchContext = { previousMessages: [], systemInfo: '' };
      const grouped = await pineconeService.searchDocuments(userQuery, searchContext);
      const topGroup = Array.isArray(grouped?.results) && grouped.results.length ? grouped.results[0] : null;

      // Pull a small number of blocks; we're relying on LLM to summarize
      const blocks = topGroup?.chunks?.slice(0, 6).map(r => r.content).filter(Boolean) ?? [];
      const assetHints = {
        manufacturer: topGroup?.manufacturer,
        model: topGroup?.model
      };

      requestLogger.info({ intent, blocks: blocks.length, manufacturer: assetHints.manufacturer, model: assetHints.model }, 'asset-summary-path');

      let summary;
      try {
        summary = await generateAssetSummary({
          userQuery,
          assetHints,
          contextBlocks: blocks
        });
      } catch (err) {
        requestLogger.error({ err: String(err) }, 'Asset summary generation failed; returning non-persistent text');
        // Still give the user something useful (first block) rather than erroring
        const fallback = blocks?.[0] || 'I found relevant manual content but could not summarize right now.';
        // Do not crash—return a safe message without persistence requirements
        const fallbackSources = topGroup ? [{
          type: 'pinecone',
          manufacturer: topGroup.manufacturer,
          model: topGroup.model,
          filename: topGroup.filename,
          documentId: topGroup.documentId,
          pages: blocks.map(b => b.page).filter(Boolean),
          score: topGroup.bestScore
        }] : [];

        return {
          success: true,
          sessionId,
          threadId,
          userMessage: { role: 'user', content: userQuery },
          assistantMessage: { role: 'assistant', content: fallback, metadata: { mode: 'asset_summary_fallback' } },
          systemsContext: [],
          enhancedQuery: userQuery,
          sources: fallbackSources,
          telemetry: {
            requestId: requestLogger.requestId,
            retrievalMeta: {
              specBiasMeta: null,
              styleDetected: null,
              temperature: 0.7,
              model: 'gpt-4'
            }
          }
        };
      }

      // Build sources array with document information
      const sources = topGroup ? [{
        type: 'pinecone',
        manufacturer: topGroup.manufacturer,
        model: topGroup.model,
        filename: topGroup.filename,
        documentId: topGroup.documentId,
        pages: blocks.map(b => b.page).filter(Boolean),
        score: topGroup.bestScore
      }] : [];

      // Persist only if we have a thread; otherwise return a transient reply
      if (threadId) {
        const userMessage = await chatRepository.createChatMessage({
          threadId,
          role: 'user',
          content: userQuery,
          metadata: { intent: 'asset_summary' }
        });

        const assistantMessage = await chatRepository.createChatMessage({
          threadId,
          role: 'assistant',
          content: summary,
          metadata: { mode: 'asset_summary', docId: topGroup?.documentId }
        });

        return {
          success: true,
          sessionId,
          threadId,
          userMessage,
          assistantMessage,
          systemsContext: [],
          enhancedQuery: userQuery,
          sources,
          telemetry: {
            requestId: requestLogger.requestId,
            retrievalMeta: {
              specBiasMeta: null,
              styleDetected: null,
              temperature: 0.7,
              model: 'gpt-4'
            }
          }
        };
      }

      // Return transient reply without persistence
      return {
        success: true,
        sessionId,
        threadId,
        userMessage: { role: 'user', content: userQuery },
        assistantMessage: { role: 'assistant', content: summary, metadata: { mode: 'asset_summary' } },
        systemsContext: [],
        enhancedQuery: userQuery,
        sources,
        telemetry: {
          requestId: requestLogger.requestId,
          retrievalMeta: {
            specBiasMeta: null,
            styleDetected: null,
            temperature: 0.7,
            model: 'gpt-4'
          }
        }
      };
    }
    
    // Step 1: Determine if this is a follow-up question and get existing context
    let systemsContext = [];
    let isFollowUp = false;
    let existingThreadMetadata = null;
    
    if (threadId) {
      // Load thread + recent messages for context reuse
      try {
        const { getEnv } = await import('../config/env.js');
        const env = getEnv();
        const contextTimeout = parseInt(env.CONTEXT_LOADING_TIMEOUT_MS || '1800');
        const systemSearchTimeout = parseInt(env.SYSTEM_SEARCH_TIMEOUT_MS || '1200');
        
        const { thread: existingThread, messages: recentMessages } = await withTimeout(
          (async () => {
            const [thr, msgs] = await Promise.all([
              chatRepository.getChatThread(threadId),
              chatRepository.getChatMessages(threadId, { limit: 50 })
            ]);
            return { thread: thr, messages: msgs };
          })(),
          contextTimeout,
          'context bootstrap timeout'
        );
        existingThreadMetadata = existingThread?.metadata || {};

        isFollowUp = isFollowUpQuestion(userQuery);
        if (!isFollowUp && containsAmbiguousPronoun(userQuery)) {
          if (hasExistingSystemsContext(existingThreadMetadata, recentMessages)) {
            isFollowUp = true;
          }
        }

        if (isFollowUp && hasExistingSystemsContext(existingThreadMetadata, recentMessages)) {
          const existingContext = getExistingSystemsContext(existingThreadMetadata, recentMessages);
          const systemPromises = existingContext.map(async (assetUid) => {
            try {
              const results = await withTimeout(
                searchSystems(assetUid, { limit: 1 }),
                systemSearchTimeout,
                'searchSystems timeout'
              );
              const hit = Array.isArray(results)
                ? results.find(s => s.asset_uid === assetUid)
                : null;
              return hit || { asset_uid: assetUid, manufacturer: '', model: '', rank: 0.1 };
            } catch (err) {
              requestLogger.warn('Context hydration failed', { assetUid, error: err.message });
              return { asset_uid: assetUid, manufacturer: '', model: '', rank: 0.05 };
            }
          });
          const settled = await Promise.allSettled(systemPromises);
          systemsContext = settled
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value);
          if (!systemsContext.length) {
            requestLogger.warn('No systems hydrated; retaining raw UIDs', { count: existingContext.length });
            systemsContext = existingContext.map(uid => ({ asset_uid: uid, manufacturer: '', model: '' }));
          }
          requestLogger.info('Using existing systems context for follow-up', {
            threadId,
            systemsContextCount: systemsContext.length,
            isFollowUp: true,
            assetUids: existingContext
          });
        }
      } catch (e) {
        requestLogger.warn('Failed context bootstrap', { error: e.message });
      }
    }
    
    // Step 2: Search systems table for relevant context (only if not a follow-up with existing context)
    if (systemsContext.length === 0) {
      // Extract key terms from the user query for better systems search
      const searchTerms = extractEquipmentTerms(userQuery);
      
      const systemsResults = await searchSystems(searchTerms, { limit: 5 });
      systemsContext = systemsResults || [];
      
      requestLogger.info('Systems search completed', { 
        query: userQuery.substring(0, 100), 
        searchTerms,
        resultsCount: systemsContext.length,
        systemsResults: systemsResults,
        systemsContext: systemsContext,
        isFollowUp: false
      });
    } else {
      requestLogger.info('Skipped systems search - using existing context', { 
        query: userQuery.substring(0, 100),
        systemsContextCount: systemsContext.length,
        isFollowUp: true
      });
    }
    
    // Step 3: Build effective query with context rewriting
    let effectiveQuery = userQuery;
    if (containsAmbiguousPronoun(userQuery) && systemsContext?.length) {
      const before = userQuery;
      effectiveQuery = contextRewrite(userQuery, systemsContext);
      if (effectiveQuery !== before) {
        requestLogger.info('Context rewrite applied', {
          before: before.slice(0, 120),
          after: effectiveQuery.slice(0, 160),
          systemsContextCount: systemsContext.length
        });
      }
    }

    // Step 4: Enhance the query using LLM and systems context
    let enhancedQuery = effectiveQuery;
    if (systemsContext.length > 0) {
      try {
        enhancedQuery = await enhanceQuery(effectiveQuery, systemsContext);
        requestLogger.info('Query enhanced successfully', { 
          originalQuery: userQuery.substring(0, 100),
          effectiveQuery: effectiveQuery.substring(0, 100),
          enhancedQuery: enhancedQuery.substring(0, 100)
        });
      } catch (llmError) {
        requestLogger.warn('LLM enhancement failed, using effective query', { 
          error: llmError.message,
          originalQuery: userQuery.substring(0, 100),
          effectiveQuery: effectiveQuery.substring(0, 100)
        });
      }
    }
    
    // Step 5: Get recent conversation context (needed for Pinecone search)
    let recentMessages = [];
    if (threadId) {
      recentMessages = await chatRepository.getChatMessages(threadId, { limit: contextSize });
    }
    
    // Step 5.5: FACT-FIRST RETRIEVAL - Check knowledge_facts before Pinecone
    let factMatch = null;
    let factAnswer = null;
    
    try {
      requestLogger.info('🔍 [FACT-FIRST] Checking knowledge_facts for query', { 
        query: enhancedQuery.substring(0, 100) 
      });
      
      factMatch = await knowledgeRepository.findFactMatchByQuery(enhancedQuery);
      
      if (factMatch) {
        factAnswer = formatFactAnswer(factMatch);
        requestLogger.info('✅ [FACT-FIRST] Found matching fact', { 
          factType: factMatch.fact_type,
          key: factMatch.key,
          intent: factMatch.intent,
          query: factMatch.query
        });
        
        // Return fact answer immediately - no need for Pinecone search
        const factResponse = {
          sessionId: sessionId || 'fact-session',
          threadId: threadId || 'fact-thread',
          userMessage: {
            id: `user-${Date.now()}`,
            content: userQuery,
            timestamp: new Date().toISOString()
          },
          assistantMessage: {
            id: `assistant-${Date.now()}`,
            content: factAnswer,
            timestamp: new Date().toISOString(),
            metadata: {
              source: 'knowledge_facts',
              factType: factMatch.fact_type,
              confidence: factMatch.confidence || 1.0,
              retrievalMethod: 'fact-first'
            }
          },
          systemsContext: systemsContext,
          retrievalMeta: {
            factMatch: true,
            factType: factMatch.fact_type,
            skippedPinecone: true,
            retrievalMethod: 'fact-first'
          }
        };
        
        requestLogger.info('🎯 [FACT-FIRST] Returning fact answer', { 
          factType: factMatch.fact_type,
          answerLength: factAnswer.length
        });
        
        return factResponse;
      } else {
        requestLogger.info('❌ [FACT-FIRST] No matching fact found, proceeding to Pinecone', { 
          query: enhancedQuery.substring(0, 100) 
        });
      }
    } catch (factError) {
      requestLogger.warn('⚠️ [FACT-FIRST] Error checking knowledge_facts, proceeding to Pinecone', { 
        error: factError.message,
        query: enhancedQuery.substring(0, 100)
      });
      // Continue to Pinecone search as fallback
    }
    
    // Step 6: Search Pinecone for relevant documentation using spec-biased retrieval
    let pineconeResults = [];
    let pineconeError = null;
    let specBiasMeta = null;
    
    try {
      // Use spec-biased retrieval instead of regular Pinecone search
      const specBiasResult = await retrieveWithSpecBias({ 
        query: enhancedQuery,
        namespace: null // Will use default from env
      });
      
      specBiasMeta = specBiasResult.meta;
      
      // Transform spec-biased results to match expected Pinecone schema format
      if (specBiasResult.finalists && specBiasResult.finalists.length > 0) {
        // Group finalists by document for schema compatibility
        const documentGroups = {};
        
        specBiasResult.finalists.forEach((hit) => {
          const docId = hit.documentId || 'unknown';
          if (!documentGroups[docId]) {
            documentGroups[docId] = {
              documentId: docId,
              manufacturer: hit.manufacturer || 'Unknown',
              model: hit.model || 'Unknown',
              filename: hit.filename || 'Unknown Document',
              revisionDate: hit.revisionDate || new Date().toISOString(),
              bestScore: hit.bestScore || hit.score || 0,
              chunks: []
            };
          }
          
          // Add chunk in expected format
          documentGroups[docId].chunks.push({
            id: hit.id || `chunk_${Date.now()}`,
            score: hit.score || hit.bestScore || 0,
            relevanceScore: hit._rankScore || hit.score || 0,
            content: hit.chunk?.content || hit.metadata?.content || hit.content || '',
            page: hit.page || 0,
            chunkIndex: hit.chunkIndex || 0,
            chunkType: hit.chunkType || 'text'
          });
          
          // Update best score if this chunk has a higher score
          if ((hit.score || hit.bestScore || 0) > documentGroups[docId].bestScore) {
            documentGroups[docId].bestScore = hit.score || hit.bestScore || 0;
          }
        });
        
        pineconeResults = Object.values(documentGroups);
        
        requestLogger.info('Spec-biased retrieval completed', { 
          query: enhancedQuery.substring(0, 100),
          resultsCount: pineconeResults.length,
          specBiasMeta: specBiasMeta
        });
      } else {
        requestLogger.warn('Spec-biased retrieval returned no results', { 
          query: enhancedQuery.substring(0, 100),
          specBiasMeta: specBiasMeta
        });
      }
    } catch (error) {
      pineconeError = error;
      requestLogger.warn('Spec-biased retrieval failed', { 
        error: error.message,
        query: enhancedQuery.substring(0, 100)
      });
    }
    
    // Step 7: Create or get chat session/thread if needed
    let session = null;
    let thread = null;
    
    if (!sessionId) {
      // Create new session
      session = await chatRepository.createChatSession({
        name: 'New Chat',
        description: `Chat about: ${userQuery.substring(0, 100)}...`
      });
      sessionId = session.id;
      requestLogger.info('New chat session created', { sessionId });
    } else {
      session = await chatRepository.getChatSession(sessionId);
      requestLogger.info('Existing chat session loaded', { sessionId });
    }
    
    if (!threadId) {
      // Create new thread
      thread = await chatRepository.createChatThread({
        sessionId,
        name: 'New Thread',
        metadata: { 
          systemsContext: systemsContext.map(s => s.asset_uid),
          pineconeResults: pineconeResults.length,
          specBiasMeta: specBiasMeta
        }
      });
      threadId = thread.id;
      requestLogger.info('New chat thread created', { threadId, sessionId });
    } else {
      thread = await chatRepository.getChatThread(threadId);
      requestLogger.info('Existing chat thread loaded', { threadId });
      
      // Update thread metadata with current systems context if it's new or different
      if (systemsContext.length > 0) {
        const currentSystemsContext = thread.metadata?.systemsContext || [];
        const newSystemsContext = systemsContext.map(s => s.asset_uid);
        
        // Only update if the systems context has changed
        if (JSON.stringify(currentSystemsContext) !== JSON.stringify(newSystemsContext)) {
          await chatRepository.updateChatThread(threadId, {
            metadata: {
              ...thread.metadata,
              systemsContext: newSystemsContext,
              lastUpdatedAt: new Date().toISOString()
            }
          });
          requestLogger.info('Updated thread metadata with new systems context', { 
            threadId, 
            systemsContextCount: newSystemsContext.length 
          });
        }
      }
    }
    
    // Step 8: Store user message
    const userMessage = await chatRepository.createChatMessage({
      threadId,
      role: 'user',
      content: userQuery,
      metadata: {
        originalQuery: userQuery,
        enhancedQuery,
        systemsContext: systemsContext.map(s => s.asset_uid),
        factMatch: false,
        factType: null,
        retrievalMethod: 'pinecone-fallback',
        pineconeResults: pineconeResults.length,
        specBiasMeta: specBiasMeta
      }
    });
    
    // Step 9: Generate assistant response with Pinecone results
    const assistantResponse = await generateEnhancedAssistantResponse(
      userQuery,
      enhancedQuery,
      systemsContext,
      pineconeResults,
      pineconeError,
      recentMessages
    );
    
    // Step 10: Store assistant response
    const assistantMessage = await chatRepository.createChatMessage({
      threadId,
      role: 'assistant',
      content: assistantResponse.content,
      metadata: {
        systemsContext: systemsContext.map(s => s.asset_uid),
        enhancedQuery,
        factMatch: false,
        factType: null,
        retrievalMethod: 'pinecone-fallback',
        pineconeResults: pineconeResults.length,
        sources: assistantResponse.sources,
        hasPineconeError: !!pineconeError,
        specBiasMeta: specBiasMeta
      }
    });
    
    // Step 11: Update thread with latest activity
    await chatRepository.updateChatThread(threadId, {
      updated_at: new Date().toISOString()
    });
    
    // Step 12: Check if we should summarize (every N messages)
    const totalMessages = recentMessages.length + 2; // +2 for user and assistant messages we just added
    const { getEnv } = await import('../config/env.js');
    const { summaryFrequency = 5 } = getEnv();
    if (totalMessages >= summaryFrequency) {
      try {
        const summary = await summarizeConversation(recentMessages, systemsContext);
        await chatRepository.updateChatThread(threadId, {
          metadata: { 
            ...thread.metadata,
            summary,
            lastSummarizedAt: new Date().toISOString()
          }
        });
        requestLogger.info('Conversation summarized', { threadId, summaryLength: summary.length });
      } catch (summaryError) {
        requestLogger.warn('Summary generation failed', { 
          error: summaryError.message,
          threadId 
        });
      }
    }
    
    // Step 13: Generate or update thread name if it's new
    if (!thread.name || thread.name === 'New Thread') {
      try {
        const threadName = await generateChatName(recentMessages, systemsContext);
        await chatRepository.updateChatThread(threadId, { name: threadName });
        requestLogger.info('Thread name generated', { threadId, threadName });
      } catch (namingError) {
        requestLogger.warn('Thread naming failed', { 
          error: namingError.message,
          threadId 
        });
      }
    }
    
    requestLogger.info('User message processed successfully', { 
      sessionId, 
      threadId, 
      responseLength: assistantResponse.content.length,
      sourcesCount: assistantResponse.sources.length,
      sourceTypes: assistantResponse.sources.map(s => s.type),
      personalityApplied: true
    });
    
    // Generate request ID for telemetry
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Get environment config for telemetry
    const { getEnv: getEnvConfig } = await import('../config/env.js');
    const env = getEnvConfig();
    
    return {
      sessionId,
      threadId,
      userMessage,
      assistantMessage,
      systemsContext,
      enhancedQuery,
      pineconeResults,
      sources: assistantResponse.sources,
      specBiasMeta,
      telemetry: {
        requestId,
        retrievalMeta: {
          factMatch: false,
          factType: null,
          skippedPinecone: false,
          retrievalMethod: 'pinecone-fallback',
          specBiasMeta,
          styleDetected: assistantResponse.styleDetected || null,
          temperature: parseFloat(env.LLM_TEMPERATURE || '0.7'),
          model: env.OPENAI_MODEL || 'gpt-4'
        }
      }
    };
    
  } catch (error) {
    requestLogger.error('Failed to process user message', { 
      error: error.message,
      userQuery: userQuery.substring(0, 100),
      sessionId,
      threadId
    });
    throw new Error(`Failed to process user message: ${error.message}`);
  }
}

async function generateEnhancedAssistantResponse(userQuery, enhancedQuery, systemsContext, pineconeResults, pineconeError, recentMessages) {
  try {
    let response = '';
    let sources = [];
    let styleDetected = null;
    
    // Build sources array from pinecone results
    if (pineconeResults.length > 0) {
      sources = pineconeResults.map(result => ({
        type: 'pinecone',
        manufacturer: result.manufacturer,
        model: result.model,
        filename: result.filename,
        documentId: result.documentId,
        pages: result.chunks?.map(chunk => chunk.page).filter(Boolean) || [],
        score: result.bestScore
      }));
    }
    
    // Check if this is a pressure-related question and extract specific pressure data
    const isPressureQuestion = userQuery.toLowerCase().includes('pressure');
    let pressureSpecs = [];
    
    if (isPressureQuestion && pineconeResults.length > 0) {
      pineconeResults.forEach((result) => {
        if (result.chunks) {
          result.chunks.forEach((chunk) => {
            const content = chunk.content.toLowerCase();
            // Look for pressure-related content with specific values
            if (content.includes('pressure') && (
              content.includes('bar') || 
              content.includes('psi') || 
              content.includes('working pressure') ||
              content.includes('operating pressure') ||
              content.includes('pressure range') ||
              content.includes('pressure switch') ||
              content.includes('manometer')
            )) {
              pressureSpecs.push({
                content: chunk.content,
                page: chunk.page,
                score: chunk.score
              });
            }
          });
        }
      });
    }
    
    // Debug logging
    requestLogger.info('Pressure question', { isPressureQuestion });
    requestLogger.info('Pressure specs found', { pressureSpecsCount: pressureSpecs.length });
    
    // If we found specific pressure data, present it directly
    if (isPressureQuestion && pressureSpecs.length > 0) {
      response += `## Pressure Specifications\n\n`;
      response += `Based on the technical documentation, here are the specific pressure specifications for your watermaker:\n\n`;
      
      pressureSpecs.forEach((spec, index) => {
        const cleanContent = spec.content.replace(/\s+/g, ' ').trim();
        response += `**${index + 1}.** ${cleanContent}\n\n`;
      });
      
      response += `These specifications provide the exact operating pressures for your equipment. `;
      response += `The manometer on your watermaker will show the current working pressure, which should be within the specified ranges.\n\n`;
    } else {
      // Add systems context (collect sources but don't display them)
      if (systemsContext.length > 0) {
        systemsContext.forEach((system, index) => {
          // Add systems as sources with type classification
          const systemSource = {
            id: system.asset_uid,
            type: 'system',
            rank: system.rank,
            manufacturer: system.manufacturer || system.asset_uid.split('_')[0],
            model: system.model || system.asset_uid
          };
          sources.push(systemSource);
        });
      } else {
        response += `I understand you're asking about: **"${userQuery}"**\n\n`;
        response += `I couldn't find specific systems matching your query in your database. `;
        response += `Could you provide more details or try a different search term?\n\n`;
      }
      
      // Add Pinecone documentation results
      if (pineconeResults.length > 0) {
        // Stage 2: Generate synthesized answer using LLM with style detection
        let synthesizedAnswer = '';
        try {
          const style = decideStyle(userQuery);
          styleDetected = style; // Capture the detected style
          requestLogger.info('Style detected', { style, userQuery });
          synthesizedAnswer = await synthesizeAnswer(userQuery, pineconeResults, style);
          response += `${synthesizedAnswer}\n\n`;
        } catch (synthesisError) {
          // Fallback to categorized content if synthesis fails
          console.warn('Synthesis failed, using categorized content:', synthesisError.message);
        }
        
        response += `## Detailed Documentation\n`;
        response += `I found relevant documentation for your question:\n\n`;
      
      pineconeResults.forEach((result, index) => {
        response += `### ${result.manufacturer} ${result.model}\n`;
        
        if (result.chunks && result.chunks.length > 0) {
          // Group content by type and create structured response
          const specifications = [];
          const operation = [];
          const safety = [];
          const installation = [];
          const general = [];
          
          result.chunks.forEach((chunk) => {
            if (chunk.content && chunk.content.trim()) {
              const content = chunk.content.toLowerCase();
              if (content.includes('specification') || content.includes('voltage') || content.includes('amp') || content.includes('watt') || content.includes('model')) {
                specifications.push(chunk);
              } else if (content.includes('operation') || content.includes('use') || content.includes('cook') || content.includes('timer')) {
                operation.push(chunk);
              } else if (content.includes('safety') || content.includes('warning') || content.includes('danger') || content.includes('fire')) {
                safety.push(chunk);
              } else if (content.includes('install') || content.includes('unpack') || content.includes('setup')) {
                installation.push(chunk);
              } else {
                general.push(chunk);
              }
            }
          });
          
          // Add structured content sections
          if (specifications.length > 0) {
            response += `**📋 Specifications:**\n`;
            specifications.forEach((chunk) => {
              const cleanContent = chunk.content.replace(/\s+/g, ' ').trim();
              response += `• ${cleanContent.substring(0, 150)}${cleanContent.length > 150 ? '...' : ''}\n`;
            });
            response += `\n`;
          }
          
          if (operation.length > 0) {
            response += `**🔧 Operation & Usage:**\n`;
            operation.forEach((chunk) => {
              const cleanContent = chunk.content.replace(/\s+/g, ' ').trim();
              response += `• ${cleanContent.substring(0, 150)}${cleanContent.length > 150 ? '...' : ''}\n`;
            });
            response += `\n`;
          }
          
          if (safety.length > 0) {
            response += `**⚠️ Safety Information:**\n`;
            safety.forEach((chunk) => {
              const cleanContent = chunk.content.replace(/\s+/g, ' ').trim();
              response += `• ${cleanContent.substring(0, 150)}${cleanContent.length > 150 ? '...' : ''}\n`;
            });
            response += `\n`;
          }
          
          if (installation.length > 0) {
            response += `**🔨 Installation & Setup:**\n`;
            installation.forEach((chunk) => {
              const cleanContent = chunk.content.replace(/\s+/g, ' ').trim();
              response += `• ${cleanContent.substring(0, 150)}${cleanContent.length > 150 ? '...' : ''}\n`;
            });
            response += `\n`;
          }
          
          if (general.length > 0 && specifications.length === 0 && operation.length === 0 && safety.length === 0 && installation.length === 0) {
            response += `**📄 Document Information:**\n`;
            general.forEach((chunk) => {
              const cleanContent = chunk.content.replace(/\s+/g, ' ').trim();
              response += `• ${cleanContent.substring(0, 150)}${cleanContent.length > 150 ? '...' : ''}\n`;
            });
            response += `\n`;
          }
          
          // Add source attribution with type classification
          const source = {
            manufacturer: result.manufacturer,
            model: result.model,
            filename: result.filename || 'Unknown Document',
            pages: [...new Set(result.chunks.map(c => c.page).filter(p => p))],
            score: result.bestScore,
            type: 'pinecone', // Classify as Pinecone source
            content: result.chunks.map(chunk => ({
              content: chunk.content,
              page: chunk.page,
              score: chunk.score
            }))
          };
          sources.push(source);
        }
        
        response += `\n`;
      });
      
      // Add relevance scores at the end
      if (pineconeResults.length > 0) {
        response += `\n**Relevance Scores:**\n`;
        pineconeResults.forEach((result, index) => {
          response += `• ${result.manufacturer} ${result.model}: ${result.bestScore.toFixed(3)}\n`;
        });
        response += `\n`;
      }
      
      response += `Based on this documentation, I can provide detailed information about specifications, operation, safety, and installation. `;
      response += `Feel free to ask specific questions about any aspect of your equipment!\n\n`;
      }  
    if (pineconeError) {
        response += `## Documentation Search\n`;
        response += `I encountered an issue searching the documentation database. `;
        response += `However, I can still help you with information about your systems.\n\n`;
      } else {
        response += `## Documentation Search\n`;
        response += `I couldn't find specific documentation matching your query. `;
        response += `This might mean the documentation hasn't been uploaded yet, or you might need to try different search terms.\n\n`;
      }
    }
    
    // Add conversation context if available
    if (recentMessages.length > 0) {
      response += `## Conversation Context\n`;
      response += `I can see we've been discussing related topics. `;
      response += `Feel free to ask follow-up questions or request more specific information.\n\n`;
    }
    
    // Add source attribution footer with type metadata
    if (sources.length > 0) {
      response += `---\n`;
      response += `**Sources:**\n`;
      sources.forEach((source, index) => {
        const pages = source.pages && source.pages.length > 0 ? ` (Pages: ${source.pages.join(', ')})` : '';
        const sourceType = source.type || 'unknown';
        response += `${index + 1}. ${source.manufacturer || source.id} ${source.model || ''}${pages} [${sourceType}]\n`;
      });
    }
    
    return { content: response, sources, styleDetected };
    
  } catch (error) {
    const fallbackResponse = `I'm here to help! I found some relevant systems and can assist with your questions. What would you like to know more about?`;
    return { content: fallbackResponse, sources: [] };
  }
}

export async function getChatHistory(threadId, { limit = 50 } = {}) {
  try {
    // Check Supabase availability before getting chat history
    if (!isSupabaseConfigured()) {
      const error = new Error('Supabase not configured');
      error.code = 'SUPABASE_DISABLED';
      throw error;
    }
    
    const messages = await chatRepository.getChatMessages(threadId, { limit });
    return messages;
  } catch (error) {
    throw new Error(`Failed to get chat history: ${error.message}`);
  }
}

export async function listUserChats({ limit = 25, cursor } = {}) {
  try {
    // Check Supabase availability before listing chats
    if (!isSupabaseConfigured()) {
      const error = new Error('Supabase not configured');
      error.code = 'SUPABASE_DISABLED';
      throw error;
    }
    
    const sessions = await chatRepository.listChatSessions({ limit, cursor });
    
    // Get the latest thread for each session
    const sessionsWithThreads = await Promise.all(
      sessions.map(async (session) => {
        const threads = await chatRepository.listChatThreads(session.id, { limit: 1 });
        return {
          ...session,
          latestThread: threads[0] || null
        };
      })
    );
    
    return sessionsWithThreads;
  } catch (error) {
    throw new Error(`Failed to list user chats: ${error.message}`);
  }
}

export async function getChatContext(threadId) {
  try {
    // Check Supabase availability before getting chat context
    if (!isSupabaseConfigured()) {
      const error = new Error('Supabase not configured');
      error.code = 'SUPABASE_DISABLED';
      throw error;
    }
    
    const thread = await chatRepository.getChatThread(threadId);
    const session = await chatRepository.getChatSession(thread.session_id);
    const messages = await chatRepository.getChatMessages(threadId, { limit: 10 });
    
    return {
      session,
      thread,
      messages,
      context: {
        systemsContext: thread.metadata?.systemsContext || [],
        summary: thread.metadata?.summary || null,
        lastSummarizedAt: thread.metadata?.lastSummarizedAt || null
      }
    };
  } catch (error) {
    throw new Error(`Failed to get chat context: ${error.message}`);
  }
}

export async function deleteChatSession(sessionId) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    // Check Supabase availability before deleting chat session
    if (!isSupabaseConfigured()) {
      const error = new Error('Supabase not configured');
      error.code = 'SUPABASE_DISABLED';
      throw error;
    }
    
    requestLogger.info('Deleting chat session', { sessionId });
    
    // Get the session to find all associated threads
    const session = await chatRepository.getChatSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    // Get all threads for this session
    const threads = await chatRepository.listChatThreads(sessionId);
    
    // Delete all messages for each thread
    for (const thread of threads) {
      await deleteChatMessages(thread.id);
      requestLogger.info('Deleted messages for thread', { threadId: thread.id });
    }
    
    // Delete all threads for this session
    await deleteChatThreads(sessionId);
    requestLogger.info('Deleted threads for session', { sessionId });
    
    // Delete the session itself
    await deleteSessionFromRepo(sessionId);
    requestLogger.info('Deleted chat session', { sessionId });
    
    return { success: true, sessionId };
  } catch (error) {
    requestLogger.error('Failed to delete chat session', { 
      error: error.message,
      stack: error.stack,
      sessionId
    });
    throw error;
  }
}

export default {
  processUserMessage,
  getChatHistory,
  listUserChats,
  getChatContext,
  deleteChatSession,
  retrieveWithSpecBias
};
