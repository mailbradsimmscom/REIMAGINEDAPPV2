# Hardcoded Values & Code Duplication Audit

**Date:** 2026-02-23
**Scope:** Full codebase audit of `src/`, `python-sidecar/app/`, and frontend files
**Trigger:** Concern about Claude Code sessions introducing hardcoded values and duplicate code islands

---

## 1. Hardcoded Model Names — No Env Fallback (HIGH)

These files hardcode LLM model names with **no env var fallback**. A model upgrade requires finding and updating each one manually:

| File | Hardcoded | Should Use |
|------|-----------|------------|
| `src/services/thread-naming.service.js:81` | `gpt-4o-mini` | `OPENAI_SUMMARY_MODEL` |
| `src/services/equipment-relationship-inference.service.js:228` | `gpt-4o-mini` | `OPENAI_SUMMARY_MODEL` |
| `src/services/suggestions/intent.suggestions.js:20` | `gpt-4o-mini` | `OPENAI_SUMMARY_MODEL` |
| `python-sidecar/app/main.py:4770` | `gpt-4o-mini` | `OPENAI_SUMMARY_MODEL` |
| `python-sidecar/app/chat/services/doc_assets_retriever.py:331` | `gpt-4o-mini` | `OPENAI_SUMMARY_MODEL` |

---

## 2. `OPENAI_SUMMARY_MODEL` Missing from Zod Schema (HIGH)

6+ services reference `env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini'` but the variable is **not declared** in `src/config/env.js`. It works because Zod `.passthrough()` lets unknown keys through, but there's no validation, no default, and no documentation.

**Fix:** Add to env.js Zod schema with default `'gpt-4o-mini'`.

---

## 3. Embedding Model Hardcoded (HIGH)

`text-embedding-3-large` is hardcoded in 4+ files with no `EMBEDDING_MODEL` env var:

| File | Model | Dimensions |
|------|-------|------------|
| `src/services/pinecone-rag.service.js:73` | `text-embedding-3-large` | 3072 |
| `src/services/document.service.js:312` | `text-embedding-3-large` | 3072 |
| `python-sidecar/app/chunking/embeddings.py` | `text-embedding-3-large` | 3072 |
| `python-sidecar/app/pinecone_client.py` | `text-embedding-3-large` | 3072 |
| `src/services/agents/dip-exemplar.service.js:30` | `text-embedding-3-small` | 1536 (!) |

Note: `dip-exemplar.service.js` uses a **different embedding model** (`small` vs `large`). This is either intentional or a bug — different dimensions means vectors are incompatible.

---

## 4. Frontend Hardcoded Service URLs (MEDIUM)

10+ instances of Render production URLs and localhost scattered across HTML/JS files:

| File | Hardcoded |
|------|-----------|
| `src/public/weather-areas.html:260-261` | `localhost:3001`, `boatos-maintenance.onrender.com` |
| `src/public/weather-area-view.html:347-348` | `localhost:3001`, `boatos-maintenance.onrender.com` |
| `src/public/weather-area-add.html:292` | `localhost:3001` |
| `src/public/unified-mobile.html:410-427` | `localhost:3001` (3x), domain mapping |
| `src/public/unified-dashboard.html:252-261` | `localhost:3001` (2x) |
| `src/public/js/mobile-hamburger.js:21-28` | `boatos-main.onrender.com` domain check (3x) |
| `src/public/js/mobile-nav.js:130-143` | `boatos-main.onrender.com` domain check (2x) |

These use a pattern of checking `window.location.hostname` and swapping localhost for Render URLs. Should be centralized in a shared config module.

---

## 5. `process.env` Violations (MINOR)

| File | Line | Violation |
|------|------|-----------|
| `src/app.js` | 33 | `process.env.CI` — bypasses Zod schema |
| `src/debug/routes.js` | 54-56 | `process.env.NODE_ENV` (2x), `process.env.ENABLE_ROUTE_DEBUG` |

**Fix:** Add `CI` and `ENABLE_ROUTE_DEBUG` to env.js schema, use `getEnv()`.

---

## 6. Pinecone Namespace Conflict (MINOR)

| File | Default Namespace |
|------|-------------------|
| `src/routes/admin/pinecone.route.js:32` | `'__default__'` |
| `src/routes/admin/pinecone-admin.route.js:32` | `'REIMAGINEDDOCS'` |
| `python-sidecar/app/pinecone_client.py:16` | `'REIMAGINEDDOCS'` |

`pinecone.route.js` defaults to `'__default__'` while everything else uses `'REIMAGINEDDOCS'`. Should be standardized.

---

## 7. Python Has No Centralized Config (MEDIUM)

Node.js has `src/config/env.js` with Zod validation — excellent pattern. Python has **12+ env vars** accessed via scattered `os.getenv()` calls with inconsistent defaults and no validation:

`LOG_LEVEL`, `ENVIRONMENT`, `CHAT_DEBUG_LOGGING`, `CHAT_MODEL`, `OPENAI_TEMPERATURE`, `PERPLEXITY_ENABLED`, `PERPLEXITY_API_KEY`, `PERPLEXITY_MODEL`, `PERPLEXITY_TIMEOUT`, `ANTHROPIC_MODEL`, `COHERE_API_KEY`, `MODEL_DETECTION_MODEL`

**Fix:** Create `python-sidecar/app/config.py` mirroring the Node pattern with Pydantic validation.

---

## 8. DIP Service Duplication (MEDIUM)

Three overlapping DIP services:

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| `src/services/dip.service.js` | 162 | Older class-based DIP | Possibly legacy |
| `src/services/v5-dip.service.js` | 190 | Newer functional DIP | Active |
| `src/services/dip-stream.service.js` | 180 | Streaming/callback DIP | Active (used by runner) |

Both `dip-stream.service.js` and `python-sidecar.client.js` implement **identical SSE parsing logic** independently (~30 lines each).

**Fix:** Consolidate, determine if `dip.service.js` is still needed, extract SSE parser to shared utility.

---

## 9. OpenAI Client Bypassed by 7 Services (MEDIUM)

`src/clients/openai.client.js` provides `oaiJson`, `oaiText`, `oaiVision` with centralized retry, logging, and model config. But 7 services bypass it with direct `new OpenAI()`:

- `src/services/equipment-extraction.service.js`
- `src/services/llm.service.js`
- `src/services/rerank.service.js`
- `src/services/equipment-relationship-inference.service.js`
- (and 3 others)

These miss centralized retry logic, logging, and model configuration.

---

## 10. Background Runner Duplication (LOW — already tracked)

`v5-parse-detect-runner.service.js` (435 lines) and `v5-ingest-runner.service.js` (485 lines) share ~50 lines of identical heartbeat/job/staleness infrastructure. Already tracked in `.cursorrules` as tech debt.

---

## What's Well Done

| Area | Status | Notes |
|------|--------|-------|
| Supabase queries | Excellent | Properly isolated in repositories, no duplication |
| Admin fetch | Excellent | Centralized in `auth.js`, all admin sections use it |
| Sidecar fetch | Good | `sidecar-fetch.js` is solid, most services use it |
| HTTP envelope | Excellent | Consistent `{ success, data?, error? }` across 191 uses |
| Pinecone namespace | Good | Most files use env fallback to `REIMAGINEDDOCS` |

---

## Recommended Fix Priority

| # | Issue | Impact | Effort |
|---|-------|--------|--------|
| 1 | Add `OPENAI_SUMMARY_MODEL` + `EMBEDDING_MODEL` to env.js schema | Model upgrades break silently | Small |
| 2 | Fix 5 files with no env fallback for model names | Same risk | Small |
| 3 | Create Python `config.py` with centralized env validation | Scattered defaults, no validation | Medium |
| 4 | Consolidate DIP services + extract SSE parser utility | 3 overlapping files | Medium |
| 5 | Migrate 7 services to use `openai.client.js` | Bypasses retry/logging/config | Medium |
| 6 | Centralize frontend service URL config | 10+ hardcoded Render URLs | Medium |
| 7 | Extract background runner common infrastructure | Duplicated heartbeat/job logic | Small |
| 8 | Fix `process.env` violations (2 files) | Bypasses Zod validation | Tiny |
| 9 | Fix Pinecone namespace conflict | Could index to wrong namespace | Tiny |
