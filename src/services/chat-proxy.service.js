import { searchSystems } from '../repositories/systems.repository.js';
import { getSystemSvc } from './systems.service.js';
import { getWeightedConversationContext, getEquipmentRelationshipContext } from './conversation-context.service.js';
import { inferEquipmentRelationships, quickReferenceCheck } from './equipment-relationship-inference.service.js';
import { updateChatThread } from '../repositories/chat.repository.js';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { processChatWorkflow } from '../clients/python-sidecar.client.js';
import { chatDebug } from '../utils/chat-debug-logger.js';
import { extractEquipmentName } from './equipment-extraction.service.js';

function extractKeywords(query) {
  if (!query || typeof query !== 'string') {
    return '';
  }

  const stopWords = new Set(['tell', 'me', 'about', 'my', 'the', 'a', 'an', 'is', 'are', 'what', 'how', 'when', 'where', 'why', 'which', 'who', 'can', 'could', 'would', 'should', 'will', 'do', 'does', 'did', 'has', 'have', 'had', 'be', 'been', 'being', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'from', 'by', 'it', 'its', 'this', 'that', 'these', 'those']);

  const words = query.toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));

  return words.join(' ');
}


export async function processChatMessage({ query, threadId, synthesisModel = 'gpt-5' }) {
  const requestLogger = logger.createRequestLogger();
  const env = getEnv();
  let systemsContext = [];
  let conversationContext = null;

  try {
    // STEP 1: Get conversation context (always, for memory) and thread equipment blob
    conversationContext = await getWeightedConversationContext(threadId, query);

    // Get thread with equipment_context blob
    const { getChatThread } = await import('../repositories/chat.repository.js');
    let threadData = null;
    let existingEquipmentContext = [];

    try {
      threadData = await getChatThread(threadId);

      // 🔍 DIAGNOSTIC LOGGING - Remove after debugging
      console.log('\n=== EQUIPMENT CONTEXT DEBUG START ===');
      console.log('Thread ID:', threadId);
      console.log('threadData exists:', !!threadData);
      console.log('threadData keys:', threadData ? Object.keys(threadData) : 'null');
      console.log('threadData.equipment_context:', threadData?.equipment_context);
      console.log('Type of equipment_context:', typeof threadData?.equipment_context);
      console.log('Is Array:', Array.isArray(threadData?.equipment_context));
      console.log('String value:', JSON.stringify(threadData?.equipment_context));

      existingEquipmentContext = threadData?.equipment_context || [];

      console.log('After assignment:');
      console.log('existingEquipmentContext:', existingEquipmentContext);
      console.log('existingEquipmentContext.length:', existingEquipmentContext.length);
      console.log('=== EQUIPMENT CONTEXT DEBUG END ===\n');

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
    const previousEquipment = existingEquipmentContext.length > 0
      ? existingEquipmentContext
      : conversationContext.accumulated_equipment;

    // 🔍 DIAGNOSTIC LOGGING - Remove after debugging
    console.log('\n=== REFERENCE CHECK DEBUG START ===');
    console.log('Query:', query);
    console.log('existingEquipmentContext.length:', existingEquipmentContext.length);
    console.log('conversationContext.accumulated_equipment.length:', conversationContext.accumulated_equipment.length);
    console.log('previousEquipment:', previousEquipment);
    console.log('previousEquipment.length:', previousEquipment.length);

    const referenceCheck = quickReferenceCheck(query, previousEquipment);

    console.log('referenceCheck result:', referenceCheck);
    console.log('=== REFERENCE CHECK DEBUG END ===\n');

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

    if (referenceCheck.should_infer) {
      // Use LLM to infer equipment relationships, passing existing equipment context
      const inferenceResult = await inferEquipmentRelationships(
        threadId,
        query,
        [], // Start with empty current search for inference
        existingEquipmentContext // Pass equipment_context blob instead of fetching messages
      );

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

      // NEW: If inference found nothing AND we have no existing context, try LLM extraction as fallback
      if (currentEquipmentSearch.length === 0 && existingEquipmentContext.length === 0) {
        requestLogger.info('🤖 No equipment found and no context exists, trying LLM extraction', {
          originalQuery: query.substring(0, 100)
        });

        const extraction = await extractEquipmentName(query);

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

            const results = await searchSystems(eq.name, { limit: 10 });

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

    } else {
      // ===== PARALLEL EQUIPMENT SEARCH =====
      // Run BOTH keyword search AND LLM extraction simultaneously
      // Merge results to never miss multi-equipment or implicit systems

      requestLogger.info('🔀 Starting PARALLEL equipment search', {
        query: query.substring(0, 100),
        paths: ['keyword_search', 'llm_extraction']
      });

      chatDebug.step('PARALLEL_SEARCH_START', {
        query: query.substring(0, 100),
        paths: 2
      });

      const parallelStart = Date.now();

      // Extract keywords for search
      const searchQuery = extractKeywords(query) || query;

      // Launch both searches in parallel with error handling
      let keywordResults = [];
      let llmExtraction = { equipment: [] };

      try {
        const results = await Promise.all([
          // Path 1: Keyword search (fast, exact matches)
          searchSystems(searchQuery, { limit: 10 }).catch(err => {
            requestLogger.error('❌ Keyword search FAILED', {
              error: err.message,
              query: searchQuery
            });
            return []; // Graceful degradation
          }),

          // Path 2: LLM extraction (semantic understanding)
          extractEquipmentName(query).catch(err => {
            requestLogger.error('❌ LLM extraction FAILED', {
              error: err.message,
              query: query.substring(0, 100)
            });
            return { equipment: [] }; // Graceful degradation
          })
        ]);

        keywordResults = results[0];
        llmExtraction = results[1];

        const parallelDuration = Date.now() - parallelStart;

        requestLogger.info('✅ Parallel execution COMPLETE', {
          duration_ms: parallelDuration,
          keywordResultsCount: keywordResults.length,
          llmExtractedCount: llmExtraction.equipment?.length || 0,
          bothSucceeded: true
        });

        chatDebug.timing('PARALLEL_SEARCH_COMPLETE', parallelDuration, {
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

      // Step 1: Add keyword results
      for (const eq of keywordResults) {
        if (!seenAssetUids.has(eq.asset_uid)) {
          seenAssetUids.add(eq.asset_uid);
          allEquipment.push({
            ...eq,
            search_source: 'keyword'
          });
          dedupLog.keyword_added++;
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

        for (const eq of llmExtraction.equipment) {
          const searchStart = Date.now();

          requestLogger.info('🔍 [LLM_SEARCH_START]', {
            name: eq.name,
            confidence: eq.confidence,
            role: eq.role
          });

          const results = await searchSystems(eq.name, { limit: 10 });
          const searchDuration = Date.now() - searchStart;

          requestLogger.info('🔍 [LLM_SEARCH_RESULT]', {
            name: eq.name,
            found: results.length,
            duration_ms: searchDuration,
            asset_uids: results.map(r => r.asset_uid)
          });

          chatDebug.timing(`SEARCH_${eq.name}`, searchDuration, {
            found: results.length
          });

          // Track new vs duplicate
          let newCount = 0;
          let dupCount = 0;

          for (const result of results) {
            if (!seenAssetUids.has(result.asset_uid)) {
              seenAssetUids.add(result.asset_uid);
              allEquipment.push({
                ...result,
                search_source: 'llm',
                llm_confidence: eq.confidence,
                llm_role: eq.role
              });
              newCount++;
              dedupLog.llm_added++;
            } else {
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
          model: eq.model
        }))
      });

      chatDebug.step('EQUIPMENT_MERGE_COMPLETE', {
        total_unique: allEquipment.length,
        keyword_count: dedupLog.keyword_added,
        llm_count: dedupLog.llm_added,
        duplicates: dedupLog.llm_duplicates
      });

      currentEquipmentSearch = allEquipment;

      // ===== CLARIFICATION IF NOTHING FOUND =====
      if (currentEquipmentSearch.length === 0) {
        // Check if LLM extracted anything but didn't find in systems table
        if (llmExtraction.equipment && llmExtraction.equipment.length > 0) {
          const extractedNames = llmExtraction.equipment.map(e => e.name).join(', ');

          requestLogger.info('❓ Equipment extracted but not found in inventory', {
            extracted: extractedNames,
            count: llmExtraction.equipment.length
          });

          return {
            response: `I couldn't find "${extractedNames}" in your equipment inventory. Could you provide the manufacturer and model number? Or would you like me to answer generally about ${extractedNames}?`,
            systems_context: [],
            sources: [],
            classification: { primary: 'clarification_needed' },
            metadata: {
              extraction_attempted: true,
              extracted_equipment: extractedNames,
              needs_user_input: true
            },
            processing_time_ms: 0
          };
        }

        requestLogger.info('⚠️ No equipment found via keyword or LLM', {
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
    const rawEquipmentContext = await getEquipmentRelationshipContext(threadId, currentEquipmentSearch);

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
          fullSystem = await getSystemSvc(equipment.asset_uid);
          newEquipmentFound.push(fullSystem);

          requestLogger.info('🆕 Fetched NEW equipment details', {
            assetUid: fullSystem.asset_uid,
            manufacturer: fullSystem.manufacturer,
            model: fullSystem.model
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
          rank: equipment.rank ?? 0
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
          rank: equipment.rank ?? equipment.weight ?? 0.5,
          source: equipment.source || 'current',
          relationship_type: equipment.relationship_type || null,
          inference_confidence: equipment.inference_confidence || null,
          llm_confidence: equipment.llm_confidence || null,
          llm_role: equipment.llm_role || null
        });
      }
    }

    // STEP 6: Update equipment context blob (always update to persist confidence scores)
    if (systemsContext.length > 0) {
      try {
        await updateChatThread(threadId, {
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

    // STEP 7: Call Python sequential workflow (replaces DIP, Pinecone, OpenAI completion)
    chatDebug.step('PYTHON_WORKFLOW_CALL', {
      systemsContextCount: systemsContext.length,
      hasConversationSummary: !!conversationContext.conversation_summary,
      hasEquipmentInference: !!equipmentInference
    });

    const workflowStart = Date.now();
    const pythonResult = await processChatWorkflow({
      query,
      systemsContext,
      threadId,
      conversationSummary: conversationContext.conversation_summary,
      memoryContext: {
        accumulated_equipment: conversationContext.accumulated_equipment,
        total_exchanges: conversationContext.total_exchanges,
        equipment_inference: equipmentInference
      },
      synthesisModel
    });
    const workflowDuration = Date.now() - workflowStart;

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
    const result = {
      response: pythonResult.response,
      systems_context: systemsContext,
      sources: pythonResult.sources || [],
      classification: pythonResult.classification,
      score: pythonResult.score,
      metadata: pythonResult.metadata || {},
      processing_time_ms: pythonResult.processing_time_ms || 0,
      detailed_metrics: pythonResult.detailed_metrics || null  // Pass through detailed metrics
    };

    // Debug: Log what we're returning
    requestLogger.info('🎯 Returning result with detailed_metrics:', !!result.detailed_metrics);

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
    throw error;
  }
}

export default {
  processChatMessage
};