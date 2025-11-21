# Code Update #48c: Two-Call Chat Optimization - Final Consolidated Plan

**Date:** 2025-11-20
**Status:** ✅ FINAL PLAN - READY FOR IMPLEMENTATION
**Supersedes:** 48 (original plan) and 48b (corrections)
**Priority:** HIGH - User experience critical (60s → 10s perceived)
**Approach:** Hybrid - Sequence-based updates (Phase 1) + Backend saves (Phase 2)

---

## 🎯 Executive Summary

### The Problem
- Chat responses take 58-65 seconds due to Perplexity web search
- Python already runs OpenAI and Perplexity in parallel but waits for both
- Users stare at loading spinner for full minute

### The Solution: Two-Call Architecture
1. **Call 1 (Fast):** 10s - Classification + DIP + Pinecone + OpenAI (skip Perplexity)
2. **Call 2 (Web):** 45s - Perplexity only, updates existing message

### Implementation Strategy: Hybrid Approach
- **Phase 1:** Sequence-based updates (quick, matches existing patterns)
- **Phase 2:** Backend saves messages (proper architecture, future)

---

## 📊 Current State Analysis

### Message Flow Discovery
```javascript
// CURRENT FLOW (Single Call):
1. Frontend → POST /chat/process (60s wait)
2. Frontend ← Response with content
3. Frontend → POST /chat/messages (save user message)
4. Frontend → POST /chat/messages (save assistant message)
   // Returns message.id but frontend IGNORES it!

// KEY INSIGHTS:
- Frontend controls message saving (not backend)
- Frontend tracks by sequenceNumber, not messageId
- Deletion uses: DELETE /chat/messages/:threadId/:sequenceNumber
- No update endpoint exists (but repository function does)
```

### Timing Breakdown
```
0s:   User sends message
3s:   Classification complete
3.5s: DIP + Pinecone search complete
      [OpenAI and Perplexity start in parallel]
10s:  OpenAI synthesis complete ⏸️ WAITING...
55s:  Perplexity complete
60s:  Both assembled, returned to user
```

---

## 🏗️ Phase 1: Sequence-Based Updates (Immediate)

### Why Sequence-Based?
- **Matches existing pattern:** `deleteChatMessageBySequence(threadId, sequenceNumber)`
- **No frontend changes:** Already tracks sequenceNumbers
- **Lower risk:** Uses established patterns
- **Quick to implement:** 1-2 days

### Implementation Steps

#### Step 1.0: Database Migration (CRITICAL - Run First)
**File:** `scripts/migrations/XXX_add_two_call_support.sql` (NEW)

**Create migration file:**

```sql
-- Migration: Add support for two-call chat optimization
-- Run this FIRST before any code changes

-- Step 1: Ensure sequence numbers are unique per thread
-- Check for existing duplicates first
DO $$
DECLARE
    duplicate_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT thread_id, sequence_number, COUNT(*)
        FROM chat_messages
        GROUP BY thread_id, sequence_number
        HAVING COUNT(*) > 1
    ) duplicates;

    IF duplicate_count > 0 THEN
        RAISE EXCEPTION 'Found % duplicate sequence numbers. Clean up before running migration.', duplicate_count;
    END IF;
END $$;

-- Add unique constraint to prevent duplicate sequence numbers per thread
ALTER TABLE chat_messages
    DROP CONSTRAINT IF EXISTS unique_thread_sequence;

ALTER TABLE chat_messages
    ADD CONSTRAINT unique_thread_sequence
    UNIQUE (thread_id, sequence_number);

-- Add index for faster sequence lookups
CREATE INDEX IF NOT EXISTS idx_messages_thread_seq
    ON chat_messages(thread_id, sequence_number);

-- Add tracking column for web enrichment status
ALTER TABLE chat_messages
    DROP COLUMN IF EXISTS web_enrichment_status;

ALTER TABLE chat_messages
    ADD COLUMN web_enrichment_status VARCHAR(20)
    DEFAULT 'pending'
    CHECK (web_enrichment_status IN ('pending', 'processing', 'completed', 'failed', 'skipped'));

-- Add index for enrichment status queries
CREATE INDEX IF NOT EXISTS idx_messages_enrichment_status
    ON chat_messages(web_enrichment_status)
    WHERE web_enrichment_status IN ('pending', 'processing');

-- Verify migration
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'unique_thread_sequence'
    ) THEN
        RAISE EXCEPTION 'Unique constraint creation failed';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_messages_thread_seq'
    ) THEN
        RAISE EXCEPTION 'Index creation failed';
    END IF;

    RAISE NOTICE 'Migration completed successfully';
END $$;
```

**Run migration:**
```bash
# Check existing duplicates first
psql $DATABASE_URL -c "SELECT thread_id, sequence_number, COUNT(*) FROM chat_messages GROUP BY thread_id, sequence_number HAVING COUNT(*) > 1;"

# If clean, run migration
psql $DATABASE_URL -f scripts/migrations/XXX_add_two_call_support.sql
```

#### Step 1.1: Add Repository Functions
**File:** `src/repositories/chat.repository.js`

**Add AFTER line 523 (after `getMessagesByThreadWithSequence` function):**

```javascript
/**
 * Get a single message by thread ID and sequence number
 * Used for retrieving messages before updating them
 */
export async function getMessageBySequence(threadId, sequenceNumber) {
  try {
    const supabase = await checkSupabaseAvailability();

    const { data, error } = await supabase
      .from(MESSAGES_TABLE)
      .select('*')
      .eq('thread_id', threadId)
      .eq('sequence_number', sequenceNumber)
      .single();

    if (error) {
      const err = new Error(`Message not found: ${error.message}`);
      err.cause = error;
      err.context = { 
        operation: 'get_message_by_sequence', 
        threadId, 
        sequenceNumber, 
        table: MESSAGES_TABLE 
      };
      throw err;
    }

    return data;
  } catch (error) {
    if (!error.context) {
      error.context = { 
        operation: 'get_message_by_sequence', 
        threadId, 
        sequenceNumber 
      };
    }
    throw error;
  }
}
```

**Add AFTER line 668 (after `deleteChatMessageBySequence` function):**

```javascript
/**
 * Update a message by thread ID and sequence number
 * Matches the pattern used by deleteChatMessageBySequence
 */
export async function updateChatMessageBySequence(threadId, sequenceNumber, updates) {
  try {
    const supabase = await checkSupabaseAvailability();

    // First get the message by sequence to retrieve its ID
    const existingMessage = await getMessageBySequence(threadId, sequenceNumber);

    if (!existingMessage) {
      throw new Error(`Message not found: threadId=${threadId}, sequenceNumber=${sequenceNumber}`);
    }

    // Update the message using its ID
    const { data, error } = await supabase
      .from(MESSAGES_TABLE)
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', existingMessage.id)
      .select()
      .single();

    if (error) {
      const err = new Error(`Update failed: ${error.message}`);
      err.cause = error;
      err.context = { 
        operation: 'update_message_by_sequence', 
        threadId, 
        sequenceNumber,
        messageId: existingMessage.id,
        table: MESSAGES_TABLE 
      };
      throw err;
    }

    return data;
  } catch (error) {
    if (!error.context) {
      error.context = { 
        operation: 'update_message_by_sequence', 
        threadId, 
        sequenceNumber 
      };
    }
    throw error;
  }
}
```

**CRITICAL: Update exports at bottom of file (around line 799-823):**

Add to the exports:
```javascript
export default {
  // ... existing exports ...
  getMessageBySequence,  // NEW - Add this line
  updateChatMessageBySequence,  // NEW - Add this line
  // ... rest of exports ...
};
```

#### Step 1.2: Add Update Endpoint
**File:** `src/routes/chat/messages.route.js` (add to existing file)

**Add imports at top (after existing imports, around line 8):**
```javascript
import { updateChatMessageBySequence } from '../../services/chat-message-update.service.js';  // Service layer, not repository
```

**NOTE:** To maintain architecture compliance (Route → Service → Repository), we should create a service layer for message updates. However, since this is a simple update operation and the route already exists, we'll use a minimal service wrapper:

**File:** `src/services/chat-message-update.service.js` (NEW - Minimal service layer)
```javascript
import { getMessageBySequence, updateChatMessageBySequence } from '../repositories/chat.repository.js';
import { logger } from '../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Update message with web enrichment content
 * Service layer wrapper for repository function
 */
export async function updateMessageWithWebEnrichment(threadId, sequenceNumber, webContent, webSources) {
  // Get existing message
  const existing = await getMessageBySequence(threadId, sequenceNumber);

  // Append web content with clear separator
  const updatedContent = existing.content +
    '\n\n───────────────────────────────\n\n' +
    '💡 **Real-World Resources from Boat Owners**\n\n' +
    webContent;

  // Merge sources
  const existingSources = existing.metadata?.sources || [];
  const updatedSources = [
    ...existingSources,
    ...(webSources || [])
  ];

  // Update message
  const updated = await updateChatMessageBySequence(
    threadId,
    sequenceNumber,
    {
      content: updatedContent,
      metadata: {
        ...existing.metadata,
        sources: updatedSources,
        web_enhanced: true,
        web_enhanced_at: new Date().toISOString()
      }
    }
  );

  return updated;
}
```

**Then in route file:**
```javascript
import { updateMessageWithWebEnrichment } from '../../services/chat-message-update.service.js';
```

**Add route handler BEFORE the export default router (around line 169, before the closing export):**
```javascript
// Update message by sequence number (for web enrichment)
router.put('/:threadId/:sequenceNumber', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { threadId, sequenceNumber } = req.params;
    const { webContent, webSources } = req.body;

    if (!threadId || !sequenceNumber) {
      return res.status(400).json({
        success: false,
        error: 'Thread ID and sequence number are required',
        requestId: requestLogger.requestId
      });
    }

    if (!webContent) {
      return res.status(400).json({
        success: false,
        error: 'Web content is required',
        requestId: requestLogger.requestId
      });
    }

    const seqNum = parseInt(sequenceNumber);
    if (isNaN(seqNum)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid sequence number',
        requestId: requestLogger.requestId
      });
    }

    requestLogger.info('Updating message with web enrichment', {
      threadId,
      sequenceNumber: seqNum,
      webContentLength: webContent?.length || 0,
      webSourcesCount: webSources?.length || 0
    });

    // Call service layer (maintains Route → Service → Repository pattern)
    const updated = await updateMessageWithWebEnrichment(
      threadId,
      seqNum,
      webContent,
      webSources || []
    );

    requestLogger.info('✅ Message updated with web enrichment', {
      messageId: updated.id,
      threadId,
      sequenceNumber: seqNum,
      totalSourcesCount: (updated.metadata?.sources || []).length
    });

    // Return full updated message so frontend can sync UI
    return res.json({ 
      success: true, 
      data: updated,
      requestId: requestLogger.requestId
    });

  } catch (error) {
    requestLogger.error('❌ Failed to update message', {
      error: error.message,
      threadId: req.params.threadId,
      sequenceNumber: req.params.sequenceNumber,
      stack: error.stack
    });

    const env = getEnv();
    return res.status(500).json({
      success: false,
      error: 'Failed to update message',
      details: error.message,
      stack: env.NODE_ENV === 'development' ? error.stack : undefined,
      requestId: requestLogger.requestId
    });
  }
});
```

#### Step 1.3: Modify chat-proxy.service.js to Support New Parameters
**File:** `src/services/chat-proxy.service.js`

**MODIFY the function signature (line 28):**
```javascript
export async function processChatMessage({ 
  query, 
  threadId, 
  synthesisModel = 'gpt-5',
  skipPerplexity = false,  // NEW - Skip Perplexity for fast path
  perplexityOnly = false,  // NEW - Run only Perplexity for web enrichment
  cachedState = null  // NEW - Reuse state from previous call
}) {
  const requestLogger = logger.createRequestLogger();
  const env = getEnv();
  // ... existing code ...
```

**MODIFY the Python client call (around line 609):**
```javascript
// STEP 7: Call Python sequential workflow (replaces DIP, Pinecone, OpenAI completion)
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
  synthesisModel,
  skip_perplexity: skipPerplexity,  // NEW - Pass flag to Python
  perplexity_only: perplexityOnly,  // NEW - Pass flag to Python
  cached_state: cachedState  // NEW - Pass cached state to Python
});
```

**CRITICAL: Add logging for new parameters:**
```javascript
requestLogger.info('🔍 [PROCESS] Chat request received', {
  threadId,
  messageLength: query.length,
  synthesisModel,
  skipPerplexity,  // NEW
  perplexityOnly,  // NEW
  hasCachedState: !!cachedState  // NEW
});
```

#### Step 1.4: Update Python Sidecar Client
**File:** `src/clients/python-sidecar.client.js`

**MODIFY the `processChatWorkflow` function (line 20-27):**
```javascript
export async function processChatWorkflow({
  query,
  systemsContext = [],
  threadId = null,
  conversationSummary = null,
  memoryContext = null,
  synthesisModel = 'gpt-5',
  skip_perplexity = false,  // NEW
  perplexity_only = false,  // NEW
  cached_state = null  // NEW
}) {
  const env = getEnv();

  const sidecarUrl = env.PYTHON_SIDECAR_URL || 'http://localhost:8000';
  const endpoint = `${sidecarUrl}/v1/chat/process`;
  const timeoutMs = parseInt(env.PYTHON_CHAT_TIMEOUT_MS || '30000');
  const retryAttempts = parseInt(env.PYTHON_CHAT_RETRY_ATTEMPTS || '2');

  const requestBody = {
    query,
    systems_context: systemsContext,
    thread_id: threadId,
    conversation_summary: conversationSummary,
    memory_context: memoryContext,
    synthesis_model: synthesisModel,
    skip_perplexity: skip_perplexity,  // NEW - Add to request body
    perplexity_only: perplexity_only,  // NEW - Add to request body
    cached_state: cached_state  // NEW - Add to request body
  };

  return await makePythonSidecarCall(endpoint, requestBody, timeoutMs, retryAttempts);
}
```

#### Step 1.5: Create Service Layer (Fix Architecture Violation)
**File:** `src/services/chat-process.service.js` (NEW)

**Create new file with complete service layer:**
```javascript
import { processChatMessage } from './chat-proxy.service.js';
import { createChatMessageWithSequence } from '../repositories/chat.repository.js';
import { logger } from '../utils/logger.js';
import { chatDebug } from '../utils/chat-debug-logger.js';
import { getEnv } from '../config/env.js';

const requestLogger = logger.createRequestLogger();

/**
 * Circuit Breaker for Perplexity API
 * Prevents cascading failures when Perplexity is down
 */
const perplexityCircuitBreaker = {
  failures: 0,
  lastFailureTime: null,
  threshold: 3,
  resetTime: 60000, // 1 minute

  isOpen() {
    if (this.failures >= this.threshold) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure < this.resetTime) {
        return true; // Circuit is open, skip Perplexity
      }
      // Reset circuit after cooldown
      this.failures = 0;
    }
    return false;
  },

  recordSuccess() {
    this.failures = 0;
  },

  recordFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    requestLogger.warn('Perplexity circuit breaker failure recorded', {
      failures: this.failures,
      threshold: this.threshold
    });
  }
};

/**
 * Telemetry tracking for two-call performance
 */
const telemetry = {
  async trackFastResponse(duration, success, sequenceNumber) {
    const env = getEnv();
    
    // Use existing logger infrastructure
    requestLogger.performance('fast_chat_processing', duration, {
      success,
      sequenceNumber
    });

    // Also send to metrics endpoint (fire and forget)
    const metrics = {
      'chat.fast_response.duration': duration,
      'chat.fast_response.success_rate': success ? 1 : 0,
      'chat.fast_response.count': 1,
      timestamp: Date.now()
    };

    fetch('/admin/api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metrics)
    }).catch(() => {}); // Fire and forget
  },

  async trackWebEnrichment(duration, hasContent, sequenceNumber) {
    const env = getEnv();
    
    requestLogger.performance('web_enrichment', duration, {
      hasContent,
      sequenceNumber
    });

    const metrics = {
      'chat.web_enrichment.duration': duration,
      'chat.web_enrichment.has_content': hasContent ? 1 : 0,
      'chat.web_enrichment.count': 1,
      timestamp: Date.now()
    };

    fetch('/admin/api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metrics)
    }).catch(() => {}); // Fire and forget
  }
};

/**
 * Process fast chat request (skips Perplexity)
 * Saves assistant message and returns with sequence number
 */
export async function processFastChat({ query, threadId, sequenceNumber, synthesisModel }) {
  try {
    requestLogger.info('🚀 Processing fast chat request', {
      threadId,
      sequenceNumber,
      queryLength: query.length,
      synthesisModel
    });

    chatDebug.step('FAST_CHAT_START', {
      threadId,
      sequenceNumber,
      hasQuery: !!query
    });

    // Call Python with skip_perplexity flag
    const result = await processChatMessage({
      query,
      threadId,
      synthesisModel,
      skipPerplexity: true,  // Skip Perplexity for fast path
      perplexityOnly: false,
      cachedState: null
    });

    if (!result.response) {
      throw new Error('No response generated from Python workflow');
    }

    // Save assistant message with provided sequence number
    const message = await createChatMessageWithSequence({
      threadId,
      role: 'assistant',
      content: result.response,
      sequenceNumber,
      metadata: {
        sources: result.sources || [],
        processing_time_ms: result.processing_time_ms || 0,
        systems_context: result.systems_context || [],
        fast_path: true,  // Mark as fast path
        cached_state: result.cached_state || null  // Include for Call 2
      }
    });

    const duration = Date.now() - startTime;
    
    chatDebug.step('FAST_CHAT_COMPLETE', {
      threadId,
      sequenceNumber,
      messageId: message.id,
      responseLength: result.response.length,
      duration
    });

    requestLogger.info('✅ Fast chat processing complete', {
      messageId: message.id,
      threadId,
      sequenceNumber,
      responseLength: result.response.length,
      duration
    });

    // Track telemetry
    await telemetry.trackFastResponse(duration, true, sequenceNumber);

    return {
      ...result,
      messageId: message.id,
      sequenceNumber: message.sequence_number,
      cachedState: result.cached_state  // Return for web enrichment
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    
    requestLogger.error('❌ Fast chat processing failed', {
      error: error.message,
      threadId,
      sequenceNumber,
      stack: error.stack,
      duration
    });

    chatDebug.error('FAST_CHAT_FAILED', error, {
      threadId,
      sequenceNumber
    });

    // Track telemetry
    await telemetry.trackFastResponse(duration, false, sequenceNumber);

    throw error;
  }
}

/**
 * Enrich message with web search results (Perplexity only)
 * Uses cached state from fast call
 */
export async function enrichWithWeb({ query, threadId, sequenceNumber, cachedState }) {
  const startTime = Date.now();
  
  try {
    // Check circuit breaker first
    if (perplexityCircuitBreaker.isOpen()) {
      requestLogger.warn('⚠️ Perplexity circuit breaker open, skipping web enrichment', {
        threadId,
        sequenceNumber,
        failures: perplexityCircuitBreaker.failures
      });
      
      await telemetry.trackWebEnrichment(Date.now() - startTime, false, sequenceNumber);
      return { webContent: null, webSources: [] };
    }

    requestLogger.info('🌐 Starting web enrichment', {
      threadId,
      sequenceNumber,
      hasCachedState: !!cachedState
    });

    chatDebug.step('WEB_ENRICHMENT_START', {
      threadId,
      sequenceNumber
    });

    if (!cachedState) {
      throw new Error('Cached state is required for web enrichment');
    }

    // Call Python with perplexity_only flag
    const result = await processChatMessage({
      query,
      threadId,
      synthesisModel: cachedState.synthesis_model || 'gpt-5',
      skipPerplexity: false,
      perplexityOnly: true,  // Run only Perplexity
      cachedState: cachedState  // Reuse classification and equipment context
    });

    if (!result.web_enhancement) {
      requestLogger.warn('⚠️ No web enhancement returned', {
        threadId,
        sequenceNumber
      });
      return {
        webContent: null,
        webSources: []
      };
    }

    chatDebug.step('WEB_ENRICHMENT_COMPLETE', {
      threadId,
      sequenceNumber,
      webContentLength: result.web_enhancement?.length || 0,
      webSourcesCount: result.web_sources?.length || 0
    });

    const duration = Date.now() - startTime;
    
    requestLogger.info('✅ Web enrichment complete', {
      threadId,
      sequenceNumber,
      webContentLength: result.web_enhancement?.length || 0,
      webSourcesCount: result.web_sources?.length || 0,
      duration
    });

    // Record success in circuit breaker
    perplexityCircuitBreaker.recordSuccess();
    
    // Track telemetry
    await telemetry.trackWebEnrichment(
      duration,
      !!result.web_enhancement,
      sequenceNumber
    );

    return {
      webContent: result.web_enhancement,
      webSources: result.web_sources || []
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    
    requestLogger.error('❌ Web enrichment failed', {
      error: error.message,
      threadId,
      sequenceNumber,
      stack: error.stack,
      duration
    });

    chatDebug.error('WEB_ENRICHMENT_FAILED', error, {
      threadId,
      sequenceNumber
    });

    // Record failure in circuit breaker
    perplexityCircuitBreaker.recordFailure();
    
    // Track telemetry
    await telemetry.trackWebEnrichment(duration, false, sequenceNumber);

    // Don't throw - return empty result for graceful degradation
    return {
      webContent: null,
      webSources: []
    };
  }
}
```

#### Step 1.6: Python Sidecar Modifications

**File:** `python-sidecar/app/chat/chat_models.py`

**MODIFY the ChatRequest class (lines 51-64):**
```python
class ChatRequest(BaseModel):
    """Incoming chat request"""
    query: str
    thread_id: Optional[str] = None
    systems_context: Optional[List[Dict[str, Any]]] = []
    
    # Conversation memory from Node.js
    conversation_summary: Optional[str] = None
    memory_context: Optional[Dict[str, Any]] = None
    equipment_inference: Optional[Dict[str, Any]] = None
    table_types: Optional[List[str]] = None
    
    # Model selection for synthesis
    synthesis_model: Optional[str] = None  # Default None = use env var OPENAI_MODEL
    
    # NEW: Two-call optimization flags
    skip_perplexity: bool = False  # Skip Perplexity for fast path
    perplexity_only: bool = False  # Run only Perplexity for web enrichment
    cached_state: Optional[Dict[str, Any]] = None  # Reuse state from fast call
```

**File:** `python-sidecar/app/chat/workflows/chat_workflow_sequential.py`

**MODIFY the process_chat method - Add early return for perplexity_only (around line 87):**
```python
async def process_chat(self,
                      user_query: str,
                      systems_context: List[Dict[str, Any]],
                      thread_id: Optional[str] = None,
                      conversation_summary: Optional[str] = None,
                      memory_context: Optional[Dict[str, Any]] = None,
                      skip_perplexity: bool = False,  # NEW
                      perplexity_only: bool = False,  # NEW
                      cached_state: Optional[Dict[str, Any]] = None  # NEW
                      ) -> Dict[str, Any]:
    """
    Process chat query with conditional execution based on flags
    
    Args:
        skip_perplexity: If True, skip Perplexity search (fast path)
        perplexity_only: If True, run only Perplexity (web enrichment)
        cached_state: Reuse state from previous call (for perplexity_only)
    """
    logger.info("🚀 WORKFLOW ENTRY - ChatWorkflowSequential.process_chat() called")
    logger.info(f"  - Query: {user_query[:100]}")
    logger.info(f"  - Systems context count: {len(systems_context)}")
    logger.info(f"  - skip_perplexity: {skip_perplexity}")
    logger.info(f"  - perplexity_only: {perplexity_only}")
    logger.info(f"  - has_cached_state: {cached_state is not None}")

    # CASE 1: Perplexity-only mode (web enrichment)
    if perplexity_only:
        if not cached_state:
            logger.error("❌ perplexity_only requires cached_state")
            raise ValueError("cached_state is required when perplexity_only=True")
        
        logger.info("🌐 PERPLEXITY-ONLY MODE: Running web enrichment")
        state = cached_state
        
        # Run Perplexity search only
        perplexity_result = await self._query_perplexity(state)
        
        if perplexity_result:
            return {
                "web_enhancement": perplexity_result.get("answer", ""),
                "web_sources": perplexity_result.get("citations", []),
                "processing_time_ms": 0  # Already accounted for in fast call
            }
        else:
            logger.warning("⚠️ Perplexity returned no results")
            return {
                "web_enhancement": "",
                "web_sources": [],
                "processing_time_ms": 0
            }

    # CASE 2: Fast path (skip Perplexity) - continue with existing flow but skip STEP 3
    # CASE 3: Normal mode (both) - existing behavior
    
    # Initialize state as before
    state = {
        "user_query": user_query,
        "thread_id": thread_id,
        "systems_context": systems_context,
        "conversation_summary": conversation_summary,
        "memory_context": memory_context,
        "synthesis_model": synthesis_model,
        "start_time": datetime.now(),
        "processing_steps": []
    }

    try:
        # STEP 1: Query Classification (always run unless cached_state provided)
        state = await self._classify_query(state)
        # ... rest of steps ...

        # STEP 3: Conditional Parallel Execution (MODIFY lines 148-161)
        if skip_perplexity:
            # Fast path: Skip Perplexity, run OpenAI only
            logger.info("⚡ FAST PATH: Skipping Perplexity")
            openai_result = await self._synthesize_response(state)
            
            # Return with cached state for potential web enrichment
            return {
                "response": openai_result.get("response", ""),
                "sources": self._format_sources(state),
                "classification": state.get("classification"),
                "processing_time_ms": int((datetime.now() - state["start_time"]).total_seconds() * 1000),
                "metadata": {
                    "workflow": "sequential_fast",
                    "processing_steps": state["processing_steps"]
                },
                "cached_state": state,  # Return state for Call 2
                "systems_context": systems_context
            }
        
        else:
            # Normal mode: Both in parallel (existing behavior)
            logger.info("📌 STEP 3: Starting Parallel OpenAI + Perplexity")
            parallel_start = datetime.now()
            
            openai_task = asyncio.create_task(self._synthesize_response(state))
            perplexity_task = asyncio.create_task(self._query_perplexity(state))
            
            openai_result, perplexity_result = await asyncio.gather(
                openai_task,
                perplexity_task,
                return_exceptions=True
            )
            
            # ... rest of existing assembly logic ...
```

**CRITICAL: Also update the main.py endpoint handler (around line 822):**
```python
@app.post("/v1/chat/process", response_model=ChatResponse)
async def process_chat(request: ChatRequest):
    """
    Process chat query using sequential workflow with DIP integration
    """
    # ... existing code ...
    
    # Pass new parameters to workflow
    result = await chat_workflow.process_chat(
        user_query=request.query,
        systems_context=request.systems_context or [],
        thread_id=request.thread_id,
        conversation_summary=request.conversation_summary,
        memory_context=request.memory_context,
        skip_perplexity=request.skip_perplexity,  # NEW
        perplexity_only=request.perplexity_only,  # NEW
        cached_state=request.cached_state  # NEW
    )
    
    # ... rest of handler ...
```

#### Step 1.7: Create New Route Files

**File:** `src/routes/chat/process-fast.route.js` (NEW)

```javascript
import express from 'express';
import crypto from 'crypto';
import { processFastChat } from '../../services/chat-process.service.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { methodNotAllowed } from '../../utils/methodNotAllowed.js';
import { logger } from '../../utils/logger.js';
import { chatDebug } from '../../utils/chat-debug-logger.js';
import { EnvelopeSchema } from '../../schemas/envelope.schema.js';
import { z } from 'zod';

const router = express.Router();

// Request schema for fast chat
const fastChatRequestSchema = z.object({
  message: z.string().min(1),
  threadId: z.string().optional(),
  sequenceNumber: z.number().int().positive(),
  synthesis_model: z.string().optional().default('gpt-5')
});

router.use(requireServices(['supabase', 'openai', 'pinecone']));
router.use(validateResponse(EnvelopeSchema));

router.post(
  '/',
  validate(fastChatRequestSchema, 'body'),
  async (req, res, next) => {
    const startTime = Date.now();
    const requestLogger = logger.createRequestLogger();
    
    // Generate trace ID for observability
    const traceId = crypto.randomUUID();
    
    // Add observability headers
    res.set('X-Trace-Id', traceId);
    res.set('X-Request-Id', requestLogger.requestId);
    res.set('X-Two-Call-Mode', 'true');
    res.set('X-Fast-Path', 'true');

    try {
      const { message, threadId, sequenceNumber, synthesis_model } = req.body;
      
      requestLogger.info('⚡ Fast chat request received', {
        traceId,
        threadId,
        sequenceNumber,
        messageLength: message.length,
        synthesisModel: synthesis_model
      });

      if (!threadId) {
        throw new Error('Thread ID is required for fast chat');
      }

      // Call service layer (fixes architecture violation)
      const result = await processFastChat({
        query: message,
        threadId,
        sequenceNumber,
        synthesisModel: synthesis_model || 'gpt-5'
      });

      const totalDuration = Date.now() - startTime;

      chatDebug.timing('FAST_ROUTE_COMPLETE', totalDuration, {
        sequenceNumber,
        responseLength: result.response?.length || 0
      });

      requestLogger.performance('fast_chat_processing', totalDuration, {
        sequenceNumber,
        responseLength: result.response?.length || 0
      });

      return res.json({
        success: true,
        data: {
          threadId,
          response: result.response,
          sources: result.sources || [],
          sequenceNumber: result.sequenceNumber,
          messageId: result.messageId,
          cachedState: result.cachedState,  // For web enrichment
          systemsContext: result.systems_context || [],
          processing_time_ms: result.processing_time_ms || totalDuration
        },
        requestId: requestLogger.requestId
      });

    } catch (error) {
      const totalDuration = Date.now() - startTime;
      
      chatDebug.error('FAST_ROUTE_ERROR', error, {
        threadId: req.body.threadId,
        duration: totalDuration
      });

      requestLogger.error('❌ Fast chat request failed', {
        error: error.message,
        stack: error.stack,
        duration_ms: totalDuration
      });

      const env = getEnv();
      return res.status(500).json({
        success: false,
        error: 'Fast chat processing failed',
        details: error.message,
        stack: env.NODE_ENV === 'development' ? error.stack : undefined,
        requestId: requestLogger.requestId
      });
    }
  }
);

router.all('/', methodNotAllowed);

export default router;
```

**File:** `src/routes/chat/enrich-web.route.js` (NEW)

```javascript
import express from 'express';
import crypto from 'crypto';
import { enrichWithWeb } from '../../services/chat-process.service.js';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { requireServices } from '../../middleware/serviceGuards.js';
import { methodNotAllowed } from '../../utils/methodNotAllowed.js';
import { logger } from '../../utils/logger.js';
import { chatDebug } from '../../utils/chat-debug-logger.js';
import { EnvelopeSchema } from '../../schemas/envelope.schema.js';
import { z } from 'zod';

const router = express.Router();

// Request schema for web enrichment
const webEnrichRequestSchema = z.object({
  message: z.string().min(1),
  threadId: z.string(),
  sequenceNumber: z.number().int().positive(),
  cachedState: z.object({}).passthrough()  // Allow any object structure
});

router.use(requireServices(['supabase', 'openai', 'pinecone']));
router.use(validateResponse(EnvelopeSchema));

router.post(
  '/',
  validate(webEnrichRequestSchema, 'body'),
  async (req, res, next) => {
    const startTime = Date.now();
    const requestLogger = logger.createRequestLogger();
    
    // Generate trace ID for observability
    const traceId = crypto.randomUUID();
    
    // Add observability headers
    res.set('X-Trace-Id', traceId);
    res.set('X-Request-Id', requestLogger.requestId);
    res.set('X-Two-Call-Mode', 'true');
    res.set('X-Fast-Path', 'false');
    res.set('X-Web-Enrichment', 'true');

    try {
      const { message, threadId, sequenceNumber, cachedState } = req.body;

      requestLogger.info('🌐 Web enrichment request received', {
        traceId,
        threadId,
        sequenceNumber,
        hasCachedState: !!cachedState
      });

      chatDebug.step('WEB_ENRICH_ROUTE_RECEIVED', {
        threadId,
        sequenceNumber,
        hasCachedState: !!cachedState
      });

      // Call service layer
      const result = await enrichWithWeb({
        query: message,
        threadId,
        sequenceNumber,
        cachedState
      });

      const totalDuration = Date.now() - startTime;

      chatDebug.timing('WEB_ENRICH_ROUTE_COMPLETE', totalDuration, {
        sequenceNumber,
        webContentLength: result.webContent?.length || 0
      });

      requestLogger.performance('web_enrichment', totalDuration, {
        sequenceNumber,
        webSourcesCount: result.webSources?.length || 0
      });

      return res.json({
        success: true,
        data: {
          webContent: result.webContent,
          webSources: result.webSources,
          processing_time_ms: totalDuration
        },
        requestId: requestLogger.requestId
      });

    } catch (error) {
      const totalDuration = Date.now() - startTime;
      
      chatDebug.error('WEB_ENRICH_ROUTE_ERROR', error, {
        threadId: req.body.threadId,
        duration: totalDuration
      });

      requestLogger.error('❌ Web enrichment failed', {
        error: error.message,
        stack: error.stack,
        duration_ms: totalDuration
      });

      // Return success but with empty content for graceful degradation
      return res.json({
        success: true,
        data: {
          webContent: null,
          webSources: [],
          error: error.message
        },
        requestId: requestLogger.requestId
      });
    }
  }
);

router.all('/', methodNotAllowed);

export default router;
```

**File:** `src/routes/chat/index.js` (MODIFY)

**Add imports and register new routes (around line 4-19):**
```javascript
import express from 'express';
import { getEnv } from '../../config/env.js';
import sessionsRouter from './sessions.route.js';
import threadsRouter from './threads.route.js';
import messagesRouter from './messages.route.js';
import processRouter from './process.route.js';
import processFastRouter from './process-fast.route.js';  // NEW
import enrichWebRouter from './enrich-web.route.js';  // NEW

const router = express.Router();
const env = getEnv();

// Register all chat routes
router.use('/sessions', sessionsRouter);
router.use('/threads', threadsRouter);
router.use('/messages', messagesRouter);
router.use('/process', processRouter);  // Keep original for backwards compatibility

// Conditionally register two-call routes based on feature flag
if (env.TWO_CALL_MODE === 'true') {
  router.use('/process-fast', processFastRouter);
  router.use('/enrich-web', enrichWebRouter);
}

export default router;
```

#### Step 1.9: Add Health Check Endpoint
**File:** `src/routes/admin/health.route.js` (MODIFY) or create `src/routes/chat/health.route.js` (NEW)

**Add health check for two-call readiness:**

```javascript
import express from 'express';
import { getEnv } from '../../config/env.js';
// Note: Health check endpoints can import repositories for diagnostic purposes
// This is acceptable as health checks are diagnostic, not business logic
import { getMessageBySequence } from '../../repositories/chat.repository.js';

const router = express.Router();
const env = getEnv();

/**
 * Health check endpoint for two-call readiness
 * Checks if all required infrastructure is in place
 */
router.get('/two-call-ready', async (req, res) => {
  const checks = {
    fastEndpoint: false,
    enrichEndpoint: false,
    sequenceUpdate: false,
    pythonSupport: false,
    databaseConstraint: false,
    featureFlag: false
  };

  try {
    // Check feature flag
    checks.featureFlag = env.TWO_CALL_MODE === 'true';

    // Check if endpoints are registered (if flag is on)
    if (checks.featureFlag) {
      // Check route registration by trying to access router stack
      const routes = req.app._router?.stack
        ?.filter(layer => layer.route)
        ?.map(layer => layer.route.path) || [];

      checks.fastEndpoint = routes.some(path => path.includes('process-fast'));
      checks.enrichEndpoint = routes.some(path => path.includes('enrich-web'));
    }

    // Check database function exists (health check can use repository directly)
    // Import for type checking
    try {
      const { updateChatMessageBySequence } = await import('../../repositories/chat.repository.js');
      checks.sequenceUpdate = typeof updateChatMessageBySequence === 'function';
    } catch (err) {
      checks.sequenceUpdate = false;
    }

    // Check database constraint exists
    try {
      const { getSupabaseClient } = await import('../../repositories/supabaseClient.js');
      const supabase = await getSupabaseClient();
      const { data } = await supabase.rpc('check_constraint_exists', {
        constraint_name: 'unique_thread_sequence',
        table_name: 'chat_messages'
      }).catch(() => ({ data: null }));
      
      checks.databaseConstraint = !!data;
    } catch (err) {
      // Constraint check failed, assume false
      checks.databaseConstraint = false;
    }

    // Check Python sidecar support (make a test call)
    const PYTHON_SIDECAR_URL = env.PYTHON_SIDECAR_URL || 'http://localhost:8000';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout
      
      const pythonHealth = await fetch(`${PYTHON_SIDECAR_URL}/v1/chat/health`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      checks.pythonSupport = pythonHealth.ok;
    } catch (err) {
      checks.pythonSupport = false;
    }

    const ready = Object.values(checks).every(v => v === true);

    res.json({
      success: true,
      data: {
        ready,
        checks,
        mode: ready && checks.featureFlag ? 'two-call' : 'single-call',
        recommendations: !ready ? getRecommendations(checks) : []
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Health check failed',
      details: error.message,
      checks
    });
  }
});

function getRecommendations(checks) {
  const recommendations = [];
  if (!checks.featureFlag) {
    recommendations.push('Enable TWO_CALL_MODE=true in environment');
  }
  if (!checks.databaseConstraint) {
    recommendations.push('Run database migration for unique sequence constraint');
  }
  if (!checks.fastEndpoint) {
    recommendations.push('Ensure /chat/process-fast route is registered');
  }
  if (!checks.enrichEndpoint) {
    recommendations.push('Ensure /chat/enrich-web route is registered');
  }
  if (!checks.pythonSupport) {
    recommendations.push('Check Python sidecar is running and accessible');
  }
  return recommendations;
}

export default router;
```

**Register health check route:**

```javascript
// In src/routes/admin/index.js or src/routes/chat/index.js
import healthRouter from './health.route.js';  // or from admin/health.route.js
router.use('/health', healthRouter);
```

#### Step 1.8: Frontend Two-Call Implementation
**File:** `src/public/app.js`

**IMPORTANT NOTES:**
- Sequence numbers are consumed upfront (increment before save)
- This matches existing pattern but requires careful error handling
- Sequence number rollback is needed if save fails

**MODIFY or REPLACE the `processMessage` function (around line 744):**

```javascript
// Track pending web enrichments to avoid race conditions
const pendingEnrichments = new Map();

// Track active requests to prevent duplicates
const activeRequests = new Map();

/**
 * Create request fingerprint for deduplication
 * Same message in same thread within same second = duplicate
 */
function createRequestKey(threadId, message) {
  const messageHash = btoa(message.substring(0, 50)).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
  const timeWindow = Math.floor(Date.now() / 1000); // Same second
  return `${threadId}-${messageHash}-${timeWindow}`;
}

/**
 * Process message with automatic fallback to single-call mode
 */
async function processMessageWithFallback(message) {
  const requestKey = createRequestKey(currentThreadId, message);
  
  // Check if identical request is in flight
  if (activeRequests.has(requestKey)) {
    console.log('Duplicate request detected, waiting for existing');
    return await activeRequests.get(requestKey);
  }
  
  // Store promise to prevent duplicates
  const promise = (async () => {
    try {
      // Try two-call mode first
      return await processMessageTwoCall(message);
    } catch (error) {
      // Check if it's because endpoints don't exist (404 or 404-like error)
      if (error.message.includes('process-fast') || 
          error.message.includes('404') ||
          error.message.includes('not found')) {
        console.warn('Two-call endpoints not available, falling back to single-call');
        // Fallback to original single-call mode
        return await processMessageSingleCall(message);
      }
      throw error;
    }
  })();
  
  activeRequests.set(requestKey, promise);
  
  try {
    return await promise;
  } finally {
    activeRequests.delete(requestKey);
  }
}

/**
 * Original single-call implementation (for fallback)
 * This preserves the existing /chat/process endpoint behavior
 */
async function processMessageSingleCall(message) {
  // This is the original implementation that calls /chat/process
  // Copy existing processMessage logic here as fallback
  let userSequence = null;
  let assistantSequence = null;

  try {
    if (!currentThreadId) {
      currentThreadId = generateThreadId();
      currentMessageSequence = 0;
      // ... thread creation logic ...
    }

    addMessage(message, 'outbound');
    userSequence = ++currentMessageSequence;
    await saveUserMessage(currentThreadId, message, userSequence);

    addLoadingAnimation();
    const selectedModel = getSelectedModel();

    // Call original endpoint
    const response = await fetch('/chat/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: message,
        thread_id: currentThreadId,
        synthesis_model: selectedModel
      })
    });

    if (!response.ok) {
      throw new Error(`Chat request failed: ${response.status}`);
    }

    removeLoadingAnimation();
    const data = await response.json();

    if (data.success && data.data) {
      const responseData = data.data;
      const assistantMessage = responseData.assistantMessage.content || 'No response generated';
      const sources = responseData.sources || [];

      assistantSequence = ++currentMessageSequence;
      await saveAssistantMessage(currentThreadId, assistantMessage, assistantSequence, {
        sources: sources,
        processing_time_ms: responseData.telemetry?.processing_time_ms
      });

      const formattedSources = sources.map(source => ({
        type: source.type,
        content: source.data,
        data: source.data,
        count: source.count,
        equipment: source.equipment,
        icon: getSourceIcon(source.type)
      }));

      addEnhancedMessage(assistantMessage, formattedSources);

      if (responseData.detailed_metrics) {
        window.lastMetrics = responseData.detailed_metrics;
        updateStatsPanel(responseData.detailed_metrics);
      }

      await loadChatSessions();
    } else {
      addMessage(`Error: ${data.error || 'Unknown error'}`, 'inbound');
    }

  } catch (error) {
    removeLoadingAnimation();
    addMessage(`Error: ${error.message}`, 'inbound');
    
    // Rollback sequences
    if (assistantSequence) {
      await rollbackMessage(currentThreadId, assistantSequence, 'assistant');
      currentMessageSequence--;
    }
    if (userSequence && !assistantSequence) {
      await rollbackMessage(currentThreadId, userSequence, 'user');
      currentMessageSequence--;
    }
  }
}

// Main entry point - uses fallback automatically
async function processMessage(message) {
  return await processMessageWithFallback(message);
}

/**
 * Two-call implementation
 * This is the main two-call flow
 */
async function processMessageTwoCall(message) {
  let userSequence = null;
  let assistantSequence = null;

  try {
    if (!currentThreadId) {
      currentThreadId = generateThreadId();
      currentMessageSequence = 0;

      const threadResponse = await fetch('/chat/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentThreadId,
          name: 'New Thread',
          metadata: { created_at: new Date().toISOString() }
        })
      });
      if (!threadResponse.ok) {
        throw new Error('Failed to create thread');
      }

      updateURL(currentThreadId);
    }

    // Add user message to UI immediately
    addMessage(message, 'outbound');
    input.value = '';

    // Save user message (sequence number consumed upfront)
    userSequence = ++currentMessageSequence;
    try {
      await saveUserMessage(currentThreadId, message, userSequence);
    } catch (saveError) {
      // Rollback sequence number if save fails
      currentMessageSequence--;
      throw new Error(`Failed to save user message: ${saveError.message}`);
    }

    // Show loading animation
    const loadingAnimation = addLoadingAnimation();

    // Check feature flag for two-call mode
    // For now, assume TWO_CALL_MODE is enabled via environment
    // You can add UI toggle later: const useTwoCall = window.TWO_CALL_MODE !== false;

    // Reserve sequence number for assistant message BEFORE making the call
    // This prevents race conditions but means we need rollback logic
    assistantSequence = ++currentMessageSequence;

    try {
      // CALL 1: Fast response (skip Perplexity)
      const selectedModel = getSelectedModel() || 'gpt-5';
      
      const fastResponse = await fetch('/chat/process-fast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message,
          threadId: currentThreadId,
          sequenceNumber: assistantSequence,  // Use pre-reserved sequence
          synthesis_model: selectedModel
        })
      });

      if (!fastResponse.ok) {
        const errorText = await fastResponse.text();
        throw new Error(`Fast response failed: ${fastResponse.status} ${errorText}`);
      }

      const fastData = await fastResponse.json();

      if (!fastData.success || !fastData.data) {
        throw new Error(fastData.error || 'Fast response had no data');
      }

      const responseData = fastData.data;
      const assistantMessage = responseData.response || 'No response generated';
      const sources = responseData.sources || [];

      // Verify sequence number matches (sanity check)
      if (responseData.sequenceNumber !== assistantSequence) {
        console.warn(`Sequence number mismatch: expected ${assistantSequence}, got ${responseData.sequenceNumber}`);
      }

      // Remove loading, show response immediately
      removeLoadingAnimation();

      const formattedSources = sources.map(source => ({
        type: source.type,
        content: source.data,
        data: source.data,
        count: source.count,
        equipment: source.equipment,
        icon: getSourceIcon(source.type)
      }));

      const messageDiv = addEnhancedMessage(assistantMessage, formattedSources);

      // Add web search indicator
      const indicator = addWebSearchIndicator(messageDiv);

      // CALL 2: Web enrichment (don't block, run in background)
      if (responseData.cachedState) {
        enrichWithWeb(
          message, 
          currentThreadId, 
          assistantSequence, 
          messageDiv, 
          indicator, 
          responseData.cachedState
        );
      } else {
        console.warn('No cached state returned, skipping web enrichment');
        removeIndicator(indicator);
      }

      // Update stats panel if detailed metrics available
      if (responseData.detailed_metrics) {
        window.lastMetrics = responseData.detailed_metrics;
        updateStatsPanel(responseData.detailed_metrics);
      }

      await loadChatSessions();

    } catch (fastError) {
      // Rollback assistant sequence number on error
      console.error('Fast chat error:', fastError);
      currentMessageSequence--;
      throw fastError;
    }

  } catch (error) {
    removeLoadingAnimation();
    addMessage(`Error: ${error.message}`, 'inbound');

    // Rollback sequence numbers on error
    if (assistantSequence) {
      try {
        await fetch(`/chat/messages/${currentThreadId}/${assistantSequence}`, { 
          method: 'DELETE' 
        });
      } catch (deleteError) {
        console.error('Failed to rollback assistant message:', deleteError);
      }
      currentMessageSequence--;
    }
    
    if (userSequence && !assistantSequence) {
      try {
        await fetch(`/chat/messages/${currentThreadId}/${userSequence}`, { 
          method: 'DELETE' 
        });
      } catch (deleteError) {
        console.error('Failed to rollback user message:', deleteError);
      }
      currentMessageSequence--;
    }
  }
}

async function enrichWithWeb(message, threadId, sequenceNumber, messageDiv, indicator, cachedState) {
  // Store enrichment promise to track pending operations
  const enrichmentKey = `${threadId}-${sequenceNumber}`;
  
  // Create AbortController with configurable timeout
  const WEB_ENRICHMENT_TIMEOUT = parseInt(
    window.WEB_ENRICHMENT_TIMEOUT || '60000'
  ); // Default 60s, configurable
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    console.warn(`Web enrichment timeout after ${WEB_ENRICHMENT_TIMEOUT}ms`);
  }, WEB_ENRICHMENT_TIMEOUT);
  
  try {
    // Check if enrichment already in progress for this message
    if (pendingEnrichments.has(enrichmentKey)) {
      console.log('Web enrichment already in progress, skipping duplicate');
      clearTimeout(timeoutId);
      return;
    }

    const enrichPromise = fetch('/chat/enrich-web', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        threadId,
        sequenceNumber,
        cachedState
      }),
      signal: controller.signal  // Add abort signal for timeout
    });

    // Track pending enrichment with abort controller
    pendingEnrichments.set(enrichmentKey, {
      promise: enrichPromise,
      abortController: controller
    });

    const webResponse = await enrichPromise;
    clearTimeout(timeoutId);

    if (!webResponse.ok) {
      const errorText = await webResponse.text();
      console.error('Web enrichment failed:', webResponse.status, errorText);
      removeIndicator(indicator);
      return;
    }

    const webData = await webResponse.json();

    // Check if web enrichment succeeded
    if (!webData.success || !webData.data) {
      console.warn('Web enrichment returned unsuccessful response');
      removeIndicator(indicator);
      return;
    }

    // If no web content, just remove indicator
    if (!webData.data.webContent) {
      console.log('No web content to append');
      removeIndicator(indicator);
      return;
    }

    // Update message in database via API
    const updateResponse = await fetch(`/chat/messages/${threadId}/${sequenceNumber}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webContent: webData.data.webContent,
        webSources: webData.data.webSources || []
      })
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('Failed to update message in database:', updateResponse.status, errorText);
      // Still update UI even if DB update fails
    } else {
      // Optionally get updated message from response
      const updateData = await updateResponse.json();
      if (updateData.success && updateData.data) {
        console.log('Message updated successfully in database');
      }
    }

    // Update UI to show web section
    removeIndicator(indicator);
    appendWebSection(messageDiv, webData.data.webContent, webData.data.webSources || []);

  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      console.log('Web enrichment timed out after 60s');
      removeIndicator(indicator);
      
      // Show timeout notification to user
      const timeoutMsg = document.createElement('div');
      timeoutMsg.className = 'web-timeout-notice';
      timeoutMsg.textContent = '⏱️ Web search took too long, results may appear later';
      messageDiv.appendChild(timeoutMsg);
      return;
    }
    
    console.error('Web enrichment error:', error);
    removeIndicator(indicator);
    // Graceful failure - user still has main response
  } finally {
    // Clean up pending enrichment tracking
    pendingEnrichments.delete(enrichmentKey);
  }
}

function addWebSearchIndicator(parentDiv) {
  const indicator = document.createElement('div');
  indicator.className = 'web-search-indicator';
  indicator.innerHTML = `
    <span class="spinner"></span>
    <span class="text">🔍 Searching real-world experiences</span>
    <span class="dots">...</span>
  `;
  parentDiv.appendChild(indicator);

  // Animate dots
  let dots = 1;
  const interval = setInterval(() => {
    const dotsEl = indicator.querySelector('.dots');
    if (dotsEl) {
      dotsEl.textContent = '.'.repeat((dots % 3) + 1);
      dots++;
    }
  }, 500);

  indicator.dataset.interval = interval;
  return indicator;
}

function removeIndicator(indicator) {
  if (indicator && indicator.dataset.interval) {
    clearInterval(parseInt(indicator.dataset.interval));
    indicator.remove();
  }
}

function appendWebSection(messageDiv, content, sources) {
  const webSection = document.createElement('div');
  webSection.className = 'web-enhancement';
  webSection.innerHTML = `
    <hr class="web-divider" />
    <div class="web-header">💡 Real-World Resources from Boat Owners</div>
    <div class="web-content">${marked.parse(content)}</div>
  `;

  if (sources && sources.length > 0) {
    const citations = document.createElement('div');
    citations.className = 'web-citations';
    citations.innerHTML = sources.map((url, i) =>
      `<a href="${url}" target="_blank" rel="noopener">[${i+1}]</a>`
    ).join(' ');
    webSection.appendChild(citations);
  }

  messageDiv.appendChild(webSection);
}
```

---

## 🏗️ Phase 2: Backend Saves (Future Enhancement)

### Timeline: Next Sprint (After Phase 1 Stable)

### Changes Required

#### Backend Takes Over Saving
```javascript
// chat-proxy.service.js
export async function processChatMessage({ query, threadId, skipPerplexity }) {
  // Process with Python
  const result = await pythonClient.process({...});

  // Backend saves message (not frontend)
  const savedMessage = await createChatMessage({
    thread_id: threadId,
    role: 'assistant',
    content: result.response,
    metadata: result.metadata
  });

  // Return with real message ID
  return {
    ...result,
    messageId: savedMessage.id
  };
}
```

#### Frontend Simplified
```javascript
// No more separate save calls
const response = await fetch('/chat/process-fast');
// Message already saved, just display
addMessage(response.data.response);
// Use messageId for updates
```

---

## 🧪 Test Plan

### Test Scenario 1: Happy Path
```javascript
// 1. Send message
const start = Date.now();
await sendMessage("My watermaker is making noise");

// 2. Verify fast response
const timeToFirst = Date.now() - start;
assert(timeToFirst < 12000); // Should be ~10s

// 3. Verify web indicator shows
assert(document.querySelector('.web-search-indicator'));

// 4. Wait for web enrichment
await waitFor('.web-enhancement', 60000);

// 5. Verify message updated in DB
const messages = await getMessagesByThread(threadId);
const lastMessage = messages[messages.length - 1];
assert(lastMessage.metadata.web_enhanced === true);
```

### Test Scenario 2: Web Enrichment Failure
```javascript
// 1. Disable Perplexity in Python
setenv('PERPLEXITY_ENABLED', 'false');

// 2. Send message
await sendMessage("Test query");

// 3. Verify main response shows
await waitFor('.assistant-message');

// 4. Verify indicator disappears gracefully
await sleep(5000);
assert(!document.querySelector('.web-search-indicator'));

// 5. Verify no errors in console
assert(console.errors.length === 0);
```

### Test Scenario 3: Sequence Number Consistency
```javascript
// 1. Send multiple messages quickly
await sendMessage("Message 1");
await sendMessage("Message 2");
await sendMessage("Message 3");

// 2. Verify sequence numbers
const messages = await getMessagesByThread(threadId);
const sequences = messages.map(m => m.sequence_number);
assert(sequences === [1, 2, 3, 4, 5, 6]); // User, assistant pairs

// 3. Verify all get web enrichment
await sleep(60000);
const enriched = messages.filter(m => m.metadata?.web_enhanced);
assert(enriched.length === 3); // All assistant messages
```

### Test Scenario 4: Equipment Context Maintained
```javascript
// 1. Send equipment query
await sendMessage("Tell me about my watermaker");
const response1 = await getLastMessage();
assert(response1.metadata.systems_context.length > 0);

// 2. Send follow-up while web search running
await sendMessage("This filter needs replacing");

// 3. Verify context maintained
const response2 = await getLastMessage();
assert(response2.metadata.systems_context[0].model === 'zen_150_watermaker_48v');
```

---

## 📊 Performance Metrics

### Success Criteria
| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Time to First Content | 60s | <12s | Frontend timer |
| Web Enrichment Success Rate | N/A | >95% | Backend logs |
| Message Update Success | N/A | >99% | Database metrics |
| User Engagement | Wait 60s | Reading at 10s | Analytics |

### Monitoring Dashboard
```javascript
// Add to backend metrics
{
  "chat_performance": {
    "fast_response_p50": 9.2,
    "fast_response_p95": 11.8,
    "fast_response_p99": 14.3,
    "web_enrichment_p50": 45.2,
    "web_enrichment_success_rate": 0.96,
    "sequence_update_success_rate": 0.99
  }
}
```

---

## 🔄 Rollback Plan

### Feature Flag Configuration
**File:** `src/config/env.js` (MODIFY - Add to existing EnvSchema)

**Add to EnvSchema (around line 50, after existing fields):**
```javascript
const EnvSchema = z.object({
  // ... existing fields ...
  
  // Two-call optimization feature flags
  TWO_CALL_MODE: z.string().default('false'),
  USE_SEQUENCE_UPDATES: z.string().default('true'),
  BACKEND_SAVES_MESSAGES: z.string().default('false'),
  
  // Web enrichment timeout (configurable, milliseconds)
  WEB_ENRICHMENT_TIMEOUT: z.string().default('60000'),
  
  // ... rest of schema ...
});
```

**Usage (compliant with .cursorrules):**
```javascript
// ✅ CORRECT - Use getEnv() (not process.env)
import { getEnv } from '../config/env.js';
const env = getEnv();
const twoCallEnabled = env.TWO_CALL_MODE === 'true';

// ❌ WRONG - Direct process.env access
const twoCallEnabled = process.env.TWO_CALL_MODE === 'true';  // Violates rule
```

// Usage
if (chatFeatures.TWO_CALL_MODE) {
  // Two-call logic
} else {
  // Original single-call
}
```

### Instant Rollback Steps
1. Set `TWO_CALL_MODE=false` in environment
2. Restart Node.js service
3. Frontend automatically uses single-call
4. No code changes needed

### Rollback Triggers
- Fast response time > 20s (2x target)
- Web enrichment error rate > 10%
- Sequence number conflicts detected
- User reports missing content

---

## ✅ Compliance Verification

### Architecture Compliance (.cursorrules)

**✅ Routes → Services → Repositories Pattern:**
- **NEW routes:** `process-fast.route.js` and `enrich-web.route.js` → Call `chat-process.service.js` ✅
- **Service layer:** `chat-process.service.js` → Calls `chat-proxy.service.js` and repositories ✅
- **Exception:** PUT endpoint in `messages.route.js` uses service wrapper `chat-message-update.service.js` ✅
- **Health check:** Diagnostic endpoint can import repositories directly (acceptable) ✅

**✅ Environment Variables:**
- All code uses `getEnv()` from `src/config/env.js` ✅
- Feature flags added to Zod schema in `env.js` ✅
- No direct `process.env` access in backend code ✅

**✅ Logging:**
- All backend code uses `logger.createRequestLogger()` ✅
- Frontend code (`src/public/app.js`) can use `console.log/error/warn` (exempt per .cursorrules) ✅

**✅ HTTP Response Format:**
- All responses use `{ success, data?, error?, requestId? }` envelope ✅
- Consistent across all new endpoints ✅

**✅ File Naming:**
- New routes use `.route.js` suffix (not `.routes.js`) ✅
- Service files use `.service.js` suffix ✅

**✅ File Size Considerations:**
- New service file: `chat-process.service.js` (~200 lines) ✅
- New routes: ~150 lines each ✅
- Note: `app.js` will exceed 250 lines (existing technical debt, acceptable) ⚠️

**⚠️ Known Architecture Violations (Existing):**
- `messages.route.js` already imports from repository directly (line 2-8)
- This is one of the 20 documented violations
- Plan addresses this by creating service layer for NEW PUT endpoint
- Existing POST endpoint violations remain (to be fixed separately)

### CLAUDE.md Compliance

**✅ Detailed Planning:**
- Full context analysis included ✅
- All files identified ✅
- Risk analysis provided ✅
- Test plan included ✅

**✅ No Code Written Without Approval:**
- This is a planning document only ✅
- Ready for review before implementation ✅

---

## 📁 File Structure Overview

### New Files Created
```
src/
├── services/
│   └── chat-process.service.js  ← NEW (fixes architecture violation)
├── routes/
│   └── chat/
│       ├── process-fast.route.js  ← NEW
│       └── enrich-web.route.js  ← NEW
└── repositories/
    └── chat.repository.js  ← MODIFIED (adds 2 new functions)
```

### Modified Files
```
src/
├── services/
│   └── chat-proxy.service.js  ← MODIFIED (adds new parameters)
├── clients/
│   └── python-sidecar.client.js  ← MODIFIED (passes new params)
├── routes/
│   └── chat/
│       ├── messages.route.js  ← MODIFIED (adds PUT endpoint)
│       └── index.js  ← MODIFIED (registers new routes)
└── public/
    └── app.js  ← MODIFIED (two-call implementation)

python-sidecar/app/
├── chat/
│   ├── chat_models.py  ← MODIFIED (adds new fields)
│   └── workflows/
│       └── chat_workflow_sequential.py  ← MODIFIED (conditional execution)
└── main.py  ← MODIFIED (passes new params)
```

### Import Dependencies
```
process-fast.route.js
  → chat-process.service.js
      → chat-proxy.service.js
          → python-sidecar.client.js
              → python-sidecar API

messages.route.js
  → chat.repository.js (getMessageBySequence, updateChatMessageBySequence)

enrich-web.route.js
  → chat-process.service.js
      → chat-proxy.service.js (with perplexityOnly flag)
```

---

## 📋 Implementation Checklist

### Day 1: Backend Infrastructure
- [ ] **Database Migration** (see Step 1.0 below)
- [ ] Run migration and verify no duplicate sequences exist
- [ ] Create `getMessageBySequence()` repository function
- [ ] Create `updateChatMessageBySequence()` repository function
- [ ] Add sequence conflict error handling to `createChatMessageWithSequence`
- [ ] Export new functions from repository
- [ ] Add PUT `/chat/messages/:threadId/:sequenceNumber` endpoint
- [ ] Update `chat-proxy.service.js` to accept new parameters
- [ ] Update `python-sidecar.client.js` to pass new parameters
- [ ] Create `chat-process.service.js` with state validation
- [ ] Create `/chat/process-fast` route file
- [ ] Create `/chat/enrich-web` route file
- [ ] Add feature flag checks to route registration
- [ ] Create `/admin/api/chat-config` endpoint
- [ ] Register new routes in `src/routes/chat/index.js`
- [ ] Test endpoints with curl/Postman
- [ ] Test sequence conflict handling
- [ ] Test cached state validation

### Day 2: Python Modifications
- [ ] Update `ChatRequest` model in `chat_models.py` with new fields
- [ ] Modify `process_chat` method signature to accept new parameters
- [ ] Implement perplexity_only early return logic
- [ ] Implement skip_perplexity conditional execution
- [ ] Update `main.py` endpoint handler to pass new parameters
- [ ] Test perplexity_only path independently
- [ ] Test skip_perplexity path independently
- [ ] Verify cached_state is properly returned and reused

### Day 3: Frontend Implementation
- [ ] Backup app.js (create app.js.backup)
- [ ] Implement `loadChatConfig()` function
- [ ] Add sessionStorage-based pending enrichments tracking
- [ ] Add page unload cleanup handlers
- [ ] Modify `processMessage()` function for two-call flow
- [ ] Add `getNextSequenceNumber()` with thread-based tracking
- [ ] Implement `enrichWithWeb()` function with timeout and AbortController
- [ ] Add `rollbackMessage()` function with failure handling
- [ ] Add `addWebSearchIndicator()` function
- [ ] Add `removeIndicator()` function
- [ ] Add `appendWebSection()` function
- [ ] Add timeout notification UI
- [ ] Add CSS for `.web-search-indicator` class
- [ ] Add CSS for `.web-enhancement` class
- [ ] Add CSS for `.web-timeout-notice` class
- [ ] Test sequence number handling and rollback
- [ ] Test error handling and graceful degradation
- [ ] Test timeout handling
- [ ] Test page refresh during enrichment
- [ ] Test multiple tabs with same thread
- [ ] Verify UI updates correctly after web enrichment

### Day 4: Integration Testing
- [ ] **Create integration test file:** `tests/two-call-integration.test.js` (see below)
- [ ] Run all test scenarios (happy path, failures, edge cases)
- [ ] Test sequence number conflicts (attempt duplicates)
- [ ] Test cached state size limits (send oversized state)
- [ ] Test web enrichment timeout (simulate slow Perplexity)
- [ ] Test circuit breaker behavior (simulate Perplexity failures)
- [ ] Test request deduplication (send identical requests)
- [ ] Test rollback fallback (disable two-call endpoints)
- [ ] Test multiple tabs with same thread
- [ ] Test page refresh during enrichment
- [ ] Test rollback failure recovery
- [ ] Verify equipment context maintained
- [ ] Test backwards compatibility (old endpoint still works)
- [ ] Test feature flag toggling
- [ ] Test health check endpoint
- [ ] Performance testing (memory usage, response times)
- [ ] Security testing (state validation, sanitization)

**File:** `tests/two-call-integration.test.js` (NEW)

```javascript
import { describe, test, expect, beforeEach, afterEach } from 'node:test';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';
import { createChatThreadWithId } from '../src/repositories/chat.repository.js';
import { processFastChat, enrichWithWeb } from '../src/services/chat-process.service.js';
import { getMessageBySequence, updateChatMessageBySequence } from '../src/repositories/chat.repository.js';

describe('Two-Call Chat Flow Integration Tests', () => {
  let threadId;
  let sequenceNumber = 0;

  beforeEach(async () => {
    // Create test thread
    threadId = `test-thread-${Date.now()}`;
    await createChatThreadWithId({
      id: threadId,
      name: 'Test Thread',
      metadata: { test: true }
    });
    sequenceNumber = 0;
  });

  afterEach(async () => {
    // Cleanup test data
    const supabase = await getSupabaseClient();
    await supabase.from('chat_messages').delete().eq('thread_id', threadId);
    await supabase.from('chat_threads').delete().eq('id', threadId);
  });

  test('Fast response returns within time limit', async () => {
    const start = Date.now();
    const query = 'Test query about watermaker';
    sequenceNumber++;

    const result = await processFastChat({
      query,
      threadId,
      sequenceNumber,
      synthesisModel: 'gpt-4.1-mini'
    });

    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(15000); // 15s max
    expect(result.response).toBeDefined();
    expect(result.cachedState).toBeDefined();
    expect(result.sequenceNumber).toBe(sequenceNumber);
    expect(result.messageId).toBeDefined();
  });

  test('Web enrichment updates existing message', async () => {
    // First create a message via fast call
    sequenceNumber++;
    const fastResult = await processFastChat({
      query: 'Tell me about my watermaker',
      threadId,
      sequenceNumber,
      synthesisModel: 'gpt-4.1-mini'
    });

    expect(fastResult.cachedState).toBeDefined();

    // Then enrich it
    const enrichResult = await enrichWithWeb({
      query: 'Tell me about my watermaker',
      threadId,
      sequenceNumber,
      cachedState: fastResult.cachedState
    });

    expect(enrichResult.webContent !== null || enrichResult.webSources.length > 0).toBe(true);

    // Verify message was updated in database
    const message = await getMessageBySequence(threadId, sequenceNumber);
    expect(message.metadata.web_enhanced).toBe(true);
    expect(message.content).toContain('Real-World Resources');
  });

  test('Handles web enrichment failure gracefully', async () => {
    sequenceNumber++;
    
    // Create message first
    const fastResult = await processFastChat({
      query: 'Test query',
      threadId,
      sequenceNumber,
      synthesisModel: 'gpt-4.1-mini'
    });

    // Try enrichment with invalid cached state
    const enrichResult = await enrichWithWeb({
      query: 'Test query',
      threadId,
      sequenceNumber,
      cachedState: null  // Invalid state
    });

    // Should return empty result, not throw
    expect(enrichResult.webContent).toBeNull();
    expect(enrichResult.webSources).toEqual([]);
  });

  test('Prevents duplicate sequence numbers', async () => {
    sequenceNumber++;
    
    // Create first message
    await processFastChat({
      query: 'First message',
      threadId,
      sequenceNumber,
      synthesisModel: 'gpt-4.1-mini'
    });

    // Try to create duplicate sequence - should fail
    await expect(
      processFastChat({
        query: 'Second message',
        threadId,
        sequenceNumber,  // Same sequence number
        synthesisModel: 'gpt-4.1-mini'
      })
    ).rejects.toThrow(/sequence.*already exists|unique|duplicate/i);
  });

  test('Circuit breaker prevents cascading failures', async () => {
    // This test would require mocking Perplexity failures
    // Implementation depends on your test infrastructure
    // Basic structure:
    
    sequenceNumber++;
    const fastResult = await processFastChat({
      query: 'Test query',
      threadId,
      sequenceNumber,
      synthesisModel: 'gpt-4.1-mini'
    });

    // Simulate multiple failures
    for (let i = 0; i < 5; i++) {
      await enrichWithWeb({
        query: 'Test',
        threadId,
        sequenceNumber: sequenceNumber + i,
        cachedState: {}  // Invalid to trigger failure
      });
    }

    // After threshold failures, circuit should be open
    const result = await enrichWithWeb({
      query: 'Test',
      threadId,
      sequenceNumber: sequenceNumber + 10,
      cachedState: {}
    });

    // Should return empty (circuit breaker open)
    expect(result.webContent).toBeNull();
  });

  test('Cached state is optimized in size', async () => {
    sequenceNumber++;
    
    const result = await processFastChat({
      query: 'Test query with equipment context',
      threadId,
      sequenceNumber,
      synthesisModel: 'gpt-4.1-mini'
    });

    const stateString = JSON.stringify(result.cachedState);
    
    // Should be under 100KB
    expect(stateString.length).toBeLessThan(100000);
    
    // Should only include necessary fields
    expect(result.cachedState.user_query).toBeDefined();
    expect(result.cachedState.systems_context).toBeDefined();
    // Should NOT include large objects
    expect(result.cachedState.dip_results).toBeUndefined();
    expect(result.cachedState.pinecone_results).toBeUndefined();
  });

  test('Update endpoint modifies existing message', async () => {
    sequenceNumber++;
    
    // Create message
    await processFastChat({
      query: 'Initial message',
      threadId,
      sequenceNumber,
      synthesisModel: 'gpt-4.1-mini'
    });

    // Update message
    const updated = await updateChatMessageBySequence(threadId, sequenceNumber, {
      metadata: {
        web_enhanced: true,
        test_update: true
      }
    });

    expect(updated.metadata.web_enhanced).toBe(true);
    expect(updated.metadata.test_update).toBe(true);
  });
});
```

### Day 5: Deployment
- [ ] Run database migration in staging
- [ ] Verify migration completed successfully
- [ ] Check health endpoint: `/admin/api/health/two-call-ready`
- [ ] Deploy with feature flag OFF
- [ ] Test existing single-call in production
- [ ] Enable feature flag for test account
- [ ] Monitor telemetry metrics
- [ ] Check circuit breaker status
- [ ] Verify observability headers in responses
- [ ] Gradual rollout (10% → 50% → 100%)
- [ ] Monitor error rates and performance
- [ ] Be ready for instant rollback if needed

---

## ⚠️ Risk Matrix

| Risk | Probability | Impact | Mitigation | Status |
|------|------------|---------|------------|--------|
| Sequence conflicts | Low | High | Database unique constraint + frontend tracking | ✅ Addressed |
| Web enrichment timeout | Medium | Low | AbortController with 60s timeout | ✅ Addressed |
| Cache state corruption | Low | Medium | Validation + sanitization functions | ✅ Addressed |
| Double message save | Low | High | Sequence conflict detection + error handling | ✅ Addressed |
| Frontend memory leak | Low | Low | SessionStorage + cleanup handlers | ✅ Addressed |
| Cached state size limit | Low | Medium | 100KB validation + sanitization | ✅ Addressed |
| Rollback failure | Low | Medium | Error logging + cleanup job notification | ✅ Addressed |
| Multiple tab conflicts | Medium | Medium | Thread-based sequence tracking | ✅ Addressed |
| State tampering | Low | High | State validation + sanitization | ✅ Addressed |
| Backwards compatibility | Low | Medium | Keep old endpoint functional | ✅ Addressed |

---

## 🎯 Key Decisions Made

1. **Use Sequence-Based Updates (Phase 1)**
   - Matches existing deletion pattern
   - No frontend ID tracking needed
   - Quick to implement

2. **Backend Saves Messages (Phase 2)**
   - Better architecture
   - Atomic operations
   - Future-proof

3. **Fix Architecture Violations**
   - Create service layer for chat routes
   - Move business logic from routes

4. **Feature Flag Everything**
   - Instant rollback capability
   - Gradual rollout possible
   - Risk mitigation

---

## 📌 Summary

This plan provides a clear path to reduce perceived chat latency from 60s to 10s using a two-call architecture. The sequence-based update approach (Phase 1) allows quick implementation with minimal risk, while the backend saves approach (Phase 2) provides the proper long-term architecture.

**Phase 1 Timeline:** 5 days (including testing)
**Risk Level:** LOW (using existing patterns)
**Expected Impact:** 83% improvement in perceived response time

---

---

## ⚠️ Risk Analysis & Edge Cases

### Critical Concerns Identified

#### 1. Line Number Fragility
**Issue:** Plan specifies exact line numbers that may change during implementation.

**Solution:** Use function/pattern search instead:
- ✅ "Add AFTER `getMessagesByThreadWithSequence` function" (pattern-based)
- ✅ "Add AFTER `deleteChatMessageBySequence` function" (pattern-based)
- ✅ "MODIFY the `processChatMessage` function signature" (function-based)

**Implementation Note:** Use grep/IDE search to find exact locations:
```bash
# Find insertion points
grep -n "getMessagesByThreadWithSequence" src/repositories/chat.repository.js
grep -n "deleteChatMessageBySequence" src/repositories/chat.repository.js
```

#### 2. Cached State Size & Security
**Issue:** `cachedState` could become large or contain sensitive data.

**Solution:** Add validation and size limits in service layer.

**File:** `src/services/chat-process.service.js`

```javascript
/**
 * Validate and sanitize cached state before use
 */
function validateCachedState(cachedState) {
  if (!cachedState || typeof cachedState !== 'object') {
    throw new Error('Invalid cached state: must be an object');
  }

  // Size check (approximately 100KB limit)
  const stateString = JSON.stringify(cachedState);
  if (stateString.length > 100000) {
    throw new Error('Cached state too large: exceeds 100KB limit');
  }

  // Required fields check
  if (!cachedState.systems_context) {
    throw new Error('Invalid cached state: missing systems_context');
  }

  if (!cachedState.classification) {
    throw new Error('Invalid cached state: missing classification');
  }

  // Sanitize: Remove any sensitive fields that shouldn't be passed back
  const sanitized = {
    user_query: cachedState.user_query,
    systems_context: cachedState.systems_context,
    classification: cachedState.classification,
    synthesis_model: cachedState.synthesis_model,
    start_time: cachedState.start_time,
    processing_steps: cachedState.processing_steps
  };

  return sanitized;
}

export async function enrichWithWeb({ query, threadId, sequenceNumber, cachedState }) {
  try {
    // Validate cached state before use
    const validatedState = validateCachedState(cachedState);
    
    // ... rest of function
  } catch (error) {
    if (error.message.includes('Invalid cached state') || 
        error.message.includes('too large')) {
      requestLogger.warn('⚠️ Cached state validation failed, falling back to full processing', {
        error: error.message,
        threadId,
        sequenceNumber
      });
      
      // Fallback: Re-process without cached state
      return await processChatMessage({
        query,
        threadId,
        perplexityOnly: true,  // Still only run Perplexity
        cachedState: null  // Let it rebuild state
      });
    }
    throw error;
  }
}
```

#### 3. Sequence Number Race Conditions
**Issue:** Multiple tabs could generate duplicate sequence numbers.

**Solution:** Add database constraint AND frontend protection.

**Database Migration:** `scripts/migrations/XXX_add_unique_sequence_constraint.sql`

```sql
-- Add unique constraint to prevent duplicate sequence numbers per thread
CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_sequence_unique 
ON chat_messages(thread_id, sequence_number);

-- Verify existing data doesn't violate constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT thread_id, sequence_number, COUNT(*)
    FROM chat_messages
    GROUP BY thread_id, sequence_number
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate sequence numbers found - must clean up first';
  END IF;
END $$;
```

**Frontend Protection:** `src/public/app.js`

```javascript
// Track sequence numbers per thread to detect conflicts
const threadSequenceTrackers = new Map();

function getNextSequenceNumber(threadId) {
  if (!threadSequenceTrackers.has(threadId)) {
    // Initialize from database or start at 0
    threadSequenceTrackers.set(threadId, 0);
  }
  
  const current = threadSequenceTrackers.get(threadId);
  const next = current + 1;
  threadSequenceTrackers.set(threadId, next);
  
  return next;
}

// Use instead of ++currentMessageSequence
async function processMessage(message) {
  // ...
  const userSequence = getNextSequenceNumber(currentThreadId);
  // ...
  
  // If save fails, rollback the tracker
  try {
    await saveUserMessage(currentThreadId, message, userSequence);
  } catch (saveError) {
    threadSequenceTrackers.set(currentThreadId, userSequence - 1);
    throw saveError;
  }
}
```

**Repository Error Handling:** `src/repositories/chat.repository.js`

```javascript
export async function createChatMessageWithSequence({ threadId, role, content, sequenceNumber, metadata = {} }) {
  try {
    // ... existing code ...
    
    const { data, error } = await supabase
      .from(MESSAGES_TABLE)
      .insert({
        thread_id: threadId,
        role,
        content,
        sequence_number: sequenceNumber,
        metadata,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      // Check if it's a unique constraint violation
      if (error.code === '23505' || error.message.includes('unique') || error.message.includes('duplicate')) {
        const err = new Error(`Sequence number ${sequenceNumber} already exists for thread ${threadId}`);
        err.code = 'SEQUENCE_CONFLICT';
        err.context = { threadId, sequenceNumber };
        throw err;
      }
      
      // ... existing error handling ...
    }

    return data;
  } catch (error) {
    // ... existing error context ...
  }
}
```

#### 4. Pending Enrichments on Navigation
**Issue:** In-memory Map lost on page refresh/navigation.

**Solution:** Use sessionStorage for persistence + cleanup handlers.

**File:** `src/public/app.js`

```javascript
// Enhanced pending enrichments with persistence
const PENDING_ENRICHMENTS_KEY = 'pending_chat_enrichments';

function loadPendingEnrichments() {
  try {
    const stored = sessionStorage.getItem(PENDING_ENRICHMENTS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Convert back to Map (tracking only, promises can't be serialized)
      const map = new Map();
      for (const [key, timestamp] of parsed) {
        // Only restore if less than 5 minutes old
        if (Date.now() - timestamp < 5 * 60 * 1000) {
          map.set(key, { timestamp, status: 'pending' });
        }
      }
      return map;
    }
  } catch (error) {
    console.warn('Failed to load pending enrichments:', error);
  }
  return new Map();
}

function savePendingEnrichments(map) {
  try {
    // Store only keys and timestamps (not promises)
    const serializable = Array.from(map.entries()).map(([key, value]) => [
      key,
      value.timestamp || Date.now()
    ]);
    sessionStorage.setItem(PENDING_ENRICHMENTS_KEY, JSON.stringify(serializable));
  } catch (error) {
    console.warn('Failed to save pending enrichments:', error);
  }
}

const pendingEnrichments = loadPendingEnrichments();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  // Cancel any pending enrichments
  for (const [key, value] of pendingEnrichments) {
    if (value.abortController) {
      value.abortController.abort();
    }
  }
  // Clear session storage (they'll be retried if needed)
  sessionStorage.removeItem(PENDING_ENRICHMENTS_KEY);
});

// Also clear on successful completion
function clearPendingEnrichment(key) {
  pendingEnrichments.delete(key);
  savePendingEnrichments(pendingEnrichments);
}
```

#### 5. Web Enrichment Timeout
**Issue:** No timeout specified, could hang indefinitely.

**Solution:** Add AbortController with configurable timeout.

**File:** `src/public/app.js`

```javascript
async function enrichWithWeb(message, threadId, sequenceNumber, messageDiv, indicator, cachedState) {
  const enrichmentKey = `${threadId}-${sequenceNumber}`;
  
  // Create abort controller with 60s timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    console.warn(`Web enrichment timeout for ${enrichmentKey}`);
  }, 60000); // 60 seconds
  
  try {
    if (pendingEnrichments.has(enrichmentKey)) {
      console.log('Web enrichment already in progress, skipping duplicate');
      return;
    }

    const enrichPromise = fetch('/chat/enrich-web', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        threadId,
        sequenceNumber,
        cachedState
      }),
      signal: controller.signal  // Add abort signal
    });

    // Track with abort controller
    pendingEnrichments.set(enrichmentKey, {
      promise: enrichPromise,
      timestamp: Date.now(),
      abortController: controller
    });
    savePendingEnrichments(pendingEnrichments);

    const webResponse = await enrichPromise;
    clearTimeout(timeoutId);

    // ... rest of function ...

  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      console.warn('Web enrichment timed out');
      removeIndicator(indicator);
      // Optionally show timeout message to user
      const timeoutMsg = document.createElement('div');
      timeoutMsg.className = 'web-timeout-notice';
      timeoutMsg.textContent = '⏱️ Web search took too long, results may appear later';
      messageDiv.appendChild(timeoutMsg);
      return;
    }
    
    // ... existing error handling ...
  } finally {
    clearPendingEnrichment(enrichmentKey);
  }
}
```

---

## 🔧 Critical Implementation Notes

### Sequence Number Handling Pattern
**IMPORTANT:** The codebase uses a "consume upfront" pattern for sequence numbers:
- Frontend increments `currentMessageSequence` BEFORE saving
- This prevents race conditions but requires rollback on errors
- Matches existing deletion pattern: `deleteChatMessageBySequence(threadId, sequenceNumber)`

**Error Handling:**
- If fast call fails: Rollback assistant sequence number
- If user message save fails: Rollback user sequence number
- Always decrement `currentMessageSequence--` on rollback

### Missing Functions Added
1. `getMessageBySequence()` - Required by update endpoint
2. `updateChatMessageBySequence()` - Required for web enrichment updates
3. Both added to repository exports

### Parameter Passing Chain
```
Frontend → Route → Service → Client → Python
  ↓         ↓       ↓        ↓        ↓
threadId  threadId  query   query   query
seqNum    seqNum    skipP   skip_p  skip_perplexity
```

### Feature Flag Integration

**Backend Configuration:** `src/config/env.js`

```javascript
// Add to Zod schema
TWO_CALL_MODE: z.string().default('false'),
USE_SEQUENCE_UPDATES: z.string().default('true'),
BACKEND_SAVES_MESSAGES: z.string().default('false')
```

**Backend Usage:** `src/routes/chat/index.js`

```javascript
import { getEnv } from '../../config/env.js';

const router = express.Router();
const env = getEnv();

// Conditionally register routes based on feature flags
router.use('/sessions', sessionsRouter);
router.use('/threads', threadsRouter);
router.use('/messages', messagesRouter);
router.use('/process', processRouter);

if (env.TWO_CALL_MODE === 'true') {
  router.use('/process-fast', processFastRouter);
  router.use('/enrich-web', enrichWebRouter);
}
```

**Frontend Configuration Endpoint:** `src/routes/admin/config.route.js` (NEW or add to existing)

```javascript
router.get('/chat-config', async (req, res) => {
  const env = getEnv();
  return res.json({
    success: true,
    data: {
      twoCallMode: env.TWO_CALL_MODE === 'true',
      useSequenceUpdates: env.USE_SEQUENCE_UPDATES === 'true',
      backendSavesMessages: env.BACKEND_SAVES_MESSAGES === 'true'
    }
  });
});
```

**Frontend Feature Flag Check:** `src/public/app.js`

```javascript
// Load feature flags from backend on page load
let chatConfig = {
  twoCallMode: false,
  useSequenceUpdates: true,
  backendSavesMessages: false
};

async function loadChatConfig() {
  try {
    const response = await fetch('/admin/api/chat-config');
    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        chatConfig = data.data;
        console.log('Chat config loaded:', chatConfig);
      }
    }
  } catch (error) {
    console.warn('Failed to load chat config, using defaults:', error);
  }
}

// Call on page load
document.addEventListener('DOMContentLoaded', loadChatConfig);

// Use in processMessage
async function processMessage(message) {
  // ...
  
  if (chatConfig.twoCallMode) {
    // Use two-call flow
    // ... fast call logic ...
  } else {
    // Use original single-call flow
    const response = await fetch('/chat/process', {
      // ... existing logic ...
    });
  }
}
```

**Environment Variables:** `.env`
```
TWO_CALL_MODE=true
USE_SEQUENCE_UPDATES=true
BACKEND_SAVES_MESSAGES=false
```

### Error Recovery Strategy

**Rollback Failure Handling:** `src/public/app.js`

```javascript
async function rollbackMessage(threadId, sequenceNumber, messageType) {
  try {
    const response = await fetch(`/chat/messages/${threadId}/${sequenceNumber}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      // If delete fails, log for manual cleanup
      console.error(`Failed to delete ${messageType} message ${sequenceNumber} in thread ${threadId}`);
      
      // Optionally notify backend for cleanup job
      await fetch('/admin/api/message-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          sequenceNumber,
          reason: 'rollback_failed'
        })
      }).catch(err => console.error('Cleanup notification failed:', err));
      
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`Rollback error for ${messageType} message:`, error);
    
    // Store failed rollback for later retry
    const failedRollbacks = JSON.parse(localStorage.getItem('failed_rollbacks') || '[]');
    failedRollbacks.push({ threadId, sequenceNumber, messageType, timestamp: Date.now() });
    localStorage.setItem('failed_rollbacks', JSON.stringify(failedRollbacks.slice(-50))); // Keep last 50
    
    return false;
  }
}

// Use in error handling
catch (error) {
  removeLoadingAnimation();
  addMessage(`Error: ${error.message}`, 'inbound');

  if (assistantSequence) {
    const rolledBack = await rollbackMessage(currentThreadId, assistantSequence, 'assistant');
    if (rolledBack) {
      currentMessageSequence--;
    } else {
      // Sequence number is now "orphaned" - log for manual review
      console.error(`Orphaned sequence ${assistantSequence} in thread ${currentThreadId}`);
    }
  }
  
  // ... user message rollback ...
}
```

### Python Memory Management

**Cached State Cleanup:** `python-sidecar/app/chat/workflows/chat_workflow_sequential.py`

```python
def _sanitize_state_for_caching(self, state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a minimal cached state with only essential data
    Reduces memory usage and prevents sensitive data leakage
    """
    return {
        "user_query": state.get("user_query"),
        "systems_context": state.get("systems_context", [])[:10],  # Limit to 10 systems
        "classification": state.get("classification"),
        "synthesis_model": state.get("synthesis_model"),
        "start_time": state.get("start_time"),
        "processing_steps": state.get("processing_steps", [])[-5:],  # Last 5 steps only
        # Explicitly exclude large objects
        # "dip_results": [],  # Don't cache - can be large
        # "pinecone_results": None,  # Don't cache - can be large
        # "final_response": None,  # Don't cache - already returned
    }

# Use in skip_perplexity path
elif skip_perplexity:
    openai_result = await self._synthesize_response(state)
    
    # Return optimized cached state (only what Perplexity needs)
    cached_state = {
        "user_query": state.get("user_query"),
        "systems_context": state.get("systems_context", [])[:10],  # Limit to top 10
        "classification": state.get("classification", {}),
        # Include only top Pinecone chunks with truncated text for Perplexity context
        "pinecone_chunks": [
            {
                "text": chunk.get("text", "")[:1000],  # First 1000 chars
                "score": chunk.get("score", 0),
                "metadata": chunk.get("metadata", {})
            }
            for chunk in (state.get("pinecone_results", {}).get("matches", []) or [])[:5]  # Top 5 chunks
        ],
        "synthesis_model": state.get("synthesis_model"),
        "start_time": state.get("start_time"),
        "processing_steps": state.get("processing_steps", [])[-5:]  # Last 5 steps
    }
    
    return {
        "response": openai_result.get("response", ""),
        "sources": self._format_sources(state),
        "classification": state.get("classification"),
        "processing_time_ms": int((datetime.now() - state["start_time"]).total_seconds() * 1000),
        "metadata": {
            "workflow": "sequential_fast",
            "processing_steps": state["processing_steps"]
        },
        "cached_state": cached_state,  # Optimized state
        "systems_context": systems_context
    }
```

### Backwards Compatibility

**Maintain Old Endpoint:** `src/routes/chat/process.route.js`

```javascript
// Keep existing endpoint - it will continue to work
router.post(
  '/',
  validate(chatProcessRequestSchema, 'body'),
  async (req, res, next) => {
    // Check feature flag
    const env = getEnv();
    
    if (env.TWO_CALL_MODE === 'true' && req.body.use_two_call !== false) {
      // Optionally redirect to fast endpoint if flag is set
      // OR: Continue to use single-call for backwards compatibility
      // Decision: Keep original behavior for backwards compatibility
    }
    
    // ... existing single-call logic ...
  }
);
```

**Migration Path:**
1. Deploy new endpoints alongside old ones
2. Old endpoint remains functional
3. Frontend gradually migrates to new endpoints
4. After 100% adoption, mark old endpoint as deprecated
5. Remove old endpoint in future major version

### Testing Checklist

**Core Functionality:**
- [ ] Fast response returns in <12s
- [ ] Sequence numbers increment correctly
- [ ] Web enrichment updates correct message
- [ ] Error rollback works correctly
- [ ] Multiple rapid messages don't cause sequence conflicts
- [ ] UI updates smoothly after web enrichment
- [ ] Graceful degradation when Perplexity disabled

**Edge Cases:**
- [ ] Database unique constraint prevents duplicate sequences
- [ ] Cached state validation rejects invalid/oversized states
- [ ] Web enrichment timeout cancels after 60s
- [ ] Page refresh/navigation cleans up pending enrichments
- [ ] Multiple browser tabs maintain separate sequence counters
- [ ] Rollback failure is logged and recoverable
- [ ] Feature flags disable/enable correctly
- [ ] Old `/chat/process` endpoint still works
- [ ] Backwards compatibility maintained during migration

**Performance:**
- [ ] Cached state size < 100KB
- [ ] Memory cleanup works correctly
- [ ] No memory leaks from pending enrichments
- [ ] Database query performance maintained

**Security:**
- [ ] Cached state sanitized (no sensitive data)
- [ ] State validation prevents tampering
- [ ] Error messages don't leak sensitive info

---

**Document Status:** ✅ FINAL - Ready for implementation
**Approach:** Sequence-based updates first, backend saves later
**All Gaps Addressed:** ✅ Yes
**Next Step:** Begin Day 1 implementation