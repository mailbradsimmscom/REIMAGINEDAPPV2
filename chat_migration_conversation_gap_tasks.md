# Chat Migration: Restore Conversation Intelligence - Task List

## Overview
This document provides detailed tasks and implementation guidance to restore the lost conversational intelligence in the Node.js chat migration. The current implementation is too stateless and loses critical context-awareness features that were present in the Python/LangGraph version.

---

## Task 1: Fix Conversation History Ordering Bug [CRITICAL]

### File: `src/services/memory.service.js`

**Line 74 - Current (WRONG):**
```javascript
.order('created_at', { ascending: false })
```

**Change to:**
```javascript
.order('sequence_number', { ascending: false })
```

**Why:** QA summarization triggers on even sequence numbers. Wrong ordering breaks conversation flow reconstruction.

**Verification:**
- Check that `checkAndGenerateQASummary()` in `thread-summary.service.js:395-432` triggers correctly
- Ensure messages appear in correct order when retrieved

---

## Task 2: Implement Conversation Context Service

### Create New File: `src/services/conversation-context.service.js`

**Purpose:** Track accumulated equipment across conversation with recency weighting

**Implementation Requirements:**

```javascript
/**
 * Get weighted conversation context including accumulated equipment
 * @param {string} threadId
 * @param {string} currentQuery
 * @returns {Object} {
 *   accumulated_equipment: Array of equipment with conversation_weight,
 *   total_exchanges: number,
 *   conversation_summary: string or null,
 *   recent_topics: Array of strings
 * }
 */
export async function getWeightedConversationContext(threadId, currentQuery) {
  // 1. Fetch last 20 messages from chat_messages table
  // 2. Extract equipment mentions from processing_metadata.equipment_context
  // 3. Apply recency weighting (recent = higher weight):
  //    - Last 2 messages: weight 1.0
  //    - Messages 3-5: weight 0.8
  //    - Messages 6-10: weight 0.6
  //    - Messages 11-20: weight 0.4
  // 4. Deduplicate by asset_uid, keeping highest weight
  // 5. Get conversation summary from thread table
  // 6. Extract topics from last 5 user messages

  return {
    accumulated_equipment: [
      {
        asset_uid: 'xxx',
        manufacturer: 'Fortress',
        model: 'FX-7',
        conversation_weight: 0.8,
        last_mentioned: 2, // messages ago
        mention_count: 3   // total times mentioned
      }
    ],
    total_exchanges: 10,
    conversation_summary: "User discussing anchor options...",
    recent_topics: ['anchor', 'holding power', 'chain']
  };
}
```

### Update File: `src/routes/chat/process.route.js`

**Add at line 88 (before equipment search):**
```javascript
import { getWeightedConversationContext } from '../../services/conversation-context.service.js';

// Get conversation context for memory and equipment accumulation
const conversationContext = await getWeightedConversationContext(threadId, message);

requestLogger.info('Retrieved conversation context', {
  accumulatedEquipment: conversationContext.accumulated_equipment.length,
  totalExchanges: conversationContext.total_exchanges
});
```

---

## Task 3: Implement Equipment Reference Detection

### Create New File: `src/services/equipment-reference-detector.service.js`

**Purpose:** Detect when user is referring to previous equipment vs new search

**Implementation Requirements:**

```javascript
/**
 * Quick check if query likely references previous equipment
 * @param {string} query - User's current query
 * @param {Array} previousEquipment - Equipment from conversation context
 * @returns {Object} Detection results
 */
export function quickReferenceCheck(query, previousEquipment) {
  const lowerQuery = query.toLowerCase();

  // Reference patterns that suggest referring to previous equipment
  const referencePatterns = [
    /\b(it|its|it's)\b/,
    /\b(this|that|these|those)\b/,
    /\b(the same|similar)\b/,
    /\b(my|our)\s+\w+/, // "my anchor" when anchor already discussed
    /^(what|how|when|where|why|can|does|is)\b/ // Questions often refer to context
  ];

  // Check if query mentions equipment type without specific brand/model
  const genericEquipmentTerms = ['anchor', 'windlass', 'chain', 'radar', 'gps'];
  const mentionsGenericEquipment = genericEquipmentTerms.some(term =>
    lowerQuery.includes(term) &&
    !lowerQuery.match(/\b(fortress|lewmar|rocna|garmin|raymarine)\b/i) // No specific brands
  );

  const hasReferencePattern = referencePatterns.some(pattern => pattern.test(lowerQuery));
  const hasPreviousContext = previousEquipment.length > 0;
  const queryLength = query.split(' ').length;

  return {
    likely_reference: hasReferencePattern && hasPreviousContext,
    mentions_equipment_type: mentionsGenericEquipment,
    has_previous_context: hasPreviousContext,
    confidence: calculateConfidence(hasReferencePattern, queryLength, hasPreviousContext),
    should_infer: (hasReferencePattern && hasPreviousContext) ||
                  (mentionsGenericEquipment && hasPreviousContext && queryLength < 8)
  };
}

function calculateConfidence(hasPattern, queryLength, hasContext) {
  let confidence = 0;
  if (hasPattern) confidence += 0.4;
  if (hasContext) confidence += 0.3;
  if (queryLength < 5) confidence += 0.2; // Short queries often contextual
  if (queryLength > 15) confidence -= 0.2; // Long queries often self-contained
  return Math.min(Math.max(confidence, 0), 1);
}
```

---

## Task 4: Implement Equipment Relationship Inference

### Create New File: `src/services/equipment-relationship-inference.service.js`

**Purpose:** Use LLM to understand equipment relationships in context

**Implementation Requirements:**

```javascript
import OpenAI from 'openai';
import { getOpenAIClient } from './chat-completion.service.js';

/**
 * Infer equipment relationships using LLM
 * @param {string} threadId
 * @param {string} currentQuery
 * @param {Array} currentSearchResults - May be empty if inference-only
 * @param {Array} conversationEquipment - Previous equipment context
 * @returns {Object} {
 *   inference: string explanation,
 *   expanded_equipment: Array of equipment with relationship metadata,
 *   should_search_related: boolean
 * }
 */
export async function inferEquipmentRelationships(
  threadId,
  currentQuery,
  currentSearchResults,
  conversationEquipment
) {
  const openai = await getOpenAIClient();

  // Build context for inference
  const equipmentContext = conversationEquipment.map(eq =>
    `${eq.manufacturer} ${eq.model}: ${eq.description || 'N/A'}`
  ).join('\n');

  const inferencePrompt = `
    Given this conversation context about marine equipment:
    ${equipmentContext}

    User's current question: "${currentQuery}"

    Analyze:
    1. Is the user referring to previously discussed equipment? Which one(s)?
    2. Are they asking about related/compatible equipment?
    3. What is the relationship type? (main_subject, comparison, compatibility, accessory)

    Return JSON:
    {
      "refers_to_previous": boolean,
      "primary_equipment_id": "asset_uid or null",
      "relationship_type": "main_subject|comparison|compatibility|accessory|new_topic",
      "confidence": 0.0-1.0,
      "reasoning": "brief explanation",
      "should_search_related": boolean
    }
  `;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: 'You are an equipment context analyzer. Return only valid JSON.' },
      { role: 'user', content: inferencePrompt }
    ],
    temperature: 0.1,
    max_tokens: 200
  });

  const inference = JSON.parse(completion.choices[0].message.content);

  // Build expanded equipment list with relationships
  const expandedEquipment = [];

  if (inference.refers_to_previous && inference.primary_equipment_id) {
    const primaryEquipment = conversationEquipment.find(
      eq => eq.asset_uid === inference.primary_equipment_id
    );

    if (primaryEquipment) {
      expandedEquipment.push({
        ...primaryEquipment,
        relationship_type: 'main',
        inference_confidence: inference.confidence,
        inference_reasoning: inference.reasoning,
        source: 'inferred'
      });
    }
  }

  // Add any current search results as secondary
  currentSearchResults.forEach((eq, idx) => {
    expandedEquipment.push({
      ...eq,
      relationship_type: idx === 0 && !inference.refers_to_previous ? 'main' : 'related',
      source: 'current_search'
    });
  });

  return {
    inference: inference.reasoning,
    expanded_equipment: expandedEquipment,
    should_search_related: inference.should_search_related
  };
}
```

---

## Task 5: Update Main Process Route with Intelligence

### Update File: `src/routes/chat/process.route.js`

**Replace lines 108-120 with intelligent search/inference logic:**

```javascript
import { quickReferenceCheck } from '../../services/equipment-reference-detector.service.js';
import { inferEquipmentRelationships } from '../../services/equipment-relationship-inference.service.js';

// ... existing imports ...

// After getting conversation context (line 88):

// Quick reference check
const referenceCheck = quickReferenceCheck(message, conversationContext.accumulated_equipment);

requestLogger.info('Query analysis', {
  likelyReference: referenceCheck.likely_reference,
  shouldInfer: referenceCheck.should_infer,
  confidence: referenceCheck.confidence
});

let systemsContext = [];
let equipmentInference = null;

if (referenceCheck.should_infer) {
  // PATH 1: Use inference for contextual queries

  // Get equipment from thread blob
  const threadData = await getChatThread(threadId);
  const existingEquipment = threadData?.equipment_context || [];

  // Infer relationships
  const inferenceResult = await inferEquipmentRelationships(
    threadId,
    message,
    [], // No new search yet
    existingEquipment.length > 0 ? existingEquipment : conversationContext.accumulated_equipment
  );

  equipmentInference = inferenceResult.inference;

  // Only search if inference suggests it
  if (inferenceResult.should_search_related) {
    const normalizedMessage = normalizeQuery(message);
    const searchResults = await searchSystems(normalizedMessage || message);

    // Merge search results with inference
    const enrichedResults = await enrichSystemsContext(searchResults);

    // Combine with inferred equipment, preserving relationships
    systemsContext = inferenceResult.expanded_equipment.map(eq => {
      const enriched = enrichedResults.find(e => e.asset_uid === eq.asset_uid);
      return enriched ? { ...enriched, ...eq } : eq;
    });
  } else {
    // Use only inferred equipment
    systemsContext = inferenceResult.expanded_equipment;
  }

} else {
  // PATH 2: Traditional search for new topics
  const normalizedMessage = normalizeQuery(message);
  const searchResults = await searchSystems(normalizedMessage || message);

  if (searchResults.length === 0) {
    // FALLBACK: Use cached equipment if no results
    const threadData = await getChatThread(threadId);
    const cachedEquipment = threadData?.equipment_context || [];

    if (cachedEquipment.length > 0) {
      requestLogger.info('Using cached equipment as fallback');
      systemsContext = cachedEquipment.map(eq => ({
        ...eq,
        source: 'cached_fallback'
      }));
    }
  } else {
    // Enrich search results
    systemsContext = await enrichSystemsContext(searchResults);
  }
}
```

---

## Task 6: Enhance Equipment Context Storage

### Update File: `src/routes/chat/process.route.js`

**Replace lines 129-146 with enhanced storage:**

```javascript
// Store enhanced equipment context with metadata
if (systemsContext.length > 0) {
  // Check if we have new equipment to add
  const threadData = await getChatThread(threadId);
  const existingEquipment = threadData?.equipment_context || [];

  // Create map for deduplication
  const equipmentMap = new Map();

  // Add existing equipment
  existingEquipment.forEach(eq => {
    equipmentMap.set(eq.asset_uid, eq);
  });

  // Merge new equipment, preserving relationship metadata
  let hasNewEquipment = false;
  systemsContext.forEach(eq => {
    if (!equipmentMap.has(eq.asset_uid) || eq.source === 'current_search') {
      hasNewEquipment = true;
      equipmentMap.set(eq.asset_uid, {
        ...eq,
        last_referenced: new Date().toISOString(),
        reference_count: (equipmentMap.get(eq.asset_uid)?.reference_count || 0) + 1
      });
    }
  });

  if (hasNewEquipment) {
    const mergedContext = Array.from(equipmentMap.values());

    await updateChatThread(threadId, {
      equipment_context: mergedContext,
      last_equipment_update: new Date().toISOString()
    });

    requestLogger.info('Updated equipment context', {
      total: mergedContext.length,
      new: systemsContext.filter(eq => eq.source === 'current_search').length
    });
  }
}
```

---

## Task 7: Pass Context to Chat Completion

### Update File: `src/routes/chat/process.route.js`

**Update lines 174-180 to pass new context:**

```javascript
const { response, usage } = await processChatCompletion({
  query: message, // Use original message, not normalized
  threadId,
  systemsContext,
  dipResults,
  documentChunks,
  conversationSummary: conversationContext.conversation_summary,
  equipmentInference,
  conversationMetadata: {
    totalExchanges: conversationContext.total_exchanges,
    recentTopics: conversationContext.recent_topics,
    accumulatedEquipment: conversationContext.accumulated_equipment
  }
});
```

### Update File: `src/services/chat-completion.service.js`

**Update buildSystemPrompt to use conversation metadata (line 40):**

```javascript
function buildSystemPrompt({
  systemsContext = [],
  dipResults = [],
  documentChunks = [],
  conversationSummary = null,
  equipmentInference = null,
  conversationMetadata = null  // ADD THIS
}) {
  let prompt = `You are a helpful marine equipment assistant. Answer questions accurately based on the provided context.\n\n`;

  // Add conversation metadata if available
  if (conversationMetadata) {
    prompt += `## Conversation Context\n`;
    prompt += `- Total exchanges: ${conversationMetadata.totalExchanges}\n`;
    if (conversationMetadata.recentTopics?.length > 0) {
      prompt += `- Recent topics: ${conversationMetadata.recentTopics.join(', ')}\n`;
    }
    prompt += `\n`;
  }

  // ... rest of existing prompt building ...
}
```

---

## Task 8: Add Message Metadata Storage

### Update File: `src/services/memory.service.js`

**Enhance saveMessage method (around line 35) to store equipment context:**

```javascript
async saveMessage(role, content, metadata = {}) {
  try {
    const supabase = await getSupabaseClient();

    // Get current message count for sequence number
    const { data: threadData } = await supabase
      .from('chat_threads')
      .select('message_count')
      .eq('id', this.threadId)
      .single();

    const sequenceNumber = (threadData?.message_count || 0) + 1;

    // Enhanced metadata
    const processingMetadata = {
      ...metadata,
      equipment_context: metadata.systemsContext || [],
      inference_used: !!metadata.equipmentInference,
      inference_reasoning: metadata.equipmentInference || null,
      query_type: metadata.referenceCheck?.likely_reference ? 'contextual' : 'new',
      timestamp: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        thread_id: this.threadId,
        role,
        content,
        sequence_number: sequenceNumber,
        processing_metadata: processingMetadata
      })
      .select()
      .single();

    // ... rest of existing code ...
  }
}
```

---

## Testing & Verification

### Test Conversation Flow:
```bash
# Test 1: New equipment query
curl -X POST "http://localhost:PORT/api/chat/process" -H "Content-Type: application/json" -d '{
  "message": "tell me about fortress anchors",
  "threadId": "test-thread-1"
}'

# Test 2: Contextual reference (should use inference)
curl -X POST "http://localhost:PORT/api/chat/process" -H "Content-Type: application/json" -d '{
  "message": "what is its holding power?",
  "threadId": "test-thread-1"
}'

# Test 3: Comparison (should keep context)
curl -X POST "http://localhost:PORT/api/chat/process" -H "Content-Type: application/json" -d '{
  "message": "how does it compare to a danforth?",
  "threadId": "test-thread-1"
}'

# Test 4: Related equipment (should infer relationship)
curl -X POST "http://localhost:PORT/api/chat/process" -H "Content-Type: application/json" -d '{
  "message": "what chain should I use with it?",
  "threadId": "test-thread-1"
}'
```

### Verify:
1. Check logs for "Query analysis" showing inference decisions
2. Verify equipment_context in thread table accumulates correctly
3. Ensure conversation maintains context across turns
4. Check that sequence_number ordering works for history retrieval
5. Validate QA summarization triggers on even sequence numbers

---

## Implementation Order

1. **Fix conversation history ordering** (Task 1) - IMMEDIATE
2. **Implement conversation context service** (Task 2) - Foundation
3. **Add reference detection** (Task 3) - Quick win
4. **Update main route with basic intelligence** (Task 5 partial) - Test flow
5. **Implement LLM inference** (Task 4) - Advanced feature
6. **Complete route updates** (Task 5 complete) - Full integration
7. **Enhance storage and metadata** (Tasks 6-8) - Polish

---

## Success Criteria

✅ Conversation history ordered correctly by sequence_number
✅ "What is its holding power?" correctly refers to previously discussed anchor
✅ Equipment context accumulates across conversation
✅ No duplicate equipment in context
✅ Inference reasoning logged and stored
✅ Fallback to cached equipment when appropriate
✅ QA summarization triggers correctly

---

## Notes for Implementation

- Start with Tasks 1-3 for quick improvements
- Test thoroughly after Task 5 before adding LLM inference
- Monitor OpenAI costs with inference calls
- Consider caching inference results for similar queries
- Add performance metrics for inference vs search paths