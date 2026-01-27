# Logging

## Overview

BoatOS uses a custom structured logger (`src/utils/logger.js`) that writes to files in development and console in production. The Log Viewer UI provides a way to browse and search logs.

**Access:** `/logs-viewer.html`

---

## Logger Implementation (src/utils/logger.js)

### Logger Class Structure

```javascript
class Logger {
  constructor() {
    this.logsDir = join(process.cwd(), 'logs');
    this.maxLogSize = 5 * 1024 * 1024; // 5MB
    this.maxLogFiles = 5;
    this.healthCheckPaths = ['/health', '/admin/api/health', '/v1/pinecone/stats'];
  }

  async writeLog(level, message, meta = {}) {
    const env = await this.getEnv();
    const isHealthCheck = this.isHealthCheck(meta);

    // Production: ONLY log to console (Render captures it)
    if (env.NODE_ENV === 'production') {
      if (!isHealthCheck) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level.toUpperCase()}] [${meta.module || 'app'}] ${message}`, meta);
      }
      return;
    }

    // Development: Write to files
    // ...file writing logic
  }
}
```

### Log Methods

| Method | Level | Usage |
|--------|-------|-------|
| `logger.error(message, meta)` | ERROR | Failures needing attention |
| `logger.warn(message, meta)` | WARN | Potential issues |
| `logger.info(message, meta)` | INFO | Normal operations |
| `logger.debug(message, meta)` | DEBUG | Detailed troubleshooting |
| `logger.performance(op, duration, meta)` | INFO | Performance metrics |
| `logger.security(event, userId, meta)` | WARN | Security events |
| `logger.chat(type, message, details, meta)` | INFO | Chat-specific |

### Request-Scoped Logger

Creates a logger with correlation ID for request tracing:

```javascript
// Creates logger that tags all logs with same requestId
const requestLogger = logger.createRequestLogger(correlationId, 'chat-route');

requestLogger.info('Chat request received', { userId, threadId });
requestLogger.error('Failed to process', { error: err.message });
// All logs share correlationId for tracing
```

### Module-Scoped Logger

Creates a logger for a service or module:

```javascript
// In a service file
const moduleLogger = logger.createModuleLogger('chat-service');

moduleLogger.info('Processing message', { threadId });
// All logs tagged with module: 'chat-service'
```

---

## Log Files (Development Only)

```
logs/
├── chat/
│   └── node-chat.log    # Chat-related logs (module: 'chat')
├── api/
│   └── node-api.log     # API requests (excluding health checks)
├── errors/
│   └── node-errors.log  # Error level only
└── debug/
    └── node-debug.log   # Everything (verbose)
```

**Python Sidecar:**
```
python-sidecar/logs/
└── chat.log             # Python service logs
```

---

## Log Entry Format

```json
{
  "level": "INFO",
  "message": "Chat message processed",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "module": "chat-proxy",
  "correlationId": "abc-123",
  "context": {
    "threadId": "thread-456",
    "duration_ms": 1234,
    "equipmentCount": 3
  }
}
```

---

## API Endpoints

### GET /admin/api/logs

Fetch logs with filters.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `level` | string | Filter by level (error, warn, info, debug) |
| `service` | string | Filter by service |
| `module` | string | Filter by module |
| `correlationId` | string | Filter by request ID |
| `limit` | number | Max entries (default: 100) |
| `search` | string | Search log content |

**Response:**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "level": "ERROR",
        "message": "Chat proxy error",
        "timestamp": "2025-01-15T10:30:00.000Z",
        "module": "chat-proxy",
        "correlationId": "abc-123"
      }
    ],
    "count": 50,
    "timestamp": "2025-01-15T10:35:00.000Z"
  }
}
```

### GET /admin/api/logs/stream

Stream logs from specific source.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | string | Log source |
| `level` | string | Filter by level |
| `since` | string | ISO timestamp |
| `search` | string | Search term |
| `limit` | number | Max entries |

### GET /admin/api/logs/metadata

Get available services, modules, and levels.

---

## Usage Patterns

### Correct Usage

```javascript
import { logger } from './utils/logger.js';

// In a route handler
app.post('/chat/process', async (req, res) => {
  const requestLogger = logger.createRequestLogger(req.requestId, 'chat-route');

  requestLogger.info('Chat request received', { userId: req.userId });

  try {
    const result = await processChat(req.body);
    requestLogger.info('Chat processed', { duration_ms: Date.now() - start });
    return res.json({ success: true, data: result });
  } catch (error) {
    requestLogger.error('Chat failed', { error: error.message, stack: error.stack });
    throw error;
  }
});
```

### Wrong Usage

```javascript
// ❌ WRONG - bypasses structured logging
console.log('User action:', userId);
console.error('Something failed');

// ✅ RIGHT
requestLogger.info('User action', { userId });
requestLogger.error('Operation failed', { error: err.message });
```

---

## Common Log Patterns

### Chat Processing

```
📚 Retrieved conversation context
🔍 Analyzing query for equipment references
✅ Python workflow completed
📊 Node.js timing breakdown (sum: 2340ms)
```

### Equipment Search

```
🔬 [EXTRACT_START] LLM extraction initiated
🔍 [SEARCH_START] Searching systems table
✅ [MERGE_COMPLETE] Equipment merged
```

### Errors

```
❌ Chat proxy error
⚠️ Failed to retrieve thread equipment context
❌ Python sidecar unreachable
```

---

## Files & Locations

| Purpose | Path |
|---------|------|
| Logger utility | `src/utils/logger.js` |
| Logs service | `src/services/logs.service.js` |
| Logs route | `src/routes/admin/logs.route.js` |
| Log viewer HTML | `src/public/logs-viewer.html` |
| Log viewer JS | `src/public/js/logs-viewer.js` |

---

## Production vs Development

| Aspect | Development | Production |
|--------|-------------|------------|
| Output | Files + console | Console only |
| Health checks | Logged | Suppressed |
| File rotation | 5MB, 5 files | N/A |
| Log viewer | Reads files | Not available |

**Note:** In production, Render captures console output. The Log Viewer UI doesn't work in production.

---

## Debugging Tips

1. **Trace a request:** Search for `correlationId` to see all logs for one request
2. **Find chat issues:** Search for specific `threadId`
3. **Find errors:** Filter by `level=error`
4. **Python issues:** Check `python-sidecar/logs/chat.log`
5. **Performance:** Look for `duration_ms` in logs

---

## Testing

| Test File | What It Tests |
|-----------|---------------|
| `tests/smoke/route-map.test.js` | Logs route exists |
| `tests/integration/admin.test.js` | Logs endpoint works |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Use console.log" | **No.** Use logger utility |
| "Logs persist in production" | **No.** Console only, Render captures |
| "Log viewer works in production" | **No.** File-based, development only |
| "Winston library" | **No.** Custom logger class |

---

## Related Docs

- [dashboard.md](./dashboard.md) - System dashboard
- [monitoring.md](./monitoring.md) - Telemetry
- [principles.md](../00-foundations/principles.md) - Logging standards
