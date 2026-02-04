# 84 - Doc Assets Chat Integration & Synonym/Referenced Systems Gap Analysis

**Date:** 2026-02-04
**Branch:** Stable-v4-Working
**Session Focus:** Integrate doc_assets (figures/tables) into chat retrieval, fix metrics panel, discover referenced_systems propagation gap and synonym infrastructure gaps.

---

## 1. What Was Completed This Session

### A) Doc Assets Retriever - Created and Integrated

**New file:** `python-sidecar/app/chat/services/doc_assets_retriever.py`

Production service that retrieves figures/tables from `doc_assets` during chat:
- Uses v5 filtering: doc_id scoping + model scoping (two-category rule)
- Primary docs: `is_universal=true` OR `applies_to_models overlaps focus_models`
- Referencing docs: `referenced_systems overlaps focus_models`
- Text search: OR across normalized terms x columns (`search_blob`, `title`, `description`, `figure_reference`)
- Three-stage selection:
  - Stage 1: PostgREST query with v5 filters → up to 100 candidates
  - Stage 2: Deterministic shortlist (K=12) ranked by text relevance score
  - Stage 3: LLM selection (gpt-4o-mini) picks N=3 most relevant

**Scoring weights:**
- Exact figure_reference match: +100
- Term hit in search_blob: +10
- Term hit in title: +5
- Term hit in description: +3
- Intent boost (asset_kind matches intent): +20

**Cost:** ~$0.0003 per query for LLM selection

### B) Chat Workflow Integration

**File:** `python-sidecar/app/chat/workflows/chat_workflow_sequential.py`

Changes:
- Added `from ..services.doc_assets_retriever import DocAssetsRetriever`
- Initialized `self.doc_assets_retriever = DocAssetsRetriever()` in `__init__`
- Added doc_assets retrieval call in `_retrieve_data()` after Pinecone results
- Non-fatal: if doc_assets fails, sets empty result and continues
- State keys: `state["doc_assets_results"]`, `state["doc_assets_duration_ms"]`
- Added `DOC_ASSETS` to `_format_sources()` - only emitted when `count > 0`

### C) LLM Synthesis Receives Doc Assets

**File:** `python-sidecar/app/chat/services/llm_service.py`

Changes:
- Added `doc_assets_results` parameter to `synthesize_response()`
- Added `_format_doc_assets_context()` method that formats selected assets for the LLM:
  - Asset kind, figure reference, title, page number
  - Description and search_blob (truncated to 300 chars)
  - Instruction: "When referencing these visuals, mention the figure number (e.g., 'See FIG. 3-8')"
- Passed `doc_assets_context` to prompt template

**File:** `python-sidecar/app/chat/config/system_prompts.py`

Changes:
- Added section to SYNTHESIS_PROMPT_TEMPLATE:
  ```
  RELEVANT DIAGRAMS & TABLES (figures from manuals - reference these by figure number when helpful):
  {doc_assets_context}
  ```

### D) Frontend - Inline Rendering + Stats Fix

**File:** `src/public/index.html`

Changes:
- Fixed duplicate `id="toggleStatsBtn"` bug (lines 37 and 64)
- Both buttons now use `class="toggle-stats-btn" data-toggle-stats` attribute instead of ID

**File:** `src/public/app.js`

Changes:
- Updated `initializeStatsPanel()` to use `querySelectorAll('[data-toggle-stats]')` so both buttons work
- Added DOC_ASSETS inline rendering in `addEnhancedMessage()`:
  - Detects `DOC_ASSETS` source with `count > 0`
  - Renders "Related Diagrams & Tables" strip with thumbnail cards
  - Each card shows: thumbnail image, asset kind icon, figure reference, title
  - Click opens full-size image in new tab

**File:** `src/public/chat-styles.css`

Changes:
- Added `.doc-assets-strip` styles (gradient background, rounded border)
- Added `.doc-asset-item` card styles (160px wide, hover lift effect)
- Added `.doc-asset-thumb` (100px height, cover background)
- Added `.doc-asset-info` with kind, ref, title labels
- Added dark mode support

### E) Test Script

**New file:** `python-sidecar/scripts/test_doc_assets_retrieval.py`

Standalone test with production-matching inputs/outputs. Hardcoded test case:
- Query: "how do I depressurize my watermaker?"
- Doc: `759ac8ff51c98c10358e2c0604c1ca73cf975023949d6e122f9af6e8cb32f061` (Schenker ZEN150)
- Focus models: `['ZEN15048VDC']`
- Keywords: `['depressurize', 'pressure', 'valve', 'watermaker']`

Test results: 50 candidates → 12 shortlisted → 3 selected (FIG. 3-8 ranked #1 with score 61)

---

## 2. Verified Schema: doc_assets Table

Confirmed from production Supabase (not just migrations):

```sql
create table public.doc_assets (
  id UUID PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(doc_id),
  page_number INT NOT NULL,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('figure', 'table')),
  asset_index INT NOT NULL,
  asset_type TEXT NULL,
  title TEXT NULL,
  description TEXT NULL,
  bbox JSONB NOT NULL,
  storage_path TEXT NOT NULL,
  analysis_path TEXT NOT NULL,
  applies_to_models TEXT[] NOT NULL,
  referenced_systems TEXT[] NOT NULL DEFAULT '{}',
  is_universal BOOLEAN NOT NULL DEFAULT false,
  asset_json JSONB NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'low',
  attribution_warnings TEXT[] NOT NULL DEFAULT '{}',
  figure_reference TEXT NULL,        -- NOT in migration, added manually
  search_blob TEXT NULL,             -- NOT in migration, added manually
  UNIQUE (doc_id, page_number, asset_kind, asset_index)
);
```

**Important:** `figure_reference` and `search_blob` columns exist in production but are NOT in any tracked migration. They were added manually.

**Indexes:**
- GIN on `applies_to_models`, `referenced_systems`, `attribution_warnings`
- Btree on `(doc_id, page_number)`, `confidence`
- Partial btree on `figure_reference` WHERE NOT NULL

**Confirmed:**
- `search_blob` is 100% populated for existing assets
- Storage paths resolve correctly (HTTP 200, image/jpeg, 7.7KB-93.9KB)
- URL pattern: `${SUPABASE_URL}/storage/v1/object/public/documents/${storage_path}`

---

## 3. Referenced Systems Gap (Critical Finding)

### The Problem

User selects referenced systems in the ingest UI (e.g., FUSIONLINK, CMAP, H5000, NAVIONICS, PREDICTWIND for Zeus 3S doc). These are correctly saved to the `document_referenced_systems` junction table. BUT:

- `doc_assets.referenced_systems` is derived only from per-page content analysis during vision extraction
- Vision pipeline does NOT read the junction table
- Result: assets missing user-selected references

### Zeus 3S Doc Evidence

**Doc ID:** `c0423de72bdbb87d3bb3b517bc4f4ba189c02e21d5da4f815d0cac303848770f`

**Junction table (`document_referenced_systems`):**

| canonical_model | user_selected |
|-----------------|:---:|
| H5000 | true |
| FUSIONLINK | true |
| NAVIONICS | true |
| CMAP | true |
| PREDICTWIND | true |
| S3100 | false |
| FLIR | false |
| BEPCZONE | false |
| NAVIOP | false |
| ITCLIGHTING | false |
| NMEA2000RGBWLIGHTING | false |
| SIRIUSXM | false |

**doc_assets referenced_systems (from content analysis only):**

| System | doc_assets count | DIP table count |
|--------|:---:|:---:|
| PREDICTWIND | 34 | 5 |
| NAVIONICS | 17 | 5 |
| H5000 | 10 | 3 |
| CMAP | 0 | 5 |
| FUSIONLINK | 0 | 1 |

**Evidence check (search_blob text search):**

| Term | Assets with evidence |
|------|:---:|
| `fusion` | 0 |
| `fusionlink` | 0 |
| `cmap` | 0 |
| `c-map` | 3 (page 30) |

**Root cause:** Vision pipeline generates search_blobs without knowing the doc's referenced vocabulary. So the LLM doesn't mention FUSIONLINK/CMAP in the blob, and evidence-based matching can't find them.

### Data Flow (Verified)

1. UI collects `referenced_selections` array
2. Route handler receives them in `req.body.referenced_selections`
3. `saveReferencedSystems()` saves to `document_referenced_systems` junction table (WORKS)
4. `upsertDocumentRecord()` receives `referencedModels` parameter but IGNORES it (dead code)
5. `documents` table has NO `referenced_systems` column (by design - uses junction table)
6. Vision pipeline creates doc_assets with `referenced_systems` from content analysis ONLY (never reads junction table)

---

## 4. Synonym Infrastructure Gaps (Critical Finding)

### What Exists

**Reference table synonyms (manual, via migrations):**
- `ref_manufacturers.synonyms[]` - ~26 manufacturers with hand-curated synonyms
- `ref_product_types.synonyms[]` - ~45 product types
- `ref_system_categories.synonyms[]` - 9 categories
- `ref_subsystem_categories.synonyms[]` - ~35 subcategories
- Populated by migration 036 (SQL INSERT/UPDATE statements)
- NO UI to edit - requires SQL migration

**Per-system synonyms (automatic, LLM-generated):**
- `systems.synonyms_fts` - search variations (string, not array)
- `systems.synonyms_human` - same as above
- `systems.spec_keywords` - functional keywords
- Generated by OpenAI LLM when system is created in admin UI
- Prompt asks for 20-50 spelling/format/abbreviation/typo variations
- Bulk script: `scripts/bulk/generate-keywords-synonyms.js`

**Dead field:**
- `systems.model_synonyms` TEXT[] - column exists (migration 030) with GIN index, but NEVER populated by any code

### What's Missing

1. **Nobody queries synonyms during chat retrieval** - synonym data exists but isn't wired into v5 filtering
2. **No model-level synonym lookup table** - per-system synonyms are flat strings, not a searchable lookup
3. **Cross-language consistency** - no shared normalization function between Node and Python
4. **Reference table synonyms have no UI** - stuck in migration SQL

---

## 5. Plans Reviewed This Session

### Plan: chat_diagrams_and_metrics_integration

| Todo | Status |
|------|--------|
| `dip-columns-report` | COMPLETE |
| `doc-assets-chat-retrieval` | COMPLETE (backend + frontend) |
| `desktop-metrics-and-assets` | Partial - duplicate ID fixed, metrics panel extension deferred |

### Plan: chat_doc_assets_show_only_if_llm_recommends

| Todo | Status |
|------|--------|
| `backend-omit-empty-doc-assets` | COMPLETE |
| `frontend-gate-rendering` | COMPLETE |

### Plan: doc_assets_referenced_systems_propagation

Status: Reviewed, not implemented. Key insight: evidence-based matching alone won't fix FUSIONLINK (zero evidence in search_blobs).

### Plan: canonical_alias_and_typo_tolerant_matching

Status: Reviewed. Three-layer approach (normalization → alias expansion → LLM typo). User's feedback: Layer 2 (synonym lookup) is the most valuable, and the synonym data should be made "way more vast" rather than building complex matching code. Supabase synonym lookup is already fast.

---

## 6. Priority Recommendations (User's Direction)

1. **Make search_blob generation vocabulary-aware** (Section C of alias plan)
   - When generating search_blobs, tell the LLM the doc's referenced systems vocabulary
   - This creates evidence where none exists today (FUSIONLINK, CMAP)
   - Enables evidence-based propagation to work

2. **Expand synonym data massively**
   - User wants fat synonym tables rather than complex matching code
   - Supabase lookup is sub-10ms, so volume isn't a problem
   - Options: LLM batch generation with human review, or manual curation

3. **Wire synonyms into retrieval**
   - Currently synonyms exist but aren't queried during chat
   - Need to plug into v5 filtering path

4. **Unify normalization** (comparison key function)
   - Same rules in Node and Python
   - Strip hyphens, spaces, underscores, punctuation, uppercase

---

## 7. Files Modified This Session

| File | Change |
|------|--------|
| `python-sidecar/app/chat/services/doc_assets_retriever.py` | NEW - doc_assets retriever service |
| `python-sidecar/app/chat/workflows/chat_workflow_sequential.py` | Import, init, retrieve, format sources, pass to synthesis |
| `python-sidecar/app/chat/services/llm_service.py` | Added doc_assets_results param, _format_doc_assets_context() |
| `python-sidecar/app/chat/config/system_prompts.py` | Added DIAGRAMS & TABLES section to synthesis prompt |
| `python-sidecar/scripts/test_doc_assets_retrieval.py` | NEW - standalone test script |
| `src/public/index.html` | Fixed duplicate toggleStatsBtn ID → data-toggle-stats |
| `src/public/app.js` | Stats toggle fix, DOC_ASSETS inline strip rendering |
| `src/public/chat-styles.css` | Doc assets strip styles + dark mode |
| `scripts/check-zeus-refs.mjs` | NEW - utility script for checking referenced systems |

---

## 8. New Documents Ingested

**Zeus 3S (B&G chartplotter/MFD):**
- Doc ID: `c0423de72bdbb87d3bb3b517bc4f4ba189c02e21d5da4f815d0cac303848770f`
- 162 figures, 10 tables (172 total assets)
- 172 search_blobs generated
- DIP: 37 intent_router, 15 specs, 21 troubleshooting, 27 golden_tests, 24 procedures
- 12 referenced systems (5 user-selected: H5000, FUSIONLINK, NAVIONICS, CMAP, PREDICTWIND)

---

## 9. Key Technical Details for Post-Compact

### DocAssetsRetriever Constants
```python
MAX_TERMS = 6
SHORTLIST_K = 12
SELECT_N = 3
TEXT_SEARCH_COLUMNS = ['search_blob', 'title', 'description', 'figure_reference']
```

### Image URL Pattern
```
${SUPABASE_URL}/storage/v1/object/public/documents/${storage_path}
```

### Watermaker Test Doc
- Doc ID: `759ac8ff51c98c10358e2c0604c1ca73cf975023949d6e122f9af6e8cb32f061`
- Model: `ZEN15048VDC`
- All assets universal, no referenced_systems

### Zeus 3S Test Doc
- Doc ID: `c0423de72bdbb87d3bb3b517bc4f4ba189c02e21d5da4f815d0cac303848770f`
- Model: `ZEUS3S`
- Has referenced_systems: PREDICTWIND (34), NAVIONICS (17), H5000 (10)
- Missing from assets: CMAP, FUSIONLINK (despite being user-selected)

### Junction Table Query for Referenced Systems
```sql
SELECT canonical_model, user_selected
FROM document_referenced_systems
WHERE doc_id = :doc_id
```

### Synonym Data Locations
- `ref_manufacturers.synonyms[]` - manual, migration 036
- `ref_product_types.synonyms[]` - manual, migration 036
- `systems.synonyms_fts` - LLM-generated on system create
- `systems.model_synonyms` - EXISTS but EMPTY (dead field)
