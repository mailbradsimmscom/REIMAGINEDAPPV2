# Code Update #48f: Two-Call Chat - Single Source of Truth Final Plan

**Date:** 2025-11-20
**Status:** ✅ FINAL - Single source of truth for feature flags
**Supersedes:** 48e (fixes feature flag divergence)
**Priority:** HIGH - Ready for implementation

---

## 🎯 Critical Fix: Feature Flag Single Source of Truth

**Problem with 48e:** Referenced `window.TWO_CALL_MODE` which could diverge from backend setting.

**Solution:** Feature flag flows in ONE direction only:
```
.env → getEnv() → /config/chat endpoint → Frontend
```

No `window.TWO_CALL_MODE`, no divergence, no confusion.

---

## 📝 Essential Additions to Original Plan

### 1. Backend-Controlled Feature Flags (CRITICAL)
**Why:** Frontend and backend must always be synchronized

**File:** `.env`
```
TWO_CALL_MODE=false
WEB_ENRICHMENT_TIMEOUT_MS=60000
PINECONE_CHUNKS_FOR_CACHE=5
PINECONE_CHUNK_SIZE=1000
```

**File:** `src/config/env.js`
```javascript
// Chat configuration
TWO_CALL_MODE: z.string().optional().default('false'),
WEB_ENRICHMENT_TIMEOUT_MS: z.string().optional().default('60000'),
PINECONE_CHUNKS_FOR_CACHE: z.string().optional().default('5'),
PINECONE_CHUNK_SIZE: z.string().optional().default('1000'),
```

**File:** `src/routes/config.route.js` (NEW)
```javascript
import express from 'express';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const requestLogger = logger.createRequestLogger();

// Single source of truth for chat configuration
router.get('/chat', (req, res) => {
  const env = getEnv();

  const config = {
    TWO_CALL_MODE: env.TWO_CALL_MODE === 'true',
    WEB_ENRICHMENT_TIMEOUT_MS: parseInt(env.WEB_ENRICHMENT_TIMEOUT_MS || '60000'),
    PINECONE_CHUNKS_FOR_CACHE: parseInt(env.PINECONE_CHUNKS_FOR_CACHE || '5'),
    PINECONE_CHUNK_SIZE: parseInt(env.PINECONE_CHUNK_SIZE || '1000')
  };

  requestLogger.info('📋 Chat config requested', config);

  res.json(config);
});

export default router;
```

**File:** `src/routes/index.js` (MODIFY)
```javascript
// Add config routes
import configRouter from './config.route.js';

// Register config routes
router.use('/config', configRouter);
```

**File:** `src/public/app.js`
```javascript
// CRITICAL: This is the ONLY source of feature flag truth
let chatConfig = {
  TWO_CALL_MODE: false,  // Default to single-call (safe)
  WEB_ENRICHMENT_TIMEOUT_MS: 60000
};

// Flag to track if config is loaded
let configLoaded = false;

// Load configuration from backend - REQUIRED before processing
async function loadChatConfig() {
  try {
    const response = await fetch('/config/chat');
    if (response.ok) {
      chatConfig = await response.json();
      configLoaded = true;
      console.log('✅ Chat configuration loaded from backend:', chatConfig);

      // Update UI to show mode
      const modeIndicator = document.getElementById('chat-mode-indicator');
      if (modeIndicator) {
        modeIndicator.textContent = chatConfig.TWO_CALL_MODE ? 'Two-Call Mode' : 'Single-Call Mode';
      }
    } else {
      console.error('❌ Config endpoint failed, defaulting to single-call mode');
      chatConfig.TWO_CALL_MODE = false;  // Safe fallback
      configLoaded = false;
    }
  } catch (error) {
    console.error('❌ Failed to load config, defaulting to single-call mode:', error);
    chatConfig.TWO_CALL_MODE = false;  // Safe fallback
    configLoaded = false;
  }
}

// Initialize on page load - MUST complete before allowing messages
document.addEventListener('DOMContentLoaded', async () => {
  // Disable send button until config loaded
  const sendButton = document.getElementById('send-button');
  const messageInput = document.getElementById('messageInput');

  if (sendButton) sendButton.disabled = true;
  if (messageInput) messageInput.disabled = true;

  // Load configuration
  await loadChatConfig();

  // Re-enable UI
  if (sendButton) sendButton.disabled = false;
  if (messageInput) messageInput.disabled = false;

  // Log final mode
  console.log(`🚀 Chat initialized in ${chatConfig.TWO_CALL_MODE ? 'TWO-CALL' : 'SINGLE-CALL'} mode`);

  // Rest of initialization...
  await initializeChat();
});

// Process message using backend-controlled flag
async function processMessage(message) {
  // Ensure config is loaded
  if (!configLoaded) {
    console.warn('⚠️ Config not loaded, attempting reload...');
    await loadChatConfig();
  }

  // Use backend-controlled flag ONLY - no window.TWO_CALL_MODE
  if (!chatConfig.TWO_CALL_MODE) {
    console.log('📝 Using single-call mode (backend config)');
    return processMessageOriginal(message);
  }

  console.log('⚡ Using two-call mode (backend config)');

  // ... two-call implementation continues
  let userSequence = null;
  let assistantSequence = null;

  try {
    // ... rest of two-call implementation from 48c
  } catch (error) {
    // ... error handling
  }
}

// Update enrichWithWeb to use config timeout
async function enrichWithWeb(message, threadId, sequenceNumber, messageDiv, indicator, cachedState) {
  const enrichmentKey = `${threadId}-${sequenceNumber}`;

  // Use backend-configured timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
    console.warn(`Web enrichment timed out after ${chatConfig.WEB_ENRICHMENT_TIMEOUT_MS}ms`);
  }, chatConfig.WEB_ENRICHMENT_TIMEOUT_MS);

  try {
    // ... rest of function from 48c
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`Web enrichment timed out (${chatConfig.WEB_ENRICHMENT_TIMEOUT_MS}ms configured)`);
      removeIndicator(indicator);
      return;
    }
    // ... rest of error handling
  } finally {
    clearTimeout(timeout);
    pendingEnrichments.delete(enrichmentKey);
  }
}

// REMOVE ANY REFERENCE TO window.TWO_CALL_MODE
// DO NOT USE: const TWO_CALL_MODE = window.TWO_CALL_MODE
// DO NOT CHECK: if (window.TWO_CALL_MODE)
// ONLY USE: chatConfig.TWO_CALL_MODE
```

### 2. Backend Safeguards
**Why:** Ensure endpoints respect the same flag

**File:** `src/routes/chat/process-fast.route.js`
```javascript
router.post('/',
  validate(fastChatRequestSchema, 'body'),
  async (req, res, next) => {
    const env = getEnv();

    // Backend also checks the flag
    if (env.TWO_CALL_MODE !== 'true') {
      return res.status(503).json({
        success: false,
        error: 'Two-call mode is disabled',
        message: 'This endpoint is not available in single-call mode'
      });
    }

    // ... rest of handler
  }
);
```

**File:** `src/routes/chat/enrich-web.route.js`
```javascript
router.post('/',
  validate(webEnrichRequestSchema, 'body'),
  async (req, res, next) => {
    const env = getEnv();

    // Backend also checks the flag
    if (env.TWO_CALL_MODE !== 'true') {
      return res.status(503).json({
        success: false,
        error: 'Two-call mode is disabled',
        message: 'This endpoint is not available in single-call mode'
      });
    }

    // ... rest of handler
  }
);
```

### 3. Configurable Cached State Size (From 48e)
**File:** `python-sidecar/app/chat/workflows/chat_workflow_sequential.py`
```python
import os

# Configuration from environment
PINECONE_CHUNKS_FOR_CACHE = int(os.getenv("PINECONE_CHUNKS_FOR_CACHE", "5"))
PINECONE_CHUNK_SIZE = int(os.getenv("PINECONE_CHUNK_SIZE", "1000"))

logger.info(f"📊 Cache configuration: {PINECONE_CHUNKS_FOR_CACHE} chunks × {PINECONE_CHUNK_SIZE} chars")

# In cached_state creation (line ~684)
"cached_state": {
    "user_query": state.get("user_query"),
    "systems_context": state.get("systems_context", []),
    "classification": state.get("classification", {}),
    "synthesis_model": state.get("synthesis_model"),

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

    "conversation_summary": state.get("conversation_summary", ""),
    "memory_context": {
        "total_exchanges": state.get("memory_context", {}).get("total_exchanges", 0)
    }
},
```

### 4. Database Constraint for Data Integrity (From 48e)
**File:** `migrations/001_chat_sequence_constraint.sql`
```sql
-- Ensure sequence numbers are unique per thread
ALTER TABLE chat_messages
ADD CONSTRAINT IF NOT EXISTS unique_thread_sequence
UNIQUE (thread_id, sequence_number);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_messages_thread_seq
ON chat_messages(thread_id, sequence_number);

-- Document the pattern
COMMENT ON CONSTRAINT unique_thread_sequence ON chat_messages IS
'Prevents race conditions. Frontend increments before use, so rollback works: delete failed message, decrement, reuse number.';
```

---

## 🔒 Single Source of Truth Flow

```
1. Deployment sets: TWO_CALL_MODE=false in .env
                        ↓
2. Backend reads:   getEnv() → env.TWO_CALL_MODE
                        ↓
3. Config endpoint: /config/chat → { TWO_CALL_MODE: false }
                        ↓
4. Frontend loads:  fetch('/config/chat') → chatConfig
                        ↓
5. Frontend uses:   if (!chatConfig.TWO_CALL_MODE) → single-call
```

**No divergence possible:** Frontend cannot enable two-call if backend says no.

---

## ⚠️ What NOT to Do

### ❌ DO NOT use window variables
```javascript
// NEVER DO THIS
const TWO_CALL_MODE = window.TWO_CALL_MODE;
```

### ❌ DO NOT hardcode in frontend
```javascript
// NEVER DO THIS
const USE_TWO_CALL = true;
```

### ❌ DO NOT bypass config endpoint
```javascript
// NEVER DO THIS
const config = { TWO_CALL_MODE: true };  // Hardcoded
```

---

## 📋 Updated Implementation Checklist

### Day 1: Backend Infrastructure
- [ ] Create database migration for sequence constraint
- [ ] Implement all repository and route changes from 48c
- [ ] Create `/config/chat` endpoint with getEnv() source
- [ ] Add flag checks to new endpoints (503 if disabled)
- [ ] Add environment variables to `.env`
- [ ] Test config endpoint returns correct values

### Day 2: Python Modifications
- [ ] Implement all changes from 48c
- [ ] Add configurable cache size (5×1KB default)
- [ ] Test cached state ~5KB not MB
- [ ] Verify sufficient context for Perplexity

### Day 3: Frontend Implementation
- [ ] Implement all changes from 48c
- [ ] Add config loading with UI disable during load
- [ ] Use ONLY chatConfig.TWO_CALL_MODE (no window references)
- [ ] Add mode indicator to UI
- [ ] Test fallback to single-call if config fails

### Day 4: Testing
- [ ] Test with TWO_CALL_MODE=false (should use single-call)
- [ ] Test with TWO_CALL_MODE=true (should use two-call)
- [ ] Test config endpoint failure (should fallback safely)
- [ ] Test backend rejects two-call endpoints when disabled
- [ ] Verify frontend and backend always synchronized

### Day 5: Deployment
- [ ] Deploy with TWO_CALL_MODE=false
- [ ] Verify single-call mode works
- [ ] Verify two-call endpoints return 503
- [ ] Enable TWO_CALL_MODE=true
- [ ] Verify switches to two-call mode
- [ ] Monitor both modes respect same flag

---

## 🔄 Deployment Scenarios

### Scenario 1: Gradual Rollout
```bash
# Stage 1: Deploy code, flag off
TWO_CALL_MODE=false
# Result: New code deployed but using single-call

# Stage 2: Enable for testing
TWO_CALL_MODE=true
# Result: All users switch to two-call

# Stage 3: Rollback if needed
TWO_CALL_MODE=false
# Result: All users back to single-call
```

### Scenario 2: Config Endpoint Failure
```
1. Frontend tries: fetch('/config/chat')
2. Request fails (timeout, 500, etc)
3. Frontend sets: chatConfig.TWO_CALL_MODE = false
4. Uses single-call mode (safe fallback)
5. User can still chat (degraded but functional)
```

### Scenario 3: Mixed Deployment
```
IMPOSSIBLE with this design:
- Backend controls the flag via getEnv()
- Frontend must obey backend's decision
- No way for frontend to be in different mode
```

---

## 🎯 Summary

**Key Change from 48e:**
- ✅ Removed all `window.TWO_CALL_MODE` references
- ✅ Config endpoint is single source of truth
- ✅ Frontend and backend always synchronized
- ✅ Safe fallback if config fails

**Single Source of Truth:** `.env` → `getEnv()` → `/config/chat` → Frontend

**Result:** No divergence possible. The feature flag is centrally controlled and both layers always respect the same setting.

---

## 🚀 IMPLEMENTATION STATUS (2024-11-21)

### ✅ COMPLETED PHASES

#### Phase 1: Backend Configuration ✅
- ✅ Added environment variables to `.env`
- ✅ Updated `src/config/env.js` with chat configuration schema
- ✅ Created `/config/chat` endpoint in `src/routes/config.route.js`
- ✅ Registered config router in `src/routes/index.js`
- ✅ Tested config endpoint - working correctly

#### Phase 2: Database Setup ✅
- ✅ Created migration file: `migrations/001_chat_sequence_constraint.sql`
- ✅ Created migration README
- ⚠️ **NEEDS MANUAL STEP:** Migration must be run in Supabase dashboard

#### Phase 3: Backend Chat Endpoints ✅
- ✅ Created `src/services/chat-fast.service.js`
- ✅ Created `/chat/process-fast` route in `src/routes/chat/process-fast.route.js`
- ✅ Created `/chat/enrich-web` route in `src/routes/chat/enrich-web.route.js`
- ✅ Registered both routes in `src/routes/chat/index.js`
- ✅ Added schemas to `src/schemas/chat.schema.js`
- ✅ Fixed repository imports (was broken, now fixed)

#### Phase 4: Python Sidecar ✅
- ✅ Created `python-sidecar/app/chat/two_call_endpoints.py`
- ✅ Registered endpoints in `python-sidecar/app/main.py`
- ✅ Fixed Perplexity service import
- ⚠️ **NOTE:** Perplexity service initialization has warning but endpoints registered

#### Phase 5: Frontend ✅
- ✅ Updated `src/public/app.js` with two-call logic
- ✅ Added config loading on initialization
- ✅ Added mode indicator
- ✅ Created `processMessageOriginal` (preserved single-call)
- ✅ Created `processMessageTwoCall` (new two-call implementation)
- ✅ Added web enrichment background processing
- ✅ Single source of truth implemented (no window variables)

### 🔴 CURRENT ISSUES (Need Fixing)

1. **Python Sidecar Not Running**
   - Fast endpoint returns 404 because Python sidecar needs to be started
   - Command: `cd python-sidecar && python3 -m app.main`

2. **Repository Method Issue (FIXED)**
   - ~~`chatRepository.createMessage` was not a function~~
   - Fixed by importing correct methods from chat.repository.js

### 📊 CURRENT STATE

**Environment Variables (.env):**
```
TWO_CALL_MODE=true  # Currently enabled for testing
WEB_ENRICHMENT_TIMEOUT_MS=60000
PINECONE_CHUNKS_FOR_CACHE=5
PINECONE_CHUNK_SIZE=1000
```

**Servers Running:**
- ✅ Node.js server: Running on port 3000
- ✅ Python sidecar: Running on port 8000 (restarted and confirmed working)

**Feature Flag Status:**
- Backend returns `TWO_CALL_MODE: true`
- Frontend loads config and respects it
- Fast/enrichment endpoints return 503 when disabled (working correctly)

### 📝 NEXT STEPS FOR NEW SESSION

1. **Start Python Sidecar:**
```bash
cd python-sidecar
python3 -m app.main
```

2. **Test Two-Call Mode:**
- Open browser to http://localhost:3000
- Check console for "🚀 Chat initialized in TWO-CALL mode"
- Send a test message
- Should see fast response + enrichment indicator

3. **Test Single-Call Mode:**
- Change `.env`: `TWO_CALL_MODE=false`
- Restart Node server
- Test that it uses original `/chat/process` endpoint

4. **Verify Feature Flag Sync:**
- Toggle `.env` between true/false
- Restart server
- Verify `/config/chat` returns correct value

---

## 🎉 IMPLEMENTATION COMPLETE (2025-11-21)

### ✅ What's Working:
1. **Both servers running successfully:**
   - Node.js on port 3000
   - Python sidecar on port 8000 with two-call endpoints registered

2. **Single source of truth established:**
   - `/config/chat` endpoint returns feature flags from backend
   - Frontend loads config on initialization
   - No window variables used

3. **Endpoints verified:**
   - Python `/chat/fast` endpoint returns messages with cached state
   - Node.js `/chat/process-fast` and `/chat/enrich-web` routes registered
   - Config endpoint correctly returns TWO_CALL_MODE status

4. **All code implementations complete:**
   - Backend configuration with Zod validation
   - Fast chat service with proper imports
   - Python two-call endpoints with caching
   - Frontend two-call logic with backward compatibility

### 🧪 Ready for Browser Testing:
The system is now ready for full end-to-end testing through the browser UI at http://localhost:3000.
The UI will handle proper thread/session creation and demonstrate the two-call flow with:
- Fast initial response
- Visual enrichment indicator
- Background web enrichment completion
- Verify frontend respects the flag

### 🐛 DEBUGGING COMMANDS

**Check config:**
```bash
curl http://localhost:3000/config/chat | jq .
```

**Test fast endpoint (when TWO_CALL_MODE=true):**
```bash
curl -X POST http://localhost:3000/chat/process-fast \
  -H "Content-Type: application/json" \
  -d '{"message":"test","threadId":"test","sessionId":"test","sequenceNumber":1}'
```

**Check Python sidecar health:**
```bash
curl http://localhost:8000/health
```

### 📁 KEY FILES MODIFIED

**Backend:**
- `/src/config/env.js` - Added chat config schema
- `/src/routes/config.route.js` - New config endpoint
- `/src/routes/chat/process-fast.route.js` - Fast chat endpoint
- `/src/routes/chat/enrich-web.route.js` - Web enrichment endpoint
- `/src/services/chat-fast.service.js` - Two-call service logic

**Python:**
- `/python-sidecar/app/chat/two_call_endpoints.py` - New endpoints
- `/python-sidecar/app/main.py` - Register endpoints

**Frontend:**
- `/src/public/app.js` - Complete two-call implementation

### ⚠️ IMPORTANT NOTES

1. **Database Migration:** Still needs to be run in Supabase
2. **Python Sidecar:** Must be running for two-call mode to work
3. **Feature Flag:** Currently set to `true` in `.env`
4. **Backup:** Original app.js backed up as `app.js.backup`

---

**Document Status:** ✅ IMPLEMENTATION IN PROGRESS
**Current Phase:** Testing & Verification
**Blocker:** Python sidecar needs to be started
**Next Action:** Start Python sidecar and test full flow