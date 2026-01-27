# Code Update #62: SSE Buffering Fix and Image Extraction Gap

**Date:** 2025-12-13
**Status:** IMPLEMENTED (SSE fix) / IDENTIFIED (Image gap)
**Branch:** Stable-v4-Working

---

## Issues Addressed

### 1. SSE Streaming Empty Responses on Render (FIXED)

**Symptom:** Chat requests on production (Render) returned "No response received" even though Python completed successfully.

**Evidence from logs:**
- Python: `✅ STREAMING: Synthesis ready at 13617ms - yielding immediately`
- Python: `🎯 STREAMING COMPLETE - Total time: 13617ms`
- Node: `Performance metric: duration: 15903ms, statusCode: 200`
- Frontend saved: `contentLength: 0`

**Root Cause:** Two issues:

1. **Proxy buffering:** Render's proxy was buffering SSE events instead of streaming them. Events arrived in one burst at connection close.

2. **Frontend parsing bug:** The stream reader checked `done` BEFORE processing the final chunk:
   ```javascript
   const { done, value } = await reader.read();
   if (done) break;  // <-- Breaks BEFORE processing final value!
   buffer += decoder.decode(value, { stream: true });
   ```

### 2. Dashboard Timing Mismatch (FIXED)

**Symptom:** Python Sidecar Breakdown header showed 12.3s but breakdown items only added up to ~8.9s.

**Root Cause:** Header showed `nodeTiming.python_call_ms` (Node's HTTP round-trip) but breakdown items showed Python's internal timing. These are different measurements.

### 3. CI Integration Test Timeout (FIXED)

**Symptom:** Integration tests timing out in CI.

**Fix:** Increased timeout from 5 to 10 minutes in both workflow files.

### 4. Per-Test Python Timing Not Stored (FIXED)

**Symptom:** Individual test timing breakdown wasn't available in dashboard.

**Root Cause:** `upload-nightly-results.js` was stripping `internalTiming` when mapping test results.

### 5. Image Extraction Gap (IDENTIFIED - NOT FIXED)

**Symptom:** System references "Pos. 19 in exploded view" but user can't see the diagram.

**Root Cause:** LlamaParse configured with `result_type="markdown"` only extracts text. Images/figures in PDFs are completely ignored.

**Impact:** 81 documents processed, 0 images extracted. Visual content (exploded views, wiring diagrams, schematics) is lost.

---

## Fixes Implemented

### 1. Node.js SSE Route (`src/routes/chat/process.route.js`)

```javascript
// BEFORE
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');
res.setHeader('X-Accel-Buffering', 'no');

for await (const { event, data } of eventStream) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
res.end();

// AFTER
res.status(200);
res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
res.setHeader('Cache-Control', 'no-cache, no-transform');  // no-transform prevents proxy optimization
res.setHeader('Connection', 'keep-alive');
res.setHeader('X-Accel-Buffering', 'no');

if (typeof res.flushHeaders === 'function') res.flushHeaders();  // Send headers immediately

// Keep-alive heartbeat every 15s
const heartbeat = setInterval(() => {
  res.write(':\n\n');
  if (typeof res.flush === 'function') res.flush();
}, 15000);

try {
  for await (const { event, data } of eventStream) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') res.flush();  // Force flush after each event
  }
} finally {
  clearInterval(heartbeat);
  res.end();
}
```

**Key changes:**
- `res.flushHeaders()` - Send headers immediately to prevent proxy buffering
- `res.flush()` after each write - Force events out immediately
- `no-transform` in Cache-Control - Prevent proxy optimization
- 15s heartbeat - Keep connection alive

### 2. Frontend SSE Parser (`src/public/app.js`)

```javascript
// BEFORE - Bug: breaks before processing final chunk
while (true) {
  const { done, value } = await reader.read();
  if (done) break;  // <-- Final chunk with data is skipped!
  buffer += decoder.decode(value, { stream: true });
  // ... parse events
}

// AFTER - Process value BEFORE checking done
while (true) {
  const { done, value } = await reader.read();

  if (value) {
    buffer += decoder.decode(value, { stream: true });
    parseSSEBuffer();  // Process immediately
  }

  if (done) {
    // Final parse pass for any remaining buffer
    if (buffer.trim()) {
      buffer += '\n';
      parseSSEBuffer();
    }
    break;
  }
}

// Don't save empty messages
if (fullResponse) {
  await saveAssistantMessage(...);
} else {
  console.warn('Not saving empty assistant message');
}
```

**Key changes:**
- Process `value` BEFORE checking `done`
- Final parse pass on remaining buffer
- Track `sawDoneEvent` flag
- Don't save empty assistant messages

### 3. Dashboard Timing Display (`src/public/test-results.html`)

```javascript
// BEFORE
const pythonCallTime = nodeTiming.python_call_ms || breakdown.total_internal_ms || 0;
// Header showed Node's measurement, items showed Python's - mismatch!

// AFTER
const pythonInternalTime = breakdown.total_internal_ms || 0;
const pythonCallTime = nodeTiming.python_call_ms || pythonInternalTime;
const httpOverhead = pythonCallTime - pythonInternalTime;

// Header: "10.6s (+1.7s HTTP)" - shows internal time + overhead separately
```

### 4. CI Integration Test Timeout

**Files:** `.github/workflows/nightly-sweep.yml`, `.github/workflows/nightly-sweep-full.yml`

```yaml
# BEFORE
timeout-minutes: 5

# AFTER
timeout-minutes: 10
```

### 5. Per-Test Timing Storage (`scripts/upload-nightly-results.js`)

```javascript
// BEFORE - internalTiming stripped out
tests: data.tests.map(t => ({
  name: t.name,
  duration: t.duration,
  success: t.success,
  type: t.type || t.category,
  nodeTiming: t.nodeTiming || null
}))

// AFTER - internalTiming preserved
tests: data.tests.map(t => ({
  name: t.name,
  duration: t.duration,
  success: t.success,
  type: t.type || t.category,
  nodeTiming: t.nodeTiming || null,
  internalTiming: t.internalTiming || null  // Python breakdown per test
}))
```

---

## Image Extraction Gap (NOT FIXED)

### Current State

**LlamaParse configuration:**
```python
self.parser = LlamaParse(
    api_key=api_key,
    result_type="markdown",  # Only extracts text
)
documents = await self.parser.aload_data(file_path)
full_markdown = "\n\n".join([doc.text for doc in documents])  # Text only
```

**Impact:**
- 81 documents in `documents` table
- 37 documents have chunks (2,377 vectors in Pinecone)
- 0 images extracted

**Consequence:** System references diagrams ("See Pos. 19 in exploded view") but user can't see them. The text describes visual content that isn't available.

### Solution (Not Implemented)

LlamaParse supports image extraction via `get_json_result()`:

```python
# To extract images:
json_result = parser.get_json_result()
# Returns document structure with images, metadata, and locations
```

**Required work:**
1. Update LlamaParse config to use `get_json_result()`
2. Extract image data/URLs from JSON response
3. Store images in Supabase storage
4. Link image references to chunks
5. Surface images in chat responses
6. Re-process all 81 documents

---

## Commits

| Commit | Description |
|--------|-------------|
| `3989b6d` | Add streaming chat responses and fix dashboard timing display |
| `3dfbfc8` | Preserve per-test Python timing breakdown in CI results |
| `032cf03` | Fix SSE buffering causing empty responses on Render |

---

## Files Changed

| File | Change |
|------|--------|
| `src/routes/chat/process.route.js` | SSE flush headers, flush after write, heartbeat |
| `src/public/app.js` | Process value before done, final parse pass, don't save empty |
| `src/public/test-results.html` | Show Python internal time + HTTP overhead separately |
| `.github/workflows/nightly-sweep.yml` | Integration test timeout 5→10 min |
| `.github/workflows/nightly-sweep-full.yml` | Integration test timeout 5→10 min |
| `scripts/upload-nightly-results.js` | Preserve internalTiming per test |

---

## Testing

After deploying to Render, test SSE streaming:

```bash
# Watch for streamed events (should trickle, not dump at end)
curl -N -H "Accept: text/event-stream" \
  https://boatos-main.onrender.com/chat/enhanced/process?stream=true \
  -H "Content-Type: application/json" \
  -d '{"message": "test", "threadId": "test-123"}'
```

**Expected:** Events arrive incrementally as Python yields them, not all at once when connection closes.

---

## Key Insight: RAG Limitations

The "macro issue" identified: The system correctly grounds answers in documents, but **documents don't always contain the needed information**.

**Example:** User asks "How do I change the electronic module on the Marco pump?"

- **System answer:** References Pos. 17, 18, 19 from parts list, derives procedure from part order
- **Generic GPT:** Makes up detailed procedure with safety steps, tools, gotchas

The system is correctly constrained to document content, but the documents only have parts lists and exploded views - no actual service procedures. The text references visual content (diagrams) that isn't surfaced to the user.

**Two gaps:**
1. **Procedural knowledge** - Documents don't contain actual how-to procedures
2. **Visual content** - Images aren't extracted, so users can't see referenced diagrams

---

## Next Steps

1. **Test SSE fix on Render** - Verify streaming works after deploy
2. **Image extraction** - Decide whether to implement and re-process 81 docs
3. **Procedural gap** - Consider hybrid approach allowing general knowledge when docs are insufficient
