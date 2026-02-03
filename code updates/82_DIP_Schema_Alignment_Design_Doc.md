# DIP Schema Alignment Plan (v5, production-only, no staging, no legacy)

**Date:** 2026-02-02 (updated 2026-02-03)
**Status:** ✅ Code implementation complete → Ready for end-to-end testing
**Root Cause:** Sidecar inserts assume columns that do not exist in production tables

---

## Executive Summary (what we are doing)

The v5 DIP extraction system will be **production-only** and **schema-driven**:
- No staging workflow
- No “legacy” retriever paths
- Prompts and inserts must match production DB schemas exactly
- Add one missing capability: referenced-system tagging as a first-class column

**Current architecture (v5):**

| Component | Path | Status |
|-----------|------|--------|
| **v5 DIP** | Python sidecar → DIP streaming → `_insert_dip_results()` → **production tables** | ✅ FIXED (2026-02-03) |

**Plan decision:** Staging tables are not part of the architecture. We will not preserve or expand staging workflows.

---

## Problem Statement

From the error logs:
```
[ERROR] Failed to insert into intent_router: 400 {"code":"PGRST204","message":"Could not find the 'confidence' column"}
[ERROR] Failed to insert into troubleshooting: 400 {"code":"PGRST204","message":"Could not find the 'error_code' column"}
[WARNING] Failed to parse JSON from specs response
[ERROR] Failed to insert into golden_tests: 400 {"code":"PGRST204","message":"Could not find the 'confidence' column"}
[ERROR] Failed to insert into playbook_hints: 400 {"code":"PGRST204","message":"Could not find the 'confidence' column"}
```

---

## Decisions (locked for v5)

1. **Production-only** DIP writes (no staging flow).
2. **No legacy**: do not maintain parallel “old vs new” DIP systems.
3. **Tagging contract**:
   - `applies_to_models TEXT[]`: **primary-only** canonical keys.
   - `referenced_systems TEXT[]`: **referenced-only** canonical keys.
   - This avoids overloading `applies_to_models` while still making referenced-only DIP retrievable.
4. **Idempotency**:
   - `force_rerun=true` deletes by `doc_id` for the selected modes, then inserts new rows.
   - **Preserve approvals**: deletion must be `WHERE doc_id=... AND status != 'approved'` so reruns do not destroy approved/human-reviewed rows.
5. **Status convention**:
   - All inserts set `status='dip_extracted'` (so chat retrieval can filter `IN ('dip_extracted','approved')` consistently).
6. **Chat-time DIP retriever**:
   - Use the production retriever only (no staging/legacy fallback).
   - Update production retriever filters to support `referenced_systems` so referenced-only DIP is retrievable without polluting primary-only queries.
7. **Referenced systems tagging policy**:
   - The request provides `referenced_selections` (allowlist).
   - Each extracted item may include `referenced_systems` (more specific).
   - Insert-time enforcement:
     - If the item includes `referenced_systems`, store `referenced_systems = item.referenced_systems ∩ referenced_selections`.
     - If the item omits `referenced_systems`, store `referenced_systems = []` (primary-only row).
   - This keeps tags canonical + bounded to user-approved referenced systems while allowing VC20 vs SD60 specificity.
8. **Invalid JSON handling (per mode)**:
   - If the model returns invalid JSON for a mode:
     - Retry **once** with an explicit “JSON only” repair instruction.
     - If still invalid, treat the mode as **failed** (emit `mode_failed` SSE and return `DIPModeResult.success=false`) with `error_code='INVALID_JSON'`.
   - Do not silently treat invalid JSON as “success with 0 items”.
9. **NOT NULL constraint handling (item-level)**
   - Some production tables have required columns:
     - `troubleshooting`: `symptom`, `cause`
     - `playbook_hints`: `title`, `steps`
     - `golden_tests`: `query`, `expected`
   - Policy:
     - If an extracted **item** is missing a required field, **skip that item**, log/emit a warning, and continue.
     - If the model returned an empty array (`[]`), that is a valid “no extractions” success.
     - If the model returned \(N > 0\) items but **0** pass validation, treat the mode as **failed** with `error_code='SCHEMA_VALIDATION_FAILED'` (do not show green).
   - Special case (troubleshooting multi-cause):
     - If `possible_causes` exists but `cause` is missing/empty, derive `cause` from the first `possible_causes[].cause` (required by DB).
10. **Universal primary semantics**
   - For primary-universal DIP items (apply to all selected primary models), use `applies_to_models=["all"]` (sentinel, not a model key).
   - Keep `referenced_systems` as the concrete referenced keys (no sentinel).
11. **"all" exclusivity**
   - If `"all"` appears in `applies_to_models`, normalize to `["all"]` (drop all other values).
   - `"all"` is a sentinel meaning "primary-universal across selected primary models" and must not be mixed with specific model keys.
   - Enforcement: insert-time normalization in `_insert_dip_results()`.

---

## Required DB migrations (minimal, production tables only)

### Migration A — add `referenced_systems TEXT[]` to all 5 DIP tables

```sql
ALTER TABLE public.spec_suggestions
  ADD COLUMN IF NOT EXISTS referenced_systems text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.playbook_hints
  ADD COLUMN IF NOT EXISTS referenced_systems text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.troubleshooting
  ADD COLUMN IF NOT EXISTS referenced_systems text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.golden_tests
  ADD COLUMN IF NOT EXISTS referenced_systems text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.intent_router
  ADD COLUMN IF NOT EXISTS referenced_systems text[] NOT NULL DEFAULT '{}'::text[];
```

Recommended indexes (keep retrieval fast as data grows):

```sql
CREATE INDEX IF NOT EXISTS idx_spec_suggestions_refsys_gin
  ON public.spec_suggestions USING gin (referenced_systems);
CREATE INDEX IF NOT EXISTS idx_playbook_hints_refsys_gin
  ON public.playbook_hints USING gin (referenced_systems);
CREATE INDEX IF NOT EXISTS idx_troubleshooting_refsys_gin
  ON public.troubleshooting USING gin (referenced_systems);
CREATE INDEX IF NOT EXISTS idx_golden_tests_refsys_gin
  ON public.golden_tests USING gin (referenced_systems);
CREATE INDEX IF NOT EXISTS idx_intent_router_refsys_gin
  ON public.intent_router USING gin (referenced_systems);
```

### Migration B — fix `playbook_hints.asset_uid` type (TEXT → UUID) + FK

The schema currently shows `playbook_hints.asset_uid text null`, which is inconsistent with other DIP tables and makes correct linking impossible.

```sql
ALTER TABLE public.playbook_hints
  ALTER COLUMN asset_uid TYPE uuid USING NULLIF(asset_uid, '')::uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'playbook_hints_asset_uid_fkey'
  ) THEN
    ALTER TABLE public.playbook_hints
      ADD CONSTRAINT playbook_hints_asset_uid_fkey
      FOREIGN KEY (asset_uid) REFERENCES public.systems(asset_uid) ON DELETE SET NULL;
  END IF;
END $$;
```

---

## Actual Database Schemas (Source of Truth)

### spec_suggestions
```sql
create table public.spec_suggestions (
  id uuid not null default gen_random_uuid (),
  doc_id character varying(255) not null,
  approved_at timestamp with time zone null default now(),
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  status text not null default 'pending'::text,
  manufacturer_norm text null,
  model_norm text null,
  asset_uid uuid null,
  description text null,
  parameter text null,
  normalized_parameter text null,
  parameter_aliases jsonb null default '[]'::jsonb,
  value text null,
  range text null,
  units text null,
  normalized_units text null,
  converted_value text null,
  category text null,
  search_terms jsonb null default '[]'::jsonb,
  concept_group text null,
  "references" jsonb null default '[]'::jsonb,
  approved_by text null,
  parameter_aliases_text text null,
  search_terms_text text null,
  references_text text null,
  applies_to_models text[] null,
  constraint spec_suggestions_pkey primary key (id),
  constraint spec_suggestions_asset_uid_fkey foreign KEY (asset_uid) references systems (asset_uid),
  constraint spec_suggestions_doc_id_fkey foreign KEY (doc_id) references documents (doc_id) on delete CASCADE
);
```

### troubleshooting
```sql
create table public.troubleshooting (
  id uuid not null default gen_random_uuid (),
  doc_id text null,
  asset_uid uuid null,
  symptom text not null,
  symptom_variations text[] null,
  symptom_category text null,
  cause text not null,
  check_action text null,
  resolution text null,
  source_type text null,
  source_ref text null,
  related_system_uid uuid null,
  related_system_name text null,
  relationship_type text null,
  models text[] null,
  priority integer null,
  manufacturer_norm text null,
  model_norm text null,
  approved_at timestamp with time zone null default now(),
  created_at timestamp with time zone null default now(),
  applies_to_models text[] null,
  possible_causes jsonb null,
  status text null default 'dip_extracted'::text,
  constraint troubleshooting_pkey primary key (id),
  constraint troubleshooting_asset_uid_fkey foreign KEY (asset_uid) references systems (asset_uid),
  constraint troubleshooting_related_system_uid_fkey foreign KEY (related_system_uid) references systems (asset_uid)
);
```

### playbook_hints
```sql
create table public.playbook_hints (
  id uuid not null default gen_random_uuid (),
  doc_id character varying(255) not null,
  title character varying(255) not null,
  description text null,
  steps jsonb not null,
  expected_outcome text null,
  preconditions jsonb null,
  error_codes jsonb null,
  manufacturer_norm text null,
  model_norm text null,
  asset_uid text null,
  status text null default 'pending'::text,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  approved_at timestamp with time zone null,
  approved_by text null,
  steps_text text null,
  preconditions_text text null,
  error_codes_text text null,
  applies_to_models text[] null,
  constraint playbook_hints_pkey primary key (id),
  constraint playbook_hints_doc_id_fkey foreign KEY (doc_id) references documents (doc_id) on delete CASCADE
);
```

### intent_router
```sql
create table public.intent_router (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  created_by text null default 'admin'::text,
  doc_id text not null,
  status text not null default 'pending'::text,
  manufacturer_norm text null,
  model_norm text null,
  asset_uid uuid null,
  description text null,
  question text null,
  question_variations jsonb null default '[]'::jsonb,
  answer text null,
  question_type text null,
  "references" jsonb null default '[]'::jsonb,
  approved_at timestamp with time zone null,
  approved_by text null,
  question_variations_text text null,
  references_text text null,
  applies_to_models text[] null,
  constraint intent_router_pkey primary key (id),
  constraint intent_router_doc_id_fkey foreign KEY (doc_id) references documents (doc_id) on delete CASCADE
);
```

### golden_tests
```sql
create table public.golden_tests (
  id uuid not null default gen_random_uuid (),
  doc_id text not null,
  query text not null,
  expected text not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  status text not null default 'pending'::text,
  manufacturer_norm text null,
  model_norm text null,
  asset_uid uuid null,
  description text null,
  test_method text null,
  failure_indication text null,
  related_procedures jsonb null default '[]'::jsonb,
  approved_at timestamp with time zone null,
  approved_by text null,
  related_procedures_text text null,
  applies_to_models text[] null,
  constraint golden_tests_pkey primary key (id),
  constraint golden_tests_doc_id_fkey foreign KEY (doc_id) references documents (doc_id) on delete CASCADE
);
```

---

## Detailed Schema Comparison

### 1. `spec_suggestions` Table

**Python v5 code tries to insert:**
```python
{
    "doc_id": doc_id,
    "hint_type": item.get("hint_type", "unknown"),
    "value": str(item.get("value", "")),
    "unit": item.get("unit"),
    "context": item.get("context"),
    "page": item.get("page"),
    "confidence": 0.8
}
```

**Actual DB schema has:**
```sql
doc_id, parameter, normalized_parameter, parameter_aliases, value, range,
units, normalized_units, converted_value, category, search_terms,
concept_group, references, description, status, manufacturer_norm,
model_norm, asset_uid, applies_to_models, ...
```

**Gap Analysis (v5 insert vs production schema):**
| v5 Code Expects | Actual DB Column |
|-----------------|------------------|
| `hint_type` | *doesn't exist* (use `parameter`) |
| `value` | `value` |
| `unit` | `units` (plural) |
| `context` | *doesn't exist* (use `description`) |
| `page` | *doesn't exist* |
| `confidence` | *doesn't exist* |

---

### 2. `troubleshooting` Table

**Python v5 code tries to insert:**
```python
{
    "doc_id": doc_id,
    "symptom": item.get("symptom", ""),
    "cause": item.get("cause", ""),
    "solution": item.get("solution", ""),
    "error_code": item.get("error_code"),
    "page": item.get("page"),
    "applies_to_models": selected_models
}
```

**Actual DB schema has:**
```sql
doc_id, symptom, symptom_variations, symptom_category, cause,
check_action, resolution, source_type, source_ref, models,
priority, applies_to_models, possible_causes, status, ...
```

**Gap Analysis:**
| v5 Code Expects | Actual DB Column |
|-----------------|------------------|
| `symptom` | `symptom` |
| `cause` | `cause` |
| `solution` | `resolution` (different name!) |
| `error_code` | *doesn't exist* |
| `page` | *doesn't exist* |
| `applies_to_models` | `applies_to_models` |

---

### 3. `playbook_hints` Table

**Python v5 code tries to insert:**
```python
{
    "doc_id": doc_id,
    "title": item.get("title", ""),
    "preconditions": item.get("preconditions", []),
    "steps": item.get("steps", []),
    "expected_outcome": item.get("expected_outcome", ""),
    "models": item.get("models", selected_models),
    "error_codes": item.get("error_codes", []),
    "confidence": 0.9
}
```

**Actual DB schema has:**
```sql
doc_id, title, description, steps, expected_outcome, preconditions,
error_codes, manufacturer_norm, model_norm, asset_uid, status,
applies_to_models, ...
```

**Gap Analysis (closest match!):**
| v5 Code Expects | Actual DB Column |
|-----------------|------------------|
| `title` | `title` |
| `preconditions` | `preconditions` |
| `steps` | `steps` |
| `expected_outcome` | `expected_outcome` |
| `models` | `applies_to_models` (name mismatch) |
| `error_codes` | `error_codes` |
| `confidence` | *doesn't exist* |

---

### 4. `intent_router` Table

**Python v5 code tries to insert:**
```python
{
    "doc_id": doc_id,
    "intent_type": item.get("intent_type", "how_to"),
    "prompt": item.get("prompt", ""),
    "context": item.get("context", ""),
    "confidence": 0.8
}
```

**Actual DB schema has:**
```sql
doc_id, question, question_variations, answer, question_type,
references, description, manufacturer_norm, model_norm,
asset_uid, status, applies_to_models, ...
```

**Gap Analysis (v5 insert vs production schema):**
| v5 Code Expects | Actual DB Column |
|-----------------|------------------|
| `intent_type` | `question_type` |
| `prompt` | `question` |
| `context` | `answer` and/or `description` |
| `confidence` | *doesn't exist* |

---

### 5. `golden_tests` Table

**Python v5 code tries to insert:**
```python
{
    "doc_id": doc_id,
    "test_name": item.get("test_name", ""),
    "test_type": item.get("test_type", "best_practice"),
    "description": item.get("description", ""),
    "steps": item.get("steps", []),
    "expected_result": item.get("expected_result", ""),
    "confidence": 0.85
}
```

**Actual DB schema has:**
```sql
doc_id, query, expected, description, test_method, failure_indication,
related_procedures, manufacturer_norm, model_norm, asset_uid, status,
applies_to_models, ...
```

**Gap Analysis (v5 insert vs production schema):**
| v5 Code Expects | Actual DB Column |
|-----------------|------------------|
| `test_name` | `query` |
| `test_type` | `test_method` |
| `description` | `description` |
| `steps` | `related_procedures` (JSONB) |
| `expected_result` | `expected` |
| `confidence` | *doesn't exist* |

---

## Additional Issue: JSON Parsing for Specs

The `specs` mode failed with "Failed to parse JSON from specs response" BEFORE attempting insert. This is a separate issue - the LLM response wasn't valid JSON.

---

## Schema reality gotchas (must be handled)

1) **`playbook_hints.asset_uid` type mismatch**
- Current DDL shows `asset_uid text null` (inconsistent with other tables).
- Plan: migrate to `uuid` + FK to `systems(asset_uid)` (see Migration B).

2) **Troubleshooting 1:N causes**
- `troubleshooting.cause` is `NOT NULL` but richer structure exists as `possible_causes JSONB`.
- Insert rule:
  - If we have `possible_causes[]`, store it in `possible_causes` and populate `cause` with a stable summary / first cause so the row remains valid.
  - If we have only a single cause, store it in `cause` and keep `possible_causes` null.

---

## Affected Files

### Python sidecar (v5)
- `python-sidecar/app/main.py`
  - Line ~1179: `DIP_MODE_TABLE_MAP`
  - Line ~1188: `DIP_MODE_PROMPTS` (LLM extraction prompts)
  - Line ~1477: `_insert_dip_results()` (insert logic)
  - Line ~1572: `_delete_existing_dip_data()` (force_rerun delete logic)

Note: line numbers may drift. Prefer searching by symbol/function name in the file.

---

## Implementation plan (production-only)

### Fix Python Code to Match Production DB Schema

**Scope:** ~150-200 lines across two areas:

#### 1. Update `_insert_dip_results()` (python-sidecar/app/main.py; see line ~1477)

For each mode, change field mappings to match actual production table columns:

**specs → spec_suggestions:**
```python
# CURRENT (broken):
row.update({
    "hint_type": ...,  # doesn't exist
    "value": ...,
    "unit": ...,       # should be "units"
    "context": ...,    # should be "description"
    "page": ...,       # doesn't exist
    "confidence": 0.8  # doesn't exist
})

# SHOULD BE:
row.update({
    "parameter": item.get("parameter", ""),
    "value": str(item.get("value", "")),
    "units": item.get("units", ""),
    "description": item.get("description", ""),
    "category": item.get("category", ""),
    "references": item.get("references", []),
    "applies_to_models": item.get("applies_to_models", []),  # primary-only or ["all"]
    "referenced_systems": item.get("referenced_systems", []),
    "status": "dip_extracted"
})
```

**troubleshooting:**
```python
# CURRENT (broken):
row.update({
    "symptom": ...,
    "cause": ...,
    "solution": ...,         # should be "resolution"
    "error_code": ...,       # doesn't exist
    "page": ...,             # doesn't exist
    "applies_to_models": ...
})

# SHOULD BE:
row.update({
    "symptom": item.get("symptom", ""),
    "cause": item.get("cause", ""),
    "check_action": item.get("check_action"),
    "resolution": item.get("resolution"),
    "possible_causes": item.get("possible_causes"),
    "applies_to_models": item.get("applies_to_models", []),  # primary-only or ["all"]
    "referenced_systems": item.get("referenced_systems", []),
    "status": "dip_extracted"
})
```

**procedures → playbook_hints:**
```python
# CURRENT (broken):
row.update({
    "title": ...,
    "preconditions": ...,
    "steps": ...,
    "expected_outcome": ...,
    "models": ...,           # should be "applies_to_models"
    "error_codes": ...,
    "confidence": 0.9        # doesn't exist
})

# SHOULD BE:
row.update({
    "title": item.get("title", ""),
    "description": item.get("description"),
    "preconditions": item.get("preconditions", []),
    "steps": item.get("steps", []),
    "expected_outcome": item.get("expected_outcome", ""),
    "error_codes": item.get("error_codes", []),
    "applies_to_models": item.get("applies_to_models", []),  # primary-only or ["all"]
    "referenced_systems": item.get("referenced_systems", []),
    "status": "dip_extracted"
})
```

**golden_rules → golden_tests:**
```python
# CURRENT (broken):
row.update({
    "test_name": ...,        # should be "query"
    "test_type": ...,        # should be "test_method"
    "description": ...,
    "steps": ...,            # should be "related_procedures"
    "expected_result": ...,  # should be "expected"
    "confidence": 0.85       # doesn't exist
})

# SHOULD BE:
row.update({
    "query": item.get("query", ""),
    "expected": item.get("expected", ""),
    "test_method": item.get("test_method", ""),
    "description": item.get("description", ""),
    "failure_indication": item.get("failure_indication", ""),
    "related_procedures": item.get("related_procedures", []),
    "applies_to_models": item.get("applies_to_models", []),
    "referenced_systems": item.get("referenced_systems", []),
    "status": "dip_extracted"
})
```

**intent_router:**
```python
# CURRENT (broken):
row.update({
    "intent_type": ...,      # should be "question_type"
    "prompt": ...,           # should be "question"
    "context": ...,          # should be "answer"
    "confidence": 0.8        # doesn't exist
})

# SHOULD BE:
row.update({
    "question": item.get("question", ""),
    "question_type": item.get("question_type", ""),
    "answer": item.get("answer", ""),
    "question_variations": item.get("question_variations", []),
    "references": item.get("references", []),
    "description": item.get("description"),
    "applies_to_models": item.get("applies_to_models", []),
    "referenced_systems": item.get("referenced_systems", []),
    "status": "dip_extracted"
})
```

#### 2. Update `DIP_MODE_PROMPTS` (python-sidecar/app/main.py; see line ~1188)

Each prompt must instruct the LLM to extract fields that match the corrected insert mappings above.

Additionally, prompts must include explicit tagging guidance and allowlists:
- Valid `applies_to_models` values: `selected_models` plus the sentinel `all`
- Valid `referenced_systems` values: `referenced_selections`
- Never invent model/system keys outside these lists

#### 3. Update `_delete_existing_dip_data()` (force_rerun preserves approvals)

Current delete is too destructive (`?doc_id=eq.<doc_id>`). It must preserve approved work:

Target behavior:
- Delete by `doc_id` AND `status != 'approved'` (per-table/mode).

Example request URL form:

```
/rest/v1/<table>?doc_id=eq.<DOC_ID>&status=neq.approved
```

---

#### 4. Update production chat-time DIP retriever (in-scope)

This plan adds a new column (`referenced_systems`), so chat-time retrieval must be updated to use it.

Concrete changes (Python sidecar):
- File: `python-sidecar/app/chat/services/production_dip_retriever.py`
  - Add a **referenced-scoped** query path:
    - filter: `referenced_systems` overlaps allowed referenced focus models (`ov` operator)
    - same doc_id scoping + text filters + status filter
  - Fix existing troubleshooting text filter to match schema:
    - table column is `resolution` (not `solution`)
  - Keep universal primary logic via `applies_to_models` contains `"all"`.

---

## Validation Steps BEFORE Any Code Changes

1. **Review current `DIP_MODE_PROMPTS`** to understand what LLM is being asked to extract
2. **Map prompt outputs → insert logic → DB columns** end-to-end for each mode
3. **Verify doc_id FK constraint** - documents must exist before DIP insert

---

## Key Constraint

**Staging tables are NOT used.** The v5 system inserts directly into production tables. This means:
- Field mappings must match production table schemas exactly
- LLM prompts must extract fields that map to production columns

---

## Current LLM Prompts (DIP_MODE_PROMPTS)

These prompts tell the LLM what to extract. **They must be updated to extract fields that match the DB schema.**

### specs prompt (extracts wrong fields)
```
Extract all technical specifications from this document.
For each specification, extract:
- hint_type: category (voltage, pressure, temperature, flow_rate, dimension, weight, capacity, etc.)
- value: the numeric or text value
- unit: measurement unit if applicable
- context: surrounding text that explains this spec
- page: page number if identifiable

Return JSON array: [{"hint_type": "...", "value": "...", "unit": "...", "context": "...", "page": null}]
```
**Problem:** Extracts `hint_type`, `unit`, `context`, `page` - DB has `parameter`, `units`, `description`, `category`

### troubleshooting prompt (extracts wrong fields)
```
Extract all troubleshooting information from this document.
For each issue, extract:
- symptom: the problem description
- cause: likely cause(s)
- solution: step-by-step fix
- error_code: any error codes mentioned
- page: page number if identifiable

Return JSON array: [{"symptom": "...", "cause": "...", "solution": "...", "error_code": null, "page": null}]
```
**Problem:** Extracts `solution`, `error_code`, `page` - DB has `resolution`, no error_code, no page

### procedures prompt (almost correct)
```
Extract all maintenance, operation, and installation procedures from this document.
For each procedure, extract:
- title: procedure name
- preconditions: what must be true before starting (array)
- steps: ordered list of steps (array)
- expected_outcome: what should happen when done correctly
- models: which models this applies to (array)
- error_codes: related error codes (array)

Return JSON array: [{"title": "...", "preconditions": [...], "steps": [...], "expected_outcome": "...", "models": [...], "error_codes": [...]}]
```
**Problem:** Extracts `models` - DB has `applies_to_models`

### golden_rules prompt (extracts wrong fields)
```
Extract critical safety rules, warnings, and best practices from this document.
For each rule, extract:
- test_name: short name for the rule
- test_type: category (safety, warning, caution, best_practice)
- description: full description of the rule
- steps: verification steps if applicable (array)
- expected_result: what compliance looks like

Return JSON array: [{"test_name": "...", "test_type": "...", "description": "...", "steps": [...], "expected_result": "..."}]
```
**Problem:** Extracts `test_name`, `test_type`, `steps`, `expected_result` - DB has `query`, `test_method`, `related_procedures`, `expected`

### intent_router prompt (extracts wrong fields)
```
Extract common questions and intents that users might have about this equipment.
For each intent, extract:
- intent_type: category (how_to, troubleshooting, specification, safety, maintenance)
- prompt: example question a user might ask
- context: what topic/section this relates to

Return JSON array: [{"intent_type": "...", "prompt": "...", "context": "..."}]
```
**Problem:** Extracts `intent_type`, `prompt`, `context` - DB has `question_type`, `question`, `answer`

---

## Target prompt contracts (v5) — exact JSON output shapes

All 5 prompts must follow these strict rules:
- **Return ONLY valid JSON** (no markdown fences, no extra text).
- The top-level response must be a **JSON array**.
- The sidecar code will attach `doc_id` and `status='dip_extracted'` during insert.
- **Tagging fields are mandatory on every item**:
  - `applies_to_models`: primary-only canonical keys **from `selected_models`**, OR the sentinel `["all"]` for primary-universal items.
  - `referenced_systems`: referenced-only canonical keys **from `referenced_selections`** (or `[]` when not applicable).

The prompt must include the allowlists explicitly:
- `selected_models` (valid values for `applies_to_models`, plus `all` sentinel)
- `referenced_selections` (valid values for `referenced_systems`)

Tagging instructions (must be in prompt text):
- If an item is about a referenced system (e.g., VC20), set `referenced_systems` to the matching keys (subset of `referenced_selections`).
- If an item is primary-universal, set `applies_to_models=["all"]`.
- Never invent model/system keys outside the allowlists.

### 1) specs → `spec_suggestions`

Expected JSON array shape:

```json
[
  {
    "parameter": "string",
    "value": "string",
    "units": "string or null",
    "category": "string or null",
    "description": "string or null",
    "references": ["string", "string"],
    "applies_to_models": ["PRIMARY_MODEL_KEY"],
    "referenced_systems": ["REFERENCED_SYSTEM_KEY"]
  }
]
```

Notes:
- `references` maps to the `"references"` JSONB column.
- Keep `parameter/value/units` as strings; normalization/aliases can be added later.

### 2) troubleshooting → `troubleshooting`

Expected JSON array shape:

```json
[
  {
    "symptom": "string",
    "cause": "string (required; NOT NULL in DB)",
    "check_action": "string or null",
    "resolution": "string or null",
    "possible_causes": [
      {
        "cause": "string",
        "likelihood": "string or null",
        "fix": "string or null",
        "fix_steps": ["string", "string"]
      }
    ],
    "applies_to_models": ["PRIMARY_MODEL_KEY"],
    "referenced_systems": ["REFERENCED_SYSTEM_KEY"]
  }
]
```

Notes:
- If `possible_causes` is present, `cause` must still be populated (first cause or a stable summary).

### 3) procedures → `playbook_hints`

Expected JSON array shape:

```json
[
  {
    "title": "string",
    "description": "string or null",
    "preconditions": ["string", "string"],
    "steps": ["string", "string"],
    "expected_outcome": "string or null",
    "error_codes": ["string", "string"],
    "applies_to_models": ["PRIMARY_MODEL_KEY"],
    "referenced_systems": ["REFERENCED_SYSTEM_KEY"]
  }
]
```

Notes:
- `steps` is required by DB (`steps jsonb not null`) — always return a non-empty array for real procedures.

### 4) golden_rules → `golden_tests`

Expected JSON array shape:

```json
[
  {
    "query": "string (the rule phrased as a test/question)",
    "expected": "string (what compliant behavior/result is)",
    "description": "string or null",
    "test_method": "string or null",
    "failure_indication": "string or null",
    "related_procedures": ["string", "string"],
    "applies_to_models": ["PRIMARY_MODEL_KEY"],
    "referenced_systems": ["REFERENCED_SYSTEM_KEY"]
  }
]
```

### 5) intent_router → `intent_router`

Expected JSON array shape:

```json
[
  {
    "question_type": "string (how_to | troubleshooting | specification | safety | maintenance | other)",
    "question": "string",
    "answer": "string",
    "description": "string or null",
    "question_variations": ["string", "string"],
    "references": ["string", "string"],
    "applies_to_models": ["PRIMARY_MODEL_KEY"],
    "referenced_systems": ["REFERENCED_SYSTEM_KEY"]
  }
]
```

Notes:
- `question_variations` and `references` map to JSONB columns.

---

## End-to-End Field Mapping (Current vs Required)

### specs → spec_suggestions

| Prompt Extracts | Insert Code Uses | DB Column | Fix |
|-----------------|------------------|-----------|-----|
| `parameter` | `parameter` | `parameter` | Update prompt + code (replace hint_type) |
| `value` | `value` | `value` | OK |
| `units` | `units` | `units` | Update prompt + code (plural) |
| `description` | `description` | `description` | Update prompt + code (replace context) |
| `category` | `category` | `category` | Add to prompt + code |
| `applies_to_models` | `applies_to_models` | `applies_to_models` | Add to prompt + code (primary-only) |
| `referenced_systems` | `referenced_systems` | `referenced_systems` | **Add column via migration + add to prompt + code** |
| *N/A* | `status` | `status` | Set `status='dip_extracted'` on insert |
| `page` | `page` | *N/A* | Remove from prompt + code |
| *N/A* | `confidence` | *N/A* | Remove from code |

### troubleshooting

| Prompt Extracts | Insert Code Uses | DB Column | Fix |
|-----------------|------------------|-----------|-----|
| `symptom` | `symptom` | `symptom` | OK |
| `cause` | `cause` | `cause` | OK |
| `resolution` | `resolution` | `resolution` | Update prompt + code (replace solution) |
| `check_action` | `check_action` | `check_action` | Add to prompt + code |
| `possible_causes` | `possible_causes` | `possible_causes` | Add to prompt + code (JSONB multi-cause) |
| `error_code` | `error_code` | *N/A* | Remove from prompt + code |
| `page` | `page` | *N/A* | Remove from prompt + code |
| `applies_to_models` | `applies_to_models` | `applies_to_models` | Add to prompt + code (primary-only) |
| `referenced_systems` | `referenced_systems` | `referenced_systems` | **Add column via migration + add to prompt + code** |
| *N/A* | `status` | `status` | Set `status='dip_extracted'` on insert |

### procedures → playbook_hints

| Prompt Extracts | Insert Code Uses | DB Column | Fix |
|-----------------|------------------|-----------|-----|
| `title` | `title` | `title` | OK |
| `preconditions` | `preconditions` | `preconditions` | OK |
| `steps` | `steps` | `steps` | OK |
| `expected_outcome` | `expected_outcome` | `expected_outcome` | OK |
| `applies_to_models` | `applies_to_models` | `applies_to_models` | Update prompt + code (replace models; primary-only) |
| `error_codes` | `error_codes` | `error_codes` | OK |
| `referenced_systems` | `referenced_systems` | `referenced_systems` | **Add column via migration + add to prompt + code** |
| *N/A* | `status` | `status` | Set `status='dip_extracted'` on insert |

### golden_rules → golden_tests

| Prompt Extracts | Insert Code Uses | DB Column | Fix |
|-----------------|------------------|-----------|-----|
| `query` | `query` | `query` | Update prompt + code (replace test_name) |
| `test_method` | `test_method` | `test_method` | Update prompt + code (replace test_type) |
| `description` | `description` | `description` | OK |
| `related_procedures` | `related_procedures` | `related_procedures` | Update prompt + code (replace steps) |
| `expected` | `expected` | `expected` | Update prompt + code (replace expected_result) |
| `failure_indication` | `failure_indication` | `failure_indication` | Add to prompt + code |
| `applies_to_models` | `applies_to_models` | `applies_to_models` | Add to prompt + code (primary-only) |
| `referenced_systems` | `referenced_systems` | `referenced_systems` | **Add column via migration + add to prompt + code** |
| *N/A* | `status` | `status` | Set `status='dip_extracted'` on insert |

### intent_router

| Prompt Extracts | Insert Code Uses | DB Column | Fix |
|-----------------|------------------|-----------|-----|
| `question_type` | `question_type` | `question_type` | Update prompt + code (replace intent_type) |
| `question` | `question` | `question` | Update prompt + code (replace prompt) |
| `answer` | `answer` | `answer` | Update prompt + code (replace context) |
| `question_variations` | `question_variations` | `question_variations` | Add to prompt + code (JSONB array) |
| `references` | `references` | `references` | Add to prompt + code (JSONB array) |
| `description` | `description` | `description` | Add to prompt + code |
| `applies_to_models` | `applies_to_models` | `applies_to_models` | Add to prompt + code (primary-only) |
| `referenced_systems` | `referenced_systems` | `referenced_systems` | **Add column via migration + add to prompt + code** |
| *N/A* | `status` | `status` | Set `status='dip_extracted'` on insert |

---

## Next Steps (In Order)

1. **Run DB migrations (A + B)**:
   - Add `referenced_systems TEXT[]` to all 5 DIP tables
   - Change `playbook_hints.asset_uid` to UUID + FK
2. **Rewrite `DIP_MODE_PROMPTS`** to output only schema-valid fields:
   - Add `applies_to_models` (primary-only) + `referenced_systems` (referenced-only)
   - Remove `confidence`, `page`, `error_code`, and other non-schema keys
3. **Rewrite `_insert_dip_results()`** to match production schemas:
   - Map each mode to real columns
   - Set `status='dip_extracted'` on insert for all tables
4. **Update chat-time production retriever** to use `referenced_systems` filtering for referenced-only focus queries (avoid spam for primary-only queries).
5. **End-to-end test with a real document**:
   - Verify inserts per mode
   - Verify chat retrieval returns referenced-only rows only when focusing the referenced system

---

## Checklist

### Pre-Implementation (Complete)

- [x] Run Migration A and confirm `referenced_systems` exists on all 5 tables ✅ (2026-02-03)
- [x] Run Migration B and confirm `playbook_hints.asset_uid` is `uuid` ✅ (2026-02-03)

### Code Implementation (Complete - 2026-02-03)

- [x] Update `DIP_MODE_PROMPTS` with correct field names and tagging instructions ✅
  - All 5 prompts rewritten to match DB schema
  - Added `{selected_models}` and `{referenced_selections}` template placeholders
  - Added explicit tagging rules including Decision #11 ("all" exclusivity)
  - Prompts now request strict JSON arrays (no markdown fences)

- [x] Update `_run_dip_mode_with_cache()` to format prompts with allowlists ✅
  - Added `referenced_selections` parameter
  - Prompts now formatted with `json.dumps()` allowlists

- [x] Update `_insert_dip_results()` with correct field mappings ✅
  - All 5 modes now map to correct DB columns
  - Added `status='dip_extracted'` on all inserts
  - Implemented Decision #7: `referenced_systems = item.referenced_systems ∩ referenced_selections`
  - Implemented Decision #9: Skip invalid items; required fields validated per table
  - Implemented Decision #11: If "all" in applies_to_models, normalize to ["all"]
  - Special case: troubleshooting multi-cause derives `cause` from first `possible_causes[].cause`

- [x] Update `_delete_existing_dip_data()` to preserve approved rows ✅
  - Added `&status=neq.approved` to delete URL (Decision #4)

- [x] Fix production retriever text filter bug ✅
  - Changed `solution.ilike` → `resolution.ilike` for troubleshooting table
  - Added `check_action.ilike` filter

- [x] Implement Decision #8: JSON retry with repair ✅
  - If JSON parsing fails, send repair request asking for "JSON only"
  - If still invalid after repair, return `success=False` with `error_code='INVALID_JSON'`
  - No more "green but empty" for invalid JSON

- [x] Implement Decision #9: SCHEMA_VALIDATION_FAILED mode failure ✅
  - `_insert_dip_results` now returns `(inserted_count, skipped_count)` tuple
  - If N>0 items extracted but 0 valid after validation → mode fails with `error_code='SCHEMA_VALIDATION_FAILED'`

- [x] Add `referenced_systems` query path to production retriever ✅
  - Added `_dip_query_referenced_scoped()` method
  - Updated `_query_table_v5()` to run 3 queries: model-scoped + universal + referenced-scoped
  - Threaded `referenced_systems` through `query_production_dip_tables` → `_query_table_with_tiers` → `_query_table_v5`
  - Extracts `referenced_systems` from `retrieval_scope` parameter

- [x] Add `applies_to_models` intersection with `selected_models` ✅
  - Symmetric with `referenced_systems` filtering
  - Prevents LLM from inventing model keys outside the allowlist
  - If "all" present → ["all"], else intersect with selected_models

- [x] Add `referenced_systems` to retrieval scope builder ✅
  - `retrieval_scope_builder.py` now includes `referenced_systems` key
  - Derived from `focus_models` when `referencing_doc_ids` exist
  - Enables DIP retriever to activate referenced-scoped queries

- [x] Add DIP results to ingestion success summary screen ✅
  - Added `dipResults` div to success card
  - Shows: Items Inserted, Modes Completed, Modes Failed
  - Expandable details showing which modes succeeded/failed

- [x] Add `exclude_models` to prompt context ✅
  - `DIPRunRequest.exclude_models` now passed to LLM context
  - Instructs LLM to skip content specific to excluded models
  - Reduces token waste and improves extraction precision

### Post-Implementation Verification

- [ ] Confirm `status` values align with chat filter (`dip_extracted` / `approved`)
- [ ] Confirm prompt outputs are strict JSON arrays/objects (no markdown fences)
- [ ] End-to-end test with a real document
- [ ] Verify chat retrieval returns correct rows with v5 filtering
