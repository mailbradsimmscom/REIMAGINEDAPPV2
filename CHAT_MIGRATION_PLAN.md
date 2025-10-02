# Chat Service Migration Plan: Python LangGraph → Node.js

**Date:** 2025-10-02
**Status:** Pre-implementation Review
**Goal:** Remove unstable LangChain/LangGraph, migrate chat to Node.js, preserve all DIP and search optimization work

---

## Architecture Decision

### KEEP: Python Sidecar (port 8000)
- ✅ Document upload/processing
- ✅ Semantic chunking
- ✅ DIP creation (writes to spec_suggestions, playbook_hints, intent_router, golden_tests)
- ✅ PDF parsing, OCR
- ✅ Pinecone embeddings/storage

### MOVE TO NODE.JS: Chat Processing
- ✅ Chat orchestration (currently in chat-proxy.service.js)
- ✅ DIP retrieval (read from DIP tables during chat)
- ✅ Memory management (use SupabaseMemoryManager)
- ✅ Pinecone semantic search (for document retrieval during chat)
- ✅ OpenAI chat calls (direct API, no LangChain)

### DELETE: Python Chat Service (port 8001)
- ❌ Remove `/python-chat-service/` directory entirely
- ❌ Remove broken LangChain/LangGraph dependencies

---

## Current Dependencies (Already Installed)

```json
{
  "openai": "^5.19.1",                           // ✅ Already installed
  "@pinecone-database/pinecone": "^6.1.2",       // ✅ Already installed
  "@supabase/supabase-js": "2.56.0",             // ✅ Already installed
  "uuid": "^11.1.0"                              // ✅ Already installed
}
```

**NO NEW DEPENDENCIES REQUIRED** - Everything we need is already installed.

---

## Files to Create

### 1. `/Users/brad/code/REIMAGINEDAPPV2/src/services/dip-retriever.service.js`
**Purpose:** Query DIP tables (spec_suggestions, playbook_hints, intent_router, golden_tests)
**Port from:** `python-chat-service/app/chat/services/simple_dip_retriever.py`

**Exports:**
```javascript
export async function searchSpecSuggestions(query, limit = 5)
export async function searchPlaybookHints(query, limit = 5)
export async function searchIntentRouter(query, limit = 5)
export async function searchGoldenTests(query, limit = 5)
export async function searchAllDIPTables(query, limit = 3)
```

**Dependencies:**
- `getSupabaseClient` from `../repositories/supabaseClient.js` (already exists)
- `logger` from `../utils/logger.js` (already exists)

**Implementation:** Simple Supabase `.select()` queries, no complex logic

---

### 2. `/Users/brad/code/REIMAGINEDAPPV2/src/services/pinecone-rag.service.js`
**Purpose:** Semantic search in Pinecone for document chunks during chat
**Replaces:** Python chat service's document retrieval

**Exports:**
```javascript
export async function searchDocuments({ query, equipmentContext, namespace, limit = 5 })
export async function getDocumentChunks({ assetUid, namespace, limit = 10 })
```

**Dependencies:**
- `Pinecone` from `@pinecone-database/pinecone` (already installed)
- `OpenAI` from `openai` (already installed, for embeddings)
- `getEnv` from `../config/env.js` (already exists)
- `logger` from `../utils/logger.js` (already exists)

**Key Details:**
- Embedding model: `text-embedding-ada-002` (1536 dimensions) - from .env OPENAI_API_KEY
- Pinecone index: `reimaginedsv` - from .env PINECONE_INDEX
- Namespace: `REIMAGINEDDOCS` - from .env PINECONE_NAMESPACE
- Uses equipment context for metadata filtering

---

### 3. `/Users/brad/code/REIMAGINEDAPPV2/src/services/chat-completion.service.js`
**Purpose:** Direct OpenAI chat completion with memory management
**Replaces:** Python LangGraph workflow

**Exports:**
```javascript
export async function processChatCompletion({
  query,
  threadId,
  systemsContext = [],
  dipResults = {},
  documentChunks = [],
  conversationSummary = null
})
```

**Dependencies:**
- `OpenAI` from `openai` (already installed)
- `SupabaseMemoryManager` from `./memory.service.js` (already created)
- `getEnv` from `../config/env.js` (already exists)
- `logger` from `../utils/logger.js` (already exists)

**Flow:**
1. Initialize memory manager for thread
2. Get conversation history (with token limits)
3. Build context from systems, DIP, documents
4. Build OpenAI messages array
5. Call OpenAI chat completion
6. Save user message and assistant response to memory
7. Return response

---

## Files to Modify

### 1. `/Users/brad/code/REIMAGINEDAPPV2/src/services/chat-proxy.service.js`

**Current flow (lines 25-299):**
```
1. Get conversation context (✅ KEEP)
2. Get thread equipment context (✅ KEEP)
3. Quick reference check (✅ KEEP)
4. Equipment search/inference (✅ KEEP)
5. Get equipment relationship context (✅ KEEP)
6. Fetch full system details (✅ KEEP)
7. Update equipment context blob (✅ KEEP)
8. 📞 Call Python chat service ← REPLACE THIS
```

**Changes needed:**

**Line 238-246:** REMOVE Python service call
```javascript
// DELETE THIS:
const chatServiceUrl = env.PYTHON_CHAT_SERVICE_URL || 'http://localhost:8001';

requestLogger.info('📞 Calling python chat service with enhanced context', {
  systemsCount: systemsContext.length,
  hasConversationMemory: !!conversationContext.conversation_summary,
  conversationExchanges: conversationContext.total_exchanges,
  hasEquipmentInference: !!equipmentInference,
  chatServiceUrl: `${chatServiceUrl}/v1/chat/process`
});
```

**Line 248-263:** REPLACE fetch with direct service calls
```javascript
// REPLACE WITH:
import { searchAllDIPTables } from './dip-retriever.service.js';
import { searchDocuments } from './pinecone-rag.service.js';
import { processChatCompletion } from './chat-completion.service.js';

// Search DIP tables for domain intelligence
const dipResults = await searchAllDIPTables(query, 3);

requestLogger.info('🔍 DIP search completed', {
  tablesSearched: dipResults.length,
  totalResults: dipResults.reduce((sum, r) => sum + r.count, 0)
});

// Search Pinecone for relevant document chunks
const documentChunks = await searchDocuments({
  query,
  equipmentContext: systemsContext,
  namespace: env.PINECONE_NAMESPACE || 'REIMAGINEDDOCS',
  limit: 5
});

requestLogger.info('📚 Document search completed', {
  chunksFound: documentChunks.length
});

// Process chat completion with all context
const result = await processChatCompletion({
  query,
  threadId,
  systemsContext,
  dipResults,
  documentChunks,
  conversationSummary: conversationContext.conversation_summary
});
```

**Line 265-276:** UPDATE result handling
```javascript
// REPLACE:
if (!sidecarResponse.ok) {
  const errorText = await sidecarResponse.text();
  throw new Error(`Python sidecar error: ${sidecarResponse.status} ${errorText}`);
}

const result = await sidecarResponse.json();

requestLogger.info('✅ Python sidecar response received', {
  hasResponse: !!result.response,
  hasDipResults: !!result.dip_results
});

result.systems_context = systemsContext;

// WITH:
requestLogger.info('✅ Chat completion received', {
  hasResponse: !!result.response,
  messageLength: result.response?.length || 0
});

// Add systems context and DIP results to response
result.systems_context = systemsContext;
result.dip_results = dipResults;
```

**No other changes needed** - All equipment logic, search optimization, and context handling stays the same.

---

### 2. `/Users/brad/code/REIMAGINEDAPPV2/.env`

**NO CHANGES NEEDED** - All required environment variables already exist:
```bash
OPENAI_API_KEY=sk-proj-...                                    # ✅ Already set
OPENAI_MODEL=gpt-5                                            # ✅ Already set
OPENAI_TEMPERATURE=0                                          # ✅ Already set
OPENAI_MAX_TOKENS=8000                                        # ✅ Already set
PINECONE_API_KEY=pcsk_...                                     # ✅ Already set
PINECONE_INDEX=reimaginedsv                                   # ✅ Already set
PINECONE_NAMESPACE=REIMAGINEDDOCS                             # ✅ Already set
SUPABASE_URL=https://eriquneakfcfmeecqyof.supabase.co        # ✅ Already set
SUPABASE_SERVICE_KEY=sb_secret_...                            # ✅ Already set
```

**REMOVE (after migration):**
```bash
# PYTHON_CHAT_SERVICE_URL=http://localhost:8001  # Can be removed
```

---

### 3. `/Users/brad/code/REIMAGINEDAPPV2/src/routes/chat/process.route.js`

**Current:** Uses chat-proxy.service.js (lines ~25-100)

**NO CHANGES NEEDED** - Route already calls `processChatMessage()` from chat-proxy.service.js.
The internal implementation change is transparent to the route.

---

## Files to Delete (After Testing)

### 1. `/Users/brad/code/REIMAGINEDAPPV2/python-chat-service/` (entire directory)
**Contains:**
- `app/chat/workflows/chat_workflow.py` - LangGraph workflow
- `app/chat/services/memory_manager.py` - Broken LangChain memory
- `app/chat/services/simple_dip_retriever.py` - Being replaced
- `docker-compose.yml` - Chat service container config
- `requirements.txt` - LangChain dependencies

**DELETE COMMAND:**
```bash
rm -rf /Users/brad/code/REIMAGINEDAPPV2/python-chat-service
```

---

## Database Changes

**NO DATABASE CHANGES REQUIRED**

All Supabase tables and functions already exist:
- ✅ `chat_threads` - thread management
- ✅ `chat_messages` - message storage
- ✅ `spec_suggestions` - DIP table
- ✅ `playbook_hints` - DIP table
- ✅ `intent_router` - DIP table
- ✅ `golden_tests` - DIP table
- ✅ `increment_thread_message_count(uuid)` - DB function (already created)

---

## Testing Plan

### Test 1: DIP Retrieval
```bash
# Start Node server
npm run dev

# Test DIP service directly in Node REPL or via test script
curl -X POST http://localhost:3000/api/chat/process \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d0bf5af4f2e469d29e051e39e9569a76a283ad4d5c68935e38321320137b05d0" \
  -d '{
    "query": "troubleshooting anchor windlass",
    "threadId": "00000000-0000-0000-0000-000000000001"
  }'

# Expected: Should return DIP results from spec_suggestions, playbook_hints, etc.
```

### Test 2: Equipment Context + Memory
```bash
curl -X POST http://localhost:3000/api/chat/process \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d0bf5af4f2e469d29e051e39e9569a76a283ad4d5c68935e38321320137b05d0" \
  -d '{
    "query": "tell me about my DST810",
    "threadId": "00000000-0000-0000-0000-000000000002"
  }'

# Expected:
# - Equipment search finds DST810
# - Memory manager creates/loads thread
# - Chat completion returns answer about DST810
# - Message saved to chat_messages
```

### Test 3: Conversation Continuity
```bash
# First message
curl -X POST http://localhost:3000/api/chat/process \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d0bf5af4f2e469d29e051e39e9569a76a283ad4d5c68935e38321320137b05d0" \
  -d '{
    "query": "what is the pressure rating for my fortress anchor",
    "threadId": "test-thread-001"
  }'

# Second message (should remember previous context)
curl -X POST http://localhost:3000/api/chat/process \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer d0bf5af4f2e469d29e051e39e9569a76a283ad4d5c68935e38321320137b05d0" \
  -d '{
    "query": "how do I install it",
    "threadId": "test-thread-001"
  }'

# Expected:
# - Second query should resolve "it" to fortress anchor
# - Memory manager loads previous messages
# - Equipment context preserved from first query
```

### Test 4: Document Upload (Verify No Regression)
```bash
# Upload a PDF via UI
# Expected:
# - Python sidecar (port 8000) processes document
# - Semantic chunking works
# - Pinecone embeddings created
# - NO ERRORS from missing chat service
```

---

## Rollback Plan

If migration causes issues:

### Quick Rollback (Restore Python Chat Service)
```bash
# Restore chat-proxy.service.js from git
git checkout src/services/chat-proxy.service.js

# Restart Python chat service
cd /Users/brad/code/REIMAGINEDAPPV2/python-chat-service
docker-compose up -d

# Restart Node server
npm run dev
```

### Verify Backup Before Migration
```bash
# Create backup branch
git checkout -b backup-before-chat-migration
git add .
git commit -m "Backup before chat migration to Node.js"
git checkout Stable-v3-Post-Clean-Up
```

---

## Migration Steps (Execute in Order)

### Step 1: Create New Services (No Risk)
1. Create `src/services/dip-retriever.service.js`
2. Create `src/services/pinecone-rag.service.js`
3. Create `src/services/chat-completion.service.js`

**Risk:** None - New files don't affect existing functionality

---

### Step 2: Update chat-proxy.service.js (Medium Risk)
1. Add imports for new services
2. Replace Python service call (lines 238-276)
3. Update error handling

**Risk:** Medium - Chat will break if services have bugs
**Mitigation:** Test each service independently first

---

### Step 3: Test End-to-End (Critical)
1. Run Test 1: DIP Retrieval
2. Run Test 2: Equipment Context + Memory
3. Run Test 3: Conversation Continuity
4. Run Test 4: Document Upload (verify no regression)

**Success Criteria:**
- ✅ All 4 tests pass
- ✅ No errors in Node logs
- ✅ Messages saved to chat_messages table
- ✅ Equipment context preserved
- ✅ Document upload still works

---

### Step 4: Delete Python Chat Service (Low Risk)
1. Stop Python chat service container
2. Delete `/python-chat-service/` directory
3. Remove `PYTHON_CHAT_SERVICE_URL` from .env (optional)

**Risk:** Low - Only after confirming all tests pass

---

## Risk Assessment

### HIGH RISK Items
1. ❌ **None** - All dependencies already installed, no database changes

### MEDIUM RISK Items
1. ⚠️ **Pinecone Integration** - Need correct embedding model (text-embedding-ada-002)
2. ⚠️ **Memory Management** - SupabaseMemoryManager already tested, should work
3. ⚠️ **Context Handling** - Need to preserve equipment context, DIP results in response

### LOW RISK Items
1. ✅ **DIP Retrieval** - Simple Supabase queries, no complex logic
2. ✅ **OpenAI Chat** - Direct API call, well-documented
3. ✅ **Equipment Logic** - Not changing, stays in chat-proxy.service.js

---

## Regression Prevention

### What MUST NOT Break
1. ✅ Equipment search and inference (chat-proxy.service.js lines 62-119)
2. ✅ Equipment relationship tracking (chat-proxy.service.js lines 122-236)
3. ✅ Conversation context weighting (conversation-context.service.js)
4. ✅ Document upload and processing (Python sidecar port 8000)
5. ✅ DIP table creation (Python sidecar port 8000)
6. ✅ Semantic chunking (Python sidecar port 8000)

### What Changes
1. 🔄 Chat completion (Python LangGraph → Node.js OpenAI)
2. 🔄 Memory management (LangChain → SupabaseMemoryManager)
3. 🔄 DIP retrieval (Python → Node.js Supabase queries)
4. 🔄 Document search (Python → Node.js Pinecone)

---

## Code Samples

### DIP Retriever Service (Preview)
```javascript
// src/services/dip-retriever.service.js
import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { logger } from '../utils/logger.js';

export async function searchAllDIPTables(query, limit = 3) {
  const requestLogger = logger.createRequestLogger();
  const results = [];

  try {
    const supabase = await getSupabaseClient();

    // Search spec_suggestions
    const { data: specResults } = await supabase
      .from('spec_suggestions')
      .select('*')
      .limit(limit);

    if (specResults?.length > 0) {
      results.push({
        table: 'spec_suggestions',
        count: specResults.length,
        results: specResults
      });
    }

    // Search playbook_hints
    const { data: playbookResults } = await supabase
      .from('playbook_hints')
      .select('*')
      .limit(limit);

    if (playbookResults?.length > 0) {
      results.push({
        table: 'playbook_hints',
        count: playbookResults.length,
        results: playbookResults
      });
    }

    // ... (similar for intent_router, golden_tests)

    requestLogger.info('DIP tables searched', {
      tablesSearched: results.length,
      totalResults: results.reduce((sum, r) => sum + r.count, 0)
    });

    return results;
  } catch (error) {
    requestLogger.error('DIP search failed', { error: error.message });
    return [];
  }
}
```

### Pinecone RAG Service (Preview)
```javascript
// src/services/pinecone-rag.service.js
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

let pineconeClient = null;
let openaiClient = null;

async function getPineconeClient() {
  if (!pineconeClient) {
    const env = getEnv();
    pineconeClient = new Pinecone({
      apiKey: env.PINECONE_API_KEY
    });
  }
  return pineconeClient;
}

async function getOpenAIClient() {
  if (!openaiClient) {
    const env = getEnv();
    openaiClient = new OpenAI({
      apiKey: env.OPENAI_API_KEY
    });
  }
  return openaiClient;
}

export async function searchDocuments({ query, equipmentContext = [], namespace, limit = 5 }) {
  const requestLogger = logger.createRequestLogger();
  const env = getEnv();

  try {
    const openai = await getOpenAIClient();
    const pinecone = await getPineconeClient();

    // Generate embedding for query
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: query
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    // Build metadata filter from equipment context
    const filter = {};
    if (equipmentContext.length > 0) {
      const assetUids = equipmentContext.map(eq => eq.asset_uid);
      filter.asset_uid = { $in: assetUids };
    }

    // Query Pinecone
    const index = pinecone.index(env.PINECONE_INDEX);
    const queryResponse = await index.namespace(namespace).query({
      vector: queryEmbedding,
      topK: limit,
      includeMetadata: true,
      filter: Object.keys(filter).length > 0 ? filter : undefined
    });

    const chunks = queryResponse.matches.map(match => ({
      id: match.id,
      score: match.score,
      content: match.metadata?.text || '',
      metadata: match.metadata || {}
    }));

    requestLogger.info('Pinecone search completed', {
      query: query.substring(0, 100),
      chunksFound: chunks.length,
      avgScore: chunks.length > 0
        ? (chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length).toFixed(3)
        : 0
    });

    return chunks;
  } catch (error) {
    requestLogger.error('Pinecone search failed', { error: error.message });
    return [];
  }
}
```

### Chat Completion Service (Preview)
```javascript
// src/services/chat-completion.service.js
import OpenAI from 'openai';
import { SupabaseMemoryManager } from './memory.service.js';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

let openaiClient = null;

async function getOpenAIClient() {
  if (!openaiClient) {
    const env = getEnv();
    openaiClient = new OpenAI({
      apiKey: env.OPENAI_API_KEY
    });
  }
  return openaiClient;
}

export async function processChatCompletion({
  query,
  threadId,
  systemsContext = [],
  dipResults = {},
  documentChunks = [],
  conversationSummary = null
}) {
  const requestLogger = logger.createRequestLogger();
  const env = getEnv();

  try {
    // Initialize memory manager
    const memory = new SupabaseMemoryManager(threadId);

    // Get conversation history
    const conversationHistory = await memory.getMessages(10, 4000);

    // Build system prompt with context
    const systemPrompt = buildSystemPrompt({
      systemsContext,
      dipResults,
      documentChunks,
      conversationSummary
    });

    // Build messages array
    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history
    conversationHistory.forEach(msg => {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    });

    // Add current user query
    messages.push({
      role: 'user',
      content: query
    });

    // Call OpenAI
    const openai = await getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: env.OPENAI_MODEL || 'gpt-4',
      messages: messages,
      temperature: parseFloat(env.OPENAI_TEMPERATURE || '0'),
      max_tokens: parseInt(env.OPENAI_MAX_TOKENS || '8000')
    });

    const response = completion.choices[0].message.content;

    // Save user message and assistant response to memory
    await memory.addMessage('user', query);
    await memory.addMessage('assistant', response);

    requestLogger.info('Chat completion completed', {
      threadId,
      messageLength: response.length,
      tokensUsed: completion.usage.total_tokens
    });

    return {
      response,
      usage: completion.usage
    };
  } catch (error) {
    requestLogger.error('Chat completion failed', { error: error.message });
    throw error;
  }
}

function buildSystemPrompt({ systemsContext, dipResults, documentChunks, conversationSummary }) {
  let prompt = `You are a helpful marine equipment assistant. Answer questions accurately based on the provided context.\n\n`;

  if (conversationSummary) {
    prompt += `Conversation Summary:\n${conversationSummary}\n\n`;
  }

  if (systemsContext.length > 0) {
    prompt += `Equipment Context:\n`;
    systemsContext.forEach(system => {
      prompt += `- ${system.manufacturer} ${system.model}: ${system.description}\n`;
    });
    prompt += `\n`;
  }

  if (documentChunks.length > 0) {
    prompt += `Relevant Documentation:\n`;
    documentChunks.forEach((chunk, i) => {
      prompt += `[${i + 1}] ${chunk.content.substring(0, 500)}\n`;
    });
    prompt += `\n`;
  }

  if (dipResults.length > 0) {
    prompt += `Domain Intelligence:\n`;
    dipResults.forEach(table => {
      prompt += `${table.table}: ${table.count} results\n`;
    });
    prompt += `\n`;
  }

  return prompt;
}
```

---

## Approval Checklist

Before proceeding, confirm:

- [ ] I understand this removes Python chat service (port 8001) entirely
- [ ] I understand Python sidecar (port 8000) stays for document processing
- [ ] I understand all dependencies are already installed (no npm install needed)
- [ ] I understand no database changes are required
- [ ] I understand the rollback plan if something breaks
- [ ] I'm ready to review the actual code for each service before it's created
- [ ] I want to proceed with creating the services one at a time for review

---

## Next Steps

After approval:
1. Create `dip-retriever.service.js` and share code for review
2. Create `pinecone-rag.service.js` and share code for review
3. Create `chat-completion.service.js` and share code for review
4. Update `chat-proxy.service.js` and share diff for review
5. Run tests
6. Delete python-chat-service if all tests pass
