# Principles

## Overview

This document defines the actual coding patterns, architectural rules, and conventions enforced in the BoatOS codebase. Every pattern described here is extracted from actual source code.

**Compliance Status:** A Grade (Last Audit: 2025-10-09)

---

## What We Are Building

An **AI-powered boat operating system for catamarans** in the marine environment.

**The Challenge:**
- Marine environment is highly complex - 200+ different systems on a catamaran
- Systems appear disconnected but are deeply interconnected
- Small changes can have cascading effects across multiple systems
- Technical documentation is dense, inconsistent, and system-specific

**What This System Does:**
- Ingests technical manuals (PDFs) for marine equipment
- Chunks and vectorizes documentation for semantic search via Pinecone
- Provides AI-powered chat interface using OpenAI GPT models
- Extracts equipment specifications, maintenance schedules, troubleshooting guides
- Understands relationships between systems (e.g., power → pumps → plumbing → safety)

---

## Layered Architecture

**The Rule:** `routes → services → repositories`

```
┌─────────────────────────────────────────────────────────────────┐
│  Routes (src/routes/**/*.route.js)                              │
│  - HTTP handlers only                                           │
│  - Validation via Zod schemas                                   │
│  - NO business logic, NO direct I/O                             │
│  - Delegate to services                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Services (src/services/*.service.js)                           │
│  - Business logic ONLY                                          │
│  - Input validation and transformation                          │
│  - Error enhancement with context                               │
│  - Coordinate multiple repository calls                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Repositories (src/repositories/*.repository.js)                │
│  - ALL DB/storage/network I/O                                   │
│  - Supabase queries, Pinecone operations                        │
│  - External API calls (sidecar, OpenAI)                         │
│  - Error wrapping with operation context                        │
└─────────────────────────────────────────────────────────────────┘
```

**Example - Systems Service (src/services/systems.service.js:19-37):**

```javascript
import { listSystems, getSystemByAssetUid } from '../repositories/systems.repository.js';

export async function listSystemsSvc({ limit, cursor } = {}) {
  try {
    await checkSupabaseAvailability();
    const safeLimit = validateLimit(limit);
    const rows = await listSystems({ limit: safeLimit, cursor });
    const nextCursor = rows.length > 0 ? rows[rows.length - 1].asset_uid : null;
    return { systems: rows, nextCursor };
  } catch (error) {
    error.context = {
      ...error.context,
      service: 'listSystemsSvc',
      input: { limit, cursor }
    };
    throw error;
  }
}
```

**Example - Systems Repository (src/repositories/systems.repository.js:24-38):**

```javascript
export async function listSystems({ limit = 25, cursor } = {}) {
  const supabase = await checkSupabaseAvailability();
  let query = supabase.from(TABLE).select('*').order('asset_uid', { ascending: true }).limit(limit);
  if (cursor) {
    query = query.gt('asset_uid', cursor);
  }
  const { data, error } = await query;
  if (error) {
    const err = new Error(`Failed to list systems: ${error.message}`);
    err.cause = error;
    err.context = { operation: 'list', limit, cursor, table: TABLE };
    throw err;
  }
  return data ?? [];
}
```

**Forbidden:** Route files importing from repositories directly.

**Known Violations (Fix on Next Touch):**
| Category | Files |
|----------|-------|
| Chat routes | `list.route.js`, `history.route.js`, `context.route.js`, `delete.route.js`, `session-delete.route.js`, `thread-by-session.route.js`, `sessions.route.js`, `threads.route.js`, `messages.route.js` |
| Admin routes | `systems-minimal.route.js`, `systems.route.js`, `golden-tests.route.js`, `health.route.js`, `jobs.route.js`, `metrics.route.js`, `pinecone-admin.route.js`, `playbooks.route.js`, `suggestions.route.js`, `testing.route.js`, `upload.route.js` |

**How to Fix:** When modifying a violating file, create the service layer FIRST, then update the route to use it.

---

## Environment Variables

**The Rule:** Read env ONLY via `src/config/env.js` using `getEnv()`.

**Implementation (src/config/env.js:10-78):**
```javascript
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  PORT: z.string().optional(),
  PINECONE_API_KEY: z.string().optional(),
  PINECONE_INDEX: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  VISION_MODEL: z.string().optional().default('gpt-4o'),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  ADMIN_TOKEN: z.string().optional(),
  PYTHON_SIDECAR_URL: z.string().optional(),
  PYTHON_CHAT_TIMEOUT_MS: z.string().optional(),
  CHAT_CONTEXT_SIZE: z.string().optional().default('5'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  // Service disable flags for testing/CI
  PINECONE_DISABLED: z.string().optional(),
  SIDECAR_DISABLED: z.string().optional(),
  SUPABASE_DISABLED: z.string().optional(),
  OPENAI_DISABLED: z.string().optional()
  // ... 40+ more variables
}).refine((data) => {
  if (data.NODE_ENV === 'production') {
    if (!data.ADMIN_TOKEN) return false;
  }
  return true;
}, { message: "ADMIN_TOKEN is required in production" });

let MEMO;
export function getEnv({ loose = null } = {}) {
  if (MEMO) return MEMO;
  const nodeEnv = process.env.NODE_ENV || 'development';
  const shouldBeLoose = loose !== null ? loose : nodeEnv !== 'production';
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success && !shouldBeLoose) {
    throw new Error(`Environment validation failed: ${parsed.error.message}`);
  }
  MEMO = parsed.success ? parsed.data : {};
  return MEMO;
}
```

**Correct Usage:**
```javascript
import { getEnv } from './config/env.js';
const env = getEnv();
const apiKey = env.OPENAI_API_KEY;
```

**Wrong (Bypasses Validation):**
```javascript
const apiKey = process.env.OPENAI_API_KEY;  // ❌ NEVER
```

**Test Helpers (src/config/env.js:109-143):**
```javascript
// Reset memoized environment
export function resetEnvMemo() {
  MEMO = null;
}

// Set test environment overrides
export function setTestEnv(overrides) {
  const current = MEMO !== null ? MEMO : {};
  MEMO = { ...current };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) {
      delete MEMO[key];
    } else {
      MEMO[key] = value;
    }
  }
  return MEMO;
}

// Usage in tests:
resetEnvMemo();
setTestEnv({ PYTHON_SIDECAR_URL: 'http://localhost:8001' });
```

---

## Logging

**The Rule:** No `console.log`. Use `src/utils/logger.js`.

**Logger Class Structure (src/utils/logger.js:5-282):**
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
      return; // Skip file writes
    }

    // Development: Write to files
    // logs/chat/node-chat.log - Chat-related logs
    // logs/api/node-api.log - API requests (excluding health checks)
    // logs/errors/node-errors.log - Errors only
    // logs/debug/node-debug.log - Everything
  }
}
```

**Log Methods:**
| Method | Purpose |
|--------|---------|
| `logger.error(message, meta)` | Error level |
| `logger.warn(message, meta)` | Warning level |
| `logger.info(message, meta)` | Info level |
| `logger.debug(message, meta)` | Debug level |
| `logger.performance(operation, duration, meta)` | Performance metrics |
| `logger.security(event, userId, meta)` | Security events |
| `logger.chat(type, message, details, meta)` | Chat-specific logs |

**Request-Scoped Logger (correlation ID):**
```javascript
// Creates logger with correlation ID for tracing
const requestLogger = logger.createRequestLogger(correlationId, 'chat-route');
requestLogger.info('Chat request received', { userId, threadId });
// All logs from this request share the correlationId
```

**Module-Scoped Logger:**
```javascript
// In a service file
const moduleLogger = logger.createModuleLogger('chat-service');
moduleLogger.info('Processing message', { threadId, messageLength });
```

**Log Files (Development Only):**
```
logs/
├── chat/
│   └── node-chat.log    # Chat-related logs (module: 'chat')
├── api/
│   └── node-api.log     # API requests (excluding health checks)
├── errors/
│   └── node-errors.log  # Error level only
└── debug/
    └── node-debug.log   # Everything
```

**Exceptions (Must have eslint-disable):**
- Bootstrap code in `src/config/env.js` (before logger initialized)
- Debugging fallbacks with explicit comment

---

## HTTP Response Contract

**The Rule:** Every response follows `{ success, data?, error?, requestId? }`.

**Success Response:**
```javascript
return res.json({
  success: true,
  data: { systems: rows, nextCursor },
  requestId: res.locals.requestId
});
```

**Error Response:**
```javascript
return res.status(400).json({
  success: false,
  data: null,
  error: {
    code: ERR.BAD_REQUEST,
    message: 'Validation failed',
    details: err.issues
  },
  requestId: res.locals?.requestId ?? null
});
```

**Error Codes (src/constants/errorCodes.js):**
```javascript
export const ERR = {
  BAD_REQUEST: 'BAD_REQUEST',              // 400 (validation)
  UNAUTHORIZED: 'UNAUTHORIZED',            // 401 (missing admin token)
  FORBIDDEN: 'FORBIDDEN',                  // 403 (bad token)
  NOT_FOUND: 'NOT_FOUND',                  // 404 (unknown path)
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',// 405
  RATE_LIMITED: 'RATE_LIMITED',            // 429
  INTERNAL: 'INTERNAL',                    // 500
  ADMIN_DISABLED: 'ADMIN_DISABLED',        // 401 (admin not configured)
  PINECONE_DISABLED: 'PINECONE_DISABLED',  // 503 (service unavailable)
  SUPABASE_DISABLED: 'SUPABASE_DISABLED',  // 503
  OPENAI_DISABLED: 'OPENAI_DISABLED',      // 503
  SIDECAR_DISABLED: 'SIDECAR_DISABLED',    // 503
};
```

---

## Input Validation

**The Rule:** Validate at the route edge using Zod. Response validation gated by `RESPONSE_VALIDATE=1`.

**Validation Middleware (src/middleware/validate.js):**
```javascript
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const target = req[source]; // 'body', 'query', 'params'
    const result = schema.safeParse(target);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: ERR.BAD_REQUEST,
          message: 'Validation failed',
          details: result.error?.errors || result.error?.issues || []
        },
        requestId: res.locals?.requestId ?? null
      });
    }

    // Assign parsed data back (only for body)
    if (source === 'body') req[source] = result.data;
    next();
  };
}
```

**Usage in Routes:**
```javascript
import { validate } from '../../middleware/validate.js';

const createPlaybookSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional()
});

router.post('/', adminOnly, validate(createPlaybookSchema, 'body'), async (req, res) => {
  // req.body is now validated and typed
});
```

---

## Admin Authentication

**The Rule:** All `/admin/*` routes protected by parent router middleware.

### Token Reading (src/middleware/admin.js:6-18)

Tokens can be supplied via three methods (checked in order):

```javascript
function readAdminToken(req) {
  const h = req.headers;
  const x = h['x-admin-token'];
  const auth = h['authorization'];
  // 1. x-admin-token header (primary method)
  if (x && typeof x === 'string') return x.trim();
  // 2. Authorization: Bearer <token> header
  if (auth && typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  // 3. Query parameter ?token=<token> (needed for EventSource/SSE)
  const q = req.query?.token;
  if (q && typeof q === 'string') return q.trim();
  return null;
}
```

**Why query param?** The browser's `EventSource` API (used for SSE streaming, e.g., DIP extraction progress) cannot set custom headers. The `?token=` query parameter allows SSE endpoints to authenticate.

### Security Logging

Token values are never logged in full. Two masking functions protect credentials:

```javascript
// Mask: shows first 4 + last 4 chars with ellipsis
function mask(token) {
  // "abc123xyz" → "abc1…xyz", short tokens: "ab" → "**"
}

// Hash: SHA-256 truncated to 12 hex chars (for correlation without exposure)
function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0,12);
}
```

Failed auth logs `supplied: mask(supplied), supplied_sha: tokenHash(supplied)`.
Successful auth logs only `supplied_sha: tokenHash(supplied)` at debug level.

### Admin Gate (src/middleware/admin.js:31-66)

```javascript
export function adminGate(req, res, next) {
  const env = getEnv({ loose: true });
  const expected = env.ADMIN_TOKEN;
  const supplied = readAdminToken(req);

  if (!expected)  → 401 ERR.ADMIN_DISABLED  // Token not configured on server
  if (!supplied)  → 401 ERR.UNAUTHORIZED    // No token provided
  if (mismatch)   → 403 ERR.FORBIDDEN       // Wrong token (logged with mask + hash)
  // Success → next() (logged at debug level with hash only)
}

export const adminOnly = adminGate;
```

### Optional Admin Gate

For routes that work with or without admin access:

```javascript
export async function optionalAdminGate(req, res, next) {
  // Sets req.isAdmin = true/false based on token validity
  // Never rejects - always calls next()
}
```

### PIN-Based Client Auth (src/public/js/admin/auth.js)

Admin pages use a PIN-unlock flow instead of hardcoded tokens:

```
1. Page loads → checks localStorage for 'adminToken'
2. If no token → prompts user for PIN via window.prompt()
3. PIN submitted to POST /api/auth/pin
4. Server validates PIN → returns { success: true, token: "<admin-token>" }
5. Token stored in localStorage for future requests
6. All admin API calls use adminFetch() wrapper
```

**Key functions:**
| Function | Purpose |
|----------|---------|
| `getAdminToken()` | Read token from localStorage |
| `clearAdminToken()` | Remove stored token |
| `ensureAdminToken()` | Get token or prompt for PIN (loops until valid) |
| `adminFetch(url, options)` | Fetch wrapper with x-admin-token header, auto-retries on 401/403 |

**Auto-retry on auth failure:** If `adminFetch()` gets 401/403, it clears the stored token, re-prompts for PIN, and retries once. Handles FormData bodies by not setting Content-Type header.

### Admin Boot (src/public/js/admin/boot.js)

Initializes the admin dashboard SPA:
- Hydrates HTML includes via `hydrateIncludes()`
- Initializes section controllers (dashboard, docUpload, dip, jobs, chunks, metrics, health, systems, suggestions)
- Exposes `window.AdminState` with lazy token getter and `window.adminFetch` globally

### Parent Router Protection (src/routes/admin/index.js)

```javascript
router.use(adminOnly);  // Protects ALL child routes
router.use('/health', healthRouter);
router.use('/metrics', metricsRouter);
router.use('/ais', aisRouter);
// ... all protected automatically
```

**Individual Route Files:** Do NOT need explicit adminGate (redundant but not harmful).

---

## Security

**CORS Configuration (src/app.js:25-52):**
```javascript
const isDevOrTest = env.NODE_ENV === 'development' || env.NODE_ENV === 'test' || process.env.CI;
const allowedOrigins = isDevOrTest
  ? [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://192.168.20.106:3000',  // Local IP for mobile testing
      'http://192.168.20.106:3001'
    ]
  : [
      'https://chat.catamaranos.com',
      'https://admin.catamaranos.com',
      'https://boatos-main.onrender.com',
      'https://boatos-python.onrender.com',
      'https://boatos-maintenance.onrender.com'
    ];
```

**Body Limits (src/app.js:54-62):**
```javascript
app.use(express.json({ limit: '10mb' }));  // For base64 images
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
```

**Helmet (src/app.js:18-21):**
```javascript
app.use(helmet({
  contentSecurityPolicy: false,      // Disabled for development
  crossOriginEmbedderPolicy: false
}));
```

---

## Error Handling Pattern

**Repository Layer (wrap with context):**
```javascript
const { data, error } = await supabase.from(TABLE).select('*');
if (error) {
  const err = new Error(`Failed to list systems: ${error.message}`);
  err.cause = error;
  err.context = { operation: 'list', limit, cursor, table: TABLE };
  throw err;
}
```

**Service Layer (enhance context):**
```javascript
try {
  return await listSystems({ limit: safeLimit, cursor });
} catch (error) {
  error.context = {
    ...error.context,
    service: 'listSystemsSvc',
    input: { limit, cursor }
  };
  throw error;
}
```

**Centralized Handler (src/middleware/error.js:5-139):**
```javascript
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // Handle Zod validation errors → 400
  if (err instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      error: { code: ERR.BAD_REQUEST, message: 'Validation failed', details: err.issues }
    });
  }

  // Handle service guard errors → 503
  if (err.code === ERR.SUPABASE_DISABLED ||
      err.code === ERR.PINECONE_DISABLED ||
      err.code === ERR.OPENAI_DISABLED ||
      err.code === ERR.SIDECAR_DISABLED) {
    return res.status(503).json({
      success: false,
      error: { code: err.code, message: 'Service temporarily unavailable' }
    });
  }

  // Handle NOT_FOUND → 404
  if (err.code === ERR.NOT_FOUND || err.status === 404) {
    return res.status(404).json({
      success: false,
      error: { code: ERR.NOT_FOUND, message: err.message || 'Resource not found' }
    });
  }

  // Handle other errors → appropriate status
  const status = Number(err.status) || 500;
  if (status >= 500) {
    requestLogger.error('Server error', {
      error: err.message,
      stack: err.stack,
      url: req.url,
      equipmentContext: req.body?.systems_context?.map(s => ({
        manufacturer: s.manufacturer,
        model: s.model,
        asset_uid: s.asset_uid
      }))
    });
  }
  return res.status(status).json({ success: false, error: { code, message } });
}
```

---

## File Conventions

**File Naming:**
| Pattern | Purpose | Example |
|---------|---------|---------|
| `*.route.js` | Leaf endpoint handlers | `systems.route.js` |
| `*.router.js` | Barrel routers (aggregate routes) | `health.router.js` |
| `*.service.js` | Business logic services | `systems.service.js` |
| `*.repository.js` | Data access layer | `systems.repository.js` |
| `index.js` | Module entry points | `src/routes/admin/index.js` |

**File Size:**
- Soft limit: 250 lines per file
- Acceptable exceptions: Complex domain logic, tests, migrations
- Large files (43 files >250 lines) are documented technical debt

**Current Services (47 files):**
```
src/services/
├── chat-proxy.service.js         # Main chat orchestration
├── chat-orchestrator.service.js  # Chat flow coordination
├── document.service.js           # PDF parsing, chunking
├── equipment-extraction.service.js # LLM-based extraction
├── dip.service.js                # DIP extraction
├── pinecone-retrieval.service.js # Vector search
├── systems.service.js            # Equipment management
├── anchor-watch.service.js       # Anchor alarm logic
└── ... 39 more services
```

**Current Repositories (18 files):**
```
src/repositories/
├── supabaseClient.js             # Singleton DB connection
├── chat.repository.js            # Threads, messages, sessions
├── document.repository.js        # Uploads, chunks
├── systems.repository.js         # Equipment data
├── pinecone.repository.js        # Vector operations
└── ... 13 more repositories
```

**Forbidden in Git:**
- `node_modules/`
- `logs/`
- `*.pdf` (uploaded documents)
- `venv/`, `__pycache__/`
- Build artifacts

---

## Python Sidecar Rules

**Requirements Sync:**
```bash
# After pip install/uninstall
cd python-sidecar
pip freeze > requirements.txt  # ALWAYS keep synced
```

**Breaking Changes:**
- Propose first, then code
- Update `requirements.txt` in same commit as code change

**Forbidden in Git:**
- `venv/`
- `__pycache__/`

---

## Change Protocol

**Before ANY code change:**

1. **Understand the full context:**
   - What calls this function? (consumers)
   - What does this function call? (dependencies)
   - What other systems depend on this data structure?
   - Are there implicit contracts being relied upon?

2. **Plan thoroughly:**
   - Identify ALL files that will be touched
   - List potential side effects
   - Consider edge cases in marine context
   - Check for similar patterns elsewhere

3. **Discuss the plan BEFORE coding:**
   - Explain what will change and why
   - Highlight potential risks
   - Get explicit approval

**Schema/Data Changes:**
Every change ships with: SQL migration + Zod schema + tests + docs (same PR).

**Breaking API Changes:**
Propose first, then code. Document in PR.

---

## What We DON'T Do

| Anti-Pattern | Why Not |
|--------------|---------|
| Direct `process.env` access | Bypasses Zod validation |
| `console.log` in production code | Bypasses structured logging |
| Route → Repository imports | Violates layered architecture |
| `*.routes.js` file names | Legacy pattern, use `*.route.js` |
| Hardcode secrets | Use `.env` and ask to add variables |
| Skip admin middleware on `/admin/*` | Parent router handles it |
| Commit `node_modules`, `venv`, PDFs | Artifacts don't belong in git |
| Docker | Not used - Local dev, Render deployment, Pi deployment |
| CommonJS (`require`, `module.exports`) | ESM only |
| LangChain/LangGraph | Removed - Python sidecar uses direct OpenAI calls |

---

## Quick Compliance Check

```bash
# Check for console.log violations
grep -r "console\.log" src/ --include="*.js" | grep -v "src/utils/logger.js" | grep -v "eslint-disable"

# Check for process.env violations
grep -r "process\.env\." src/ --include="*.js" | grep -v "src/config/env.js"

# Check route→repository violations
grep -r "from.*repositories" src/routes/ --include="*.js"

# Check file naming
find src/routes -name "*.routes.js"  # Should return nothing
```

---

## Related Docs

- [environments.md](./environments.md) - Where services run (Local, Render, Pi)
- [ci-testing.md](./ci-testing.md) - Test suites and GitHub Actions
- [routes-variables.md](./routes-variables.md) - Complete API route and env var reference
