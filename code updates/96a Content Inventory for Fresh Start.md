# 96a Content Inventory for Fresh Start

**Date:** 2026-01-12
**Parent Document:** 96 Document Foundation Crisis
**Purpose:** Complete inventory of all content storage locations with purge/keep recommendations

---

## Pinecone

**Index:** `reimaginedsv`

| Namespace | Purpose | Purge? | Notes |
|-----------|---------|--------|-------|
| `REIMAGINEDDOCS` | Document chunks (vectors) | **PURGE** | Re-embed with new pipeline | AGREED
| `MAINTENANCE_TASKS` | Maintenance agent vectors | **PURGE** | Re-extract from documents | AGREED

---

## Supabase Tables

### Document System

| Table | Purpose | Purge? | Notes |
|-------|---------|--------|-------|
| `documents` | Document metadata | **RESET** | Keep structure, purge rows - or keep if needed for storage FK | AGREED- lets deep dive the FK issue
| `document_chunks` | Chunk text backup | **PURGE** | Re-chunk with new pipeline | AGREED
| `doc_assets` | Figure/image references | **PURGE** | Re-extract with Vision | AGREED

### Production DIP (Approved Content)

| Table | Purpose | Purge? | Notes |
|-------|---------|--------|-------|
| `spec_suggestions` | Approved specs | **PURGE** | Built on flawed extraction | AGREED
| `golden_tests` | Approved validation rules | **PURGE** | Built on flawed extraction | AGREED
| `playbook_hints` | Approved procedures | **PURGE** | Missing steps (neutral, battery) | AGREED
| `intent_router` | Approved Q&A pairs | **PURGE** | Built on flawed extraction | AGREED
| `playbooks` | Structured playbooks | **PURGE** | Derived from playbook_hints | AGREED
| `playbook_steps` | Playbook step details | **PURGE** | Derived from playbook_hints | AGREED
| `spec_lexicon` | Unit reference with synonyms (4 rows) | **KEEP & EXPAND** | Has W, VDC, A, bar with synonyms - foundation for unit synonym system. Expand with PSI, kW, Ah, L/min, GPH, etc. |
| `knowledge_facts` | View (auto-rebuilds) | N/A | View, not table |

### Staging DIP (Pending Review)

| Table | Purpose | Purge? | Notes |
|-------|---------|--------|-------|
| `staging_spec_suggestions` | Pending specs (~1,900) | **PURGE** | Re-extract | AGREED
| `staging_golden_tests` | Pending tests (~1,700) | **PURGE** | Re-extract | AGREED
| `staging_playbook_hints` | Pending procedures (~1,100) | **PURGE** | Re-extract | AGREED
| `staging_intent_router` | Pending Q&A (~2,200) | **PURGE** | Re-extract | AGREED
| `staging_systems` | Pending system entries (142 rows) | **REVIEW → MIGRATE → PURGE** | 31 items NOT in production. Includes Yanmar engines, B&G Halo24, Hy-ProDrive actuator. Review, migrate good ones, then purge. |
| `staging_instances` | Pending instances (306 rows) | **REVIEW → MIGRATE → PURGE** | 145 items NOT in production. Has serial numbers (Yanmar E25782, E25787). Review, migrate serials, then purge. |

### Declined DIP (Rejected Items)

| Table | Purpose | Purge? | Notes |
|-------|---------|--------|-------|
| `declined_spec_suggestions` | Rejected specs | **PURGE** | Training patterns preserved in agent_training_decisions | AGREED
| `declined_golden_tests` | Rejected tests | **PURGE** | Training patterns preserved | AGREED
| `declined_playbook_hints` | Rejected procedures | **PURGE** | Training patterns preserved | AGREED
| `declined_intent_router` | Rejected Q&A | **PURGE** | Training patterns preserved | AGREED

### DIP Agent (Training Foundation)

| Table | Purpose | Purge? | Notes |
|-------|---------|--------|-------|
| `agent_training_decisions` | 385 training decisions | **KEEP** | Core training data with snapshots + reasoning |
| `agent_config` | Learned criteria, thresholds | **KEEP** | Contains extracted patterns |
| `agent_runs` | Run history | **REVIEW** | Keep for debugging? Or purge? | PLEASE DEEP DIVE AND SHARE WHAT THIS IS
| `agent_run_items` | Run item details | **REVIEW** | Keep for debugging? Or purge? |

### Maintenance Agent

| Table | Purpose | Purge? | Notes |
|-------|---------|--------|-------|
| `maintenance_tasks_index` | Extracted tasks | **PURGE** | Re-extract from documents |
| `maintenance_tasks_queue` | Queue for processing | **PURGE** | Transient data |
| `user_tasks` | User-created tasks | **KEEP** | User data |
| `pipeline_runs` | Pipeline run history | **PURGE** | Operational logs, can rebuild |
| `pipeline_processing_status` | Processing state | **PURGE** | Transient |
| `deduplication_reviews` | Dedup decisions (60 rows) | **KEEP** | Human training data for dedup agent! |
| `deduplication_analyses` | Dedup run metadata (5 rows) | **PURGE** | Just run metadata |
| `deduplication_pending_reviews` | Pending dedup | **PURGE** | Transient |
| `pinecone_search_results` | Search cache | **PURGE** | Cache, rebuild as needed |

**Note on deduplication_reviews:** Contains 60 human-reviewed decisions on duplicate maintenance tasks (keep_both, delete_task1, etc.). Valuable for training a deduplication agent similar to DIP agent.

### Chat System

| Table | Purpose | Purge? | Notes |
|-------|---------|--------|-------|
| `chat_threads` | Conversation threads | **KEEP** | User data |
| `chat_messages` | Messages | **KEEP** | User data |
| `chat_sessions` | Sessions | **KEEP** | User data |

### System Inventory

| Table | Purpose | Purge? | Notes |
|-------|---------|--------|-------|
| `systems` | 119 equipment entries | **KEEP** | Add model_variant column |
| `instances` | System instances | **REVIEW** | User data? | PLEASE DIG INTO THIS AND MAKE A RECOMMENDATION> THIS FEELS LIKE A KEEP

### User Features AGREED

| Table | Purpose | Purge? | Notes |
|-------|---------|--------|-------|
| `supplies` | Inventory items | **KEEP** | User data |
| `supply_categories` | Categories | **KEEP** | Reference data |
| `supply_units` | Units of measure | **KEEP** | Reference data |
| `trips` | Trip logs | **KEEP** | User data |
| `anchor_watch_zones` | Anchor zones | **KEEP** | User data |
| `anchorages` | Saved anchorages | **KEEP** | User data |
| `season_recaps` | Season summaries | **KEEP** | User data |

### Job Tracking

| Table | Purpose | Purge? | Notes |
|-------|---------|--------|-------|
| `jobs` | Background jobs (24 rows) | **PURGE** | DIP job history - just operational logs |
| `merge_audit` | Merge history (0 rows) | **PURGE** | Empty table |

### Testing

| Table | Purpose | Purge? | Notes |
|-------|---------|--------|-------|
| `test_results` | Test run results | **OPTIONAL** | Dev data |
| `test_analysis` | Test analysis | **OPTIONAL** | Dev data |

---

## Supabase Storage

**Bucket:** `documents`

| Path | Purpose | Purge? | Notes |
|------|---------|--------|-------|
| `/manuals/{doc_id}/` | Original PDF files | **KEEP** | Source documents | AGREED
| `/dip/{doc_id}/` | DIP extraction JSON | **PURGE** | Re-extract | AGREED
| `/page-screenshots/` | Page images | **PURGE** | Re-generate with Vision | AGREED
| `/supply-photos/` | Supply images | **KEEP** | User data | AGREED
**Anchorage Photos Storage (FOUND!):**
| Path | Purpose | Purge? | Notes |
|------|---------|--------|-------|
| `/anchorage-photos/` | Anchorage drop location photos | **KEEP** | User data - defined in `photo-storage.service.js` |

---

## Deep Dives (Per User Request)

### 1. Documents Table FK Issue

**Problem:** The `documents` table has foreign key relationships that could break things if we purge it.

**Tables that reference `documents.doc_id`:**
| Table | Constraint | ON DELETE |
|-------|------------|-----------|
| `document_chunks` | doc_id_fkey | (not specified - will error) |
| `golden_tests` | doc_id_fkey | CASCADE |
| `intent_router` | doc_id_fkey | CASCADE |
| `playbook_hints` | doc_id_fkey | CASCADE |
| `spec_suggestions` | doc_id_fkey | CASCADE |
| `staging_golden_tests` | doc_id_fkey | CASCADE |
| `staging_playbook_hints` | doc_id_fkey | CASCADE |
| `staging_intent_router` | doc_id_fkey | CASCADE |
| `staging_spec_suggestions` | doc_id_fkey | CASCADE |
| `playbooks` | doc_id (FK) | CASCADE |
| `playbook_steps` | doc_id (FK) | CASCADE |

**Recommendation:** Since all child tables have `ON DELETE CASCADE` (except document_chunks which we're purging anyway), we can safely:
1. First TRUNCATE all the child tables (staging_*, production DIP, document_chunks)
2. Then DELETE FROM documents

**Alternative:** If we want to preserve doc_ids for re-ingestion:
1. Keep documents table rows but clear processed content columns
2. Re-use same doc_ids when re-ingesting same PDFs

**My recommendation:** **PURGE documents rows too** - re-ingestion will create new doc_ids anyway, and PDFs in `/manuals/` don't rely on the table.

---

### 2. agent_runs and agent_run_items Tables

**What they are (from migration 025):**

```sql
agent_runs:
  id              uuid
  agent_type      text           -- 'dip'
  status          text           -- 'running' | 'completed' | 'failed'
  started_at      timestamptz
  completed_at    timestamptz
  items_processed integer        -- how many items in this batch
  llm_calls       integer        -- API calls made
  auto_approved   integer        -- count auto-approved
  auto_rejected   integer        -- count auto-rejected
  escalated       integer        -- count sent to Telegram
  pre_filtered    integer        -- count skipped by pre-filter
  errors          integer        -- error count
  config          jsonb          -- thresholds used
  error_message   text           -- if failed
```

**Purpose:** Tracks each batch run of the DIP agent for:
- Observability (how many items processed, how long did it take)
- Locking (prevent concurrent runs)
- Debugging (what config was used, any errors)

**Note:** `agent_run_items` was referenced in code but doesn't exist as a separate table - items are tracked via `processing_run_id` column on staging tables.

**Recommendation:** **PURGE** - This is operational history, not training data. After purge:
- Staging tables get truncated → processing_run_id columns reset anyway
- We can rebuild run history from future runs
- Training decisions (the important stuff) are in `agent_training_decisions`

---

### 3. Maintenance Agent Tables - Detailed Breakdown

| Table | Purpose | Training Value? | Recommendation |
|-------|---------|----------------|----------------|
| `maintenance_tasks_index` | Extracted maintenance tasks from documents | No - will re-extract | **PURGE** |
| `maintenance_tasks_queue` | Transient queue for processing | No | **PURGE** |
| `user_tasks` | User-created tasks (manual entries) | Yes - user data | **KEEP** |
| `pipeline_runs` | Tracks pipeline execution history | No - operational logs | **PURGE** |
| `pipeline_processing_status` | Current processing state per system | No - transient | **PURGE** |
| `deduplication_reviews` | Human decisions on duplicate pairs | **YES - training data!** | **KEEP** |
| `deduplication_analyses` | When dedup analysis ran, what thresholds | No - metadata | **PURGE** |
| `deduplication_pending_reviews` | Queue of pairs awaiting review | No - transient | **PURGE** |
| `pinecone_search_results` | Cached search results | No - cache | **PURGE** |

**Key insight on `deduplication_reviews`:**
This table stores human decisions like:
- "Task A and Task B are NOT duplicates (keep_both)"
- "Task A is a duplicate of Task B (delete_task1)"
- "Both are garbage (delete_both)"

These are **training decisions** similar to `agent_training_decisions` for DIP. We might want to train a deduplication agent in the future.

**Recommendation:** **KEEP `deduplication_reviews`** - it has human training signal.

---

### 4. Instances Table - Recommendation

**What it is:**
```sql
instances:
  instance_uid      uuid PRIMARY KEY
  asset_uid         uuid → systems(asset_uid)  -- FK to parent system
  serial_number     text
  location          text                        -- e.g., "Port Engine Bay"
  instance_index    integer                     -- 1, 2, 3 for multiples
```

**Purpose:** When you have multiple of the same system (e.g., 2x Yanmar engines), each physical instance has:
- Its own serial number
- Its own location
- An index (Engine 1, Engine 2)

**Used by:** `system-management.repository.js` for tracking individual equipment.

**Data type:** User data - you entered serial numbers, locations.

**Recommendation:** **KEEP** - This is user-entered data about specific equipment on the boat. Related to systems but not derived from documents.

---

## Summary by Action

### DEFINITE PURGE (execute first)

**Pinecone:**
- Both namespaces (REIMAGINEDDOCS, MAINTENANCE_TASKS)

**Supabase Tables:**
- `document_chunks`
- `doc_assets`
- `staging_spec_suggestions`
- `staging_golden_tests`
- `staging_playbook_hints`
- `staging_intent_router`
- `declined_spec_suggestions`
- `declined_golden_tests`
- `declined_playbook_hints`
- `declined_intent_router`
- `spec_suggestions`
- `golden_tests`
- `playbook_hints`
- `intent_router`
- `playbooks`
- `playbook_steps`
- `maintenance_tasks_index`
- `maintenance_tasks_queue`
- `deduplication_pending_reviews`
- `deduplication_analyses`
- `pinecone_search_results`
- `jobs`
- `merge_audit`

**Supabase Storage:**
- `/dip/*`
- `/page-screenshots/*`

### DEFINITE KEEP (do not touch)

**Supabase Tables:**
- `agent_training_decisions` (385 decisions - CRITICAL)
- `agent_config` (learned patterns - CRITICAL)
- `deduplication_reviews` (60 human dedup decisions - training data!)
- `spec_lexicon` (4 unit definitions with synonyms - expand later)
- `systems` (add model_variant later)
- `instances` (user-entered serial numbers, locations)
- `chat_threads`
- `chat_messages`
- `chat_sessions`
- `supplies`
- `supply_categories`
- `supply_units`
- `trips`
- `anchor_watch_zones`
- `anchorages`
- `season_recaps`
- `user_tasks`

**Supabase Storage:**
- `/manuals/*` (source PDFs)
- `/supply-photos/*`
- `/anchorage-photos/*`

### REVIEW BEFORE PURGE (requires migration)

**Supabase Tables:**
- `staging_systems` (142 rows, 31 NOT in production)
  - Review: Yanmar engines, B&G Halo24, Hy-ProDrive actuator, etc.
  - Migrate good items to `systems` table
  - Then TRUNCATE
- `staging_instances` (306 rows, 145 NOT in production)
  - Review: Has serial numbers (Yanmar E25782, E25787, etc.)
  - Migrate serials to `instances` table
  - Then TRUNCATE

### RESOLVED DECISIONS (from deep dives)

| Item | Decision | Reason |
|------|----------|--------|
| `documents` table | **PURGE rows** | ON DELETE CASCADE handles FKs. PDFs are in storage. |
| `agent_runs` | **PURGE** | Operational history, not training. |
| `agent_run_items` | N/A | Doesn't exist as separate table. |
| `pipeline_runs` | **PURGE** | Operational logs. |
| `pipeline_processing_status` | **PURGE** | Transient state. |
| `deduplication_reviews` | **KEEP** | 60 human training decisions (keep_both/delete_task1/etc). Training data for future dedup agent. |
| `deduplication_analyses` | **PURGE** | Just 5 rows of run metadata (thresholds, dates). |
| `instances` | **KEEP** | User-entered serial numbers, locations. |
| `spec_lexicon` | **KEEP & EXPAND** | 4 rows (W, VDC, A, bar) with synonyms. Foundation for unit synonym system. |
| `staging_systems` | **REVIEW → MIGRATE → PURGE** | 31 of 142 items NOT in production (Yanmar engines, B&G Halo24, Hy-ProDrive). Migrate good ones first. |
| `staging_instances` | **REVIEW → MIGRATE → PURGE** | 145 of 306 items NOT in production. Has serial numbers to preserve. |
| `jobs` | **PURGE** | 24 rows of DIP job history. Just operational logs. |
| `merge_audit` | **PURGE** | Empty table (0 rows). |

### STILL NEEDS DECISION

| Item | Options | Notes |
|------|---------|-------|
| `test_results` | Keep vs purge | Dev data, probably purge |
| `test_analysis` | Keep vs purge | Dev data, probably purge |

---

## Purge Sequence (Recommended Order)

```
1. BACKUP
   - Export agent_training_decisions to JSON
   - Export agent_config to JSON
   - Verify /manuals/ storage is intact

2. PINECONE (clean slate)
   - Delete all vectors in REIMAGINEDDOCS namespace
   - Delete all vectors in MAINTENANCE_TASKS namespace

3. STORAGE (processed files only)
   - Delete /dip/*
   - Delete /page-screenshots/*

4. STAGING TABLES (pending items)
   - TRUNCATE staging_spec_suggestions
   - TRUNCATE staging_golden_tests
   - TRUNCATE staging_playbook_hints
   - TRUNCATE staging_intent_router

5. DECLINED TABLES (rejected items)
   - TRUNCATE declined_spec_suggestions
   - TRUNCATE declined_golden_tests
   - TRUNCATE declined_playbook_hints
   - TRUNCATE declined_intent_router

6. PRODUCTION DIP (approved items)
   - TRUNCATE spec_suggestions
   - TRUNCATE golden_tests
   - TRUNCATE playbook_hints
   - TRUNCATE intent_router
   - TRUNCATE playbooks
   - TRUNCATE playbook_steps

7. DOCUMENT DATA
   - TRUNCATE document_chunks
   - TRUNCATE doc_assets
   - TRUNCATE documents (or DELETE FROM documents)

8. MAINTENANCE DATA
   - TRUNCATE maintenance_tasks_index
   - TRUNCATE maintenance_tasks_queue
   - TRUNCATE deduplication_pending_reviews
   - TRUNCATE deduplication_analyses
   - TRUNCATE pinecone_search_results
   - TRUNCATE pipeline_runs
   - TRUNCATE pipeline_processing_status
   - DO NOT TOUCH deduplication_reviews (60 training decisions!)
   - DO NOT TOUCH spec_lexicon (4 unit definitions!)

9. DIP AGENT DATA (operational only)
   - TRUNCATE agent_runs

10. JOB HISTORY
    - TRUNCATE jobs
    - TRUNCATE merge_audit

11. STAGING DATA (after review/migration)
    - Review staging_systems (31 items not in production)
    - Migrate good systems to production
    - TRUNCATE staging_systems
    - Review staging_instances (145 items not in production)
    - Migrate serial numbers to production
    - TRUNCATE staging_instances

12. VERIFY
   - Check agent_training_decisions still has 385 rows
   - Check agent_config still has learned_criteria
   - Check deduplication_reviews still has 60 human decisions
   - Check spec_lexicon still has 4 unit definitions
   - Check instances still has serial numbers (+ newly migrated)
   - Check systems has newly migrated items from staging
   - Check /manuals/ storage still has PDFs
   - Check user tables untouched
```

---

## After Purge: Re-Ingestion Plan

1. **Add model_variant column** to systems table
2. **Create staging_troubleshooting table** (new DIP category)
3. **Update DIP extraction prompts** with troubleshooting + model tagging
4. **Re-ingest 81 documents** with new pipeline:
   - Vision analysis for figures
   - Multi-model detection
   - Model-variant tagging
   - Enhanced chunking
5. **Run DIP agent** on new extractions (uses preserved 385 training decisions)
6. **Incremental training** for new troubleshooting category (~50 decisions)

---

*This document is a sub-document of 96 Document Foundation Crisis. See parent for full context.*
