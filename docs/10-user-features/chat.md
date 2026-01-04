# AI Chat

## Overview

The AI Chat system is the primary way users interact with BoatOS. Users ask questions about their boat's equipment, maintenance procedures, and troubleshooting - and the system responds with contextually relevant answers pulled from uploaded technical manuals and documentation.

**Who uses it:** Boat owners, technicians, crew members
**Access points:** Mobile (`/public/index-mobile.html`), Desktop (`/public/index.html`)

## User Flow

1. **User opens chat** - Mobile or desktop interface loads
2. **User types question** - e.g., "How do I change the oil filter on the Yanmar engine?"
3. **System processes** - Node.js receives request, extracts equipment context, calls Python sidecar
4. **AI responds** - Response includes answer + sources from relevant documentation
5. **Conversation continues** - Thread maintains context for follow-up questions

### What the User Sees

- Chat input box at bottom
- Messages displayed in conversation thread
- Sources shown with each AI response (which manuals were referenced)
- Thread history in sidebar (desktop) or menu (mobile)

## Key Concepts

| Term | Definition |
|------|------------|
| **Session** | A container for multiple threads (rarely used in UI) |
| **Thread** | A conversation - has its own context and history |
| **Message** | Single user or assistant message within a thread |
| **Equipment Context** | Equipment mentioned in conversation, persisted on thread |
| **Conversation Context** | Recent message history used for continuity |

### Thread vs Session

- **Thread** is what users interact with - one conversation
- **Session** groups threads but is mostly an internal concept
- Most UI work happens at the thread level

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │     │   Node.js       │     │  Python Sidecar │
│   (Browser)     │────▶│   Backend       │────▶│  (FastAPI)      │
│                 │     │                 │     │                 │
│ index.html      │     │ chat-proxy      │     │ chat_workflow   │
│ app.js          │     │ .service.js     │     │ _sequential.py  │
└─────────────────┘     └────────┬────────┘     └────────┬────────┘
                                 │                       │
                                 ▼                       ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │   Supabase      │     │   Pinecone      │
                        │   (PostgreSQL)  │     │   (Vectors)     │
                        │                 │     │                 │
                        │ chat_threads    │     │ Document chunks │
                        │ chat_messages   │     │ with embeddings │
                        └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
                                                ┌─────────────────┐
                                                │   OpenAI        │
                                                │   (GPT-4)       │
                                                └─────────────────┘
```

### Data Flow (Non-Streaming) - Detailed Steps

This is the exact sequence. Each step matters for understanding where bugs can occur.

#### Frontend → Route
1. **User submits message** in chat UI
2. **Frontend POST** to `/chat/process` with `{ message, threadId? }`
3. **Route validates** request body (Zod schema)
4. **Route calls** `processChatMessage()` in chat-proxy.service.js

#### Node.js Step 1: Thread & Conversation Context
5. **Normalize threadId** - if empty/missing, generate new UUID
6. **Get conversation context** from Supabase via `getWeightedConversationContext()`
   - Fetches recent messages for this thread
   - Builds conversation summary if thread has history
   - Returns `accumulated_equipment` from past messages
7. **Get thread data** from `chat_threads` table
   - Retrieves `equipment_context` blob (persisted equipment from prior messages)
   - This blob is the source of truth for "what equipment are we talking about"

#### Node.js Step 2: Equipment Reference Check
8. **Quick reference check** - analyze query for equipment references
   - Does query mention "it", "the engine", "this pump"? (likely reference to prior equipment)
   - Does query mention specific model numbers? (new equipment)
   - Decision: use inference (follow-up) vs extraction (new topic)

#### Node.js Step 3: Equipment Search (Two Paths)

> **Parallelization (Dec 2024):** Keyword searches and LLM extraction now run in parallel via `Promise.all()`, reducing this step from ~10s to ~2-3s.

**Path A: Inference Mode** (follow-up question about known equipment)
9. **Extract keywords** from query
10. **Search all keywords in parallel** against `systems` table (up to 5 keywords, 5 results each, via `Promise.all()`)
11. **LLM extraction starts in parallel** with keyword searches (result awaited later if needed)
12. **Call LLM inference** to understand equipment relationships
    - Input: query + keyword results + existing equipment context
    - Output: which equipment from context applies to this query
13. **If inference returns nothing but context exists** → use existing context
14. **If inference returns nothing and no context** → await LLM extraction as fallback

**Path B: Extraction Mode** (new equipment mentioned)
9. **Extract keywords** from query
10. **Search all keywords in parallel** against `systems` table (via `Promise.all()`)
11. **Await LLM extraction** (already started in parallel with keywords)
    - Input: user query
    - Output: array of `{ name, confidence, role }` for each equipment mentioned
12. **Search systems table** for each extracted equipment name
13. **Merge and deduplicate** keyword results + LLM search results
    - Track source: 'keyword' vs 'llm'
    - Deduplicate by `asset_uid`
    - Accumulate scores when same equipment found via multiple keywords

#### Node.js Step 3b: Equipment Not in Inventory (Creates User Task)
14. **If LLM extracted equipment but systems search found nothing**:
    - **Create user_task** for each extracted equipment item (non-blocking)
      - `description`: "Add [equipment name] to systems inventory"
      - `due_date`: NOW (immediately due)
      - `created_by`: 'chat_suggestion'
    - Check for duplicates first via `hasExistingTask()` - skip if task already exists
    - **Continue to Python** with empty `systems_context`
    - Python uses Perplexity for general knowledge about the equipment
    - This is NOT an error - user gets helpful response + task reminder

#### Node.js Step 4: Build Equipment Context
15. **Call `getEquipmentRelationshipContext()`**
    - Combines current search results with conversation history
    - Returns unified equipment list with relationship metadata

#### Node.js Step 5: Fetch Full System Details
16. **For each equipment in context** (up to 20):
    - Check if already in `equipment_context` blob → use cached
    - Otherwise fetch from `systems` table via `getSystemSvc()`
    - Build `systemsContext` array with full details

#### Node.js Step 6: Persist Equipment Context
17. **Update `chat_threads.equipment_context`** with current systemsContext
    - This persists equipment for future messages in this thread
    - Includes `llm_confidence`, `llm_role`, `source` metadata

#### Node.js Step 7: Call Python Sidecar
18. **Build request payload**:
    ```javascript
    {
      query,                    // User's message
      systemsContext,           // Equipment with full details
      threadId,                 // For Python to track
      conversationSummary,      // From step 6
      memoryContext: {
        accumulated_equipment,  // Historical equipment
        total_exchanges,        // Message count
        equipment_inference     // If inference was used
      }
    }
    ```
19. **POST to Python sidecar** `/chat/process`

#### Python Sidecar Steps (chat_workflow_sequential.py)
20. **Classify query** - what type of question is this?
    - maintenance, troubleshooting, specs, general, etc.
21. **Search Pinecone** for relevant document chunks
    - Uses equipment context to filter/boost results
    - Returns chunks with relevance scores
22. **Build prompt** with:
    - System prompt (marine expert persona)
    - Equipment context
    - Relevant document chunks
    - Conversation history/summary
    - User query
23. **Call OpenAI** (GPT-4) for completion
24. **Extract sources** from chunks used
25. **Build response** with timing metrics
26. **Return to Node.js**:
    ```javascript
    {
      response,           // AI answer text
      sources,            // Document sources used
      classification,     // Query type
      processing_time_ms, // Python timing
      detailed_metrics    // Step-by-step Python timing
    }
    ```

#### Node.js Response
27. **Build final result** combining:
    - Python response
    - systemsContext (equipment)
    - node_timing (step-by-step Node.js timing)
28. **Return to route** → route sends JSON response to frontend

#### Frontend Display
29. **Frontend receives** response
30. **Display message** in chat thread
31. **Show sources** (which documents were referenced)
32. **Update thread state** (for next message)

### Streaming Mode (SSE Events)

When `?stream=true` is passed, the response is Server-Sent Events (SSE) with **event-based streaming** (NOT character-by-character token streaming):

| Event | When Sent | Contains |
|-------|-----------|----------|
| `synthesis` | After OpenAI completes (~5-15s) | Full response, sources, classification |
| `perplexity` | After Perplexity completes (~10-20s) | Web search answer, citations |
| `done` | After all complete | Final timing metrics |
| `error` | On failure | Error message |

**Key distinction:** This is event-based SSE, not OpenAI token streaming. The `synthesis` event contains the complete response text, not individual tokens.

**User experience:** User sees the full synthesis response first, then Perplexity content appends when ready.

## Key Variables (chat-proxy.service.js)

These are the main variables in `processChatMessage()`. Understanding what each holds prevents bugs.

### Input & Normalization

| Variable | Type | Description |
|----------|------|-------------|
| `query` | string | User's message text |
| `rawThreadId` | string \| undefined | ThreadId from request (may be empty) |
| `threadId` | string | **Normalized** - if rawThreadId empty, generates new UUID. Always a valid string. |
| `stream` | boolean | Whether to use SSE streaming (default: false) |

### Context Retrieved from Database

| Variable | Type | Description |
|----------|------|-------------|
| `conversationContext` | object | From `getWeightedConversationContext()`. Contains: `total_exchanges`, `accumulated_equipment`, `conversation_summary` |
| `threadData` | object \| null | Full thread record from `chat_threads` table |
| `existingEquipmentContext` | array | **Source of truth** - equipment blob from `threadData.equipment_context`. Persisted across messages. |

### Equipment Search Results

| Variable | Type | Description |
|----------|------|-------------|
| `referenceCheck` | object | From `quickReferenceCheck()`. Contains: `likely_reference`, `mentions_equipment_type`, `should_infer` |
| `queryKeywordResults` | array | Equipment found by searching each keyword against `systems` table |
| `currentEquipmentSearch` | array | **Final merged equipment** from current query - either from inference, extraction, or keyword search |
| `equipmentInference` | object \| null | LLM inference result (Path A only). Contains: `analysis`, `primary_equipment`, `related_equipment` |

### Context Building

| Variable | Type | Description |
|----------|------|-------------|
| `rawEquipmentContext` | array | Merged current + historical equipment from `getEquipmentRelationshipContext()` |
| `systemsContext` | array | **Final equipment array** sent to Python. Each item has: `asset_uid`, `manufacturer`, `model`, `description`, `source`, `llm_confidence`, `llm_role`, `rank` |
| `newEquipmentFound` | array | Equipment fetched fresh (not from cache) - used to know what's new |

### Timing

| Variable | Type | Description |
|----------|------|-------------|
| `nodeTiming` | object | Step-by-step timing breakdown. Keys: `conversation_context_ms`, `equipment_search_ms`, `equipment_extraction_ms`, `equipment_inference_ms`, `equipment_context_build_ms`, `system_details_fetch_ms`, `equipment_context_update_ms`, `python_call_ms`, `response_format_ms` |

### Python Response

| Variable | Type | Description |
|----------|------|-------------|
| `pythonResult` | object | Full response from Python sidecar. Contains: `response`, `sources`, `classification`, `processing_time_ms`, `detailed_metrics` |
| `result` | object | **Final return value** - combines pythonResult + systemsContext + node_timing |

### Critical Relationships

```
existingEquipmentContext (from DB)
         ↓
    referenceCheck (decides path)
         ↓
    ┌────┴────┐
    ▼         ▼
 Path A    Path B
(inference) (extraction)
    │         │
    └────┬────┘
         ▼
currentEquipmentSearch (merged)
         ↓
rawEquipmentContext (+ history)
         ↓
systemsContext (full details)
         ↓
    Python sidecar
         ↓
    pythonResult
         ↓
      result
```

---

## Files & Locations

| Purpose | Path |
|---------|------|
| **Routes** | |
| Chat router index | `src/routes/chat/index.js` |
| Process endpoint | `src/routes/chat/process.route.js` |
| History endpoint | `src/routes/chat/history.route.js` |
| Thread list | `src/routes/chat/list.route.js` |
| Context endpoint | `src/routes/chat/context.route.js` |
| Delete thread | `src/routes/chat/delete.route.js` |
| **Services** | |
| Main orchestration | `src/services/chat-proxy.service.js` |
| Conversation context | `src/services/conversation-context.service.js` |
| Equipment extraction | `src/services/equipment-extraction.service.js` |
| **Repository** | |
| Chat data access | `src/repositories/chat.repository.js` |
| User tasks (inventory suggestions) | `src/repositories/user-tasks.repository.js` |
| **Python Sidecar** | |
| Chat workflow | `python-sidecar/app/chat/workflows/chat_workflow_sequential.py` |
| Chat models | `python-sidecar/app/chat/chat_models.py` |
| Chat services | `python-sidecar/app/chat/services/` |
| **Frontend** | |
| Mobile chat | `src/public/index-mobile.html` |
| Desktop chat | `src/public/index.html` |
| Chat JS | `src/public/app.js` |
| **Client** | |
| Python sidecar client | `src/clients/python-sidecar.client.js` |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat/process` | Send message, get AI response |
| POST | `/chat/process?stream=true` | Send message, get streaming SSE response |
| GET | `/chat/history?threadId=X` | Get messages for a thread |
| GET | `/chat/list` | List all threads |
| GET | `/chat/context?threadId=X` | Get thread context/equipment |
| DELETE | `/chat/delete?threadId=X` | Delete a thread |
| GET | `/chat/sessions` | List sessions |
| GET | `/chat/threads?sessionId=X` | List threads in session |
| GET | `/chat/messages?threadId=X` | Get messages (alternative) |

### Request/Response Examples

**POST /chat/process**
```json
// Request
{
  "message": "How do I change the oil filter?",
  "threadId": "optional-uuid-here"
}

// Response
{
  "success": true,
  "data": {
    "assistantMessage": {
      "content": "To change the oil filter on your Yanmar...",
      "role": "assistant",
      "sources": [
        { "document": "Yanmar 4JH Manual", "page": 45, "relevance": 0.92 }
      ]
    },
    "threadId": "uuid-of-thread",
    "timing": {
      "total_ms": 2340,
      "pinecone_ms": 120,
      "llm_ms": 1800
    }
  }
}
```

## Database Tables

### chat_sessions
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| name | text | Session name |
| description | text | Optional description |
| metadata | jsonb | Additional data |
| created_at | timestamp | Creation time |
| updated_at | timestamp | Last update |

### chat_threads
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key (also used as threadId) |
| session_id | uuid | FK to chat_sessions |
| name | text | Auto-generated thread name |
| equipment_context | jsonb | Equipment mentioned in thread |
| summary | text | Conversation summary |
| created_at | timestamp | Creation time |
| updated_at | timestamp | Last update |

### chat_messages
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| thread_id | uuid | FK to chat_threads |
| role | text | 'user' or 'assistant' |
| content | text | Message content |
| sources | jsonb | Document sources (assistant only) |
| metadata | jsonb | Timing, tokens, etc. |
| created_at | timestamp | Creation time |

## Testing

| Test File | Type | What It Tests |
|-----------|------|---------------|
| `tests/unit/services/chat-proxy.service.test.js` | Unit | Service logic, mocked dependencies |
| `tests/integration/chat.test.js` | Integration | Full endpoint validation |
| `tests/integration/chat.process.normalization.test.js` | Integration | Query normalization |
| `tests/integration/bad-input.test.js` | Integration | Invalid input handling |
| `tests/e2e/chat-flow.spec.js` | E2E | Full user flow |
| `tests/nightly/chat-timing.test.js` | Nightly | Performance benchmarks |
| `python-sidecar/app/chat/tests/` | Python | Workflow tests |

### Running Chat Tests

```bash
# Unit tests only
node --test tests/unit/services/chat-proxy.service.test.js

# Integration tests
node --test tests/integration/chat.test.js

# All chat-related tests
node --test tests/**/*chat*.test.js

# Timing benchmark (nightly)
node tests/nightly/chat-timing.test.js
```

> See also: [CI Testing](../00-foundations/ci-testing.md) for full test suite

## Performance

### Current Timing (as of Dec 2024)

Average response times from real user query benchmarks:

| Metric | Time | Notes |
|--------|------|-------|
| **First Response (synthesis)** | ~18.5s | User sees initial answer |
| **Total Complete** | ~19.7s | Including Perplexity |

### Step-by-Step Breakdown

#### Node.js Steps (before Python call)
| Step | Avg Time | Description |
|------|----------|-------------|
| equipment_search | 2,344ms | Parallel keyword searches (5 keywords) |
| equipment_extraction | 1,305ms | LLM extraction (runs in parallel with keywords) |
| conversation_context | 268ms | Fetch thread history |
| system_details_fetch | 402ms | Fetch equipment details |

#### Python Steps
| Step | Avg Time | Description |
|------|----------|-------------|
| Classification | 3,283ms | LLM classifies query intent |
| Pinecone | 1,186ms | Vector search for relevant chunks |
| Chunk Ranking | 375ms | Cohere rerank-v3.5 (was 3-6s with LLM) |
| Synthesis | 6,701ms | OpenAI generates response |
| Perplexity | 6,447ms | Web search (parallel with synthesis) |

### Parallelization (Dec 2024)

**What runs in parallel:**
1. **Keyword searches** - All 5 keyword searches run via `Promise.all()` instead of serial loop
2. **LLM extraction** - Starts at same time as keyword searches
3. **LLM equipment searches** - All searches for extracted equipment run via `Promise.all()`
4. **Synthesis + Perplexity** - Both LLM calls run in parallel in Python

**Before parallelization:** ~55s average
**After parallelization:** ~14s average

### Chunk Ranking: Cohere Rerank (Dec 2024)

The `rank_chunks()` function uses **Cohere Rerank API** (`rerank-v3.5`) instead of an LLM call.

| Metric | Before (LLM) | After (Cohere) |
|--------|--------------|----------------|
| Time | 3-6 seconds | ~375ms |
| Improvement | - | **12x faster** |

**Why reranking is needed:** Pinecone returns chunks by vector similarity, but top results are often irrelevant (e.g., searching "4JH57 RPM" returns VC20 vessel control docs first). Reranking ensures the most relevant chunks go to synthesis.

**Environment:** Requires `COHERE_API_KEY` in Python sidecar environment.

### Timing Test

Run the timing benchmark:
```bash
node tests/nightly/chat-timing.test.js
```

Results saved to: `results/chat-timing.json`

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Chat uses LangChain" | **No.** We removed LangChain. Python sidecar uses direct OpenAI calls. |
| "Chat uses LangGraph" | **No.** Removed. Sequential workflow only. |
| "There's a separate enhanced chat" | **No.** `/chat/enhanced/*` routes are aliases to `/chat/*` for backward compatibility. Same code. |
| "Node.js calls OpenAI directly" | **No.** Node.js calls Python sidecar, which calls OpenAI. |
| "Each message is independent" | **No.** Thread maintains equipment_context and conversation history. |
| "Streaming is default" | **No.** Non-streaming is default. Add `?stream=true` for SSE. |

## Related Docs

- [Python Sidecar](../30-backend/python-sidecar.md) - Chat workflow implementation details
- [Pinecone](../20-admin-tools/pinecone.md) - Vector search for document retrieval
- [Documents](../20-admin-tools/documents.md) - How documents get into Pinecone
- [Systems](../20-admin-tools/systems.md) - Equipment context and relationships

---

## Appendix: LLM Prompts

These are the exact prompts sent to AI models. Changes here directly affect chat behavior.

### A1: Equipment Extraction Prompt (Node.js → OpenAI)

**Used in:** Step 11 (Path B) - `src/services/equipment-extraction.service.js`
**Model:** `gpt-4o-mini` (OPENAI_SUMMARY_MODEL)
**Purpose:** Parse user query to extract equipment names

```
You are a marine expert looking at a colloquial sentence and trying to extract the systems. As you know the marine environment is complex because states and conditions can also be equipment, such as GPS which is a thing and a system, or wind sensor which is a state but also there is a wind sensor. You need to be crafty and careful to parse apart a sentence and pull from it what could be the systems. The questions will be all over the place as this is the lead in from a chat application. the goal is to find the marine item in the sentence and surface it - from trouble shooting, to general inqury, to asking about what equipment or supplies we have, to random questions, we need to be on our toes and find that marine item. But and this is a but. this is a luxury catamaran and has showers, kitchen, tv's and so we need to keep an eye out for systems that would be on a luxury boat also. Returning a few options is not a bad thing as this response flows into query our systems and supplies tables.

OUTPUT FORMAT: Return JSON array only.

RULES:
1. Extract explicit mentions (V100, Zeus, fortress anchor)
2. Infer implicit systems:
   - "GPS data" implies GPS receiver exists
   - "wind data" implies wind sensor exists
   - "not showing same" implies multiple displays
3. Include confidence (0-1) for each
4. Identify role: data_source, display, control, or equipment

EXAMPLES:

Query: "GPS showing different on V100 and Zeus"
[
  {"name": "GPS", "confidence": 0.8, "role": "data_source"},
  {"name": "V100", "confidence": 0.95, "role": "display"},
  {"name": "Zeus", "confidence": 0.95, "role": "display"}
]

Query: "autopilot not responding to wind data"
[
  {"name": "autopilot", "confidence": 1.0, "role": "control"},
  {"name": "wind sensor", "confidence": 0.75, "role": "data_source"}
]

Now extract from: "{query}"
```

**Placeholders:**
- `{query}` - User's message text

---

### A2: Equipment Relationship Inference Prompt (Node.js → OpenAI)

**Used in:** Step 11 (Path A) - `src/services/equipment-relationship-inference.service.js`
**Model:** `gpt-4o-mini` via `oaiJson()`
**Purpose:** Determine if user is referring to previously mentioned equipment

```
You are an expert marine equipment analyst specializing in understanding equipment relationships and user intent.

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
3. Are there any RELATED/CONNECTED equipment that should be considered?

Common marine equipment relationships:
- Chartplotters often have integrated GPS/sounder functionality
- MFDs (Multi-Function Displays) typically connect to various sensors
- Radar systems often integrate with chartplotters
- Autopilots connect to GPS and compass systems
- Depth/fish finders often pair with chartplotters
- Engine monitors connect to various engine sensors
- Wind instruments connect to autopilots and sail systems

Respond with valid JSON only:
{
    "analysis": {
        "is_new_equipment": false,
        "referring_to_previous": true,
        "confidence": 0.85,
        "reasoning": "User said 'GPS' after discussing V100 chartplotter"
    },
    "primary_equipment": {
        "asset_uid": "previous-equipment-id",
        "confidence": 0.90,
        "relationship_type": "same_device",
        "reasoning": "GPS is integral functionality of the V100"
    },
    "related_equipment": [...],
    "context_expansion": {
        "should_search_new": false,
        "should_include_related": true,
        "search_suggestions": []
    }
}
```

**Placeholders:**
- `{conversationHistory}` - Recent messages in thread
- `{currentQuery}` - User's current message
- `{currentEquipment}` - Equipment found from keyword search
- `{previousEquipment}` - Equipment from thread's equipment_context blob

---

### A3: Query Classification Prompt (Python → OpenAI)

**Used in:** Step 20 - `python-sidecar/app/chat/config/system_prompts.py`
**Model:** `gpt-4o-mini` (OPENAI_SUMMARY_MODEL)
**Purpose:** Classify query intent and determine what data to retrieve

```
Analyze this user query and equipment context to classify the request:

USER QUERY: "{user_query}"

EQUIPMENT FOUND IN USER'S INVENTORY:
{equipment_text}

Please analyze:
1. What is the user's intent? (general_information, specifications, installation, troubleshooting, comparison, etc.)
2. Which equipment is the user primarily asking about? (provide the index number, or null if unclear)
3. What types of information would be most helpful? (spec, procedure, troubleshooting, routing)
4. What are the key search terms/keywords for finding relevant data?
5. How confident are you in this classification?
6. How complex is this question? (simple/moderate/complex)

Respond with valid JSON only:
{
    "intent": "primary intent category",
    "confidence": 0.8,
    "complexity": "simple",
    "complexity_score": 0.2,
    "table_types_needed": ["spec", "routing"],
    "primary_equipment_index": 0,
    "search_keywords": ["anchor", "fortress", "specifications"],
    "reasoning": "Brief explanation"
}
```

**Placeholders:**
- `{user_query}` - User's message
- `{equipment_text}` - Formatted list of equipment with rank/description

---

### A4: Response Synthesis Prompt (Python → OpenAI/Anthropic)

**Used in:** Step 22-23 - `python-sidecar/app/chat/config/system_prompts.py`
**Model:** `gpt-4o` (OPENAI_MODEL) or Claude (if CHAT_MODEL=ANTHROPIC)
**Purpose:** Generate the final response to the user

```
{personality_traits}

USER QUESTION: "{user_query}"

EQUIPMENT IN USER'S INVENTORY:
{equipment_context}

CONVERSATION HISTORY (if available):
{conversation_summary}

RELEVANT TECHNICAL DATA FROM DIP TABLES:
{dip_context}

RELEVANT DOCUMENTS FROM KNOWLEDGE BASE:
{pinecone_context}

QUERY INTENT: {intent}

{format_rules}

{synthesis_instructions}

Generate your response now using the technical data provided:
```

**Placeholders:**
- `{personality_traits}` - See A4a below
- `{user_query}` - User's message
- `{equipment_context}` - Equipment details from systemsContext
- `{conversation_summary}` - Thread summary if exists
- `{dip_context}` - Structured data from DIP tables
- `{pinecone_context}` - Document chunks from vector search
- `{intent}` - From classification step
- `{format_rules}` - See A4b below
- `{synthesis_instructions}` - See A4c below

---

### A4a: Personality Traits

```
You are a helpful marine equipment expert assistant with an optimistic, curious, and people-focused personality. You're a critical thinker but positive. You believe that with hard work and cheerful resilience, you can make a real difference. Bring this positive, can-do spirit to your responses while staying grounded in technical facts.
```

---

### A4b: Format Rules

```
FORMAT REQUIREMENTS:
1. NO stage directions or action descriptions (no "*brightens up*", "*smiles*", etc.)
2. First paragraph MUST be conversational technical context from DIP/Vector data - prefix with 📊 icon
3. If the query asks for steps/procedures/how-to, the second section MUST extract and list those steps explicitly - prefix with 🔧 icon. They should be numbered and clear.
4. Third section can include world knowledge and context - prefix with 💡 icon
5. Use actual numbers and specifications from the technical data provided
6. Be conversational but precise in context paragraphs
7. Be direct and verbatim when listing procedural steps
8. Keep paragraphs focused and scannable
```

---

### A4c: Synthesis Instructions

```
CRITICAL DATA USAGE RULES:
1. You MUST use the technical data provided in RELEVANT TECHNICAL DATA and RELEVANT DOCUMENTS sections
2. DO NOT say "I don't have information" if technical data is provided above
3. DO NOT use general knowledge for specifications when DIP data is available
4. Directly answer the question using the specs, procedures, and data shown
5. Cite specific numbers, parameters, and values from the technical data
6. EQUIPMENT IDENTIFICATION IS NON-NEGOTIABLE: NEVER change manufacturer or model from EQUIPMENT IN USER'S INVENTORY - this is ground truth
7. Use documents for technical specifications ONLY, not for equipment identification
8. If documents mention different manufacturers/models, ignore that - stick to inventory data
9. If DIP data contradicts your general knowledge, ALWAYS use the DIP data
10. Show genuine curiosity and enthusiasm about the user's equipment
11. If you spot opportunities for improvement or optimization, mention them positively

PROCEDURE EXTRACTION RULES:
12. When query asks for steps/procedures/how-to AND documents contain procedures, you MUST include a 🔧 section
13. The 🔧 section must come AFTER the 📊 conversational context paragraph
14. Extract and LIST steps explicitly - DO NOT summarize procedures conversationally
15. Format as numbered lists - preserve section structure from source
16. Include all steps verbatim from source documents - do not abbreviate or paraphrase
17. Be direct: Lead with section heading, then list steps immediately
18. Installation information is not overly helpful as most items are installed. Skip unless asked
```

---

### Prompt File Locations

| Prompt | File |
|--------|------|
| Equipment Extraction | `src/services/equipment-extraction.service.js:5-51` |
| Relationship Inference | `src/services/equipment-relationship-inference.service.js:7-61` |
| Classification | `python-sidecar/app/chat/config/system_prompts.py:58-83` |
| Synthesis | `python-sidecar/app/chat/config/system_prompts.py:85-107` |
| Personality | `python-sidecar/app/chat/config/system_prompts.py:8` |
| Format Rules | `python-sidecar/app/chat/config/system_prompts.py:10-20` |
| Synthesis Instructions | `python-sidecar/app/chat/config/system_prompts.py:22-56` |
