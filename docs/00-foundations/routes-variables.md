# Routes & Environment Variables

## Overview

Complete reference for all API routes (167 total) and environment variables. Check here before adding new routes or changing configuration.

**Route Count by Category:**
| Category | Count | Auth Required |
|----------|-------|---------------|
| Public | ~10 | No |
| Chat | ~12 | No |
| Systems | 3 | No |
| Documents | ~8 | Admin |
| Supplies | ~8 | No |
| Trips | ~5 | No |
| Admin | ~120 | Admin |
| Health | 5 | No |

---

## Public Routes

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/` | Main chat page | `src/app.js` |
| GET | `/health` | Health check | `src/routes/health.router.js` |
| GET | `/health/services` | Service status | `src/routes/health.router.js` |
| GET | `/health/ready` | Readiness probe | `src/routes/health.router.js` |
| GET | `/health/live` | Liveness probe | `src/routes/health.router.js` |
| GET | `/health/monitoring` | Monitoring data | `src/routes/health.router.js` |
| GET | `/landing` | Landing page | `src/app.js` |
| GET | `/public/*` | Static files | `src/app.js` |
| GET | `/styles.css` | Main CSS | `src/app.js` |
| GET | `/app.js` | Main JS | `src/app.js` |

---

## Chat Routes (`/chat`)

No auth required. Mounted in `src/routes/chat/index.js`.

| Method | Path | Purpose | File |
|--------|------|---------|------|
| POST | `/chat/process` | Process message (JSON response) | `process.route.js` |
| POST | `/chat/process?stream=true` | Process message (SSE stream) | `process.route.js` |
| GET | `/chat/list` | List all threads | `list.route.js` |
| GET | `/chat/history` | Get thread messages | `history.route.js` |
| GET | `/chat/context` | Get thread context | `context.route.js` |
| DELETE | `/chat/delete` | Delete thread | `delete.route.js` |
| DELETE | `/chat/session` | Delete session | `session-delete.route.js` |
| GET | `/chat/threads/:threadId` | Get thread by session | `thread-by-session.route.js` |
| POST | `/chat/sessions` | Create session | `sessions.route.js` |
| GET | `/chat/sessions/:sessionId` | Get session | `sessions.route.js` |
| POST | `/chat/threads` | Create thread | `threads.route.js` |
| GET | `/chat/threads/:threadId` | Get thread | `threads.route.js` |
| POST | `/chat/messages` | Add message | `messages.route.js` |
| GET | `/chat/messages/:threadId` | Get messages | `messages.route.js` |
| DELETE | `/chat/messages/:threadId/:seq` | Delete message | `messages.route.js` |

---

## Systems Routes (`/systems`)

No auth required. Mounted via `src/routes/systems.router.js`.

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/systems` | List all systems | `systems.router.js` |
| GET | `/systems/search?q=X` | Search systems | `systems.router.js` |
| GET | `/systems/:assetUid` | Get system details | `systems.router.js` |

---

## Supplies Routes (`/api/supplies`)

No auth required. Mounted via `src/routes/supplies/index.js`.

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/api/supplies` | List supplies | `supplies.route.js` |
| POST | `/api/supplies` | Create supply | `supplies.route.js` |
| PUT | `/api/supplies/:id` | Update supply | `supplies.route.js` |
| DELETE | `/api/supplies/:id` | Delete supply | `supplies.route.js` |
| POST | `/api/supplies/analyze-photo` | AI photo analysis | `supplies.route.js` |
| GET | `/api/supplies/config` | Get config | `config.route.js` |

---

## Trips Routes (`/trips`)

No auth required. Mounted via `src/routes/trips/index.js`.

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/trips` | List trips | `trips.route.js` |
| POST | `/trips` | Create trip | `trips.route.js` |
| GET | `/trips/:id` | Get trip details | `trips.route.js` |

---

## GPS Routes (`/gps`)

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/gps/position` | Get current position | `gps.route.js` |
| POST | `/gps/position` | Update position | `gps.route.js` |

---

## Admin Routes (`/admin/api/*`)

**All require `x-admin-token` header.** Mounted in `src/routes/admin/index.js`.

### Health & Monitoring

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/admin/api/health` | Admin health | `health.route.js` |
| GET | `/admin/api/health/connectivity` | Service connectivity | `health.route.js` |
| GET | `/admin/api/dashboard` | Dashboard data | `dashboard.route.js` |
| GET | `/admin/api/logs` | View logs | `logs.route.js` |
| GET | `/admin/api/metrics` | System metrics | `metrics.route.js` |

### Systems

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/admin/api/systems` | List systems | `systems.route.js` |
| GET | `/admin/api/systems/lookup` | Lookup system | `systems.route.js` |
| GET | `/admin/api/systems/minimal` | Minimal list | `systems-minimal.route.js` |
| GET | `/admin/api/manufacturers` | List manufacturers | `manufacturers.route.js` |
| GET | `/admin/api/models` | List models | `models.route.js` |

### Documents

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/admin/api/docs/documents` | List documents | Document routes |
| GET | `/admin/api/docs/ingest/:id` | Ingest status | Document routes |
| POST | `/admin/api/docs/ingest` | Start ingest | Document routes |
| GET | `/admin/api/upload/documents` | Upload list | `upload.route.js` |
| DELETE | `/admin/api/document-deletion/*` | Delete document | `document-deletion.route.js` |

### Jobs

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/admin/api/jobs` | List jobs | `jobs.route.js` |
| GET | `/admin/api/jobs/queue` | Job queue | `jobs.route.js` |
| GET | `/admin/api/jobs/:jobId` | Job details | `jobs.route.js` |
| GET | `/admin/api/jobs/status` | Queue status | `jobs.route.js` |
| POST | `/admin/api/jobs/process-next` | Process next | `jobs.route.js` |

### Pinecone

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/admin/api/pinecone` | Pinecone status | `pinecone.route.js` |
| GET | `/admin/api/pinecone/models` | Vector models | `pinecone-admin.route.js` |
| POST | `/admin/api/pinecone/chunks` | Query chunks | `pinecone-admin.route.js` |
| DELETE | `/admin/api/pinecone/chunks` | Delete chunks | `pinecone-admin.route.js` |

### Testing

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/admin/api/testing/dashboard` | Test dashboard | `testing.route.js` |
| GET | `/admin/api/testing/:table` | Get table | `testing.route.js` |
| POST | `/admin/api/testing/:table/approve` | Approve | `testing.route.js` |
| POST | `/admin/api/testing/:table/decline` | Decline | `testing.route.js` |
| GET | `/admin/api/golden-tests/pending` | Pending tests | `golden-tests.route.js` |
| POST | `/admin/api/golden-tests/:id/approve` | Approve test | `golden-tests.route.js` |
| POST | `/admin/api/golden-tests/:id/reject` | Reject test | `golden-tests.route.js` |
| POST | `/admin/api/golden-tests/approve` | Bulk approve | `golden-tests.route.js` |
| GET | `/admin/api/test-results` | Test results | `test-results.route.js` |
| GET | `/admin/api/test-results/history` | Result history | `test-results.route.js` |
| GET | `/admin/api/test-results/:runId` | Run details | `test-results.route.js` |
| POST | `/admin/api/test-results/trigger` | Trigger run | `test-results.route.js` |
| GET | `/admin/api/test-analysis/:runId` | Analyze run | `test-analysis.route.js` |

### Suggestions

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/admin/api/suggestions/pending` | Pending suggestions | `suggestions.route.js` |
| POST | `/admin/api/suggestions/approve` | Approve suggestion | `suggestions.route.js` |

### Playbooks

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/admin/api/playbooks` | List playbooks | `playbooks.route.js` |
| GET | `/admin/api/playbooks/stats` | Playbook stats | `playbooks.route.js` |
| GET | `/admin/api/playbooks/:id` | Get playbook | `playbooks.route.js` |
| POST | `/admin/api/playbooks` | Create playbook | `playbooks.route.js` |
| PUT | `/admin/api/playbooks/:id` | Update playbook | `playbooks.route.js` |
| DELETE | `/admin/api/playbooks/:id` | Delete playbook | `playbooks.route.js` |
| POST | `/admin/api/playbooks/generate` | Generate playbook | `playbooks.route.js` |

### Maintenance

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/admin/api/maintenance/tasks` | List tasks | `maintenance.route.js` |
| GET | `/admin/api/maintenance/stats` | Task stats | `maintenance.route.js` |
| POST | `/admin/api/maintenance/tasks/:id/approve` | Approve task | `maintenance.route.js` |
| POST | `/admin/api/maintenance/tasks/:id/reject` | Reject task | `maintenance.route.js` |
| GET | `/admin/api/maintenance-tasks/list` | Task list | `maintenance-tasks.route.js` |
| GET | `/admin/api/maintenance-tasks/:id` | Task details | `maintenance-tasks.route.js` |
| PATCH | `/admin/api/maintenance-tasks/:id` | Update task | `maintenance-tasks.route.js` |
| DELETE | `/admin/api/maintenance-tasks/:id` | Delete task | `maintenance-tasks.route.js` |
| POST | `/admin/api/maintenance-tasks/bulk-update-status` | Bulk update | `maintenance-tasks.route.js` |
| GET | `/admin/api/maintenance-tasks/stats` | Stats | `maintenance-tasks.route.js` |

### Duplicate Review

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/admin/api/duplicate-review/candidates` | Get candidates | `duplicate-review.route.js` |
| POST | `/admin/api/duplicate-review/decision` | Submit decision | `duplicate-review.route.js` |
| GET | `/admin/api/duplicate-review/stats` | Stats | `duplicate-review.route.js` |

### Anchor Watch

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/admin/api/anchor-watch/*` | Anchor watch data | `anchor-watch.route.js` |

### Telemetry

| Method | Path | Purpose | File |
|--------|------|---------|------|
| GET | `/admin/api/telemetry/current` | Current telemetry | `telemetry.route.js` |
| GET | `/admin/api/telemetry/battery` | Battery status | `telemetry.route.js` |
| GET | `/admin/api/telemetry/solar` | Solar status | `telemetry.route.js` |
| GET | `/admin/api/telemetry/tanks` | Tank levels | `telemetry.route.js` |

### Text Extraction

| Method | Path | Purpose | File |
|--------|------|---------|------|
| POST | `/admin/api/text-extraction/*` | Extract text | `text-extraction.route.js` |

---

## Python Sidecar Routes (port 8000)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| POST | `/chat` | Process chat message |
| POST | `/chat/stream` | Streaming chat |
| POST | `/parse` | Parse PDF |
| POST | `/chunk` | Chunk document |
| POST | `/embeddings` | Generate embeddings |
| POST | `/dip/extract` | Extract DIPs |
| POST | `/dip/process` | Process DIP packet |

---

## Environment Variables

### Required (Production)

| Variable | Purpose | Example |
|----------|---------|---------|
| `SUPABASE_URL` | Database URL | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Service role key | `eyJ...` |
| `OPENAI_API_KEY` | OpenAI API | `sk-...` |
| `PINECONE_API_KEY` | Vector search | `pc-...` |
| `PINECONE_INDEX` | Index name | `boatos-docs` |
| `ADMIN_TOKEN` | Admin auth | (secret) |

### Core Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3000` | HTTP port |
| `PYTHON_SIDECAR_URL` | `http://localhost:8000` | Sidecar URL |
| `PYTHON_CHAT_TIMEOUT_MS` | - | Chat timeout |

### LLM Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENAI_MODEL` | `gpt-4o` | Main model |
| `VISION_MODEL` | `gpt-4o` | Vision model |
| `CHAT_CONTEXT_SIZE` | `5` | Context window |

### Pinecone

| Variable | Default | Purpose |
|----------|---------|---------|
| `PINECONE_INDEX` | - | Index name |
| `PINECONE_NAMESPACE` | - | Namespace |
| `DEFAULT_NAMESPACE` | - | Default namespace |
| `SEARCH_RANK_FLOOR` | - | Min search rank |

### Supabase

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_KEY` | Service role key |
| `SUPABASE_ANON_KEY` | Anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Alias |
| `SERVICE_ROLE_KEY` | Alias |
| `PY_SUPABASE_SERVICE_KEY` | Python key |

### Document Processing

| Variable | Default | Purpose |
|----------|---------|---------|
| `DOC_CHUNKS_TABLE` | `document_chunks` | Chunks table |
| `DOC_CHUNKS_PAGE_COL` | `page_start` | Page column |
| `DOC_CHUNKS_TEXT_COL` | `content` | Text column |
| `ANTHROPIC_API_DELAY` | `1.2` | Rate limit delay |
| `DIP_LLM_DEBUG` | - | Debug DIP extraction |

### Timeouts

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONTEXT_LOADING_TIMEOUT_MS` | `1800` | Context timeout |
| `SYSTEM_SEARCH_TIMEOUT_MS` | `1200` | Search timeout |

### Anchor Watch

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANCHOR_WATCH_SAFE_RATIO` | `0.7` | Safe radius ratio |
| `ANCHOR_WATCH_WARNING_RATIO` | `0.9` | Warning ratio |
| `ANCHOR_WATCH_CENTROID_SAMPLES` | `20` | Centroid samples |
| `ANCHOR_WATCH_STALE_THRESHOLD_SEC` | `300` | Stale threshold |

### Telegram

| Variable | Purpose |
|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token |
| `TELEGRAM_CHAT_ID` | Chat ID |

### Twilio

| Variable | Purpose |
|----------|---------|
| `TWILIO_ACCOUNT_SID` | Account SID |
| `TWILIO_AUTH_TOKEN` | Auth token |
| `TWILIO_PHONE_NUMBER` | From number |
| `TWILIO_SMS_TO` | To number |

### Service Disable Flags

| Variable | Effect |
|----------|--------|
| `PINECONE_DISABLED=1` | Disable Pinecone |
| `SIDECAR_DISABLED=1` | Disable sidecar |
| `SUPABASE_DISABLED=1` | Disable database |
| `OPENAI_DISABLED=1` | Disable OpenAI |

### Validation

| Variable | Default | Purpose |
|----------|---------|---------|
| `RESPONSE_VALIDATE` | `0` | Response validation (CI: 1) |

### Maintenance Agent

| Variable | Default | Purpose |
|----------|---------|---------|
| `MAINTENANCE_SERVICE_URL` | `http://localhost:3001` | Agent URL |

---

## Render-Specific Variables

| Variable | Render Value | Notes |
|----------|--------------|-------|
| `NODE_ENV` | `production` | Production mode |
| `PORT` | `$PORT` | Dynamic assignment |
| `PYTHON_SIDECAR_URL` | `http://boatos-python:10000` | Internal URL |
| `MAINTENANCE_SERVICE_URL` | `http://boatos-maintenance:10000` | Internal URL |

---

## Route Registration (src/app.js)

```javascript
// Public routes
app.use('/health', healthRouter);

// Feature routes
app.use('/chat', chatRouter);
app.use('/systems', systemsRouter);
app.use('/api/supplies', suppliesRouter);
app.use('/trips', tripsRouter);
app.use('/gps', gpsRouter);

// Admin routes (protected)
app.use('/admin/api', adminRouter);  // All routes require x-admin-token
```

---

## Adding New Routes

1. Create route file: `src/routes/{feature}/{action}.route.js`
2. Register in parent index or `src/app.js`
3. Add admin middleware if needed: `router.use(adminOnly)`
4. Add service guards: `requireServices(['supabase'])`
5. Add to this document
6. Add smoke test: `tests/smoke/route-map.test.js`

---

## Adding New Environment Variables

1. Add to `.env` locally
2. Add to `src/config/env.js` (Zod schema):
   ```javascript
   const EnvSchema = z.object({
     // ...
     MY_NEW_VAR: z.string().optional().default('default'),
   });
   ```
3. Add to `.env.example`
4. Add to Render Dashboard if needed
5. Document here

---

## Related Docs

- [principles.md](./principles.md) - Coding standards (env config details)
- [environments.md](./environments.md) - Environment setup
- [ci-testing.md](./ci-testing.md) - Test configuration
