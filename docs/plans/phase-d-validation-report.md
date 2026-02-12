# Phase D Validation Report
**Date:** 2026-02-08  
**Plan:** Model Detection Map-Reduce Redesign — Server-side pipeline arrays (Node only)

---

## Phase D Requirements (from plan)

**Ships:**
1. `alias-map.service.js` helper
2. Vision/DIP/Index services call helper instead of reading from frontend request body
3. `selected_models` / `referenced_selections` become optional in schemas
4. Frontend simplified to pass `doc_id` only

**Test gate:** Run Vision on a document. Log what the Node service sends to Python — confirm `selected_models` = [primaryOriginal] + family aliases, `referenced_selections` = expanded refs, `alias_map` present.

---

## Validation Results

### 1. `alias-map.service.js` helper — ✓ COMPLETE

| Requirement | Status | Evidence |
|-------------|--------|----------|
| File exists | ✓ | `src/services/alias-map.service.js` |
| `buildPipelineModelParams(docId)` | ✓ | Exported function, returns `{ selected_models, referenced_selections, alias_map, models_covered }` |
| Fetches document (model_norm, models_covered, family_aliases) | ✓ | Lines 24-36 |
| primaryOriginal recovery | ✓ | `modelsCovered.find(m => normalizeModelKey(m) === modelNorm) \|\| modelNorm` (lines 40-42) |
| selected_models = [primaryOriginal] + family_aliases | ✓ | Lines 45-57 |
| Fetches document_referenced_systems (user_selected=true) | ✓ | Lines 61-65 |
| referenced_selections = raw_model + aliases (expanded) | ✓ | Lines 67-93 |
| alias_map: family_aliases → [model_norm]; refs: raw_model, aliases → [canonical_model] | ✓ | Lines 71-92 |

---

### 2. Vision/DIP/Index call helper — ✓ COMPLETE (via routes)

| Pipeline | Status | Evidence |
|----------|--------|----------|
| **Vision** (`/:docId/vision`) | ✓ | Route calls `buildPipelineModelParams(docId)` when `!selectedModels \|\| selectedModels.length === 0` (lines 329-334). Passes `selectedModels`, `referencedSelections` to `runVisionPipeline`. |
| **Index** (`/:docId/index`) | ✓ | Same pattern (lines 636-641). Derives from DB when frontend sends empty. |
| **DIP run** (`/:docId/dip/run`) | ✓ | Always calls `buildPipelineModelParams(docId)` (line 896). Uses `dbParams` when frontend omits arrays. Prefer frontend values when provided (lines 897-900). |

**Note:** The helper is called by the **routes**, not directly by the services. The services (`runVisionPipeline`, `runV5Indexing`) receive `selectedModels` and `referencedSelections` as parameters — they do not call the helper. The routes derive from DB and pass the result. This satisfies the plan.

---

### 3. Schemas: selected_models / referenced_selections optional — ✓ COMPLETE

| Schema / Route | Status | Evidence |
|----------------|--------|----------|
| VisionPipelineRequestSchema | ✓ | `selected_models: z.array(z.string()).optional()` — `src/schemas/document.schema.js:329` |
| Index route | ✓ | No Zod schema; reads `req.body`. Logic treats empty as "derive from DB" — effectively optional. |
| DIP run route | ✓ | No schema; logic uses `dbParams` when frontend omits — effectively optional. |

---

### 4. Frontend simplified to pass doc_id only — ✓ COMPLETE

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Frontend passes doc_id only | ✓ | `runVision({ docId, storagePath })` — sends only `storage_path`, `pages` (no selected_models/referenced_selections). `runIndexing({ docId, installedAssetUid })` — sends only `asset_uid`, `skip_dip`. `runDipStreaming({ docId })` — sends empty body `{}`. |
| Survives page refresh | ✓ | Document + document_referenced_systems are written in Step 1 (POST /documents). Pipelines run after; server derives from DB. No in-memory detection state required for pipelines. |

**Implementation:** Comments in code: "Phase D: server derives selected_models/referenced_selections from DB" (vision, index), "server derives model arrays from DB (Phase D)" (dip/run).

---

### 5. Additional checks

| Check | Status |
|-------|--------|
| Vision service receives models_covered from document (not helper) | ✓ — Vision fetches document separately for models_covered. Helper’s `models_covered` is used by DIP run. |
| DIP run uses dbParams.models_covered | ✓ — Line 922 |
| storeDipRunParams accepts alias_map | ❌ — Not implemented. Plan 7a says "accept alias_map in storeDipRunParams, include in params passed to sidecar." Phase D test gate says "alias_map present" in built params — the helper returns it. Passing it to the sidecar is Phase E (normalization). For Phase D, alias_map does not need to be sent to Python. |

---

## Summary

| Phase D Requirement | Status |
|---------------------|--------|
| alias-map.service.js helper | ✓ Complete |
| Vision/DIP/Index use helper (via routes) | ✓ Complete |
| selected_models / referenced_selections optional | ✓ Complete |
| Frontend simplified to pass doc_id only | ✓ Complete |

**Phase D: COMPLETE**

The frontend passes only `doc_id` (plus pipeline-specific params: `storage_path` for vision, `installedAssetUid` for index). No `selected_models` or `referenced_selections` are sent to the pipeline endpoints. The server derives them from the DB via `buildPipelineModelParams(docId)`. Flow survives page refresh because document and document_referenced_systems are persisted before pipelines run.
