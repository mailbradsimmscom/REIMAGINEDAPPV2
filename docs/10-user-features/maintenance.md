# Maintenance Module

## Overview

The Maintenance Module is a **separate service** (`boatos-maintenance`) that manages boat maintenance tasks, operating hours tracking, and automated task extraction from documentation. It runs as its own Render service with HTTP API + WebSocket + background cron jobs.

**Who uses it:** Boat owners, crew
**Service:** `maintenance-agent` (port 3001 local, Render internal)
**Access:** Via main app pages + maintenance-agent APIs

---

## Key Concept: Separate from DIP

**Important:** The Maintenance Agent has its own extraction pipeline, completely separate from DIP (Document Intelligence Processing).

| System | Purpose | Storage | Used By |
|--------|---------|---------|---------|
| **DIP Pipeline** | Extract specs, procedures, troubleshooting for chat | Supabase staging tables | Chat AI |
| **Maintenance Agent** | Extract maintenance tasks with scheduling | Pinecone MAINTENANCE_TASKS | Maintenance UI |

They both read from the same document vectors (Pinecone REIMAGINEDDOCS), but store results differently.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Maintenance Agent (maintenance-agent/src/index.js)             │
│                                                                 │
│  Components:                                                    │
│  1. Express HTTP Server (port 3001)                             │
│  2. WebSocket Server (/api/ws)                                  │
│  3. Cron Jobs (node-cron)                                       │
│  4. Pipeline Orchestrator (6-step processing)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ↓                    ↓                    ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  HTTP API       │  │  WebSocket      │  │  Cron Jobs      │
│                 │  │                 │  │                 │
│  /admin/api/*   │  │  Real-time      │  │  system-check   │
│  /api/weather/* │  │  updates to     │  │  daily-update   │
│  /health        │  │  browser        │  │  weekly-recheck │
│                 │  │                 │  │  weather-fetch  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  External Services                                              │
│  ├── Pinecone REIMAGINEDDOCS (read document vectors)            │
│  ├── Pinecone MAINTENANCE_TASKS (write extracted tasks)         │
│  ├── Supabase (PostgreSQL - status tracking, user tasks)        │
│  └── Open-Meteo / Meteoblue (weather)                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6-Step Extraction Pipeline

The maintenance agent uses a 6-step pipeline to extract and process maintenance tasks from documentation.

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: Generic Pinecone Search                                │
│  Search REIMAGINEDDOCS for maintenance-related chunks           │
│  Uses generic terms: "maintenance service inspection cleaning"  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: LLM-Powered Search                                     │
│  Use LLM to generate system-specific search terms               │
│  Find additional relevant chunks                                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 3: Extract & Upload Tasks                                 │
│  LLM extracts maintenance tasks from chunks (gpt-4o-mini)       │
│  Generates embeddings and uploads to MAINTENANCE_TASKS          │
│  Dual-write: Pinecone (source of truth) + Supabase (fast query) │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 4: High-Confidence Deduplication                          │
│  Auto-delete duplicates with ≥85% similarity                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 5: Low-Confidence Deduplication                           │
│  Queue duplicates with 65-85% similarity for manual review      │
│  Review via dedup-review UI                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 6: Classify & Discover                                    │
│  Final classification and task categorization                   │
│  Tasks ready for approval workflow                              │
└─────────────────────────────────────────────────────────────────┘
```

### Pipeline Code Location

| Step | File | Purpose |
|------|------|---------|
| Orchestrator | `maintenance-agent/src/services/pipeline-orchestrator.service.js` | Coordinates all steps |
| Step 1 | `maintenance-agent/src/services/step-executors/step1-generic-search.js` | Generic Pinecone search |
| Step 2 | `maintenance-agent/src/services/step-executors/step2-llm-search.js` | LLM-powered search |
| Step 3 | `maintenance-agent/src/services/step-executors/step3-extract-tasks.js` | Extract & upload |
| Step 4 | `maintenance-agent/src/services/step-executors/step4-dedupe-auto.js` | Auto deduplication |
| Step 5 | `maintenance-agent/src/services/step-executors/step5-dedupe-review.js` | Manual review queue |
| Step 6 | `maintenance-agent/src/services/step-executors/step6-classify-discover.js` | Final classification |

---

## Data Storage

### Dual-Write Architecture

The maintenance agent uses a **dual-write** pattern:

1. **Pinecone MAINTENANCE_TASKS** (source of truth)
   - Stores task embeddings for similarity search
   - Used for deduplication
   - Primary storage

2. **Supabase maintenance_tasks_index** (fast queryable mirror)
   - Synced from Pinecone with retry logic
   - Used for fast queries (approval workflow, todo list)
   - Sub-100ms query times

```javascript
// From pinecone.repository.js
async upsertTask(taskId, embedding, metadata) {
  // 1. Write to Pinecone (source of truth)
  await idx.namespace('MAINTENANCE_TASKS').upsert([...]);

  // 2. Sync to Supabase (best effort with retry)
  await syncToSupabaseWithRetry('upsert', () =>
    maintenanceTasksIndexRepository.upsert({...}),
    taskId
  );
}
```

### Database Tables (Actual)

| Table | Purpose | Used By |
|-------|---------|---------|
| `maintenance_tasks_index` | Mirror of Pinecone MAINTENANCE_TASKS | Approval workflow, todo queries |
| `maintenance_agent_memory` | Processing state per system | Pipeline tracking |
| `pipeline_runs` | Run history | Audit trail |
| `pipeline_processing_status` | Per-system step status | Progress tracking |
| `pinecone_search_results` | Cached search hits from Steps 1-2 | Step 3 input |
| `deduplication_reviews` | Step 5 manual review pairs | Dedup review UI |
| `boatos_tasks` | System-generated prompts (hours update) | Mobile prompts |
| `user_tasks` | User-created tasks | User task management |
| `sync_errors` | Dual-write failure log | Error recovery |

### Pinecone Namespaces

| Namespace | Purpose | Written By | Read By |
|-----------|---------|------------|---------|
| `REIMAGINEDDOCS` | Document chunks (vectors) | DIP processing | Maintenance Agent (search), Chat AI |
| `MAINTENANCE_TASKS` | Extracted maintenance tasks | Maintenance Agent | Maintenance UI, Todo list |
| `MAINTENANCE` | Legacy namespace (may have old data) | Legacy | Legacy |

---

## Cron Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| `system-check` | Every N minutes | Check for unprocessed systems |
| `daily-update` | 2:00 AM | Real-world data updates |
| `weekly-recheck` | Sundays 3:00 AM | Re-check all systems |
| `weather-fetch` | Every 4 hours | Fetch Open-Meteo forecasts |

**Configuration:**
```javascript
const systemCheckInterval = `*/${config.agent.runIntervalMinutes} * * * *`;
const dailyUpdateSchedule = '0 2 * * *';
const weeklyRecheckSchedule = '0 3 * * 0';
const weatherFetchSchedule = '0 */4 * * *';
```

---

## WebSocket Server

Real-time updates to browser clients.

**Endpoint:** `ws://localhost:3001/api/ws`

### Client Messages

```javascript
// Subscribe to processing run updates
{ type: 'subscribe_run', runId: 'uuid' }

// Unsubscribe
{ type: 'unsubscribe_run', runId: 'uuid' }

// Ping/pong heartbeat
{ type: 'ping' }
```

### Server Broadcasts

```javascript
// Processing started
{ type: 'processing_started', runId: 'uuid', systemId: 'uuid' }

// Step started/completed/failed
{ type: 'step_started', runId: 'uuid', step: 1 }
{ type: 'step_completed', runId: 'uuid', step: 1, result: {...} }
{ type: 'step_failed', runId: 'uuid', step: 1, error: 'message' }

// Manual review required (Step 5)
{ type: 'manual_review_required', runId: 'uuid', pendingReviews: 5 }

// Final review required (Step 6)
{ type: 'final_review_required', runId: 'uuid', tasksToReview: 10 }

// Processing complete
{ type: 'processing_complete', runId: 'uuid', results: {...} }
```

---

## Task Approval Workflow

After extraction, tasks go through an approval workflow:

```
Extracted Tasks (status: 'pending')
    ↓
Admin Review (maintenance UI or API)
    ↓
├── Approved → status: 'approved', visible in todo list
├── Rejected → status: 'rejected', hidden from todo list
└── Pending → awaits review
```

### Task Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique task ID (e.g., `task-1703...`) |
| `description` | string | Task description |
| `asset_uid` | uuid | System this task belongs to |
| `system_name` | string | Human-readable system name |
| `frequency_basis` | string | `calendar`, `usage`, `event`, `condition`, `unknown` |
| `frequency_type` | string | `hours`, `days`, `weeks`, `months`, `years` |
| `frequency_value` | number | Frequency value |
| `frequency_hours` | number | Normalized frequency in hours |
| `task_type` | string | `fluid_check`, `filter_replacement`, `visual_inspection`, etc. |
| `criticality` | string | `critical`, `important`, `routine`, `optional` |
| `confidence` | number | LLM extraction confidence (0-1) |
| `review_status` | string | `pending`, `approved`, `rejected` |
| `source` | string | `manual` (from documentation) |

---

## Operating Hours Service

Tracks operating hours for usage-based maintenance scheduling.

### Update Operating Hours

```javascript
async updateOperatingHours({
  assetUid,        // System asset UID
  hours,           // New operating hours
  submittedBy,     // 'user' or 'system'
  notes,           // Optional notes
  meterReplaced,   // If meter was replaced
  installationDate // Optional installation date
}) {
  // Validate hours is positive
  if (hours < 0) throw new Error('Hours must be positive');

  // Validate hours haven't decreased (unless meter replaced)
  if (latestEntry && hours < latestEntry.hours && !meterReplaced) {
    throw new Error('Hours cannot decrease without meter replacement');
  }

  // Record in history (audit trail)
  await systemMaintenanceRepo.history.recordHoursEntry({...});

  // Update maintenance state
  await systemMaintenanceRepo.maintenance.updateOperatingHours(assetUid, hours);

  // Auto-complete BoatOS "Update Operating Hours" task
  await boatosTasksService.markTaskCompletedForSystem(assetUid);
}
```

---

## User Flow

### Viewing Tasks

1. Tap "Maintenance" (🔧)
2. Opens `/app-mobile.html` on maintenance service
3. View task list grouped by status/priority
4. Tap task to see details

### Adding a Task (Manual)

1. Open unified-mobile.html
2. Tap "Add Task" (➕)
3. Opens `/user-tasks-mobile.html` on maintenance service
4. Fill in task details (title, description, due date)
5. Submit → task created in Supabase `user_tasks`

### Adding a Task (AI-Suggested via Chat)

When a user asks the chat AI about equipment **not in their inventory**, the system automatically creates a user task:

1. User asks: "do you know about spinlock stx"
2. Chat AI extracts "spinlock stx" via LLM
3. Systems table search finds **no match**
4. **Automatic task creation:**
   - `description`: "Add spinlock stx to systems inventory"
   - `due_date`: NOW (immediately due)
   - `created_by`: 'chat_suggestion'
5. Duplicate check: Won't create if similar active task exists
6. Chat continues to Python → Perplexity provides general knowledge
7. Task appears in user's maintenance todo list

This ensures users are reminded to add equipment to their inventory while still getting helpful answers about that equipment.

### Adding a Task (Manual Not Processed)

When a user asks about equipment that **is in their inventory but has an unprocessed manual** (document exists but chunk_count = 0), the system creates tasks:

1. User asks: "Tell me about my Yanmar sail drive"
2. Chat AI finds related equipment (Yanmar sail_drive, vc20, shift_actuator, etc.)
3. **Parallel document check** for ALL found equipment (via `Promise.all()`):
   - For each equipment: check `documents` table for `asset_uid`
   - If document exists AND `chunk_count = 0`: manual needs processing
4. **Automatic task creation** for each unprocessed manual:
   - Look up full system details via `getSystemByAssetUid()` (search RPC only returns asset_uid + rank)
   - `description`: "Process manual for [manufacturer_norm] [model_norm]"
   - `due_date`: NOW (immediately due)
   - `created_by`: 'chat_suggestion'
5. **Duplicate check:** Won't create if similar active task exists (checks `hasExistingTask(model_norm)`)
6. **Creates tasks for ALL related equipment** with unprocessed manuals, not just the one asked about
7. Chat continues to Python → no DIP/Pinecone data for these items, but Perplexity provides general knowledge
8. Tasks appear in user's maintenance todo list

**Performance:** Parallel execution adds only ~50-200ms to chat response time.

This ensures users are reminded to process manuals for all related equipment they interact with.

### Processing a System (Admin)

1. Navigate to admin pipeline UI
2. Select system to process
3. Click "Process System"
4. Watch 6-step pipeline execute via WebSocket updates
5. Review dedup pairs if needed (Step 5)
6. Approve/reject extracted tasks (Step 6)

---

## Files & Locations

### Entry Point

| Purpose | Path |
|---------|------|
| Main entry | `maintenance-agent/src/index.js` |
| Package.json | `maintenance-agent/package.json` |

### Routes

| Purpose | Path |
|---------|------|
| Admin routes index | `maintenance-agent/src/routes/admin/index.js` |
| Pipeline routes | `maintenance-agent/src/routes/admin/pipeline.route.js` |
| Dedup review routes | `maintenance-agent/src/routes/admin/dedup-review.route.js` |
| User tasks routes | `maintenance-agent/src/routes/admin/user-tasks.route.js` |
| Weather routes | `maintenance-agent/src/routes/weather.route.js` |

### Services

| Purpose | Path |
|---------|------|
| Pipeline orchestrator | `maintenance-agent/src/services/pipeline-orchestrator.service.js` |
| System maintenance | `maintenance-agent/src/services/system-maintenance.service.js` |
| BoatOS tasks | `maintenance-agent/src/services/boatos-tasks.service.js` |
| Weather fetch | `maintenance-agent/src/services/weather-fetch.service.js` |
| Task deduplication | `maintenance-agent/src/services/deduplication.service.js` |
| Extraction | `maintenance-agent/src/services/extraction.service.js` |

### Repositories

| Purpose | Path |
|---------|------|
| Supabase | `maintenance-agent/src/repositories/supabase.repository.js` |
| Pinecone | `maintenance-agent/src/repositories/pinecone.repository.js` |
| Weather | `maintenance-agent/src/repositories/weather.repository.js` |
| System maintenance | `maintenance-agent/src/repositories/system-maintenance.repository.js` |
| OpenAI | `maintenance-agent/src/repositories/openai.repository.js` |

### Jobs

| Purpose | Path |
|---------|------|
| Scheduler | `maintenance-agent/src/jobs/scheduler.job.js` |
| System processor | `maintenance-agent/src/jobs/system-processor.job.js` |

### Frontend (Static)

| Purpose | Path |
|---------|------|
| Mobile app | `maintenance-agent/public/app-mobile.html` |
| User tasks | `maintenance-agent/public/user-tasks-mobile.html` |
| Edit task | `maintenance-agent/public/edit-user-task-mobile.html` |
| Hours update | `maintenance-agent/public/hours-update-mobile.html` |
| Weather areas | `maintenance-agent/public/weather-areas.html` |

---

## API Endpoints

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health check |

### Pipeline API (Admin)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/api/pipeline/process/:assetUid` | Trigger 6-step processing |
| GET | `/admin/api/pipeline/status/:assetUid` | Get processing status |
| POST | `/admin/api/pipeline/check-and-advance/:assetUid` | Resume after manual review |

### Task API (Admin)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/tasks` | List tasks (from maintenance_tasks_index) |
| PATCH | `/admin/api/tasks/:id` | Update task (approve/reject) |
| DELETE | `/admin/api/tasks/:id` | Delete task |

### Dedup Review API (Admin)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/dedup-reviews` | List pending reviews |
| POST | `/admin/api/dedup-reviews/:id/resolve` | Resolve a review pair |

### Weather API (Public)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/weather/areas` | List weather areas |
| POST | `/api/weather/areas` | Create area |
| GET | `/api/weather/areas/:id/forecast` | Get forecast |
| POST | `/api/weather/areas/:id/fetch` | Manual fetch |

See [Weather](./weather.md) for full weather API documentation.

---

## Configuration (env.js)

```javascript
const config = {
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',

  agent: {
    runIntervalMinutes: parseInt(process.env.AGENT_RUN_INTERVAL_MINUTES) || 30,
    batchSize: parseInt(process.env.AGENT_BATCH_SIZE) || 5,
    confidenceThreshold: parseFloat(process.env.AGENT_CONFIDENCE_THRESHOLD) || 0.7,
  },

  features: {
    realWorldSearch: process.env.FEATURE_REAL_WORLD_SEARCH !== 'false',
    dependencyInference: process.env.FEATURE_DEPENDENCY_INFERENCE !== 'false',
    autoLearning: process.env.FEATURE_AUTO_LEARNING !== 'false',
  },

  // Cross-service URLs (for action links in todo list)
  chatServiceUrl: process.env.CHAT_SERVICE_URL || 'http://localhost:3000',
  maintenanceBaseUrl: process.env.MAINTENANCE_BASE_URL || 'http://localhost:3001',
  mainAppBaseUrl: process.env.MAIN_APP_BASE_URL || 'http://localhost:3000',

  meteoblue: {
    enabled: process.env.METEOBLUE_ENABLED === 'true',
    apiKey: process.env.METEOBLUE_API_KEY,
  }
};
```

### URL Configuration for Production

The todo list generates action URLs (e.g., "Details" buttons) that link to maintenance pages. These must be configured correctly for production:

| Variable | Local | Render |
|----------|-------|--------|
| `MAINTENANCE_BASE_URL` | `http://localhost:3001` | `https://boatos-maintenance.onrender.com` |
| `MAIN_APP_BASE_URL` | `http://localhost:3000` | `https://boatos-main.onrender.com` |

Without these, todo "Details" buttons will incorrectly link to localhost in production.

---

## Running Locally

```bash
# From project root
cd maintenance-agent
npm install
npm run dev  # Starts on port 3001

# Or use restart-all.sh from project root
./restart-all.sh
```

---

## Render Deployment

| Service | URL | Purpose |
|---------|-----|---------|
| boatos-maintenance | boatos-maintenance.onrender.com | Maintenance agent |

**Internal URL:** `http://boatos-maintenance:10000` (for service-to-service calls)

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Part of main app" | **No.** Separate service on port 3001 |
| "Uses DIP staging tables" | **No.** Has its own extraction pipeline |
| "Stores in maintenance_tasks table" | **No.** Uses Pinecone MAINTENANCE_TASKS + maintenance_tasks_index |
| "Manual task creation only" | **No.** Auto-generates from documentation via 6-step pipeline |
| "No real-time updates" | **Yes.** WebSocket broadcasts progress |
| "Single cron job" | **No.** 4 scheduled jobs |
| "Same codebase" | **No.** Separate `/maintenance-agent/` directory |

---

## Related Docs

- [Weather](./weather.md) - Weather areas (runs in maintenance-agent)
- [Documents](../20-admin-tools/documents.md) - Document pipeline and DIP
- [Systems](../20-admin-tools/systems.md) - Equipment data
- [Environments](../00-foundations/environments.md) - Service deployment
