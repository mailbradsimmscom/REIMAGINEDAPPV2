# Code Update #48e: Two-Call Chat - Production-Ready Final Plan

**Date:** 2025-11-20
**Status:** ✅ PRODUCTION-READY - Properly configured
**Supersedes:** 48d (adds configurability and data integrity)
**Priority:** HIGH - Ready for implementation

---

## 🎯 What This Document Corrects

Based on review, three important corrections:
1. **Cached state limits were too restrictive** - Now configurable (5 chunks × 1KB)
2. **Database constraint is actually beneficial** - Protects data integrity
3. **Timeout should be configurable** - Ops can tune without redeploy

---

## 📝 Essential Additions to Original Plan

### 1. Configurable Timeout for Web Enrichment
**Why:** Ops need to tune timeouts without code changes

**File:** `.env`
**Add:**
```
TWO_CALL_MODE=true
WEB_ENRICHMENT_TIMEOUT_MS=60000
PINECONE_CHUNKS_FOR_CACHE=5
PINECONE_CHUNK_SIZE=1000
```

**File:** `src/config/env.js`
**Add to schema:**
```javascript
TWO_CALL_MODE: z.string().optional().default('true'),
WEB_ENRICHMENT_TIMEOUT_MS: z.string().optional().default('60000'),
PINECONE_CHUNKS_FOR_CACHE: z.string().optional().default('5'),
PINECONE_CHUNK_SIZE: z.string().optional().default('1000'),
```

**File:** `src/routes/config.route.js` (NEW)
**Create config endpoint:**
```javascript
import express from 'express';
import { getEnv } from '../config/env.js';

const router = express.Router();

// Expose chat configuration to frontend
router.get('/chat', (req, res) => {
  const env = getEnv();

  res.json({
    TWO_CALL_MODE: env.TWO_CALL_MODE === 'true',
    WEB_ENRICHMENT_TIMEOUT_MS: parseInt(env.WEB_ENRICHMENT_TIMEOUT_MS || '60000'),
    PINECONE_CHUNKS_FOR_CACHE: parseInt(env.PINECONE_CHUNKS_FOR_CACHE || '5'),
    PINECONE_CHUNK_SIZE: parseInt(env.PINECONE_CHUNK_SIZE || '1000')
  });
});

export default router;
```

**File:** `src/public/app.js`
**Load configuration at startup:**
```javascript
// At top of file, after initial setup
let chatConfig = {
  TWO_CALL_MODE: true,
  WEB_ENRICHMENT_TIMEOUT_MS: 60000
};

// Load configuration on page load
async function loadChatConfig() {
  try {
    const response = await fetch('/config/chat');
    if (response.ok) {
      chatConfig = await response.json();
      console.log('Chat configuration loaded:', chatConfig);
    }
  } catch (error) {
    console.error('Failed to load chat config, using defaults:', error);
  }
}

// Call on page load
document.addEventListener('DOMContentLoaded', async () => {
  await loadChatConfig();
  // ... rest of initialization
});

// Update enrichWithWeb to use config
async function enrichWithWeb(message, threadId, sequenceNumber, messageDiv, indicator, cachedState) {
  const enrichmentKey = `${threadId}-${sequenceNumber}`;

  // Use configurable timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
    console.warn(`Web enrichment timed out after ${chatConfig.WEB_ENRICHMENT_TIMEOUT_MS}ms`);
  }, chatConfig.WEB_ENRICHMENT_TIMEOUT_MS);

  try {
    if (pendingEnrichments.has(enrichmentKey)) {
      console.log('Web enrichment already in progress, skipping duplicate');
      return;
    }

    const enrichPromise = fetch('/chat/enrich-web', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        message,
        threadId,
        sequenceNumber,
        cachedState
      })
    });

    pendingEnrichments.set(enrichmentKey, enrichPromise);
    const webResponse = await enrichPromise;

    // ... rest of existing function

  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`Web enrichment timed out after ${chatConfig.WEB_ENRICHMENT_TIMEOUT_MS}ms`);
      removeIndicator(indicator);
      return;
    }
    console.error('Web enrichment error:', error);
    removeIndicator(indicator);
  } finally {
    clearTimeout(timeout);
    pendingEnrichments.delete(enrichmentKey);
  }
}

// Update processMessage to check config
async function processMessage(message) {
  // Use config flag instead of hardcoded
  if (!chatConfig.TWO_CALL_MODE) {
    return processMessageOriginal(message);
  }

  // ... rest of two-call implementation
}
```

### 2. Configurable Cached State Size
**Why:** 3 chunks × 500 chars is too limiting for technical manuals

**File:** `python-sidecar/app/chat/workflows/chat_workflow_sequential.py`
**Add configuration loading:**
```python
import os

# At top of class or in __init__
PINECONE_CHUNKS_FOR_CACHE = int(os.getenv("PINECONE_CHUNKS_FOR_CACHE", "5"))
PINECONE_CHUNK_SIZE = int(os.getenv("PINECONE_CHUNK_SIZE", "1000"))

# Log configuration on startup
logger.info(f"📊 Cache configuration: {PINECONE_CHUNKS_FOR_CACHE} chunks × {PINECONE_CHUNK_SIZE} chars")
```

**Update cached_state creation (around line 684):**
```python
"cached_state": {
    # Essential fields
    "user_query": state.get("user_query"),
    "systems_context": state.get("systems_context", []),
    "classification": state.get("classification", {}),
    "synthesis_model": state.get("synthesis_model"),

    # Configurable Pinecone results - preserves more context
    "pinecone_results": {
        "matches": [
            {
                "text": match.get("text", "")[:PINECONE_CHUNK_SIZE],
                "score": match.get("score", 0),
                "doc_type": match.get("metadata", {}).get("doc_type"),
                "manufacturer": match.get("metadata", {}).get("manufacturer"),
                "model": match.get("metadata", {}).get("model")
            }
            for match in state.get("pinecone_results", {}).get("matches", [])[:PINECONE_CHUNKS_FOR_CACHE]
        ]
    },

    # Include conversation memory if present
    "conversation_summary": state.get("conversation_summary", ""),
    "memory_context": {
        "total_exchanges": state.get("memory_context", {}).get("total_exchanges", 0)
    }
},
```

**Why 5 chunks × 1KB:**
- Marine technical manuals often have critical steps buried deep
- 5KB total is reasonable payload size
- Preserves enough context for quality Perplexity responses
- Still prevents megabyte payloads

### 3. Add Database Constraint for Data Integrity
**Why:** Catches real race conditions without breaking rollback pattern

**File:** Create new migration `migrations/001_chat_sequence_constraint.sql`
```sql
-- Ensure sequence numbers are unique per thread
-- This prevents race conditions from multi-tab usage
ALTER TABLE chat_messages
ADD CONSTRAINT IF NOT EXISTS unique_thread_sequence
UNIQUE (thread_id, sequence_number);

-- Add index for faster sequence lookups
CREATE INDEX IF NOT EXISTS idx_messages_thread_seq
ON chat_messages(thread_id, sequence_number);

-- Add comment explaining the pattern
COMMENT ON CONSTRAINT unique_thread_sequence ON chat_messages IS
'Ensures sequence numbers are unique per thread. Frontend increments before use, so rollback pattern still works: delete failed message, reuse sequence number.';
```

**Note on Rollback Pattern:**
The constraint doesn't break rollback because:
1. Frontend increments sequence (e.g., 6)
2. If save fails, message with sequence 6 doesn't exist
3. Frontend decrements back to 5
4. Next message uses 6 again - no constraint violation

The constraint only triggers on:
- Multi-tab race conditions (both grab sequence 6)
- Backend bugs that try duplicate inserts
- True concurrency issues we WANT to catch

---

## 🔧 Additional Production Safety

### 4. Add Monitoring for Key Metrics
**File:** `src/services/chat-process.service.js`
**Add metrics logging:**
```javascript
// In processFastChat
const fastDuration = Date.now() - startTime;
requestLogger.info('📊 Fast chat metrics', {
  duration_ms: fastDuration,
  response_length: result.response?.length || 0,
  sources_count: result.sources?.length || 0,
  cache_state_size: JSON.stringify(result.cachedState || {}).length
});

// Alert if cached state is too large
if (result.cachedState && JSON.stringify(result.cachedState).length > 10000) {
  requestLogger.warn('⚠️ Large cached state detected', {
    size: JSON.stringify(result.cachedState).length,
    threadId
  });
}
```

---

## ⚠️ What Still NOT to Add

### ❌ Request Deduplication
Users may intentionally ask the same question twice for updated information.

### ❌ Auto-Fallback to Single Call
If two-call fails, we want to know about it explicitly, not mask the problem.

### ❌ Circuit Breaker (Yet)
Wait for production data before adding complex recovery mechanisms.

---

## 📋 Updated Implementation Checklist

### Day 1: Backend Infrastructure
- [ ] Run database migration for sequence constraint
- [ ] Implement all changes from 48c document
- [ ] Create `/config/chat` endpoint
- [ ] Add environment variables to `.env`
- [ ] Update `env.js` schema
- [ ] Test sequence constraint doesn't break rollback

### Day 2: Python Modifications
- [ ] Implement all changes from 48c document
- [ ] Add configurable cache size limits
- [ ] Test cached state size is ~5KB not MB
- [ ] Verify Perplexity gets enough context

### Day 3: Frontend Implementation
- [ ] Implement all changes from 48c document
- [ ] Add config loading on startup
- [ ] Use configurable timeout
- [ ] Use config flag for two-call mode
- [ ] Test with different timeout values

### Day 4: Testing
- [ ] Test with various cache configurations
- [ ] Test multi-tab scenario (constraint should prevent duplicates)
- [ ] Test rollback still works with constraint
- [ ] Verify timeout is respected
- [ ] Check cached state sizes in logs

### Day 5: Deployment
- [ ] Deploy with conservative defaults:
  - `WEB_ENRICHMENT_TIMEOUT_MS=60000`
  - `PINECONE_CHUNKS_FOR_CACHE=5`
  - `PINECONE_CHUNK_SIZE=1000`
  - `TWO_CALL_MODE=false`
- [ ] Test configuration endpoint works
- [ ] Enable for test accounts
- [ ] Monitor cached state sizes
- [ ] Tune configuration based on telemetry

---

## 📊 Configuration Tuning Guide

### Timeout Tuning
- Start with 60s
- If many timeouts in logs → increase to 90s
- If Perplexity consistently returns in 30s → decrease to 45s

### Cache Size Tuning
- Start with 5 chunks × 1000 chars
- Monitor Perplexity response quality
- If responses lack detail → increase chunks or size
- If cached state > 10KB warnings → decrease

### Database Monitoring
```sql
-- Check for constraint violations (indicates race conditions)
SELECT COUNT(*) as race_conditions
FROM pg_stat_database_conflicts
WHERE datname = 'your_db'
AND confl_unique > 0;

-- Check sequence number distribution
SELECT thread_id, COUNT(*) as message_count, MAX(sequence_number) as max_seq
FROM chat_messages
GROUP BY thread_id
HAVING MAX(sequence_number) != COUNT(*);
```

---

## 🎯 Summary

**Key Changes from 48d:**
1. ✅ **Configurable timeout** - Ops can tune without deploy
2. ✅ **Configurable cache limits** - Balance quality vs payload (5×1KB default)
3. ✅ **Database constraint added** - Protects data integrity, catches races
4. ✅ **Config endpoint** - Frontend loads settings dynamically

**Result:** Production-ready implementation with:
- Tunable operational parameters
- Data integrity protection
- Sufficient context for quality responses
- No over-engineering

**The plan now handles both development flexibility and production safety.**

---

**Document Status:** ✅ PRODUCTION-READY - Final
**Configurability:** Full operational control
**Data Integrity:** Protected by constraints
**Risk:** Low with proper configuration
**Next Step:** Begin implementation following 48c with these production enhancements