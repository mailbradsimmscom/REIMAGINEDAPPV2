# 68 Pipeline Funnel Visualization

**Date:** 2025-12-26
**Status:** In Progress
**Last Updated:** 2025-12-26 (Session 3)

---

## Overview

Created a new funnel visualization page (`/funnel`) to track the data pipeline from systems → documents → processing stages. This provides visibility into the health of the data processing pipeline.

**Session 3 Focus:** Added branching visualization showing DIP and Maintenance as two separate pipelines, corrected documentation.

---

## Files Created

| File | Purpose |
|------|---------|
| `src/services/funnel/funnel.service.js` | Gathers stats from DB + Pinecone, DIP staging tables, Maintenance Agent |
| `src/routes/funnel/stats.route.js` | GET `/api/funnel/stats` endpoint |
| `src/routes/funnel/index.js` | Router barrel |
| `src/public/funnel.html` | Visual funnel page with branching CSS |
| `src/public/js/funnel/funnel.js` | Frontend rendering with DIP + Maintenance branches |
| `scripts/check-dip-status.cjs` | Diagnostic script for DIP system-level stats |
| `scripts/check-maintenance-stats.cjs` | Diagnostic script for Maintenance Agent stats |

## Files Modified

| File | Change |
|------|--------|
| `src/app.js` | Added import + route registration for `/api/funnel` and `/funnel` |
| `docs/20-admin-tools/documents.md` | Fixed DIP tables documentation (staging_* tables) |
| `docs/10-user-features/maintenance.md` | **COMPLETE REWRITE** - Corrected architecture, 6-step pipeline, storage |
| `docs/architecture-diagram.md` | **MAJOR UPDATE** - Fixed DIP storage, added branching diagram |

---

## Key Discovery: Two Separate Extraction Systems

```
                    Pinecone REIMAGINEDDOCS
                    (document chunks with embeddings)
                              │
              ┌───────────────┴───────────────┐
              ↓                               ↓
       DIP Pipeline                   Maintenance Agent
       (Python Sidecar)               (boatos-maintenance:3001)
              │                               │
              ↓                               ↓
       4 Staging Tables              Pinecone MAINTENANCE_TASKS
       (Supabase)                    + maintenance_tasks_index
              │                               │
              ↓                               ↓
       Chat AI enrichment            Todo list / Maintenance UI
```

### DIP Pipeline (for Chat AI)
- **Extracts:** specs, procedures, troubleshooting Q&A, intent routing
- **Stores:** 4 Supabase staging tables → production tables after approval
- **Used by:** `production_dip_retriever.py` for chat context

### Maintenance Agent (for Todo List)
- **Extracts:** Maintenance tasks with scheduling
- **Stores:** Pinecone MAINTENANCE_TASKS namespace + Supabase mirror
- **Used by:** Maintenance UI, todo list
- **Has own 6-step pipeline:** Search → LLM Search → Extract → Auto-dedup → Manual-dedup → Classify

---

## Current Funnel State (as of 2025-12-26)

### Shared Pipeline (Documents → Vectors)
```
STAGE                          COUNT    NOTES
─────────────────────────────────────────────────────────────────
Total Systems                    119    Equipment in inventory
Systems with Documents            76    64% coverage
Documents Uploaded                81    Some systems have multiple docs
Documents in Storage              81    100% uploaded to Supabase
Jobs                              24    18 completed, 2 failed, 4 queued
Pinecone Vectors                2794    76 unique systems vectorized
─────────────────────────────────────────────────────────────────
```

### DIP Branch
```
STAGE                          COUNT    NOTES
─────────────────────────────────────────────────────────────────
DIP Extractions                 7060    76 systems processed
  - Pending                     7050
  - Approved                       9
  - Declined                       1
Production Tables                  9    Approved items for Chat AI
─────────────────────────────────────────────────────────────────
```

### Maintenance Branch
```
STAGE                          COUNT    NOTES
─────────────────────────────────────────────────────────────────
Systems Searched                  24    32% of vectorized systems
Systems with Tasks                11    46% of searched systems
Tasks Extracted                  417    From maintenance_tasks_index
  - pending                      284
  - approved                      23
  - rejected                      50
  - invalid_task                  37
  - duplicate_hidden              23
Tasks Approved                    23    Ready for todo list
  - By frequency: calendar(17), condition(4), usage(2)
  - By category: MAINTENANCE(23)
─────────────────────────────────────────────────────────────────
```

---

## Session 3 Changes

### 1. Documentation Corrections

**`docs/10-user-features/maintenance.md`** - Complete rewrite:
- Documented 6-step pipeline (search → extract → dedup → classify)
- Corrected storage: Pinecone MAINTENANCE_TASKS + maintenance_tasks_index
- Clarified separation from DIP
- Added all actual Supabase tables used
- Added WebSocket, cron jobs, API endpoints

**`docs/architecture-diagram.md`** - Major update:
- Fixed DIP storage (was `dip.json`, now staging tables)
- Added full document lifecycle diagram
- Added branching visualization
- Added status workflow diagram

### 2. Funnel Service Updates

**`src/services/funnel/funnel.service.js`**:
- Added `getMaintenanceAgentStats()` function
- Queries `maintenance_tasks_index` for task counts
- Queries `pinecone_search_results` for systems searched
- Restructured response with `shared`, `branches.dip`, `branches.maintenance`
- Removed old `maintenance_tasks` query (table doesn't exist)

### 3. Frontend Branching Visualization

**`src/public/funnel.html`**:
- Added CSS for branch containers (two-column grid)
- Added branch headers with color coding
- Added maintenance details styles
- Responsive design for mobile

**`src/public/js/funnel/funnel.js`**:
- Added `renderBranch()` function
- Added `renderMaintenanceDetails()` function
- Updated `loadFunnel()` to render shared stages then branches
- Updated summary cards to show Tasks Approved

---

## New Data Structure

```javascript
{
  // Backwards compatible flat list
  stages: [...sharedStages, ...dipBranch.stages, ...maintenanceBranch.stages],

  // New branching structure
  shared: [
    { id: 'systems', ... },
    { id: 'systems_with_manual', ... },
    { id: 'documents', ... },
    { id: 'documents_storage', ... },
    { id: 'ingest_jobs', ... },
    { id: 'pinecone_vectors', ..., isBranchPoint: true }
  ],
  branches: {
    dip: {
      id: 'dip',
      label: 'DIP Pipeline',
      description: 'Chat AI enrichment',
      stages: [
        { id: 'dip_extractions', ..., dipDetails: {...} },
        { id: 'dip_production', ... }
      ]
    },
    maintenance: {
      id: 'maintenance',
      label: 'Maintenance Agent',
      description: 'Task extraction & scheduling',
      stages: [
        { id: 'maint_systems_searched', ... },
        { id: 'maint_systems_with_tasks', ... },
        { id: 'maint_tasks_extracted', ..., breakdown: byStatus },
        { id: 'maint_tasks_approved', ..., maintenanceDetails: {...} }
      ]
    }
  },
  issues: [...],
  generated_at: '...',
  processing_time_ms: ...
}
```

---

## Next Steps (IMMEDIATE)

### 1. Restart Node Server & Test
```bash
# Restart to pick up funnel.service.js changes
./restart-all.sh

# Or just Node:
# Kill existing: lsof -ti:3000 | xargs kill -9
# Start: npm run dev

# Test API
curl http://localhost:3000/api/funnel/stats | jq '.data.branches'

# View in browser
open http://localhost:3000/funnel
```

### 2. Verify Branching Visualization
- Check that shared stages render at top
- Check that "Branches into two pipelines" label appears
- Check DIP branch on left (pink/yellow gradient)
- Check Maintenance branch on right (green gradient)
- Click on "Tasks Approved" to see breakdown by system/category/frequency

### 3. User Mentioned "System vs Boat" Split
The user mentioned wanting to split approved tasks by "system and boat". Current data shows all tasks are linked to a specific system (asset_uid). May need clarification on what "boat-level" tasks means.

---

## Future Enhancements

1. Add drill-down links (click system count → see systems list)
2. Add DIP production table counts to funnel
3. Add historical tracking (funnel over time)
4. Add alerts for critical issues
5. Add processing action buttons (trigger DIP, etc.)
6. Clarify "boat vs system" task distinction

---

## Testing

```bash
# Restart Node server first!
./restart-all.sh

# Then visit
http://localhost:3000/funnel
```

API endpoint: `GET /api/funnel/stats`

**Expected behavior:**
1. Shared stages show at top (Systems → Vectors)
2. Branch point label: "Branches into two pipelines"
3. Two columns: DIP (left, pink) and Maintenance (right, green)
4. Click any stage to expand breakdown
5. Maintenance "Tasks Approved" shows by system/category/frequency

---

## Scripts

**Check DIP status:**
```bash
node scripts/check-dip-status.cjs
```

**Check Maintenance stats:**
```bash
node scripts/check-maintenance-stats.cjs
```

---

## Related Docs (Updated)

- [Documents](docs/20-admin-tools/documents.md) - DIP staging tables
- [Maintenance](docs/10-user-features/maintenance.md) - **REWRITTEN** - 6-step pipeline
- [Architecture](docs/architecture-diagram.md) - **UPDATED** - Branching diagram
- [Systems](docs/20-admin-tools/systems.md)
- [Pinecone](docs/20-admin-tools/pinecone.md)

---

## Session History

| Session | Date | Focus |
|---------|------|-------|
| 1 | 2025-12-26 | Initial funnel page, DIP investigation |
| 2 | 2025-12-26 | DIP staging tables, status values, system-level stats |
| 3 | 2025-12-26 | Documentation fixes, Maintenance Agent discovery, branching visualization |
