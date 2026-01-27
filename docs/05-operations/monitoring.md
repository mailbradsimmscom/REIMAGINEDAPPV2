# Monitoring & Telemetry

## Overview

BoatOS captures telemetry data for performance monitoring and debugging. Timing data is captured per-request and stored in chat message metadata. Dashboard metrics are aggregated in-memory.

**Key Metrics:**
- Chat timing breakdown (32 steps)
- Equipment search performance
- LLM call latency
- Error rates

---

## Chat Timing Breakdown

Every chat request captures timing for each processing step.

### Node.js Timing (src/services/chat-proxy.service.js)

```javascript
nodeTiming: {
  conversation_context_ms,     // Step 1: Load thread history
  equipment_search_ms,         // Step 3a: Keyword search
  equipment_extraction_ms,     // Step 3b: LLM extraction
  equipment_inference_ms,      // Step 3c: LLM inference
  equipment_context_build_ms,  // Step 4: Build context
  system_details_fetch_ms,     // Step 5: Fetch system details
  equipment_context_update_ms, // Step 6: Save context
  python_call_ms,             // Step 7: Python sidecar call
  response_format_ms          // Step 8: Format response
}
```

### Python Sidecar Timing

```python
detailed_metrics: {
  classification_ms,   # Query classification
  pinecone_ms,        # Vector search
  llm_ms,             # OpenAI call
  total_ms            # Total Python time
}
```

### Full Response Timing

```json
{
  "success": true,
  "data": {
    "assistantMessage": { ... },
    "node_timing": {
      "conversation_context_ms": 45,
      "equipment_search_ms": 120,
      "equipment_extraction_ms": 850,
      "python_call_ms": 1200
    },
    "detailed_metrics": {
      "classification_ms": 50,
      "pinecone_ms": 180,
      "llm_ms": 920
    },
    "processing_time_ms": 2340
  }
}
```

---

## Performance Baselines

| Operation | Expected | Warning | Critical |
|-----------|----------|---------|----------|
| **Chat response (total)** | <3s | 3-5s | >5s |
| **Conversation context** | <50ms | 50-100ms | >100ms |
| **Equipment search** | <200ms | 200-500ms | >500ms |
| **Equipment extraction** | <1s | 1-2s | >2s |
| **Pinecone search** | <300ms | 300-600ms | >600ms |
| **LLM call** | <2s | 2-4s | >4s |
| **Response format** | <10ms | 10-50ms | >50ms |

---

## Where Telemetry Is Stored

### Per-Message Metadata (Supabase)

Chat messages store timing in `metadata` JSONB column:

```sql
-- chat_messages table
SELECT metadata->'node_timing' as timing
FROM chat_messages
WHERE thread_id = 'xxx'
ORDER BY created_at DESC;
```

### Test Results (Supabase)

CI test timing stored in `test_results` table:

| Column | Description |
|--------|-------------|
| `id` | UUID |
| `suite` | Test suite name |
| `test_name` | Individual test |
| `status` | passed/failed/skipped |
| `duration_ms` | Test duration |
| `branch` | Git branch |
| `commit_sha` | Git commit |

### In-Memory Metrics

Aggregated metrics in `src/utils/metrics.js`:
- Maintenance detection stats
- Units normalization stats
- Context rewrite stats
- Fuzzy matching stats

---

## Viewing Telemetry

### In Chat Response (Frontend)

Every chat response includes timing. Frontend can display:
- Total processing time
- Node.js breakdown
- Python breakdown

### In Dashboard

`/admin.htm` shows aggregate metrics:
- Average response time
- P95 latency
- Requests per minute
- Error rate

### In Logs

Timing logged at end of each request:

```
📊 Node.js timing breakdown (sum: 2340ms)
   conversation_context_ms: 45
   equipment_search_ms: 120
   equipment_extraction_ms: 850
   python_call_ms: 1200
```

### Via API

```bash
# Get aggregated metrics
curl -H "x-admin-token: $TOKEN" \
  "http://localhost:3000/admin/api/metrics?timeframe=15m"

# Get fuzzy matching details
curl -H "x-admin-token: $TOKEN" \
  "http://localhost:3000/admin/api/metrics/fuzzy"
```

---

## Telemetry Collection Points

### Request Start (middleware)

```javascript
// src/middleware/requestLogging.js
const start = Date.now();
res.on('finish', () => {
  const duration = Date.now() - start;
  recordRequest(req, res, duration);
});
```

### Chat Processing (service)

```javascript
// src/services/chat-proxy.service.js
const timing = {};
timing.conversation_context_ms = await measureAsync(loadContext);
timing.equipment_search_ms = await measureAsync(searchEquipment);
// ... each step measured
```

### Metrics Recording

```javascript
// src/utils/metrics.js
metrics.record('maintenance_detection', 'success', duration_ms, {
  question: 'oil change',
  fuzzyMatch: true
});
```

---

## API Endpoints

### GET /admin/api/metrics

Returns aggregated metrics for a time window.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `timeframe` | string | `15m` | `5m`, `15m`, `1h`, `24h` |
| `limit` | number | `100` | Max records |

**Response Structure:**
```json
{
  "success": true,
  "data": {
    "timeframe": "15m",
    "chatHealth": {
      "totalRequests": 150,
      "requestsPerMinute": 10,
      "p95Latency": 2500,
      "errorRate": 0.02
    },
    "fuzzyMatching": { ... },
    "systemHealth": {
      "uptime": 3600,
      "memoryUsage": { ... }
    }
  }
}
```

### GET /admin/api/telemetry/current

Current boat telemetry (battery, solar, tanks).

### GET /admin/api/telemetry/battery

Battery status over time.

### GET /admin/api/telemetry/solar

Solar panel status.

### GET /admin/api/telemetry/tanks

Tank levels (water, fuel, holding).

---

## Files & Locations

| Purpose | Path |
|---------|------|
| Metrics utility | `src/utils/metrics.js` |
| Request metrics | `src/middleware/requestLogging.js` |
| Metrics route | `src/routes/admin/metrics.route.js` |
| Telemetry route | `src/routes/admin/telemetry.route.js` |
| Chat timing | `src/services/chat-proxy.service.js` |

---

## Performance Monitoring

### Timing Helper

```javascript
async function measureAsync(operation, fn) {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;
  timing[operation] = duration;
  return result;
}
```

### Recording Metrics

```javascript
import { metrics } from '../utils/metrics.js';

// Record a timed operation
metrics.record('equipment_search', 'success', duration_ms, {
  resultCount: systems.length,
  searchQuery: query
});

// Get dashboard metrics
const dashboard = metrics.getDashboardMetrics();
```

---

## Alerts

**Currently manual monitoring.** No automated alerting configured.

### What to Monitor

1. **Error rate** > 5% - Check logs for failures
2. **P95 latency** > 5s - Check Python sidecar
3. **Memory usage** growing - Possible memory leak
4. **Requests/min** drop - Service may be down

### Manual Check Commands

```bash
# Health check
curl http://localhost:3000/health

# Recent errors
curl -H "x-admin-token: $TOKEN" \
  "http://localhost:3000/admin/api/logs?level=error&limit=20"

# Metrics
curl -H "x-admin-token: $TOKEN" \
  "http://localhost:3000/admin/api/metrics"
```

---

## Testing

| Test File | What It Tests |
|-----------|---------------|
| `tests/nightly/chat-timing.test.js` | Performance benchmarks |
| `tests/integration/spec-bias-telemetry.test.js` | Telemetry capture |
| `tests/integration/monitoring.test.js` | Metrics API |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "External monitoring" | **No.** No Datadog/NewRelic |
| "Automated alerts" | **No.** Manual monitoring only |
| "Long-term storage" | **No.** In-memory, resets on restart |
| "Distributed tracing" | **No.** Correlation IDs only |

---

## Related Docs

- [dashboard.md](./dashboard.md) - View metrics
- [logging.md](./logging.md) - Debug logs
- [chat.md](../10-user-features/chat.md) - Chat timing details
