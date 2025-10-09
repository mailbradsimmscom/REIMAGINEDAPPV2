# Claude Code Quick Reference

**Project:** REIMAGINEDAPPV2 - Marine Equipment Technical Documentation System
**Last Updated:** 2025-10-09
**Compliance Status:** ✅ A Grade (Excellent)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  Frontend (Vanilla JS)                              │
│  - Admin dashboard: /admin                          │
│  - Testing tools: /admin/testing/*                  │
│  - Public chat: /                                   │
└─────────────────────────────────────────────────────┘
                          │
                          ↓
┌─────────────────────────────────────────────────────┐
│  Node.js Backend (Express, ESM)                     │
│  - Routes: HTTP handlers (thin, validation only)    │
│  - Services: Business logic                         │
│  - Repositories: DB/storage/network I/O             │
│  - Middleware: Auth, logging, validation            │
└─────────────────────────────────────────────────────┘
                          │
                          ↓
┌──────────────────────┬──────────────────────────────┐
│  Python Sidecar      │  External Services           │
│  (FastAPI)           │                              │
│  - Chat processing   │  - Supabase (PostgreSQL)     │
│  - Document parsing  │  - Pinecone (vector search)  │
│  - LLM integration   │  - OpenAI API                │
└──────────────────────┴──────────────────────────────┘
```

---

## Key Patterns (Follow .cursorrules)

### 1. Layered Architecture
```javascript
// ✅ CORRECT
routes/*.route.js → services/*.service.js → repositories/*.repository.js

// ❌ WRONG (20 known violations - fix on next touch)
routes/*.route.js → repositories/*.repository.js  // Skips service layer
```

### 2. Environment Variables
```javascript
// ✅ CORRECT
import { getEnv } from './config/env.js';
const env = getEnv();
const apiKey = env.OPENAI_API_KEY;

// ❌ WRONG
const apiKey = process.env.OPENAI_API_KEY;  // Bypasses Zod validation
```

### 3. Logging
```javascript
// ✅ CORRECT
import { logger } from './utils/logger.js';
const requestLogger = logger.createRequestLogger();
requestLogger.info('User action', { userId, action });

// ❌ WRONG
console.log('User action:', userId);  // Bypasses structured logging
```

### 4. HTTP Responses
```javascript
// ✅ CORRECT
return res.json({
  success: true,
  data: { ... },
  requestId: res.locals.requestId
});

// ❌ WRONG
return res.json({ result: { ... } });  // Wrong envelope format
```

### 5. Admin Security
```javascript
// ✅ CORRECT (Parent router protection)
// src/routes/admin/index.js
router.use(adminOnly);  // Protects ALL child routes
router.use('/health', healthRouter);

// ❌ WRONG (Redundant, but not harmful)
// In each child route file:
router.use(adminGate);  // Already protected by parent
```

---

## File Locations

### Configuration
- **Environment:** `src/config/env.js` (Zod schema + validation)
- **CORS:** `src/app.js:19-28` (environment-based allowlist)
- **Logging:** `src/utils/logger.js` (Winston setup)

### Key Services
- **Chat Proxy:** `src/services/chat-proxy.service.js` (main chat orchestration)
- **Document Processing:** `src/services/document.service.js` (PDF parsing, chunking)
- **Equipment Extraction:** `src/services/equipment-extraction.service.js` (LLM-based)

### Repositories
- **Supabase Client:** `src/repositories/supabaseClient.js` (singleton connection)
- **Chat:** `src/repositories/chat.repository.js` (threads, messages, sessions)
- **Document:** `src/repositories/document.repository.js` (uploads, chunks)

### Admin Routes
- **Main Router:** `src/routes/admin/index.js` (applies adminOnly middleware to all)
- **Protected APIs:** All under `/admin/api/*` (requires x-admin-token header)

### Frontend
- **Admin Dashboard:** `src/public/admin.htm` + `src/public/js/admin/`
- **Testing Tools:** `src/public/testing*.html`

---

## Common Commands

### Development
```bash
# Start Node.js server (port 3000)
npm run dev

# Start Python sidecar (port 8000)
cd python-sidecar
source venv/bin/activate
python3 -m app.main

# Run both services
./restart-all.sh
```

### Testing
```bash
# Test admin endpoint (requires token from .env)
curl -H "x-admin-token: $ADMIN_TOKEN" http://localhost:3000/admin/api/health

# Test Python sidecar
curl http://localhost:8000/health

# Check logs
tail -f logs/debug/node-debug.log
tail -f python-sidecar/logs/chat.log
```

### Python Environment
```bash
# After pip install/uninstall
cd python-sidecar
pip freeze > requirements.txt  # IMPORTANT: Keep synced
```

### Compliance Checks
```bash
# Check for console.log violations
grep -r "console\.log" src/ --include="*.js" | grep -v "src/utils/logger.js" | grep -v "src/public" | grep -v "eslint-disable"

# Check for process.env violations
grep -r "process\.env\." src/ --include="*.js" | grep -v "src/config/env.js"

# Check route→repository imports
grep -r "from.*repositories" src/routes/ --include="*.js"
```

---

## Current Status & Priorities

### ✅ Recently Completed (2025-10-09)
- Removed 1,391 node_modules files from git
- Removed PDF artifacts from git
- Fixed CORS to use environment-based allowlist
- Documented all 20 route→repository violations in .cursorrules
- Achieved Grade A compliance (was B+ with CORS violation)

### ⚠️ Known Technical Debt (Managed)
**Route → Repository Violations (20 files):**
- Strategy: "Fix on next touch"
- When modifying these files, create service layer FIRST
- Files listed in .cursorrules lines 32-51

**Large Files (43 files >250 lines):**
- Soft limit, acceptable for complex domain logic
- Top offenders: app.js (938), document.service.js (830), chat.repository.js (811)

### 🔄 Next Priorities
1. Create service layers when touching the 20 documented route violations
2. Update production domain in CORS allowlist before deployment (src/app.js:22)
3. Consider refactoring largest files if they grow significantly

---

## Important Notes

### Before Deployment to Production
1. **Update CORS:** Change `src/app.js:22` to your actual domain
2. **Set Environment:** `NODE_ENV=production` in production env
3. **Admin Token:** Update `ADMIN_TOKEN` in production .env (currently hardcoded for dev)
4. **Database:** Verify Supabase connection strings for production

### Session Recovery After /compact
If conversation gets compacted and context is lost:

**Quick Recovery Commands:**
```bash
# Check current compliance status
cat .cursorrules | tail -20

# Check git status
git status
git log --oneline -5

# Find recent changes
ls -lt "code updates/" | head -10

# Test services are running
curl http://localhost:3000/health
curl http://localhost:8000/health
```

**Key Files to Read:**
- `.cursorrules` - Coding standards and compliance status
- `CLAUDE.md` - This file (architecture overview)
- `code updates/` - Detailed session documentation (sorted by date)

---

## Documentation

- **Code Standards:** `.cursorrules`
- **Session Logs:** `/code updates/` (timestamped markdown files)
- **Latest Audit:** `/code updates/17 Environment and Logging Compliance Cleanup.md`
- **Compliance Report:** See "Compliance Status" section in `.cursorrules`

---

## Quick Architecture Decisions

**Why Node.js + Python Sidecar?**
- Node.js: Fast API server, handles HTTP, DB, auth
- Python: Heavy lifting (LLM calls, document parsing, ML tasks)

**Why Supabase?**
- Managed PostgreSQL with real-time subscriptions
- Row-level security
- Built-in auth (not currently used)

**Why Pinecone?**
- Vector database for semantic search
- Stores document chunks as embeddings
- Fast similarity search for technical docs

**Why ESM Only?**
- Modern JavaScript standard
- Better tree-shaking
- Native Node.js support (no transpilation)

---

**For detailed implementation info, see `.cursorrules` and recent files in `/code updates/`**
