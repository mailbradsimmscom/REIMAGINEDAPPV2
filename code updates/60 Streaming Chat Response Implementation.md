# Code Update #60: Streaming Chat Response Implementation

**Date:** 2025-12-12
**Status:** READY TO IMPLEMENT
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

## Investigation Results (2025-12-12)

### Timing Breakdown (from actual test)
```
Classification:     4,293ms
DIP retrieval:          4ms
Pinecone search:    4,643ms
Chunk ranking:      4,251ms
Synthesis:          5,382ms  ← User could see this!
Perplexity:        10,785ms  ← Runs parallel, delays everything
Total:            ~24,000ms
```

### Key Finding
- LLMService init is only 50ms (NOT 4.5s as suspected)
- Perplexity IS the bottleneck at 10.8s
- Synthesis and Perplexity already run in parallel via `asyncio.gather()`
- We just need to YIELD synthesis before waiting for Perplexity

---

## SSE Event Format

```
event: synthesis
data: {"response": "...", "sources": [...], "classification": {...}}

event: perplexity
data: {"answer": "...", "citations": [...]}

event: done
data: {"processing_time_ms": 12345, "detailed_metrics": {...}}
```

---

## Files to Modify (6 files)

### 1. Python Workflow
**File:** `python-sidecar/app/chat/workflows/chat_workflow_sequential.py`
**Change:** Add `process_chat_streaming()` async generator

```python
from typing import AsyncGenerator

async def process_chat_streaming(
    self,
    user_query: str,
    systems_context: List[Dict[str, Any]],
    thread_id: Optional[str] = None,
    conversation_summary: Optional[str] = None,
    memory_context: Optional[Dict[str, Any]] = None,
    synthesis_model: Optional[str] = None
) -> AsyncGenerator[Dict[str, Any], None]:
    """Streaming version - yields events as they complete"""
    start_time = datetime.now()

    # Same initialization as process_chat (lines 88-104)
    state = {
        "user_query": user_query,
        "thread_id": thread_id,
        "systems_context": systems_context,
        # ... same as process_chat
    }

    # STEP 1: Classification (same)
    state = await self._classify_query(state)

    # STEP 2: Data Retrieval (same)
    state = await self._retrieve_data(state)

    # STEP 3: CHANGED - Don't wait for both
    openai_task = asyncio.create_task(self._synthesize_response(state))
    perplexity_task = asyncio.create_task(self._query_perplexity(state))

    # Wait for synthesis first, yield immediately
    openai_result = await openai_task
    if isinstance(openai_result, dict) and openai_result.get("final_response"):
        yield {
            "event": "synthesis",
            "response": openai_result["final_response"],
            "sources": self._format_sources_from_state(state, openai_result),
            "classification": state["classification"],
            "thread_id": thread_id
        }

    # Now wait for Perplexity
    perplexity_result = await perplexity_task
    if perplexity_result and not isinstance(perplexity_result, Exception):
        yield {
            "event": "perplexity",
            "answer": perplexity_result.get("answer", ""),
            "citations": perplexity_result.get("citations", [])
        }

    # Final done event
    processing_time = int((datetime.now() - start_time).total_seconds() * 1000)
    yield {
        "event": "done",
        "processing_time_ms": processing_time
    }
```

### 2. Python Endpoint
**File:** `python-sidecar/app/main.py`
**Location:** Line ~822 (the `/v1/chat/process` endpoint)
**Change:** Add streaming branch

```python
from fastapi.responses import StreamingResponse
import json

@app.post("/v1/chat/process")
async def process_chat(request: ChatRequest, stream: bool = False):
    if stream:
        return StreamingResponse(
            stream_chat_events(request),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )

    # ... existing JSON logic unchanged (lines 827-960) ...

async def stream_chat_events(request: ChatRequest):
    """Generator for SSE stream"""
    try:
        from .chat.services.llm_service import LLMService

        llm_service = LLMService()
        workflow = ChatWorkflowSequential(llm_service, chat_dip_retriever, pinecone_client)

        async for event in workflow.process_chat_streaming(
            user_query=request.query,
            systems_context=request.systems_context or [],
            thread_id=request.thread_id,
            conversation_summary=request.conversation_summary,
            memory_context=request.memory_context,
            synthesis_model=request.synthesis_model
        ):
            event_type = event.pop("event")
            yield f"event: {event_type}\ndata: {json.dumps(event)}\n\n"
    except Exception as e:
        yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
```

### 3. Node.js Sidecar Client
**File:** `src/clients/python-sidecar.client.js`
**Change:** Add streaming method after existing `processChatWorkflow`

```javascript
async function* processChatWorkflowStreaming({
  query,
  systemsContext = [],
  threadId = null,
  conversationSummary = null,
  memoryContext = null
}) {
  const env = envConfigDep.getEnv();
  const sidecarUrl = env.PYTHON_SIDECAR_URL || 'http://localhost:8000';
  const endpoint = `${sidecarUrl}/v1/chat/process?stream=true`;

  const response = await fetchFn(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      systems_context: systemsContext,
      thread_id: threadId,
      conversation_summary: conversationSummary,
      memory_context: memoryContext
    })
  });

  if (!response.ok) {
    throw new Error(`Streaming error: ${response.status}`);
  }

  // Parse SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    let currentEvent = null;
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7);
      } else if (line.startsWith('data: ') && currentEvent) {
        yield { event: currentEvent, data: JSON.parse(line.slice(6)) };
        currentEvent = null;
      }
    }
  }
}

// Export it alongside existing methods
return { processChatWorkflow, processChatWorkflowStreaming, checkChatHealth };
```

### 4. Node.js Chat Service
**File:** `src/services/chat-proxy.service.js`
**Change:** Add streaming wrapper (after existing `processChatMessage`)

```javascript
async function* processChatMessageStreaming({ query, threadId: rawThreadId }) {
  const requestLogger = logger.createRequestLogger();
  const env = envConfigDep.getEnv();
  const threadId = rawThreadId?.trim() || randomUUID();

  // Reuse equipment context building (copy relevant parts from processChatMessage)
  // Steps 1-6: conversation context, equipment search, etc.
  // ... (reuse existing logic) ...

  // Then stream from Python
  const pythonStream = pythonSidecarClient.processChatWorkflowStreaming({
    query,
    systemsContext,
    threadId,
    conversationSummary: conversationContext.conversation_summary,
    memoryContext: { /* same as processChatMessage */ }
  });

  for await (const event of pythonStream) {
    yield event;
  }
}
```

### 5. Node.js Route
**File:** `src/routes/chat/process.route.js`
**Change:** Add streaming branch at start of handler

```javascript
// At top of POST handler, after validation
const stream = req.query.stream === 'true';

if (stream) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    for await (const event of processChatMessageStreaming({ query: message, threadId })) {
      res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    }
    res.end();
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
  return;
}

// ... existing JSON logic continues ...
```

### 6. Frontend
**File:** `src/public/app.js`
**Change:** Modify `processMessage()` function (around line 752)

```javascript
async function processMessage(message) {
  // ... existing setup (lines 720-749) ...

  addLoadingAnimation();

  try {
    const response = await fetch('/chat/enhanced/process?stream=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: message, thread_id: currentThreadId })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';
    let allSources = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      let currentEvent = null;
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7);
        } else if (line.startsWith('data: ') && currentEvent) {
          const data = JSON.parse(line.slice(6));

          if (currentEvent === 'synthesis') {
            removeLoadingAnimation();
            fullResponse = data.response;
            allSources = data.sources || [];
            addEnhancedMessage(fullResponse, formatSources(allSources));
            // Save to DB
            assistantSequence = ++currentMessageSequence;
            await saveAssistantMessage(currentThreadId, fullResponse, assistantSequence, { sources: allSources });
          }

          if (currentEvent === 'perplexity' && data.answer) {
            // Append Perplexity section
            const section = `\n\n───────────────────────────────\n\n**Real-World Resources**\n\n${data.answer}`;
            fullResponse += section;
            if (data.citations) {
              allSources.push({ type: 'PERPLEXITY', data: data.citations.map(u => ({ url: u })), count: data.citations.length });
            }
            updateLastMessage(fullResponse, allSources);
            await saveAssistantMessage(currentThreadId, fullResponse, assistantSequence, { sources: allSources });
          }

          currentEvent = null;
        }
      }
    }
  } catch (error) {
    removeLoadingAnimation();
    addMessage(`Error: ${error.message}`, 'inbound');
  }
}

// Add helper to update existing message
function updateLastMessage(text, sources) {
  const container = document.getElementById('messages');
  const lastMsg = container.querySelector('.message.inbound:last-child');
  if (lastMsg) {
    const content = lastMsg.querySelector('.content');
    if (content) content.innerHTML = parseMarkdown(parseMainContent(text));
  }
}
```

---

## Implementation Order

1. **Python workflow** - `process_chat_streaming()`
2. **Python endpoint** - streaming branch
3. **Node.js client** - `processChatWorkflowStreaming()`
4. **Node.js service** - `processChatMessageStreaming()`
5. **Node.js route** - streaming branch
6. **Frontend** - SSE handling

---

## Test Commands

```bash
# Test Python streaming directly
curl -X POST "http://localhost:8000/v1/chat/process?stream=true" \
  -H "Content-Type: application/json" \
  -d '{"query": "test", "systems_context": []}'

# Test Node.js streaming
curl -X POST "http://localhost:3000/chat/enhanced/process?stream=true" \
  -H "Content-Type: application/json" \
  -d '{"message": "test"}'
```

---

## Rollback

Remove `?stream=true` from frontend fetch call. Everything else can stay.

---

## Key Files Reference

| File | Line | Purpose |
|------|------|---------|
| `chat_workflow_sequential.py` | 148-165 | Current parallel execution |
| `main.py` | 822-960 | Current endpoint |
| `python-sidecar.client.js` | 41-64 | Current Python call |
| `chat-proxy.service.js` | 675 | Where Python is called |
| `process.route.js` | 19+ | Route handler |
| `app.js` | 752-823 | Frontend processMessage |

---

## Previous Investigation

- Timing instrumentation added in commit `3f6bb36`
- LLMService init: 50ms (not the bottleneck)
- Network overhead: ~76ms (not 4.5s as suspected)
- Perplexity: 10.8s IS the bottleneck
