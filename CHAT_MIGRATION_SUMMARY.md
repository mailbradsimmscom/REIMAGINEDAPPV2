# Chat Migration Summary: Python to Node.js

## Overview

This document summarizes the migration of chat processing functionality from the Python sidecar service to Node.js, issues encountered, and remaining work.

### What Was Migrated
- Chat message processing logic
- Equipment context retrieval and enrichment
- DIP table search integration
- Pinecone document search integration
- OpenAI chat completion orchestration
- Conversation history management

### Migration Status
- ✅ Core chat processing flow implemented in Node.js
- ✅ Equipment context enrichment working
- ✅ Query normalization matching old behavior
- 🔄 End-to-end testing in progress
- ⏳ Conversation history ordering fix pending

---

## Old Code Chain (Python/chat-proxy.service.js)

### File: `/Users/brad/code/REIMAGINEDAPPV2/src/services/chat-proxy.service.js`

**Step-by-step flow:**

1. **Extract Keywords** (lines 63-78)
   - Function: `extractKeywords(query)`
   - Remove stop words: 'tell', 'me', 'about', 'my', 'the', 'a', etc.
   - Filter words longer than 2 characters
   - Returns cleaned search query

2. **Search Systems Table** (line 106)
   ```javascript
   currentEquipmentSearch = await searchSystems(searchQuery, { limit: 10 });
   ```
   - Calls RPC function `search_systems(q, top_n)`
   - Returns only: `{asset_uid, rank}` (2 columns)

3. **Build Systems Context** (lines 144-206)
   - Loop through each RPC result
   - **For each equipment:**
     - Call `getSystemSvc(equipment.asset_uid)` to get full details
     - Extract fields:
       - `manufacturer_norm` (fallback to `manufacturer`)
       - `model_norm` (fallback to `model`)
       - `description`
       - `synonyms_fts`
       - `synonyms_human`
       - `rank` (from RPC result)
   - **On error:** Use fallback "Unknown" values
   - Build enriched `systemsContext` array

4. **Search DIP Tables** (line 283)
   ```javascript
   const dipResults = await searchAllDIPTables(searchQuery, 3);
   ```

5. **Search Pinecone** (lines 311-315)
   ```javascript
   const documentChunks = await searchDocuments({
     query: searchQuery,
     equipmentContext: systemsContext,
     limit: 5
   });
   ```

6. **Forward to Python** (lines 366-374)
   - Send to Python sidecar `/v1/chat/process`
   - Include: query, threadId, systemsContext, dipResults, documentChunks
   - Python handles LangGraph workflow and OpenAI completion

---

## New Code Chain (Node.js/process.route.js)

### File: `/Users/brad/code/REIMAGINEDAPPV2/src/routes/chat/process.route.js`

**Step-by-step flow:**

1. **Normalize Query** (line 109)
   ```javascript
   const normalizedMessage = normalizeQuery(message);
   ```
   - Function in `query-normalizer.js`
   - **Step 1:** Remove prefix patterns (e.g., "tell me about")
   - **Step 2:** Remove stop words and filter short words
   - Returns cleaned search query (matches old `extractKeywords()`)

2. **Search Systems Table** (line 113)
   ```javascript
   const searchResults = await searchSystems(normalizedMessage || message);
   ```
   - Calls same RPC function `search_systems(q, top_n)`
   - Returns only: `{asset_uid, rank}` (2 columns)

3. **Enrich Equipment Context** (lines 28-68, called at line 120)
   ```javascript
   async function enrichSystemsContext(searchResults) {
     const systemsContext = [];

     for (const equipment of searchResults) {
       try {
         const fullSystem = await getSystemSvc(equipment.asset_uid);

         systemsContext.push({
           asset_uid: fullSystem.asset_uid,
           manufacturer: fullSystem.manufacturer_norm || fullSystem.manufacturer,
           model: fullSystem.model_norm || fullSystem.model,
           description: fullSystem.description,
           synonyms_fts: fullSystem.synonyms_fts,
           synonyms_human: fullSystem.synonyms_human,
           rank: equipment.rank || 1.0
         });
       } catch (error) {
         // Fallback to Unknown
         systemsContext.push({
           asset_uid: equipment.asset_uid,
           manufacturer: 'Unknown',
           model: 'Unknown',
           description: 'Equipment details unavailable',
           rank: equipment.rank || 0.5
         });
       }
     }

     return systemsContext;
   }
   ```
   - **Same pattern as old code:** RPC → loop → fetch full details

4. **Store Equipment Context** (lines 129-146)
   ```javascript
   await updateChatThread(threadId, {
     equipment_context: systemsContext
   });
   ```
   - Saves enriched equipment data to thread table JSON field

5. **Search DIP Tables** (line 150)
   ```javascript
   const dipResults = await searchAllDIPTables(normalizedMessage || message, 3);
   ```

6. **Search Pinecone** (lines 160-164)
   ```javascript
   const documentChunks = await searchDocuments({
     query: normalizedMessage || message,
     equipmentContext: systemsContext,
     limit: 5
   });
   ```

7. **Process Chat Completion (Node.js)** (lines 174-180)
   ```javascript
   const { response, usage } = await processChatCompletion({
     query: normalizedMessage || message,
     threadId,
     systemsContext,
     dipResults,
     documentChunks
   });
   ```
   - **NEW:** Handled directly in Node.js
   - No longer forwarded to Python
   - Service file: `/Users/brad/code/REIMAGINEDAPPV2/src/services/chat-completion.service.js`

8. **Build System Prompt** (chat-completion.service.js lines 41-104)
   ```javascript
   function buildSystemPrompt(systemsContext, dipResults, documentChunks) {
     let prompt = `You are a helpful marine equipment assistant...`;

     // Add equipment context
     if (systemsContext.length > 0) {
       prompt += `## Equipment Context\n`;
       systemsContext.forEach((system, idx) => {
         const manufacturer = system.manufacturer_norm || system.manufacturer || 'Unknown';
         const model = system.model_norm || system.model || 'Unknown';
         prompt += `${idx + 1}. **${manufacturer} ${model}**\n`;
         if (system.description) {
           prompt += `   ${system.description}\n`;
         }
       });
     }

     // Add DIP results
     // Add document chunks

     return prompt;
   }
   ```

9. **Get Conversation History** (chat-completion.service.js line 118)
   ```javascript
   const memoryManager = new MemoryManager(threadId);
   const conversationHistory = await memoryManager.getConversationHistory(10);
   ```
   - **ISSUE:** memory.service.js:74 orders by `created_at`
   - **Should order by:** `sequence_number`

10. **Call OpenAI** (chat-completion.service.js lines 120-136)
    ```javascript
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: query }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });
    ```

11. **Save Messages** (chat-completion.service.js lines 141-155)
    - Save user message
    - Save assistant message
    - **Trigger QA summarization** for even sequence numbers

12. **Return Response** (process.route.js lines 184-232)
    - Build envelope with response, sources, telemetry
    - Log performance metrics
    - Return to client

---

## Issues Encountered and Fixes

### Issue 1: Equipment Context Showing "undefined undefined"
**When:** After initial migration
**Symptom:** OpenAI system prompt showed "1. **undefined undefined**" instead of manufacturer/model
**Root Cause:** `buildSystemPrompt()` was accessing `system.manufacturer` and `system.model` but data structure had `manufacturer_norm` and `model_norm`
**Fix:** Updated chat-completion.service.js:53-54 with fallback pattern:
```javascript
const manufacturer = system.manufacturer_norm || system.manufacturer || 'Unknown';
const model = system.model_norm || system.model || 'Unknown';
```
**File:** `/Users/brad/code/REIMAGINEDAPPV2/src/services/chat-completion.service.js`

### Issue 2: Query Normalization Not Matching Old Behavior
**When:** Testing with "tell me about my DST810"
**Symptom:** Old code passed "DST810" to RPC, new code passed "my DST810"
**Root Cause:** `normalizeQuery()` only removed prefix patterns, didn't remove stop words like old `extractKeywords()` did
**Fix:** Updated query-normalizer.js to add stop word removal:
```javascript
const STOP_WORDS = new Set(['tell', 'me', 'about', 'my', 'the', 'a', ...]);

const words = q.toLowerCase()
  .replace(/[^\w\s-]/g, ' ')
  .split(/\s+/)
  .filter(word => word.length > 2 && !STOP_WORDS.has(word));

return words.join(' ').trim();
```
**File:** `/Users/brad/code/REIMAGINEDAPPV2/src/services/query-normalizer.js`

### Issue 3: Equipment Still Showing "Unknown Unknown" After Fixes
**When:** After applying fixes and restarting server
**Symptom:** Equipment context still showed "Unknown Unknown" in OpenAI prompts
**Root Cause:** **RPC function `search_systems` only returns `asset_uid` and `rank` columns** - doesn't return manufacturer_norm, model_norm, description, or other fields
**Discovery:**
- Ran SQL: `SELECT * FROM search_systems('dst810', 10);`
- Result: Only 2 columns returned (asset_uid, rank)
- Old code did two-step process: RPC search → fetch full details
**Fix:**
1. Created `enrichSystemsContext()` function in process.route.js (lines 28-68)
2. Added import for `getSystemSvc`
3. Updated flow to fetch full equipment details after RPC search
4. Added code to save enriched context to thread.equipment_context
**Files:**
- `/Users/brad/code/REIMAGINEDAPPV2/src/routes/chat/process.route.js`
- Reference: `/Users/brad/code/REIMAGINEDAPPV2/src/services/chat-proxy.service.js` (lines 144-206)

### Issue 4: Test Script Not Working
**When:** Attempting to test searchSystems() in isolation
**Symptom:** "Supabase not configured" error
**Root Cause:** .env file not loading properly in standalone script
**Attempted Fix:** Added `import 'dotenv/config'` - still failed
**Resolution:** Abandoned approach, used direct SQL queries instead
**Files:** `/Users/brad/code/REIMAGINEDAPPV2/test-search-systems.js`, `test-rpc.sql`, `test-direct-query.sql`

---

## To-Do List

### ✅ Completed Tasks
1. **Switch process.route.js to use Node.js implementation**
   - Replaced Python sidecar call with direct Node.js chat-completion.service.js
   - File: `/Users/brad/code/REIMAGINEDAPPV2/src/routes/chat/process.route.js`

2. **Fix equipment context field names**
   - Added fallback pattern for manufacturer_norm/model_norm vs manufacturer/model
   - File: `/Users/brad/code/REIMAGINEDAPPV2/src/services/chat-completion.service.js:53-54`

3. **Add equipment enrichment function**
   - Created enrichSystemsContext() to fetch full details after RPC search
   - Matches old code pattern: RPC → loop → getSystemSvc()
   - File: `/Users/brad/code/REIMAGINEDAPPV2/src/routes/chat/process.route.js:28-68`

4. **Store enriched equipment context**
   - Save to thread.equipment_context JSON field
   - File: `/Users/brad/code/REIMAGINEDAPPV2/src/routes/chat/process.route.js:129-146`

### 🔄 In Progress
5. **Test chat flow end-to-end with Node.js implementation**
   - Verify equipment context displays correctly
   - Test query normalization with various inputs
   - Validate DIP and Pinecone integration
   - Check conversation history retrieval

### ⏳ Pending Tasks
6. **Fix conversation history ordering**
   - **Current:** memory.service.js:74 orders by `created_at`
   - **Should be:** Order by `sequence_number`
   - **Why:** QA summarization depends on sequence numbers (even numbers trigger summarization)
   - **File:** `/Users/brad/code/REIMAGINEDAPPV2/src/services/memory.service.js:74`
   - **Change:**
     ```javascript
     // Current (wrong):
     .order('created_at', { ascending: false })

     // Should be:
     .order('sequence_number', { ascending: false })
     ```

---

## Technical Architecture

### Equipment Context Flow
1. **RPC Search** (`search_systems(q, top_n)`)
   - Returns minimal data: `{asset_uid, rank}`
   - Searches: manufacturer_norm, model_norm, description, category

2. **Enrichment** (loop + `getSystemSvc(asset_uid)`)
   - Fetch full equipment details for each RPC result
   - Extract all needed fields: manufacturer_norm, model_norm, description, synonyms
   - Handle errors with fallback "Unknown" values

3. **Storage** (thread.equipment_context)
   - Save enriched context as JSON in thread table
   - Allows UI to access equipment context without re-querying

### Query Normalization Pattern
1. **Remove Prefix Patterns** (regex-based)
   - "tell me about" → ""
   - "what is" → ""
   - "show me" → ""

2. **Remove Stop Words** (filter-based)
   - Common words: my, the, a, an, is, are, what, how, etc.
   - Short words: length <= 2
   - Returns cleaned query for RPC search

### Conversation History Management
- **Storage:** chat_messages table
- **Fields:** sequence_number, created_at, role, content, processing_metadata
- **QA Summarization:**
  - Triggered on even sequence numbers (2, 4, 6, 8...)
  - Function: `checkAndGenerateQASummary()` in thread-summary.service.js:395-432
  - Stores summary in processing_metadata.qa_summary
  - **Issue:** Retrieval orders by created_at instead of sequence_number

### Service Layer Architecture
```
routes/chat/process.route.js
  ↓
services/query-normalizer.js (normalize query)
  ↓
repositories/systems.repository.js (searchSystems RPC)
  ↓
services/systems.service.js (getSystemSvc for enrichment)
  ↓
services/dip-retriever.service.js (searchAllDIPTables)
  ↓
services/pinecone-rag.service.js (searchDocuments)
  ↓
services/chat-completion.service.js
  ├── services/memory.service.js (conversation history)
  ├── OpenAI API (chat completion)
  └── repositories/chat.repository.js (save messages)
```

---

## Key Takeaways

1. **RPC Design Limitation:** The `search_systems` RPC only returns asset_uid and rank, requiring follow-up queries for full equipment data. This two-step pattern must be preserved.

2. **Query Normalization Critical:** Stop word removal significantly impacts search quality. Old and new implementations must match exactly.

3. **Field Name Consistency:** Equipment data has both normalized (`manufacturer_norm`) and original (`manufacturer`) fields. Always use fallback pattern.

4. **Sequence Number Ordering:** Conversation history must be ordered by sequence_number (not created_at) because QA summarization logic depends on even sequence numbers.

5. **Error Handling:** Equipment enrichment should gracefully fallback to "Unknown" values when getSystemSvc() fails, ensuring UI doesn't break.

---

## Files Modified

### Core Implementation
- `/Users/brad/code/REIMAGINEDAPPV2/src/routes/chat/process.route.js` - Main chat processing route
- `/Users/brad/code/REIMAGINEDAPPV2/src/services/chat-completion.service.js` - OpenAI orchestration
- `/Users/brad/code/REIMAGINEDAPPV2/src/services/query-normalizer.js` - Query preprocessing

### Reference Files
- `/Users/brad/code/REIMAGINEDAPPV2/src/services/chat-proxy.service.js` - Old working implementation
- `/Users/brad/code/REIMAGINEDAPPV2/src/services/thread-summary.service.js` - QA summarization logic
- `/Users/brad/code/REIMAGINEDAPPV2/src/services/memory.service.js` - Conversation history (needs fix)

### Test Files
- `/Users/brad/code/REIMAGINEDAPPV2/test-rpc.sql` - RPC column verification
- `/Users/brad/code/REIMAGINEDAPPV2/test-direct-query.sql` - Direct system table query
- `/Users/brad/code/REIMAGINEDAPPV2/test-search-systems.js` - Standalone test (failed)
