// ============================================
// DEFAULT IMPORTS - Used as defaults in factory
// ============================================
import { randomUUID } from 'crypto';
import * as systemsRepo from '../repositories/systems.repository.js';
import * as systemsService from './systems.service.js';
import * as conversationContextService from './conversation-context.service.js';
import * as equipmentRelationshipService from './equipment-relationship-inference.service.js';
import * as chatRepo from '../repositories/chat.repository.js';
import * as userTasksRepo from '../repositories/user-tasks.repository.js';
import * as envConfig from '../config/env.js';
import { logger as defaultLogger } from '../utils/logger.js';
import * as pythonSidecar from '../clients/python-sidecar.client.js';
import { chatDebug as defaultChatDebug } from '../utils/chat-debug-logger.js';
import * as equipmentExtraction from './equipment-extraction.service.js';
import { ERR } from '../constants/errorCodes.js';
import { normalizeModelKey } from '../utils/normalize-model-key.js';

// Pure helper functions - extracted for testability
import { extractKeywords } from './chat-proxy/helpers.js';

// Re-export for backward compatibility and direct testing
export { extractKeywords };

// ============================================
// FACTORY PATTERN - For Dependency Injection
// ============================================

/**
 * Create a chat proxy service with injected dependencies.
 * Use this in tests to inject mocks.
 *
 * @param {Object} deps - Dependencies (all optional, defaults to real implementations)
 * @returns {Object} Service object with processChatMessage function
 *
 * @example
 * // In tests:
 * const mockSystemsRepo = { searchSystems: async () => [] };
 * const service = createChatProxyService({ systemsRepository: mockSystemsRepo });
 * const result = await service.processChatMessage({ query: 'test', threadId: '123' });
 */
export function createChatProxyService({
  // Repositories
  systemsRepository = systemsRepo,
  chatRepository = chatRepo,
  userTasksRepository = userTasksRepo,
  // Services
  systemsServiceDep = systemsService,
  conversationContextServiceDep = conversationContextService,
  equipmentRelationshipServiceDep = equipmentRelationshipService,
  equipmentExtractionServiceDep = equipmentExtraction,
  // Clients
  pythonSidecarClient = pythonSidecar,
  // Config & Utils
  envConfigDep = envConfig,
  logger = defaultLogger,
  chatDebug = defaultChatDebug
} = {}) {

  async function processChatMessage({ query, threadId: rawThreadId, stream = false }) {
    const requestLogger = logger.createRequestLogger();
    const env = envConfigDep.getEnv();

    // Normalize threadId: guarantee a string for Python sidecar
    // API contract allows optional threadId, but sidecar requires it
    const threadId = rawThreadId?.trim() || randomUUID();

    let systemsContext = [];
    let conversationContext = null;

    // Initialize timing breakdown for Node.js steps
    const nodeTiming = {
      conversation_context_ms: 0,
      equipment_search_ms: 0,
      equipment_extraction_ms: 0,
      equipment_inference_ms: 0,
      equipment_context_build_ms: 0,
      system_details_fetch_ms: 0,
      equipment_context_update_ms: 0,
      python_call_ms: 0,
      response_format_ms: 0,
      retrieval_scope_ms: 0  // v5: computed in Python, extracted for UI parity
    };

  try {
    // STEP 1: Get conversation context (always, for memory) and thread equipment blob
    const step1Start = Date.now();
    conversationContext = await conversationContextServiceDep.getWeightedConversationContext(threadId, query);
    nodeTiming.conversation_context_ms = Date.now() - step1Start;

    // Get thread with equipment_context blob
    let threadData = null;
    let existingEquipmentContext = [];

    try {
      threadData = await chatRepository.getChatThread(threadId);
      existingEquipmentContext = threadData?.equipment_context || [];

      requestLogger.info('📦 Retrieved thread equipment context', {
        threadId,
        existingEquipmentCount: existingEquipmentContext.length
      });
    } catch (error) {
      requestLogger.warn('Failed to retrieve thread equipment context', {
        threadId,
        error: error.message
      });
    }

    requestLogger.info('📚 Retrieved conversation context', {
      threadId,
      totalExchanges: conversationContext.total_exchanges,
      accumulatedEquipment: conversationContext.accumulated_equipment.length,
      hasConversationSummary: !!conversationContext.conversation_summary
    });

    chatDebug.step('CONVERSATION_CONTEXT_RETRIEVED', {
      threadId,
      totalExchanges: conversationContext.total_exchanges,
      accumulatedEquipmentCount: conversationContext.accumulated_equipment.length,
      hasSummary: !!conversationContext.conversation_summary
    });

    // STEP 2: Quick reference check and equipment relationship inference
    // ✅ FIX #3: Use existingEquipmentContext from thread blob, not accumulated_equipment
    const step2Start = Date.now();
    const previousEquipment = existingEquipmentContext.length > 0
      ? existingEquipmentContext
      : conversationContext.accumulated_equipment;

    const referenceCheck = equipmentRelationshipServiceDep.quickReferenceCheck(query, previousEquipment);

    requestLogger.info('🔍 Analyzing query for equipment references', {
      query: query.substring(0, 100),
      likelyReference: referenceCheck.likely_reference,
      mentionsEquipmentType: referenceCheck.mentions_equipment_type,
      hasPreviousContext: referenceCheck.has_previous_context,
      shouldInfer: referenceCheck.should_infer
    });

    // STEP 3: Search for new equipment or use relationship inference
    let currentEquipmentSearch = [];
    let equipmentInference = null;

    requestLogger.debug('🔍 Equipment search decision', {
      query: query.substring(0, 100),
      should_infer: referenceCheck.should_infer,
      likely_reference: referenceCheck.likely_reference,
      has_previous_context: referenceCheck.has_previous_context
    });

    // ALWAYS search current query for new equipment (fast database lookup)
    // This catches specific model numbers like "4JH57", "SD60" that user adds in follow-ups
    // Search each keyword separately to avoid multi-word queries returning 0 results
    const step3Start = Date.now();
    const searchQuery = extractKeywords(query) || query;
    const keywords = searchQuery.split(/\s+/).filter(w => w.length > 2);

    // Search each keyword and combine results, deduplicating by asset_uid
    const seenAssetUids = new Set();
    let queryKeywordResults = [];

    // ✅ FIX: Run all keyword searches IN PARALLEL + start LLM extraction at same time
    const keywordSearchPromises = keywords.slice(0, 5).map(keyword =>
      systemsRepository.searchSystems(keyword, { limit: 5 })
    );

    // Start LLM extraction in parallel (will be awaited in else block)
    const llmExtractionPromise = equipmentExtractionServiceDep.extractEquipmentName(query).catch(err => {
      requestLogger.error('❌ LLM extraction FAILED (parallel start)', { error: err.message });
      return { equipment: [] };
    });

    // Wait for all keyword searches to complete (running in parallel)
    const keywordSearchResults = await Promise.all(keywordSearchPromises);

    // Process results and deduplicate with score accumulation
    for (const results of keywordSearchResults) {
      for (const result of results) {
        if (!seenAssetUids.has(result.asset_uid)) {
          seenAssetUids.add(result.asset_uid);
          queryKeywordResults.push({...result, combinedRank: result.rank || 0});
        } else {
          // ✅ FIX: Add score to existing (same equipment found via different keyword)
          const existing = queryKeywordResults.find(e => e.asset_uid === result.asset_uid);
          if (existing) {
            existing.combinedRank = (existing.combinedRank || 0) + (result.rank || 0);
          }
        }
      }
    }

    // Sort by combinedRank (highest first) and limit to top 10
    queryKeywordResults = queryKeywordResults
      .sort((a, b) => (b.combinedRank || b.rank || 0) - (a.combinedRank || a.rank || 0))
      .slice(0, 10);
    const keywordSearchDuration = Date.now() - step3Start;

    requestLogger.info('🔍 Query keyword search completed', {
      query: searchQuery.substring(0, 50),
      resultsFound: queryKeywordResults.length,
      equipment: queryKeywordResults.slice(0, 3).map(eq => `${eq.manufacturer} ${eq.model}`)
    });

    if (referenceCheck.should_infer) {
      // ✅ FIX: Apply anchor boost (+1.0) to top item in existing context
      // This protects the primary equipment from Q1 during Q2+ queries
      const ANCHOR_BOOST = 1.0;
      if (existingEquipmentContext.length > 0) {
        // existingEquipmentContext is sorted by rank (highest first) from conversation-context.service.js
        existingEquipmentContext[0].combinedRank =
          (existingEquipmentContext[0].combinedRank || existingEquipmentContext[0].rank || 0) + ANCHOR_BOOST;

        requestLogger.info('⚓ Applied anchor boost to primary equipment', {
          manufacturer: existingEquipmentContext[0].manufacturer,
          model: existingEquipmentContext[0].model,
          originalRank: existingEquipmentContext[0].rank,
          boostedRank: existingEquipmentContext[0].combinedRank
        });
      }

      // Use LLM to infer equipment relationships, passing BOTH keyword results AND existing context
      const inferenceStart = Date.now();
      const inferenceResult = await equipmentRelationshipServiceDep.inferEquipmentRelationships(
        threadId,
        query,
        queryKeywordResults, // Pass keyword search results (was empty before!)
        existingEquipmentContext // Pass equipment_context blob instead of fetching messages
      );
      nodeTiming.equipment_inference_ms = Date.now() - inferenceStart;

      equipmentInference = inferenceResult.inference;
      currentEquipmentSearch = inferenceResult.expanded_equipment;

      requestLogger.info('🔗 Equipment relationship inference completed', {
        hasInference: !!equipmentInference,
        inferredEquipmentCount: currentEquipmentSearch.length,
        shouldSearchRelated: inferenceResult.should_search_related
      });

      chatDebug.step('EQUIPMENT_INFERENCE_COMPLETED', {
        inferredEquipmentCount: currentEquipmentSearch.length,
        inferenceConfidence: equipmentInference?.confidence || null,
        inferredRelationships: equipmentInference?.relationships?.length || 0
      });

      // ✅ FIX (Change 6): If inference determined this is NEW equipment, run LLM extraction
      // This ensures phrase-based search runs even in the inference path
      // Note: Check analysis exists first to avoid null reference errors
      if (equipmentInference?.analysis?.is_new_equipment === true && currentEquipmentSearch.length > 0) {
        requestLogger.info('🆕 Inference detected NEW equipment - running LLM extraction for better ranking', {
          is_new_equipment: equipmentInference.analysis.is_new_equipment,
          currentKeywordResults: currentEquipmentSearch.length
        });

        const extractionStart = Date.now();
        const llmExtraction = await equipmentExtractionServiceDep.extractEquipmentName(query).catch(err => {
          requestLogger.error('❌ LLM extraction failed in inference path', { error: err.message });
          return { equipment: [] };
        });
        nodeTiming.equipment_extraction_ms += Date.now() - extractionStart;

        if (llmExtraction.equipment && llmExtraction.equipment.length > 0) {
          const LLM_WEIGHT = 1.5;
          const seenAssetUids = new Set(currentEquipmentSearch.map(eq => eq.asset_uid));

          for (const eq of llmExtraction.equipment) {
            const results = await systemsRepository.searchSystems(eq.name, { limit: 10 });

            for (const result of results) {
              const weightedRank = (result.rank || 0) * LLM_WEIGHT;

              if (!seenAssetUids.has(result.asset_uid)) {
                seenAssetUids.add(result.asset_uid);
                currentEquipmentSearch.push({
                  ...result,
                  combinedRank: weightedRank,
                  search_source: 'llm',
                  llm_confidence: eq.confidence,
                  llm_role: eq.role
                });
              } else {
                // ✅ Add weighted score to existing (same equipment found by keyword + LLM)
                const existing = currentEquipmentSearch.find(e => e.asset_uid === result.asset_uid);
                if (existing) {
                  existing.combinedRank = (existing.combinedRank || existing.rank || 0) + weightedRank;
                }
              }
            }
          }

          // Re-sort by combinedRank after LLM merge
          currentEquipmentSearch.sort((a, b) =>
            (b.combinedRank || b.rank || 0) - (a.combinedRank || a.rank || 0)
          );

          requestLogger.info('✅ LLM extraction merged in inference path', {
            finalEquipmentCount: currentEquipmentSearch.length,
            topEquipment: currentEquipmentSearch.slice(0, 3).map(eq => ({
              manufacturer: eq.manufacturer,
              model: eq.model,
              combinedRank: eq.combinedRank
            }))
          });
        }
      }

      // NEW: If inference found nothing AND we have no existing context, try LLM extraction as fallback
      if (currentEquipmentSearch.length === 0 && existingEquipmentContext.length === 0) {
        requestLogger.info('🤖 No equipment found and no context exists, trying LLM extraction', {
          originalQuery: query.substring(0, 100)
        });

        const extractionStart = Date.now();
        const extraction = await equipmentExtractionServiceDep.extractEquipmentName(query);
        nodeTiming.equipment_extraction_ms += Date.now() - extractionStart;

        if (extraction.equipment && extraction.equipment.length > 0) {
          requestLogger.info('🔬 [INFERENCE_FALLBACK] Extracted multiple equipment', {
            count: extraction.equipment.length,
            equipment: extraction.equipment.map(e => e.name)
          });

          // Search each equipment separately
          for (const eq of extraction.equipment) {
            requestLogger.info('🔍 [SEARCH_START]', {
              name: eq.name,
              confidence: eq.confidence,
              role: eq.role
            });

            const results = await systemsRepository.searchSystems(eq.name, { limit: 10 });

            requestLogger.info('🔍 [SEARCH_RESULT]', {
              name: eq.name,
              found: results.length
            });

            if (results.length > 0) {
              currentEquipmentSearch.push(...results);
            }
          }

          requestLogger.info('✅ [COMBINED_RESULTS]', {
            totalSearched: extraction.equipment.length,
            totalFound: currentEquipmentSearch.length
          });
        } else {
          requestLogger.info('⚠️ LLM extraction returned no equipment', {
            query: query.substring(0, 100)
          });
        }
      } else if (currentEquipmentSearch.length === 0 && existingEquipmentContext.length > 0) {
        // Inference returned empty but context exists
        // First check if keyword search found new equipment we should add
        if (queryKeywordResults.length > 0) {
          requestLogger.info('🔄 Inference empty but keyword search found equipment - merging with context', {
            keywordResultsCount: queryKeywordResults.length,
            existingContextCount: existingEquipmentContext.length
          });
          // Merge keyword results with existing context
          const seenAssetUids = new Set(existingEquipmentContext.map(eq => eq.asset_uid));
          currentEquipmentSearch = [...existingEquipmentContext];
          for (const eq of queryKeywordResults) {
            if (!seenAssetUids.has(eq.asset_uid)) {
              currentEquipmentSearch.push(eq);
              seenAssetUids.add(eq.asset_uid);
            }
          }
        } else {
          // ✅ FIX #2A: Inference returned empty but context exists - use existing context
          requestLogger.warn('⚠️ Inference returned empty but context exists - using existing context', {
            threadId,
            existingEquipmentCount: existingEquipmentContext.length,
            existingEquipment: existingEquipmentContext.map(eq => ({
              manufacturer: eq.manufacturer,
              model: eq.model
            }))
          });
          // Use existing context instead of fallback
          currentEquipmentSearch = [...existingEquipmentContext];
        }
      }

    } else {
      // ===== LLM EXTRACTION (started in parallel with keyword search above) =====
      // Use queryKeywordResults from earlier + LLM extraction that was started in parallel

      requestLogger.info('🔀 Awaiting LLM extraction (started in parallel with keywords)', {
        query: query.substring(0, 100),
        keywordResultsFromEarlier: queryKeywordResults.length
      });

      chatDebug.step('LLM_EXTRACTION_AWAIT', {
        query: query.substring(0, 100),
        keywordResultsAlreadyHave: queryKeywordResults.length
      });

      const extractionStart = Date.now();

      // Use keyword results from earlier search
      let keywordResults = queryKeywordResults;
      let llmExtraction = { equipment: [] };

      try {
        // ✅ FIX: Await the promise that was started in parallel with keyword searches
        llmExtraction = await llmExtractionPromise;

        const extractionDuration = Date.now() - extractionStart;
        nodeTiming.equipment_extraction_ms = extractionDuration;

        requestLogger.info('✅ LLM extraction COMPLETE (was running in parallel)', {
          duration_ms: extractionDuration,
          keywordResultsCount: keywordResults.length,
          llmExtractedCount: llmExtraction.equipment?.length || 0
        });

        chatDebug.timing('LLM_EXTRACTION_COMPLETE', extractionDuration, {
          keyword_count: keywordResults.length,
          llm_count: llmExtraction.equipment?.length || 0
        });

      } catch (error) {
        requestLogger.error('❌ Parallel search CATASTROPHIC FAILURE', {
          error: error.message,
          stack: error.stack
        });
        // Complete failure - will fallback to existing equipment blob below
      }

      // ===== DETAILED BREAKDOWN =====
      requestLogger.info('📊 Parallel search BREAKDOWN', {
        keyword: {
          count: keywordResults.length,
          asset_uids: keywordResults.map(eq => eq.asset_uid),
          models: keywordResults.map(eq => `${eq.manufacturer} ${eq.model}`)
        },
        llm: {
          extracted_count: llmExtraction.equipment?.length || 0,
          extracted_names: llmExtraction.equipment?.map(e => e.name) || [],
          extracted_confidence: llmExtraction.equipment?.map(e => e.confidence) || []
        }
      });

      // ===== MERGE AND DEDUPLICATE =====
      const allEquipment = [];
      const seenAssetUids = new Set();
      const dedupLog = {
        keyword_added: 0,
        llm_added: 0,
        llm_duplicates: 0,
        llm_not_found: 0
      };

      // Step 1: Add keyword results (preserve combinedRank from score accumulation)
      for (const eq of keywordResults) {
        if (!seenAssetUids.has(eq.asset_uid)) {
          seenAssetUids.add(eq.asset_uid);
          allEquipment.push({
            ...eq,
            combinedRank: eq.combinedRank || eq.rank || 0,  // ✅ FIX: Preserve accumulated score
            search_source: 'keyword'
          });
          dedupLog.keyword_added++;
          // DEBUG: Log each keyword result with its combinedRank (inline)
          requestLogger.debug(`🔑 [KEYWORD_ADD] ${eq.manufacturer} ${eq.model}: rank=${(eq.rank||0).toFixed(3)}, combinedRank=${(eq.combinedRank||0).toFixed(3)}`);
        }
      }

      requestLogger.debug('🔑 Keyword results added', {
        total: keywordResults.length,
        unique: dedupLog.keyword_added,
        duplicates: keywordResults.length - dedupLog.keyword_added
      });

      // Step 2: Search for each LLM-extracted equipment
      if (llmExtraction.equipment && llmExtraction.equipment.length > 0) {
        const llmSearchStart = Date.now();

        requestLogger.info('🔬 Searching for LLM-extracted equipment', {
          count: llmExtraction.equipment.length,
          equipment: llmExtraction.equipment.map(e => e.name)
        });

        // ✅ FIX: Run all LLM searches in PARALLEL (saves ~800ms)
        const llmSearchPromises = llmExtraction.equipment.map(eq =>
          systemsRepository.searchSystems(eq.name, { limit: 10 })
            .then(results => ({ eq, results }))
        );

        const llmSearchResults = await Promise.all(llmSearchPromises);

        // Process results sequentially for score accumulation
        const LLM_WEIGHT = 1.5;  // LLM phrase-based search is more accurate

        for (const { eq, results } of llmSearchResults) {
          requestLogger.info('🔍 [LLM_SEARCH_RESULT]', {
            name: eq.name,
            found: results.length,
            confidence: eq.confidence
          });

          // Track new vs duplicate
          let newCount = 0;
          let dupCount = 0;

          for (const result of results) {
            const weightedRank = (result.rank || 0) * LLM_WEIGHT;

            if (!seenAssetUids.has(result.asset_uid)) {
              seenAssetUids.add(result.asset_uid);
              allEquipment.push({
                ...result,
                combinedRank: weightedRank,
                search_source: 'llm',
                llm_confidence: eq.confidence,
                llm_role: eq.role
              });
              newCount++;
              dedupLog.llm_added++;
            } else {
              // Add weighted score to existing (same equipment found by keyword + LLM)
              const existing = allEquipment.find(e => e.asset_uid === result.asset_uid);
              if (existing) {
                const oldScore = existing.combinedRank || existing.rank || 0;
                existing.combinedRank = oldScore + weightedRank;
                requestLogger.info(`📈 [SCORE_BOOST] ${existing.manufacturer} ${existing.model}: ${oldScore.toFixed(3)} + ${weightedRank.toFixed(3)} = ${existing.combinedRank.toFixed(3)}`);
              }
              dupCount++;
              dedupLog.llm_duplicates++;
            }
          }

          if (results.length === 0) {
            dedupLog.llm_not_found++;
          }

          requestLogger.debug('🔍 [LLM_SEARCH_DEDUP]', {
            name: eq.name,
            total_found: results.length,
            new_added: newCount,
            duplicates: dupCount
          });
        }

        const llmSearchDuration = Date.now() - llmSearchStart;

        requestLogger.info('✅ [LLM_SEARCHES_COMPLETE]', {
          duration_ms: llmSearchDuration,
          total_searched: llmExtraction.equipment.length,
          total_found: dedupLog.llm_added,
          not_found: dedupLog.llm_not_found,
          avg_search_ms: llmExtraction.equipment.length > 0
            ? Math.round(llmSearchDuration / llmExtraction.equipment.length)
            : 0
        });
      }

      // ===== FINAL MERGE SUMMARY =====
      requestLogger.info('✅ [MERGE_COMPLETE]', {
        total_unique: allEquipment.length,
        breakdown: {
          from_keyword: dedupLog.keyword_added,
          from_llm: dedupLog.llm_added,
          llm_duplicates: dedupLog.llm_duplicates,
          llm_not_found: dedupLog.llm_not_found
        },
        final_equipment: allEquipment.map(eq => ({
          asset_uid: eq.asset_uid,
          source: eq.search_source,
          manufacturer: eq.manufacturer,
          model: eq.model,
          rank: eq.rank,
          combinedRank: eq.combinedRank  // ← Shows accumulated score
        }))
      });

      chatDebug.step('EQUIPMENT_MERGE_COMPLETE', {
        total_unique: allEquipment.length,
        keyword_count: dedupLog.keyword_added,
        llm_count: dedupLog.llm_added,
        duplicates: dedupLog.llm_duplicates
      });

      // ✅ FIX: Re-sort by combinedRank after merge (ensures correct ranking)
      currentEquipmentSearch = allEquipment
        .sort((a, b) => (b.combinedRank || b.rank || 0) - (a.combinedRank || a.rank || 0));
      nodeTiming.equipment_search_ms = Date.now() - step3Start + keywordSearchDuration;

      // ===== CREATE TODO TASK IF EQUIPMENT NOT FOUND =====
      if (currentEquipmentSearch.length === 0) {
        // Check if LLM extracted anything but didn't find in systems table
        if (llmExtraction.equipment && llmExtraction.equipment.length > 0) {
          const extractedNames = llmExtraction.equipment.map(e => e.name).join(', ');

          requestLogger.info('❓ Equipment extracted but not found in inventory', {
            extracted: extractedNames,
            count: llmExtraction.equipment.length
          });

          // Create SEPARATE user_task for EACH extracted equipment item
          // Check for existing tasks to prevent duplicates
          for (const equipment of llmExtraction.equipment) {
            try {
              // Check if task already exists for this equipment
              const exists = await userTasksRepository.hasExistingTask(equipment.name);
              if (exists) {
                requestLogger.info('📋 Task already exists for equipment', {
                  equipment: equipment.name
                });
                continue; // Skip this one
              }

              await userTasksRepository.createUserTask({
                description: `Add "${equipment.name}" to systems inventory`,
                asset_uid: null,
                due_date: new Date().toISOString(),
                is_recurring: false,
                notes: `Equipment mentioned in chat: "${query.substring(0, 100)}"`,
                created_by: 'chat_suggestion',
                priority: 'normal'
              });

              requestLogger.info('✅ Created inventory suggestion task', {
                equipment: equipment.name,
                threadId
              });
            } catch (taskError) {
              // Non-blocking - log and continue to next equipment
              requestLogger.warn('⚠️ Failed to create inventory suggestion task', {
                equipment: equipment.name,
                error: taskError.message
              });
            }
          }

          // DON'T RETURN EARLY - continue to Python with empty systems_context
          // Python will use Perplexity for general knowledge
        }

        requestLogger.info('📤 No equipment found, continuing to Python', {
          query: query.substring(0, 100),
          keywordQuery: searchQuery
        });
      }

      // IMPORTANT: If no equipment found but we have equipment in blob, use blob as fallback
      if (currentEquipmentSearch.length === 0 && existingEquipmentContext.length > 0) {
        requestLogger.info('📦 No new equipment found, using existing equipment from blob', {
          existingEquipmentCount: existingEquipmentContext.length
        });
        currentEquipmentSearch = existingEquipmentContext.map(eq => ({
          ...eq,
          source: 'cached_fallback'
        }));
      }
    }

    // STEP 4: Get enhanced equipment context (current + conversation history)
    const step4Start = Date.now();
    const rawEquipmentContext = await conversationContextServiceDep.getEquipmentRelationshipContext(threadId, currentEquipmentSearch);
    nodeTiming.equipment_context_build_ms = Date.now() - step4Start;

    requestLogger.info('🔗 Built equipment relationship context', {
      currentEquipmentFound: currentEquipmentSearch.length,
      totalEquipmentContext: rawEquipmentContext.length,
      equipmentSources: rawEquipmentContext.map(eq => ({
        manufacturer: eq.manufacturer,
        model: eq.model,
        source: eq.source || 'current'
      }))
    });

    chatDebug.step('EQUIPMENT_CONTEXT_BUILT', {
      currentEquipmentCount: currentEquipmentSearch.length,
      totalEquipmentCount: rawEquipmentContext.length,
      sources: [...new Set(rawEquipmentContext.map(eq => eq.source || 'current'))]
    });

    // STEP 5: Fetch full system details for all equipment in context
    // Build map of existing equipment for deduplication
    const existingEquipmentMap = new Map();
    for (const eq of existingEquipmentContext) {
      existingEquipmentMap.set(eq.asset_uid, eq);
    }

    systemsContext = [];
    const newEquipmentFound = [];

    const step5Start = Date.now();
    for (let i = 0; i < Math.min(rawEquipmentContext.length, 20); i++) {
      const equipment = rawEquipmentContext[i];
      try {
        let fullSystem;

        // Check if equipment exists in blob - avoid re-fetch
        if (existingEquipmentMap.has(equipment.asset_uid)) {
          fullSystem = existingEquipmentMap.get(equipment.asset_uid);
          // Preserve llm_confidence and llm_role from current search even if using cached equipment
          fullSystem.llm_confidence = equipment.llm_confidence;
          fullSystem.llm_role = equipment.llm_role;

          requestLogger.info('♻️  Using cached equipment from blob', {
            assetUid: equipment.asset_uid,
            manufacturer: fullSystem.manufacturer,
            model: fullSystem.model
          });
        } else if (equipment.manufacturer && equipment.model && equipment.description) {
          // If equipment is from conversation history, it might already have full details
          fullSystem = equipment;
        } else {
          // Fetch full details from systems API for NEW equipment
          fullSystem = await systemsServiceDep.getSystemSvc(equipment.asset_uid);
          newEquipmentFound.push(fullSystem);

          requestLogger.info('🆕 Fetched NEW equipment details', {
            assetUid: fullSystem.asset_uid,
            manufacturer: fullSystem.manufacturer_norm,
            model: fullSystem.model_norm
          });
        }

        systemsContext.push({
          asset_uid: fullSystem.asset_uid,
          manufacturer: fullSystem.manufacturer_norm || fullSystem.manufacturer,
          model: fullSystem.model_norm || fullSystem.model,
          description: fullSystem.description,
          source: equipment.source || 'current',
          // Add inference metadata if available
          // First equipment from current query gets 'main' relationship type
          relationship_type: equipment.relationship_type || (i === 0 && equipment.source === 'current' ? 'main' : null),
          llm_confidence: equipment.llm_confidence || null,
          llm_role: equipment.llm_role || null,
          rank: equipment.combinedRank || equipment.rank || 0  // ✅ FIX: Use combinedRank if available
        });
      } catch (error) {
        requestLogger.warn('Failed to fetch full system details', {
          asset_uid: equipment.asset_uid,
          error: error.message
        });
        // Fallback to basic data
        systemsContext.push({
          asset_uid: equipment.asset_uid,
          manufacturer: equipment.manufacturer || 'Unknown',
          model: equipment.model || 'Unknown',
          description: equipment.description || 'Equipment details unavailable',
          rank: equipment.combinedRank || equipment.rank || equipment.weight || 0.5,  // ✅ FIX: Use combinedRank
          source: equipment.source || 'current',
          relationship_type: equipment.relationship_type || null,
          inference_confidence: equipment.inference_confidence || null,
          llm_confidence: equipment.llm_confidence || null,
          llm_role: equipment.llm_role || null
        });
      }
    }
    nodeTiming.system_details_fetch_ms = Date.now() - step5Start;

    // STEP 6: Update equipment context blob (always update to persist confidence scores)
    const step6Start = Date.now();
    if (systemsContext.length > 0) {
      try {
        await chatRepository.updateChatThread(threadId, {
          equipment_context: systemsContext
        });

        requestLogger.info('💾 Updated equipment context', {
          threadId,
          totalEquipment: systemsContext.length,
          newEquipmentCount: newEquipmentFound.length,
          systemsContextSample: systemsContext.slice(0, 3).map(eq => ({
            manufacturer: eq.manufacturer,
            model: eq.model,
            llm_confidence: eq.llm_confidence,
            llm_role: eq.llm_role,
            source: eq.source
          }))
        });

        chatDebug.step('EQUIPMENT_CONTEXT_UPDATED', {
          threadId,
          totalEquipment: systemsContext.length,
          newEquipmentCount: newEquipmentFound.length
        });
      } catch (error) {
        requestLogger.warn('Failed to update equipment context', {
          threadId,
          error: error.message
        });
        // Don't block request if save fails
      }
    } else {
      requestLogger.info('✅ Using existing equipment context (no new equipment)', {
        threadId,
        equipmentCount: systemsContext.length
      });
    }
    nodeTiming.equipment_context_update_ms = Date.now() - step6Start;

    // Check for unprocessed manuals - create task if needed (non-blocking, parallel)
    await Promise.all(currentEquipmentSearch.map(async (equipment) => {
      try {
        const docStatus = await userTasksRepository.checkDocumentStatus(equipment.asset_uid);
        if (docStatus.hasDoc && !docStatus.isProcessed) {
          // Look up full system details (search_systems RPC only returns asset_uid + rank)
          const systemDetails = await systemsRepository.getSystemByAssetUid(equipment.asset_uid);
          if (!systemDetails) {
            requestLogger.warn('System not found for unprocessed manual check', {
              asset_uid: equipment.asset_uid
            });
            return;
          }

          const exists = await userTasksRepository.hasExistingTask(systemDetails.model_norm);
          if (!exists) {
            await userTasksRepository.createUserTask({
              description: `Process manual for "${systemDetails.manufacturer_norm} ${systemDetails.model_norm}"`,
              asset_uid: equipment.asset_uid,
              due_date: new Date().toISOString(),
              created_by: 'chat_suggestion',
              priority: 'normal'
            });
            requestLogger.info('Created task for unprocessed manual', {
              equipment: `${systemDetails.manufacturer_norm} ${systemDetails.model_norm}`,
              asset_uid: equipment.asset_uid
            });
          }
        }
      } catch (err) {
        requestLogger.warn('Failed to check document status', { error: err.message });
      }
    }));

    // STEP 6B: Resolve model aliases via ref_model_synonyms
    // Maps model_norms from matched equipment to canonical forms for Pinecone/DIP filtering
    let resolvedModelAliases = [];
    try {
      const modelNorms = systemsContext
        .map(eq => normalizeModelKey(eq.model))
        .filter(Boolean);
      const uniqueNorms = [...new Set(modelNorms)];

      if (uniqueNorms.length > 0) {
        resolvedModelAliases = await systemsRepository.resolveModelAliases(uniqueNorms);
        if (resolvedModelAliases.length > 0) {
          requestLogger.info('🔗 Resolved model aliases', {
            inputModels: uniqueNorms,
            resolvedAliases: resolvedModelAliases
          });
        }
      }
    } catch (aliasError) {
      requestLogger.warn('Failed to resolve model aliases (non-blocking)', {
        error: aliasError.message
      });
    }

    // STEP 7: Call Python sequential workflow (replaces DIP, Pinecone, OpenAI completion)
    chatDebug.step('PYTHON_WORKFLOW_CALL', {
      systemsContextCount: systemsContext.length,
      hasConversationSummary: !!conversationContext.conversation_summary,
      hasEquipmentInference: !!equipmentInference,
      resolvedModelAliases: resolvedModelAliases.length,
      streaming: stream
    });

    const workflowStart = Date.now();

    // STREAMING MODE: Return async generator that yields SSE events
    if (stream) {
      const pythonStream = await pythonSidecarClient.processChatWorkflow({
        query,
        systemsContext,
        threadId,
        conversationSummary: conversationContext.conversation_summary,
        memoryContext: {
          accumulated_equipment: conversationContext.accumulated_equipment,
          total_exchanges: conversationContext.total_exchanges,
          equipment_inference: equipmentInference
        },
        resolvedModelAliases,
        stream: true
      });

      // Return generator that wraps Python events with Node.js context
      return (async function* () {
        for await (const { event, data } of pythonStream) {
          // Add Node.js context to each event
          yield {
            event,
            data: {
              ...data,
              thread_id: threadId,
              systems_context: systemsContext,
              node_timing: nodeTiming
            }
          };
        }
        nodeTiming.python_call_ms = Date.now() - workflowStart;
      })();
    }

    // NON-STREAMING MODE: Original behavior
    const pythonResult = await pythonSidecarClient.processChatWorkflow({
      query,
      systemsContext,
      threadId,
      conversationSummary: conversationContext.conversation_summary,
      memoryContext: {
        accumulated_equipment: conversationContext.accumulated_equipment,
        total_exchanges: conversationContext.total_exchanges,
        equipment_inference: equipmentInference
      },
      resolvedModelAliases
    });
    const workflowDuration = Date.now() - workflowStart;
    nodeTiming.python_call_ms = workflowDuration;

    chatDebug.timing('PYTHON_WORKFLOW_COMPLETE', workflowDuration, {
      hasResponse: !!pythonResult.response,
      sourcesCount: pythonResult.sources?.length || 0,
      classification: pythonResult.classification?.primary || 'unknown'
    });

    requestLogger.info('✅ Python workflow completed', {
      duration_ms: workflowDuration,
      responseLength: pythonResult.response?.length || 0,
      sourcesCount: pythonResult.sources?.length || 0,
      classification: pythonResult.classification?.primary || 'unknown',
      processingTimeMs: pythonResult.processing_time_ms || 0
    });

    // Debug: Log what we received from Python
    requestLogger.info('🔍 Python result keys:', Object.keys(pythonResult));
    if (pythonResult.detailed_metrics) {
      requestLogger.info('📊 Detailed metrics received from Python:', {
        hasClassification: !!pythonResult.detailed_metrics?.classification,
        hasPinecone: !!pythonResult.detailed_metrics?.pinecone,
        hasSynthesis: !!pythonResult.detailed_metrics?.synthesis
      });
    } else {
      requestLogger.warn('⚠️ No detailed_metrics in Python response');
    }

    // Build result object matching previous format
    const step7Start = Date.now();

    // Extract retrieval_scope_ms from Python detailed_metrics for UI parity
    if (pythonResult.detailed_metrics?.timing_summary?.breakdown?.retrieval_scope_ms) {
      nodeTiming.retrieval_scope_ms = pythonResult.detailed_metrics.timing_summary.breakdown.retrieval_scope_ms;
    }

    const result = {
      response: pythonResult.response,
      thread_id: pythonResult.thread_id || threadId,  // Include thread_id from Python or use normalized one
      systems_context: systemsContext,
      sources: pythonResult.sources || [],
      classification: pythonResult.classification,
      score: pythonResult.score,
      metadata: pythonResult.metadata || {},
      processing_time_ms: pythonResult.processing_time_ms || 0,
      detailed_metrics: pythonResult.detailed_metrics || null,  // Pass through detailed metrics
      node_timing: nodeTiming  // Include Node.js step-by-step timing breakdown
    };
    nodeTiming.response_format_ms = Date.now() - step7Start;

    // Debug: Log what we're returning
    requestLogger.info('🎯 Returning result with detailed_metrics:', !!result.detailed_metrics);

    // Diagnostic: Check if timing assignments executed
    const timingSum = Object.values(nodeTiming).reduce((sum, val) => sum + (val || 0), 0);
    if (timingSum === 0) {
      requestLogger.warn('⚠️ WARNING: All node_timing values are 0. Timing assignments may not be executing.', {
        nodeTiming,
        timingSum
      });
    } else {
      requestLogger.info('📊 Node.js timing breakdown (sum:', timingSum, 'ms):', nodeTiming);
    }

    return result;

  } catch (error) {
    // Enhanced error logging with full context
    chatDebug.error('CHAT_PROXY_ERROR', error, {
      threadId,
      query: query?.substring(0, 100),
      systemsContextCount: systemsContext?.length || 0
    });

    requestLogger.error('❌ Chat proxy error', {
      error: error.message,
      stack: error.stack,
      threadId,
      query: query.substring(0, 200),
      equipmentContextCount: systemsContext?.length || 0,
      equipmentDetails: systemsContext?.slice(0, 3).map(eq => ({
        manufacturer: eq.manufacturer,
        model: eq.model,
        source: eq.source
      })),
      hadConversationContext: !!conversationContext?.conversation_summary,
      conversationExchanges: conversationContext?.total_exchanges
    });

    // Convert sidecar connectivity errors to service unavailable (503)
    // so error middleware returns proper status instead of generic 500
    const msg = error.message || '';
    if (msg.includes('Python sidecar') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('fetch failed')) {
      error.code = ERR.SIDECAR_DISABLED;
    }

    throw error;
  }
  }

  // Return the service object
  return { processChatMessage };
}

// ============================================
// DEFAULT INSTANCE - For Backward Compatibility
// ============================================

// Create default instance with real dependencies
const defaultService = createChatProxyService();

// Export the function directly for backward compatibility
// Existing code can still do: import { processChatMessage } from './chat-proxy.service.js'
export const { processChatMessage } = defaultService;

export default {
  processChatMessage,
  createChatProxyService  // Also export factory for tests
};