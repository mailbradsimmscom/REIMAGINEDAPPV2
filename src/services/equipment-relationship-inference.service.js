import { oaiJson } from '../clients/openai.client.js';
import { searchSystems } from '../repositories/systems.repository.js';
import { getSystemSvc } from './systems.service.js';
import { getChatMessages } from '../repositories/chat.repository.js';
import { logger } from '../utils/logger.js';

const RELATIONSHIP_INFERENCE_PROMPT = `You are an expert marine equipment analyst specializing in understanding equipment relationships and user intent.

CONVERSATION CONTEXT:
{conversationHistory}

CURRENT QUERY: "{currentQuery}"

EQUIPMENT CURRENTLY IN SCOPE:
{currentEquipment}

PREVIOUS EQUIPMENT MENTIONED:
{previousEquipment}

Analyze this conversation to determine:
1. Is the user asking about NEW equipment or referring to PREVIOUSLY MENTIONED equipment?
2. If referring to previous equipment, which specific equipment and why?
3. Are there any RELATED/CONNECTED equipment that should be considered? (e.g., GPS mentioned after chartplotter discussion, sounder mentioned after MFD discussion)

Common marine equipment relationships:
- Chartplotters often have integrated GPS/sounder functionality
- MFDs (Multi-Function Displays) typically connect to various sensors
- Radar systems often integrate with chartplotters
- Autopilots connect to GPS and compass systems
- Depth/fish finders often pair with chartplotters
- Engine monitors connect to various engine sensors
- Wind instruments connect to autopilots and sail systems

Respond with valid JSON only:
{{
    "analysis": {{
        "is_new_equipment": false,
        "referring_to_previous": true,
        "confidence": 0.85,
        "reasoning": "User said 'GPS' after discussing V100 chartplotter - likely referring to GPS functionality"
    }},
    "primary_equipment": {{
        "asset_uid": "previous-equipment-id",
        "confidence": 0.90,
        "relationship_type": "same_device",
        "reasoning": "GPS is integral functionality of the V100"
    }},
    "related_equipment": [
        {{
            "search_terms": ["backup GPS", "handheld GPS"],
            "relationship_type": "backup_system",
            "confidence": 0.60,
            "reasoning": "User might be asking about backup GPS options"
        }}
    ],
    "context_expansion": {{
        "should_search_new": false,
        "should_include_related": true,
        "search_suggestions": []
    }}
}}`;

const EQUIPMENT_RELATIONSHIP_TYPES = {
  SAME_DEVICE: 'same_device',           // GPS on a chartplotter
  PAIRED_SYSTEM: 'paired_system',       // Zeus sounder with V100 MFD
  BACKUP_SYSTEM: 'backup_system',       // Backup GPS for primary
  CONNECTED_SENSOR: 'connected_sensor', // Wind sensor to autopilot
  SYSTEM_COMPONENT: 'system_component', // Antenna part of radar system
  ALTERNATIVE_OPTION: 'alternative_option' // Different model consideration
};

/**
 * Analyze conversation to infer equipment relationships and user intent
 */
export async function inferEquipmentRelationships(
  threadId,
  currentQuery,
  currentEquipmentSearch,
  equipmentContextBlob = null
) {
  const requestLogger = logger.createRequestLogger();

  try {
    let previousEquipment = [];
    let conversationHistory = [];

    // If equipment context blob provided, use it directly
    if (equipmentContextBlob && Array.isArray(equipmentContextBlob) && equipmentContextBlob.length > 0) {
      previousEquipment = equipmentContextBlob;
      requestLogger.info('Using equipment context blob from thread', {
        equipmentCount: previousEquipment.length
      });

      // Still get conversation messages for context text (but not for equipment extraction)
      conversationHistory = await getChatMessages(threadId, { limit: 10 });
    } else {
      // Fallback: Get conversation context and extract equipment from messages
      conversationHistory = await getChatMessages(threadId, { limit: 10 });
      previousEquipment = extractEquipmentFromHistory(conversationHistory);
    }

    if (previousEquipment.length === 0 && currentEquipmentSearch.length === 0) {
      // No equipment context to work with
      return {
        inference: null,
        expanded_equipment: currentEquipmentSearch,
        should_search_related: false
      };
    }

    requestLogger.info('🔗 Analyzing equipment relationships', {
      threadId,
      currentQuery: currentQuery.substring(0, 100),
      currentEquipmentCount: currentEquipmentSearch.length,
      previousEquipmentCount: previousEquipment.length
    });

    // Use LLM to analyze relationships
    const inference = await analyzeEquipmentRelationships(
      currentQuery,
      currentEquipmentSearch,
      previousEquipment,
      conversationHistory
    );

    if (!inference) {
      return {
        inference: null,
        expanded_equipment: currentEquipmentSearch,
        should_search_related: false
      };
    }

    // Expand equipment context based on inference
    const expandedEquipment = await expandEquipmentContext(
      currentEquipmentSearch,
      previousEquipment,
      inference
    );

    requestLogger.info('✅ Equipment relationship inference completed', {
      threadId,
      inferredNewEquipment: inference.analysis.is_new_equipment,
      refersToPrevious: inference.analysis.referring_to_previous,
      expandedEquipmentCount: expandedEquipment.length,
      confidence: inference.analysis.confidence
    });

    return {
      inference,
      expanded_equipment: expandedEquipment,
      should_search_related: inference.context_expansion?.should_include_related || false
    };

  } catch (error) {
    requestLogger.error('❌ Equipment relationship inference failed', {
      threadId,
      error: error.message,
      currentQuery: currentQuery.substring(0, 100)
    });

    // Return fallback - just use current equipment search
    return {
      inference: null,
      expanded_equipment: currentEquipmentSearch,
      should_search_related: false
    };
  }
}

/**
 * Use LLM to analyze equipment relationships
 */
async function analyzeEquipmentRelationships(
  currentQuery,
  currentEquipmentSearch,
  previousEquipment,
  conversationHistory
) {
  try {
    // Format conversation history
    const historyText = conversationHistory
      .slice(-6) // Last 6 messages
      .map(msg => `${msg.role.toUpperCase()}: ${msg.content.substring(0, 200)}`)
      .join('\n');

    // Format current equipment
    const currentEquipmentText = currentEquipmentSearch.length > 0
      ? currentEquipmentSearch.map(eq =>
          `- ${eq.manufacturer || 'Unknown'} ${eq.model || 'Unknown'} (confidence: ${eq.rank || 0})`
        ).join('\n')
      : 'None found';

    // Format previous equipment
    const previousEquipmentText = previousEquipment.length > 0
      ? previousEquipment.map(eq =>
          `- ${eq.manufacturer || 'Unknown'} ${eq.model || 'Unknown'} (from: ${eq.source})`
        ).join('\n')
      : 'None mentioned';

    const userPrompt = RELATIONSHIP_INFERENCE_PROMPT
      .replace('{conversationHistory}', historyText)
      .replace('{currentQuery}', currentQuery)
      .replace('{currentEquipment}', currentEquipmentText)
      .replace('{previousEquipment}', previousEquipmentText);

    const inference = await oaiJson({
      system: 'You are an expert marine equipment analyst. Respond only with valid JSON.',
      user: userPrompt,
      schema: {
        type: "object",
        properties: {
          analysis: {
            type: "object",
            properties: {
              is_new_equipment: { type: "boolean" },
              referring_to_previous: { type: "boolean" },
              confidence: { type: "number" },
              reasoning: { type: "string" }
            },
            required: ["confidence"]
          },
          primary_equipment: { type: "object" },
          related_equipment: { type: "array" },
          context_expansion: { type: "object" }
        }
      },
      model: 'gpt-4o-mini',
      maxOutputTokens: 800
    });

    return inference;

  } catch (error) {
    logger.error('LLM equipment relationship analysis failed', {
      error: error.message
    });
    return null;
  }
}

/**
 * Extract equipment mentions from conversation history
 */
function extractEquipmentFromHistory(conversationHistory) {
  const equipment = [];

  for (const message of conversationHistory) {
    // Extract from metadata if available
    if (message.metadata?.systems_context) {
      for (const eq of message.metadata.systems_context) {
        equipment.push({
          ...eq,
          source: 'metadata',
          mentioned_at: message.created_at
        });
      }
    }

    // Extract from equipment_mentioned if available (new schema)
    if (message.equipment_mentioned) {
      for (const eq of message.equipment_mentioned) {
        equipment.push({
          ...eq,
          source: 'equipment_mentioned',
          mentioned_at: message.created_at
        });
      }
    }
  }

  // Deduplicate by asset_uid, keeping most recent
  const uniqueEquipment = [];
  const seenAssetUids = new Set();

  for (const eq of equipment.reverse()) { // Most recent first
    if (!seenAssetUids.has(eq.asset_uid)) {
      uniqueEquipment.push(eq);
      seenAssetUids.add(eq.asset_uid);
    }
  }

  return uniqueEquipment;
}

/**
 * Expand equipment context based on LLM inference
 */
async function expandEquipmentContext(currentEquipmentSearch, previousEquipment, inference) {
  try {
    const expandedEquipment = [...currentEquipmentSearch];

    // If LLM says user is referring to previous equipment
    if (inference.analysis.referring_to_previous) {
      let referencedEquipment = null;

      // Try to find specific equipment if asset_uid provided
      if (inference.primary_equipment?.asset_uid) {
        referencedEquipment = previousEquipment.find(eq =>
          eq.asset_uid === inference.primary_equipment.asset_uid
        );
      }

      // ✅ FIX #1: If no specific match, use most recent equipment as fallback
      if (!referencedEquipment && previousEquipment.length > 0) {
        referencedEquipment = previousEquipment[0]; // Most recent in context

        logger.info('🔄 Using most recent equipment as fallback (asset_uid not matched)', {
          manufacturer: referencedEquipment.manufacturer,
          model: referencedEquipment.model,
          asset_uid: referencedEquipment.asset_uid
        });
      }

      if (referencedEquipment) {
        // Get full system details and add to context with high priority
        try {
          const fullSystem = await getSystemSvc(referencedEquipment.asset_uid);
          expandedEquipment.unshift({
            ...fullSystem,
            rank: 0.95, // High confidence since it's from conversation context
            source: 'conversation_inference',
            relationship_type: inference.primary_equipment?.relationship_type || 'contextual_reference',
            inference_confidence: inference.primary_equipment?.confidence || 0.90
          });
        } catch (error) {
          // Fallback to basic equipment data
          expandedEquipment.unshift({
            ...referencedEquipment,
            rank: 0.85,
            source: 'conversation_inference'
          });
        }
      }
    }

    // Search for related equipment if suggested
    if (inference.related_equipment && inference.related_equipment.length > 0) {
      for (const relatedSuggestion of inference.related_equipment) {
        if (relatedSuggestion.confidence > 0.6) { // Only high-confidence suggestions
          try {
            for (const searchTerm of relatedSuggestion.search_terms) {
              const relatedEquipment = await searchSystems(searchTerm, { limit: 3 });

              for (const equipment of relatedEquipment) {
                // Avoid duplicates
                const isDuplicate = expandedEquipment.some(eq => eq.asset_uid === equipment.asset_uid);
                if (!isDuplicate) {
                  expandedEquipment.push({
                    ...equipment,
                    rank: equipment.rank * relatedSuggestion.confidence, // Adjust confidence
                    source: 'relationship_inference',
                    relationship_type: relatedSuggestion.relationship_type,
                    inference_reasoning: relatedSuggestion.reasoning
                  });
                }
              }
            }
          } catch (error) {
            logger.warning('Failed to search for related equipment', {
              searchTerms: relatedSuggestion.search_terms,
              error: error.message
            });
          }
        }
      }
    }

    // Sort by rank (confidence) descending
    expandedEquipment.sort((a, b) => (b.rank || 0) - (a.rank || 0));

    return expandedEquipment;

  } catch (error) {
    logger.error('Failed to expand equipment context', {
      error: error.message
    });
    return currentEquipmentSearch;
  }
}

/**
 * Quick check if query might be referring to previous equipment
 */
export function quickReferenceCheck(query, previousEquipment) {
  const queryLower = query.toLowerCase();

  // Simple heuristics for common reference patterns
  const referencePatterns = [
    /\\b(it|this|that)\\b/,     // "what is it made of"
    /\\b(the|my)\\s+\\w+\\b/,    // "the GPS", "my radar"
    /\\bthis\\s+\\w+\\b/,        // "this device"
    /\\bhow\\s+(do|does)\\s+(i|it)\\b/ // "how do I", "how does it"
  ];

  const hasReferencePattern = referencePatterns.some(pattern => pattern.test(queryLower));

  // Check for equipment type mentions that might refer to previous equipment
  const equipmentTypes = ['gps', 'radar', 'sounder', 'chartplotter', 'autopilot', 'anchor', 'engine'];
  const mentionsEquipmentType = equipmentTypes.some(type => queryLower.includes(type));

  // 🧪 EXPERIMENTAL FIX (2025-11-20): Bypass regex gate, trust LLM inference
  // REVERT TO: should_infer: (hasReferencePattern || mentionsEquipmentType) && previousEquipment.length > 0
  // REASON: Regex can't handle natural language variations ("this filter", "that component", etc.)
  // SOLUTION: If previousEquipment exists, always try LLM inference - let LLM decide if referring to previous
  return {
    likely_reference: hasReferencePattern,
    mentions_equipment_type: mentionsEquipmentType,
    has_previous_context: previousEquipment.length > 0,
    should_infer: previousEquipment.length > 0  // ← Changed: Always infer when context exists
  };
}

export default {
  inferEquipmentRelationships,
  quickReferenceCheck,
  EQUIPMENT_RELATIONSHIP_TYPES
};