# Code Update #60: Streaming Chat Response Implementation

**Date:** 2025-12-13
**Status:** IMPLEMENTED
**Branch:** Stable-v4-Working

---

## Problem

Chat takes ~10-15s because we wait for both:
- **Synthesis (OpenAI):** ~5s
- **Perplexity:** ~10s (runs parallel but we wait for both)

User sees nothing until BOTH complete.

## Solution

Stream response via SSE:
1. Return synthesis immediately when ready (~5s)
2. Append Perplexity when it arrives (~10s)
3. Same endpoint, opt-in via `?stream=true`

---

## Implementation (Minimal Approach)

**Design Philosophy:** No new paths, no new methods - just add `stream` option to existing chain.

### Data Flow

```
Frontend                POST /chat/enhanced/process?stream=true
    │
    ▼
Route                   Detects stream=true, sets SSE headers
    │
    ▼
chat-proxy.service.js   processChatMessage({stream: true})
    │                   - Steps 1-6: UNCHANGED (equipment context)
    │                   - Step 7: Returns async generator instead of JSON
    ▼
python-sidecar.client.js  processChatWorkflow({stream: true})
    │                     - Adds ?stream=true to URL
    │                     - Returns async generator parsing SSE
    ▼
Python main.py          StreamingResponse with SSE events
    │
    ▼
chat_workflow_sequential.py  process_chat_streaming()
    │                        - Yields synthesis first
    │                        - Yields perplexity when ready
    │                        - Yields done with full metrics
```

### SSE Event Format

```
event: synthesis
data: {"response": "...", "sources": [...], "classification": {...}}

event: perplexity
data: {"answer": "...", "citations": [...]}

event: done
data: {"processing_time_ms": 12345, "detailed_metrics": {FULL STRUCTURE}}
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/clients/python-sidecar.client.js` | Added `stream` param + `streamPythonSidecarCall()` SSE parser |
| `src/services/chat-proxy.service.js` | Added `stream` param to `processChatMessage()`, returns generator when true |
| `src/routes/chat/process.route.js` | Added `?stream=true` branch with SSE headers |
| `src/public/app.js` | Fetch with `?stream=true`, parse SSE, update DOM on each event |
| `python-sidecar/.../chat_workflow_sequential.py` | Full `detailed_metrics` structure in `done` event |
| `tests/smoke/route-map.test.js` | Accept `/chat/process` OR `/chat/enhanced` |

---

## Code Changes

### 1. python-sidecar.client.js

Added `stream` parameter to existing `processChatWorkflow()`:

```javascript
async function processChatWorkflow({
  query,
  systemsContext = [],
  threadId = null,
  conversationSummary = null,
  memoryContext = null,
  stream = false  // NEW
}) {
  const endpoint = stream ? `${baseEndpoint}?stream=true` : baseEndpoint;

  if (stream) {
    return streamPythonSidecarCall(endpoint, requestBody, timeoutMs);
  }
  return await makePythonSidecarCall(endpoint, requestBody, timeoutMs, retryAttempts);
}

// NEW: SSE parser
async function* streamPythonSidecarCall(endpoint, requestBody, timeoutMs) {
  const response = await fetchFn(endpoint, {...});
  const reader = response.body.getReader();
  // Parse SSE, yield {event, data} objects
}
```

### 2. chat-proxy.service.js

Added `stream` parameter to existing `processChatMessage()`:

```javascript
async function processChatMessage({ query, threadId: rawThreadId, stream = false }) {
  // Steps 1-6: UNCHANGED (equipment context building)

  // Step 7: CHANGED
  if (stream) {
    const pythonStream = await pythonSidecarClient.processChatWorkflow({
      ...params,
      stream: true
    });

    return (async function* () {
      for await (const { event, data } of pythonStream) {
        yield { event, data: { ...data, thread_id, systems_context, node_timing } };
      }
    })();
  }

  // Non-streaming: original behavior unchanged
  const pythonResult = await pythonSidecarClient.processChatWorkflow({...});
  return result;
}
```

### 3. process.route.js

Added streaming branch at start of handler:

```javascript
const stream = req.query.stream === 'true';

if (stream) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const eventStream = await processChatMessage({ query: message, threadId, stream: true });

  for await (const { event, data } of eventStream) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  res.end();
  return;
}

// Non-streaming: original behavior unchanged
```

### 4. app.js (Frontend)

Changed `processMessage()` to use SSE:

```javascript
const response = await fetch('/chat/enhanced/process?stream=true', {...});

const reader = response.body.getReader();
let buffer = '', currentEvent = null;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  // Parse SSE events
  if (currentEvent === 'synthesis') {
    removeLoadingAnimation();
    addEnhancedMessage(data.response, formattedSources);
  }

  if (currentEvent === 'perplexity' && data.answer) {
    // Append to existing message
    const lastMessage = messagesContainer.querySelector('.message.inbound:last-child .content');
    lastMessage.innerHTML = parseMarkdown(fullResponse + perplexitySection);
  }

  if (currentEvent === 'done') {
    updateStatsPanel(data.detailed_metrics);
  }
}
```

### 5. chat_workflow_sequential.py

`done` event now includes full metrics structure (same as non-streaming):

```python
yield {
    "event": "done",
    "processing_time_ms": processing_time,
    "detailed_metrics": {
        "timing_summary": {...},
        "classification": {"intent": ..., "confidence": ..., "duration_ms": ...},
        "pinecone": {"total_matches": ..., "filtered_matches": ..., "chunks": [...]},
        "synthesis": {"model_used": ..., "equipment_context": [...]},
        "perplexity": {"duration_ms": ..., "citations_count": ...},
        ...
    }
}
```

---

## Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| No `?stream` param | Existing JSON response (unchanged) |
| `?stream=true` | SSE streaming response |
| Tests | Continue working (no param) |
| Rollback | Remove `?stream=true` from frontend fetch |

---

## Test Commands

```bash
# Test Python streaming directly
curl -N -X POST "http://localhost:8000/v1/chat/process?stream=true" \
  -H "Content-Type: application/json" \
  -d '{"query": "fuel capacity", "systems_context": []}'

# Test Node.js streaming (full stack)
curl -N -X POST "http://localhost:3000/chat/enhanced/process?stream=true" \
  -H "Content-Type: application/json" \
  -d '{"message": "fuel capacity", "threadId": "test-123"}'

# Test non-streaming still works
curl -X POST "http://localhost:3000/chat/enhanced/process" \
  -H "Content-Type: application/json" \
  -d '{"message": "fuel capacity", "threadId": "test-456"}'
```

---

## Bugs Fixed During Implementation

**Bug 1: Perplexity Not Appending**
- Symptom: Perplexity content not appearing when it finished after synthesis
- Cause: CSS selector was `.message-content` but actual class is `.content`
- Fix: `app.js` line 817

**Bug 2: LLM Metrics Panel Empty** (Major fix - ~70 lines)
- Symptom: Stats panel showed no data in streaming mode
- Cause: Streaming `done` event had flat structure:
  ```python
  # BEFORE - flat, unusable by frontend
  {"classification_ms": 2706, "synthesis_ms": 3111, "perplexity_ms": 5223}
  ```
- Fix: Rewrote `done` event in `chat_workflow_sequential.py` to build full nested structure:
  ```python
  # AFTER - same structure as non-streaming
  {
      "timing_summary": {"total_processing_ms": ..., "breakdown": {...}},
      "classification": {"intent": ..., "confidence": ..., "duration_ms": ...},
      "pinecone": {"total_matches": ..., "filtered_matches": ..., "chunks": [...]},
      "synthesis": {"model_used": ..., "equipment_context": [...]},
      "perplexity": {"duration_ms": ..., "citations_count": ...}
  }
  ```
- Location: `python-sidecar/app/chat/workflows/chat_workflow_sequential.py` lines 457-550
- Note: Metrics display works, but **metrics not saved to DB in streaming mode** (frontend saves message after `synthesis` event, before `done` event with metrics)

**Bug 3: CI Route Test Failing**
- Symptom: `Chat enhanced route missing` in CI
- Cause: Route introspection doesn't detect aliased routes
- Fix: Test accepts `/chat/process` OR `/chat/enhanced`

---

## Related Work (Same Session)

### Pinecone Parallelization Fix

**Problem:** Pinecone searches ran sequentially despite `asyncio.gather()` because `search_vectors()` was synchronous.

**Fix:** Wrapped in `asyncio.to_thread()`:
```python
search_result = await asyncio.to_thread(
    self.pinecone_client.search_vectors,
    query=enhanced_query,
    ...
)
```

**Result:** Pinecone 26s → 1.5s (94% faster)

### Route Consolidation

Unified `/chat/process` and `/chat/enhanced/process` to same handler. Both paths now work identically.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `python-sidecar/app/chat/workflows/chat_workflow_sequential.py` | Python workflow with `process_chat_streaming()` |
| `python-sidecar/app/main.py` | Python endpoint (already had streaming branch) |
| `src/clients/python-sidecar.client.js` | Node.js client with `stream` option |
| `src/services/chat-proxy.service.js` | Chat orchestrator with `stream` option |
| `src/routes/chat/process.route.js` | Route with `?stream=true` branch |
| `src/public/app.js` | Frontend SSE handling |

---

## APPENDIX: Failed First Attempt (2025-12-12)

The first implementation attempt created SEPARATE streaming methods (`processChatWorkflowStreaming()`, `processChatMessageStreaming()`) and accidentally simplified the equipment context building, causing empty results on new threads.

**Lesson learned:** The streaming change should ONLY affect how the response is returned (step 7), not how it's processed (steps 1-6). Adding a `stream` parameter to existing methods is cleaner and safer than creating parallel code paths.
