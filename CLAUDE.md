# Claude Code Quick Reference

**Project:** REIMAGINEDAPPV2 - AI-Powered Boat/OS for Catamarans
**Last Updated:** 2025-10-09
**Compliance Status:** ✅ A Grade (Excellent)

---

## Context: What We're Building

We are building an **AI-powered boat operating system for catamarans** in the marine environment.

**The Challenge:**
- **Marine environment is highly complex** - not like typical software domains
- **200+ different systems** on a catamaran that appear disconnected but are deeply interconnected
- Small changes can have cascading effects across multiple systems
- Equipment from different manufacturers must work together seamlessly
- Technical documentation is dense, inconsistent, and system-specific

**What This System Does:**
- Ingests technical manuals (PDFs) for marine equipment
- Chunks and vectorizes documentation for semantic search
- Provides AI-powered chat interface for boat owners and technicians
- Extracts equipment specifications, maintenance schedules, and troubleshooting guides
- Understands relationships between systems (e.g., power → pumps → plumbing → safety)

**Why This Matters:**
- A water pump failure might indicate electrical issues, affect refrigeration, impact safety systems
- Understanding system interconnections is critical for accurate assistance
- Incorrect advice in a marine environment can be dangerous or expensive

---

## 🚨 CRITICAL RULES (Read First, Every Session)

### Rule #1: No Code Changes Without Approval
**NEVER write, edit, or modify code without explicit user approval.**

This means:
- ✅ Analyze code, explain patterns, search files, answer questions
- ✅ Propose changes, create plans, discuss approaches
- ❌ Write/Edit/Bash commands that modify files (without asking first)
- ❌ "Quick fixes" or "while I'm here" changes

**Why:** Small changes in interconnected systems can have unexpected ripple effects.

---

### Rule #2: Very Detailed Planning to Avoid Regression

**Before ANY code change:**

1. **Understand the full context** - Look up AND down the chain:
   - What calls this function? (consumers)
   - What does this function call? (dependencies)
   - What other systems depend on this data structure?
   - Are there implicit contracts being relied upon?

2. **Plan thoroughly:**
   - Identify all files that will be touched
   - List potential side effects
   - Consider edge cases in marine context
   - Check for similar patterns elsewhere that might need same fix

3. **Discuss the plan with the user BEFORE coding**
   - Explain what will change and why
   - Highlight potential risks
   - Get explicit approval

**Why:** In a system with 200+ interconnected components, "obvious" changes often break unexpected things. Better to spend 10 minutes planning than 2 hours debugging cascading failures.

**Example:**
```
❌ WRONG: "I'll just update this API response format"
✅ RIGHT: "This API is used by 3 frontend components and 2 admin tools.
           Changing the format will require updating all 5 consumers.
           Here's the plan: [detailed steps]. Approve before proceeding?"
```

---

### Rule #3: Use the Live DB Schema — Never Guess

**NEVER assume database schema from migration files.** Migration files may be outdated, incomplete, or tables may have been created directly in Supabase.

**Instead, use the live schema dump:**

```bash
# Generate/refresh the live schema snapshot
node scripts/migrations/actual/dump-live-schema.mjs
```

This creates a dated folder at `scripts/migrations/actual/<YYYY-MM-DD>_tables/` containing:
- `_schema_summary.md` — All tables with row counts, column counts, FK counts, index counts
- `<table_name>.md` — Per-table: columns, types, nullability, defaults, PKs, FKs, indexes, constraints
- `functions.md` — All 200+ RPC function signatures with full SQL bodies
- `foreign_keys.md` — Complete FK relationship map
- `views.md` — View definitions

**Before ANY work involving database tables:**
1. Check for the most recent `*_tables/` folder in `scripts/migrations/actual/`
2. Read the relevant table `.md` file(s) for ground truth
3. If the snapshot looks stale, re-run the dump script

**Why:** Tables like `ref_canonical_models` and `ref_model_synonyms` exist in the live DB but have NO migration files. Relying on migration files alone will produce wrong assumptions.

---

### Rule #4: Keep /docs Updated

The `/docs` directory is the official documentation for this codebase. It must stay current with code changes.

**When to update docs:**

| Change Type | Action Required |
|-------------|-----------------|
| New route/endpoint | Run `npm run docs:all`, update `20-admin-tools/` or `10-user-features/` |
| New user feature | Add/update file in `docs/10-user-features/` |
| New admin tool | Add/update file in `docs/20-admin-tools/` |
| API changes | Update `docs/API_REFERENCE.md` |
| New env variable | Update `docs/VARIABLE_REFERENCE.md` |
| Architecture change | Update `docs/architecture-diagram.md` |
| Backend/script changes | Update `docs/30-backend/` |

**Commands:**
```bash
# Regenerate auto-generated docs (routes, deps, OpenAPI)
npm run docs:all

# Preview docs locally
npm run docs
```

**Doc structure:**
- `00-foundations/` — Core concepts, CI, environments
- `05-operations/` — Dashboard, logging, monitoring
- `10-user-features/` — End-user feature docs (chat, maintenance, weather, etc.)
- `20-admin-tools/` — Admin feature docs (documents, systems, pinecone)
- `30-backend/` — Backend docs (sidecar, scripts, agents)
- `auto/` — Auto-generated (do not edit manually)

**Why:** Documentation is how future sessions (and humans) understand the system. Outdated docs cause confusion and wrong assumptions.

---

## Additional Rules (.cursorrules)

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

### Database Schema (Source of Truth)
- **Live schema dump:** `scripts/migrations/actual/<YYYY-MM-DD>_tables/` (run `node scripts/migrations/actual/dump-live-schema.mjs` to refresh)
- **DO NOT rely on** `scripts/migrations/*.sql` for current schema — they may be incomplete

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

## 🚀 Render Deployment Sync

### Services on Render (US East)
| Service | URL | Purpose |
|---------|-----|---------|
| **boatos-main** | boatos-main.onrender.com | Node.js backend |
| **boatos-python** | boatos-python.onrender.com | Python sidecar (chat, LLM) |
| **boatos-maintenance** | boatos-maintenance.onrender.com | Maintenance agent |

### ⚠️ Environment Variables - MUST MATCH LOCAL

When changing these locally, **UPDATE RENDER TOO**:

| Variable | Local (.env) | Render Service | Impact if Wrong |
|----------|--------------|----------------|-----------------|
| `OPENAI_MODEL` | `gpt-5.1-chat-latest` | boatos-python | Wrong model = slow/different responses |
| `PYTHON_SIDECAR_URL` | `http://localhost:8000` | boatos-main | Use `http://boatos-python:10000` on Render (internal URL) |
| `SUPABASE_URL` | same | both | DB connection fails |
| `SUPABASE_SERVICE_KEY` | same | both | DB auth fails |
| `OPENAI_API_KEY` | same | boatos-python | LLM calls fail |
| `PINECONE_API_KEY` | same | boatos-python | Vector search fails |
| `ADMIN_TOKEN` | same | both | Admin auth fails |

### Render Internal Networking

**IMPORTANT:** Services should communicate via internal URLs, not public:

```
# ❌ WRONG (adds 100-300ms per call)
PYTHON_SIDECAR_URL=https://boatos-python.onrender.com

# ✅ CORRECT (internal network, ~1ms)
PYTHON_SIDECAR_URL=http://boatos-python:10000
```

### Deployment Checklist

Before/after making changes that affect production:

1. **Check env var sync:**
   ```bash
   # Compare local model config
   grep -E "OPENAI_MODEL|PYTHON_SIDECAR" .env
   ```
   Then verify Render Dashboard → Service → Environment matches

2. **Check deployed commit:**
   ```bash
   git log --oneline -1
   ```
   Compare with Render Dashboard → Service → Events (last deploy commit)

3. **Test after deploy:**
   ```bash
   curl -w "\nTime: %{time_total}s\n" https://boatos-main.onrender.com/health
   ```

### Common Issues

| Symptom | Likely Cause |
|---------|--------------|
| Chat 3-5x slower on Render than local | Wrong `PYTHON_SIDECAR_URL` (using public URL) or wrong `OPENAI_MODEL` |
| "Route not found" errors | Code not deployed, check git commit match |
| LLM responses different | `OPENAI_MODEL` mismatch between local and Render |
| Timeout errors | Service cold start, or wrong internal URL |

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
