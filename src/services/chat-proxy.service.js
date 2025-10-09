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
    const previousEquipment = conversationContext.accumulated_equipment;
    const referenceCheck = quickReferenceCheck(query, previousEquipment);

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

    console.log('🔍 [DEBUG] Equipment search decision', {
      query: query.substring(0, 100),
      should_infer: referenceCheck.should_infer,
      likely_reference: referenceCheck.likely_reference,
      has_previous_context: referenceCheck.has_previous_context
    });

    requestLogger.info('🔍 [DEBUG] Equipment search decision', {
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

      // NEW: If inference found nothing, try LLM extraction as fallback
      if (currentEquipmentSearch.length === 0) {
        requestLogger.info('🤖 Inference found no equipment, trying LLM extraction', {
          originalQuery: query.substring(0, 100)
        });

        const extractedEquipment = await extractEquipmentName(query);

        if (extractedEquipment) {
          requestLogger.info('✅ LLM extracted equipment name', {
            extracted: extractedEquipment.substring(0, 100)
          });

          // Search with extracted equipment name
          currentEquipmentSearch = await searchSystems(extractedEquipment, { limit: 10 });

          if (currentEquipmentSearch.length > 0) {
            requestLogger.info('✅ Found equipment after LLM extraction', {
              extracted: extractedEquipment,
              equipmentCount: currentEquipmentSearch.length
            });
          }
        } else {
          requestLogger.info('⚠️ LLM extraction returned no equipment', {
            query: query.substring(0, 100)
          });
        }
      }

    } else {
      // Traditional keyword-based equipment search
      const searchQuery = extractKeywords(query) || query;

      console.log('🔍 [DEBUG] Keyword search path', {
        originalQuery: query,
        extractedKeywords: searchQuery,
        willSearch: searchQuery && searchQuery !== query
      });

      if (searchQuery && searchQuery !== query) {
        requestLogger.info('🔍 Searching systems table for new equipment', {
          originalQuery: query.substring(0, 100),
          searchQuery: searchQuery.substring(0, 100)
        });

        currentEquipmentSearch = await searchSystems(searchQuery, { limit: 10 });

        console.log('🔍 [DEBUG] searchSystems result', {
          searchQuery,
          resultsCount: currentEquipmentSearch.length,
          results: currentEquipmentSearch
        });
      }

      // NEW: If no equipment found, try LLM extraction ONCE as fallback
      if (currentEquipmentSearch.length === 0) {
        console.log('🔍 [DEBUG] No equipment found, trying LLM extraction');

        requestLogger.info('🤖 No equipment found with keywords, trying LLM extraction', {
          originalQuery: query.substring(0, 100)
        });

        const extractedEquipment = await extractEquipmentName(query);

        console.log('🔍 [DEBUG] LLM extraction result', {
          extracted: extractedEquipment
        });

        if (extractedEquipment) {
          requestLogger.info('✅ LLM extracted equipment name', {
            extracted: extractedEquipment.substring(0, 100)
          });

          // Search AGAIN with extracted equipment name
          currentEquipmentSearch = await searchSystems(extractedEquipment, { limit: 10 });

          console.log('🔍 [DEBUG] LLM extraction search result', {
            extractedEquipment,
            resultsCount: currentEquipmentSearch.length,
            results: currentEquipmentSearch
          });

          // If still no results after extraction, return clarification request
          if (currentEquipmentSearch.length === 0) {
            requestLogger.info('❓ Equipment not found after extraction, requesting user clarification', {
              extracted: extractedEquipment
            });

            // Return early with clarification request
            return {
              response: `I couldn't find "${extractedEquipment}" in your equipment inventory. Could you provide the manufacturer and model number? Or would you like me to answer generally about ${extractedEquipment}?`,
              systems_context: [],
              sources: [],
              classification: { primary: 'clarification_needed' },
              metadata: {
                extraction_attempted: true,
                extracted_equipment: extractedEquipment,
                needs_user_input: true
              },
              processing_time_ms: 0
            };
          } else {
            requestLogger.info('✅ Found equipment after LLM extraction', {
              extracted: extractedEquipment,
              equipmentCount: currentEquipmentSearch.length
            });
          }
        } else {
          requestLogger.info('⚠️ LLM extraction returned no equipment', {
            query: query.substring(0, 100)
          });
        }
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

    for (let i = 0; i < Math.min(rawEquipmentContext.length, 2); i++) {
      const equipment = rawEquipmentContext[i];
      try {
        let fullSystem;

        // Check if equipment exists in blob - avoid re-fetch
        if (existingEquipmentMap.has(equipment.asset_uid)) {
          fullSystem = existingEquipmentMap.get(equipment.asset_uid);

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
          relationship_type: equipment.relationship_type || (i === 0 && equipment.source === 'current' ? 'main' : null)
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
          rank: equipment.rank || equipment.weight || 0.5,
          source: equipment.source || 'current',
          relationship_type: equipment.relationship_type || null,
          inference_confidence: equipment.inference_confidence || null
        });
      }
    }

    // STEP 6: Update equipment context blob if NEW equipment found
    if (newEquipmentFound.length > 0) {
      try {
        await updateChatThread(threadId, {
          equipment_context: systemsContext
        });

        requestLogger.info('💾 Updated equipment context with NEW equipment', {
          threadId,
          totalEquipment: systemsContext.length,
          newEquipmentCount: newEquipmentFound.length,
          newEquipment: newEquipmentFound.map(eq => ({
            manufacturer: eq.manufacturer,
            model: eq.model
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