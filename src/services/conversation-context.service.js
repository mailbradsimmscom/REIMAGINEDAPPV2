import { getChatMessages } from '../repositories/chat.repository.js';
import { logger } from '../utils/logger.js';

/**
 * Conversation Context Service
 *
 * Handles weighted conversation memory with fading importance.
 * Recent exchanges get full context, older ones get compressed.
 */

// Memory weight configuration
const MEMORY_WEIGHTS = {
  current: 1.0,      // Current exchange - full detail
  last_2: 0.8,       // Last 2 exchanges - high detail
  last_5: 0.5,       // Last 5 exchanges - medium detail
  older: 0.2         // Older exchanges - compressed summary
};

/**
 * Get weighted conversation context for a thread
 * @param {string} threadId - Thread ID to get context for
 * @param {string} currentQuery - Current user query
 * @returns {Object} Weighted conversation context
 */
export async function getWeightedConversationContext(threadId, currentQuery = '') {
  const requestLogger = logger.createRequestLogger();

  if (!threadId) {
    return {
      conversation_summary: '',
      accumulated_equipment: [],
      memory_context: null,
      total_exchanges: 0
    };
  }

  try {
    // Get conversation history (limit to reasonable amount)
    const messages = await getChatMessages(threadId, { limit: 20 });

    if (!messages || messages.length === 0) {
      return {
        conversation_summary: '',
        accumulated_equipment: [],
        memory_context: null,
        total_exchanges: 0
      };
    }

    // Group messages into Q&A pairs
    const exchanges = groupMessagesIntoExchanges(messages);

    // Generate weighted context
    const weightedContext = await generateWeightedContext(exchanges);

    // Extract accumulated equipment from all exchanges
    const accumulatedEquipment = extractAccumulatedEquipment(exchanges);

    requestLogger.info('Generated weighted conversation context', {
      threadId,
      totalExchanges: exchanges.length,
      accumulatedEquipmentCount: accumulatedEquipment.length,
      memoryWeight: weightedContext.total_weight
    });

    return {
      conversation_summary: weightedContext.summary,
      accumulated_equipment: accumulatedEquipment,
      memory_context: {
        total_weight: weightedContext.total_weight,
        exchange_weights: weightedContext.exchange_weights,
        equipment_transitions: weightedContext.equipment_transitions
      },
      total_exchanges: exchanges.length
    };

  } catch (error) {
    requestLogger.error('Failed to generate conversation context', {
      threadId,
      error: error.message
    });

    // Return empty context on failure
    return {
      conversation_summary: '',
      accumulated_equipment: [],
      memory_context: null,
      total_exchanges: 0
    };
  }
}

/**
 * Group chat messages into Q&A exchange pairs
 * @param {Array} messages - Raw chat messages
 * @returns {Array} Array of exchange objects
 */
function groupMessagesIntoExchanges(messages) {
  const exchanges = [];
  let currentExchange = {};

  for (const message of messages) {
    if (message.role === 'user') {
      // Start new exchange
      if (currentExchange.user_message) {
        // Push previous exchange if complete
        if (currentExchange.assistant_message) {
          exchanges.push({ ...currentExchange });
        }
      }
      currentExchange = {
        user_message: message,
        assistant_message: null,
        equipment_context: null,
        created_at: message.created_at
      };
    } else if (message.role === 'assistant' && currentExchange.user_message) {
      // Complete current exchange
      currentExchange.assistant_message = message;
      currentExchange.equipment_context = message.metadata?.systems_context || [];
    }
  }

  // Add final exchange if complete
  if (currentExchange.user_message && currentExchange.assistant_message) {
    exchanges.push(currentExchange);
  }

  // Sort by creation time (newest first)
  return exchanges.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/**
 * Generate weighted context summary from exchanges
 * @param {Array} exchanges - Q&A exchanges
 * @returns {Object} Weighted context with summary
 */
async function generateWeightedContext(exchanges) {
  if (exchanges.length === 0) {
    return {
      summary: '',
      total_weight: 0,
      exchange_weights: [],
      equipment_transitions: []
    };
  }

  let summary = '';
  let totalWeight = 0;
  const exchangeWeights = [];
  const equipmentTransitions = [];

  for (let i = 0; i < exchanges.length; i++) {
    const exchange = exchanges[i];
    const weight = calculateExchangeWeight(i, exchanges.length);

    // Create weighted summary entry
    const exchangeSummary = createExchangeSummary(exchange, weight);
    summary += exchangeSummary;

    totalWeight += weight;
    exchangeWeights.push({
      index: i,
      weight: weight,
      user_query: exchange.user_message.content.substring(0, 100),
      equipment_count: exchange.equipment_context?.length || 0
    });

    // Track equipment transitions
    if (exchange.equipment_context && exchange.equipment_context.length > 0) {
      equipmentTransitions.push({
        exchange_index: i,
        equipment: exchange.equipment_context.map(eq => ({
          manufacturer: eq.manufacturer,
          model: eq.model,
          asset_uid: eq.asset_uid
        })),
        weight: weight
      });
    }
  }

  return {
    summary: summary.trim(),
    total_weight: totalWeight,
    exchange_weights: exchangeWeights,
    equipment_transitions: equipmentTransitions
  };
}

/**
 * Calculate memory weight for an exchange based on recency
 * @param {number} index - Exchange index (0 = most recent)
 * @param {number} total - Total exchanges
 * @returns {number} Weight between 0.0 and 1.0
 */
function calculateExchangeWeight(index, total) {
  if (index === 0) return MEMORY_WEIGHTS.current;
  if (index <= 2) return MEMORY_WEIGHTS.last_2;
  if (index <= 5) return MEMORY_WEIGHTS.last_5;
  return MEMORY_WEIGHTS.older;
}

/**
 * Create weighted summary for a single exchange
 * @param {Object} exchange - Q&A exchange
 * @param {number} weight - Memory weight
 * @returns {string} Formatted summary
 */
function createExchangeSummary(exchange, weight) {
  const userQuery = exchange.user_message.content;
  const assistantResponse = exchange.assistant_message.content;
  const equipment = exchange.equipment_context;

  if (weight >= MEMORY_WEIGHTS.last_2) {
    // High weight: Include full detail
    const equipmentNames = equipment.map(eq => `${eq.manufacturer} ${eq.model}`).join(', ');
    return `\n\nPREVIOUS EXCHANGE (weight: ${weight}):\n` +
           `User asked: "${userQuery}"\n` +
           `Equipment discussed: ${equipmentNames || 'None'}\n` +
           `Response summary: ${assistantResponse.substring(0, 1000)}...\n`;
  } else if (weight >= MEMORY_WEIGHTS.last_5) {
    // Medium weight: Include key details
    const equipmentNames = equipment.map(eq => `${eq.manufacturer} ${eq.model}`).join(', ');
    return `\n\nEARLIER: "${userQuery}" about ${equipmentNames || 'equipment'} (weight: ${weight})\n`;
  } else {
    // Low weight: Compressed summary
    const primaryEquipment = equipment.length > 0 ? `${equipment[0].manufacturer} ${equipment[0].model}` : 'equipment';
    return `\n\nPREVIOUS TOPIC: ${primaryEquipment} discussion (weight: ${weight})\n`;
  }
}

/**
 * Extract all equipment mentioned across exchanges
 * @param {Array} exchanges - Q&A exchanges
 * @returns {Array} Accumulated equipment with weights
 */
function extractAccumulatedEquipment(exchanges) {
  const equipmentMap = new Map();

  for (let i = 0; i < exchanges.length; i++) {
    const weight = calculateExchangeWeight(i, exchanges.length);
    const equipment = exchanges[i].equipment_context || [];

    for (const eq of equipment) {
      const key = eq.asset_uid;
      if (!equipmentMap.has(key)) {
        equipmentMap.set(key, {
          ...eq,
          conversation_weight: weight,
          first_mentioned_exchange: i,
          mention_count: 1
        });
      } else {
        // Update weight to highest (most recent mention)
        const existing = equipmentMap.get(key);
        existing.conversation_weight = Math.max(existing.conversation_weight, weight);
        existing.mention_count++;
      }
    }
  }

  // Return equipment sorted by conversation weight (most important first)
  return Array.from(equipmentMap.values())
    .sort((a, b) => b.conversation_weight - a.conversation_weight);
}

/**
 * Get conversation context for equipment relationships
 * Handles cases like GPS → V100 → Zeus connections
 * @param {string} threadId - Thread ID
 * @param {Array} currentEquipment - Equipment from current query
 * @returns {Array} Enhanced equipment context with relationships
 */
export async function getEquipmentRelationshipContext(threadId, currentEquipment = []) {
  const conversationContext = await getWeightedConversationContext(threadId);
  const accumulatedEquipment = conversationContext.accumulated_equipment;

  // Merge current equipment with accumulated equipment
  const allEquipment = [...currentEquipment];

  for (const accumulated of accumulatedEquipment) {
    // Add accumulated equipment if not already present
    const exists = allEquipment.some(eq => eq.asset_uid === accumulated.asset_uid);
    if (!exists) {
      allEquipment.push({
        ...accumulated,
        source: 'conversation_history',
        weight: accumulated.conversation_weight
      });
    }
  }

  // Sort by relevance (current query equipment first, then by weight)
  return allEquipment.sort((a, b) => {
    if (a.source !== b.source) {
      return a.source === 'conversation_history' ? 1 : -1;
    }
    return (b.weight || b.rank || 0) - (a.weight || a.rank || 0);
  });
}

export default {
  getWeightedConversationContext,
  getEquipmentRelationshipContext
};