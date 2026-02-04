## Context (why this is the “first necessary code change”)

Today, chat maintains a thread-level `equipment_context` blob (systems in the conversation), keyed by `asset_uid`.

That’s good for *identity* (“what systems exist on the boat / in this chat”), but it becomes harmful when used as a

*retrieval gate*.

### Current misalignment

- Pinecone retrieval path uses `asset_uid` as the metadata filter (system identity), not v5 model applicability tags.
- DIP retrieval (“DIP out”) effectively does not filter by applicability at all.

Result: mixed-model manuals leak wrong-model content and “DIP in → DIP out” is incoherent.

## Decision: Option A (do not change systemsContext[] / equipment_context blob)

We will keep the chat blob as-is (asset identity + display fields + ranking signals).

We will compute v5 retrieval inputs at the retrieval boundary.

Rationale:

- Chat should reason in “assets in focus”, not “primary vs referenced”
- “Referenced” is a document relationship concept (which docs mention a system), not a chat concept

## Desired retrieval behavior (high-level)

When answering a question about a focus system (e.g., VC20), retrieval should:

1) Select **candidate documents**:

   - primary docs for the focus system
   - plus docs that reference the focus system

2) Retrieve content within candidate docs using v5 applicability filters:

   - include universal content
   - include content applicable to the focus model(s)
   - fallback to boat-scoped allowlist only when necessary

3) Rank/boost:

   - prefer the system’s own manual over “referenced mentions” docs
   - prefer content explicitly tagged to the focus model over broad/default tags

## v5 Retrieval Contract (concrete)

### Inputs (computed at chat-time)

- **focus_assets[]**: top 1–2 `asset_uid`s inferred as the main subject(s) of this query (from existing ranking logic)
- **focus_models[]**: model key(s) for those focus assets (initially from `systems.model_norm`; later can be canonical model keys)
- **boat_models[]**: union of model key(s) for the equipment in the thread blob (also includes referenced systems that are present as assets)
- **candidate_doc_ids[]**:
  - doc_ids from `document_systems` for focus assets (primary docs)
  - doc_ids from `document_referenced_systems` where `canonical_model` matches any focus model keys (referenced docs)

Clarification (important for VC20-style queries):

- We will compute and log these as two sets:
  - `candidate_primary_doc_ids[]` (from `document_systems`)
  - `candidate_referencing_doc_ids[]` (from `document_referenced_systems`)
  - `candidate_doc_ids[] = union(primary, referencing)` (used for logging + DIP scoping)

Why we treat the sets differently:

- `is_universal` (from chunk metadata) means “universal within the manual’s *primary_models* domain”.
  - Example: a Yanmar engine manual chunk can be `is_universal=true` because it applies to all engine models in `documents.models_covered`.
- When that doc is included only because it *references* VC20, those “engine-universal” chunks are often irrelevant to a VC20 question.
- So: allow `is_universal` for **primary docs**, but do **not** allow `is_universal` to qualify chunks from **referencing docs**.

### Tier fallback triggers (defaults; can be tuned later)

- **Pinecone Tier A → B**: if `< 3` chunks total returned after applying Tier A filter.
- **Pinecone Tier B → C**: if `< 3` chunks total returned after Tier B.
- **DIP Tier A → B**: if `< 2` total rows returned across all DIP buckets after Tier A filters.
- **DIP Tier B → C**: if `< 2` total rows returned after Tier B.

### Explicit empty-candidate handling

If `candidate_doc_ids.length === 0` (i.e., both `candidate_primary_doc_ids` and `candidate_referencing_doc_ids` are empty):

- Skip Tier A/B entirely (they would be `doc_id IN []`), and go straight to **Tier C**.
- Log `candidate_docs=0` and `tier_start=C` in telemetry for debuggability.

### Pinecone “chunk out” filter rules

Tier A (preferred):

- **Primary docs clause** (universal content is relevant):
  - `doc_id IN candidate_primary_doc_ids`
  - AND (

`is_universal == true`

OR `primary_models overlaps focus_models`

OR `referenced_systems overlaps focus_models`

)

- **Referencing docs clause** (strict: only chunks that actually mention the focus system):
  - `doc_id IN candidate_referencing_doc_ids`
  - AND (`referenced_systems overlaps focus_models`)
- Tier A overall is the OR of those two clauses.

Tier B (fallback if A returns too little):

- **Primary docs clause**:
  - `doc_id IN candidate_primary_doc_ids`
  - AND (

`is_universal == true`

OR `primary_models overlaps boat_models`

OR `referenced_systems overlaps boat_models`

)

- **Referencing docs clause**:
  - `doc_id IN candidate_referencing_doc_ids`
  - AND (`referenced_systems overlaps boat_models`)
- Tier B overall is the OR of those two clauses.

Tier C (last resort):

- no doc_id restriction
- AND (

`is_universal == true`

OR `primary_models overlaps boat_models`

OR `referenced_systems overlaps boat_models`

)

Important:

- `asset_uid` should not be used as a hard filter for Pinecone retrieval.
- `asset_uid` can remain as a ranking/boost signal if available.

#### Pinecone filter JSON examples (exact)

Tier A (two-category OR; primary docs allow universal, referencing docs strict):

```json
{
  "$or": [
    {
      "$and": [
        { "doc_id": { "$in": ["<PRIMARY_DOC_1>", "<PRIMARY_DOC_2>"] } },
        {
          "$or": [
            { "is_universal": { "$eq": true } },
            { "primary_models": { "$in": ["<FOCUS_MODEL_1>"] } },
            { "referenced_systems": { "$in": ["<FOCUS_MODEL_1>"] } }
          ]
        }
      ]
    },
    {
      "$and": [
        { "doc_id": { "$in": ["<REF_DOC_1>", "<REF_DOC_2>"] } },
        { "referenced_systems": { "$in": ["<FOCUS_MODEL_1>"] } }
      ]
    }
  ]
}
```

Tier B (two-category OR; primary docs allow universal, referencing docs strict):

```json
{
  "$or": [
    {
      "$and": [
        { "doc_id": { "$in": ["<PRIMARY_DOC_1>", "<PRIMARY_DOC_2>"] } },
        {
          "$or": [
            { "is_universal": { "$eq": true } },
            { "primary_models": { "$in": ["<BOAT_MODEL_1>", "<BOAT_MODEL_2>"] } },
            { "referenced_systems": { "$in": ["<BOAT_MODEL_1>", "<BOAT_MODEL_2>"] } }
          ]
        }
      ]
    },
    {
      "$and": [
        { "doc_id": { "$in": ["<REF_DOC_1>", "<REF_DOC_2>"] } },
        { "referenced_systems": { "$in": ["<BOAT_MODEL_1>", "<BOAT_MODEL_2>"] } }
      ]
    }
  ]
}
```

Tier C (no doc restriction + boat models):

```json
{
  "$or": [
    { "is_universal": { "$eq": true } },
    { "primary_models": { "$in": ["<BOAT_MODEL_1>", "<BOAT_MODEL_2>"] } },
    { "referenced_systems": { "$in": ["<BOAT_MODEL_1>", "<BOAT_MODEL_2>"] } }
  ]
}
```

### DIP “out” filter rules (DB tables)

Tier A:

- `doc_id IN candidate_doc_ids`
- AND (`'all' = ANY(applies_to_models)` OR `applies_to_models && focus_models`)

Tier B:

- `doc_id IN candidate_doc_ids`
- AND (`'all' = ANY(applies_to_models)` OR `applies_to_models && boat_models`)

Tier C:

- no doc_id restriction
- AND (`'all' = ANY(applies_to_models)` OR `applies_to_models && boat_models`)

## Where the changes land (code-level plan)

### Phase 1 — Build retrieval scope (no blob schema change)

**Decision (make it concrete): scope builder lives in Python (no /v1/chat/process request change).**

Rationale:

- The active retrieval implementations (Pinecone + DIP) are already in the Python sidecar.
- Building scope in Python avoids an API contract change, avoids a Node→Python “scope plumbing” layer, and keeps timing/telemetry closest to where the retrieval happens.

#### File path + function signature (exact)

Create a small helper module:

- `python-sidecar/app/chat/services/retrieval_scope_builder.py`

Proposed signature:

```python
async def build_retrieval_scope(
    *,
    supabase,
    thread_id: str | None,
    systems_context: list[dict],
    primary_equipment: dict | None,
) -> dict:
    """
    Returns:
      {
        "focus_assets": list[str],          # 1–2 asset_uids
        "focus_models": list[str],          # canonical-ish model keys
        "boat_models": list[str],           # canonical-ish model keys
        "candidate_doc_ids": list[str],     # doc_id strings
      }
    """
```

#### How `build_retrieval_scope()` gets a Supabase client (explicit)

We will follow the existing sidecar pattern (`BaseService`) instead of inventing a new DB access mechanism.

Implementation approach:

- Implement `RetrievalScopeBuilder` as a small service class:
  - `python-sidecar/app/chat/services/retrieval_scope_builder.py`
  - `class RetrievalScopeBuilder(BaseService): ...`
- The workflow creates it once (same as other services) and uses `self.retrieval_scope_builder.supabase` internally.

This keeps consistency with:

- `python-sidecar/app/chat/services/base.py` (`BaseService` initializes `self.supabase` via `create_client(...)`)
- `python-sidecar/app/chat/services/production_dip_retriever.py` (already extends `BaseService`)

#### Call site (exact)

Called from:

- `python-sidecar/app/chat/workflows/chat_workflow_sequential.py::_retrieve_data()`

It uses the existing classification output:

- `state["primary_equipment"] `(already computed in `_classify_query()`)

#### Focus inference (exact, matches current behavior)

Focus system selection uses the existing workflow logic:

- If classifier returns `primary_equipment_index`, use that index into `systems_context`.
- Else default to the equipment with highest `rank` in `systems_context`.

This means “top-ranked focus” is concretely:

- `state["primary_equipment"]` (not “first array element”)

DB reads required:

- `systems` by `asset_uid` (to get model key(s))
- `document_systems` by `asset_uid` (to get primary doc_ids)
- `document_referenced_systems` by `canonical_model` (to get referenced doc_ids)

#### How Python receives scope (explicit)

No change to Node→Python API.

- Node continues sending `systems_context` in the existing request body to `/v1/chat/process`.
- Python computes scope internally using `systems_context` + `primary_equipment`.

### Phase 2 — Pinecone retrieval uses v5 tags + doc scoping

**Important reality check:** Chat “Pinecone out” (vector retrieval) is executed in the **Python sidecar**, not Node.

Node’s `src/services/pinecone-rag.service.js` exists but is not the active chat retrieval path for `/chat/process`

(Node chat proxy hands off to Python `/v1/chat/process`).

Active call site:

- `python-sidecar/app/chat/workflows/chat_workflow_sequential.py` (STEP 2: data retrieval)

Active Pinecone query implementation:

- `python-sidecar/app/chat/workflows/chat_workflow_sequential.py::_query_pinecone_for_equipment()`
  - currently does multi-system Pinecone search and uses a metadata filter built from `manufacturer`/`model`

Plan changes (Python):

1) **Stop relying on manufacturer/model metadata filters as the primary gate**

   - Manufacturer/model are useful for ranking/boosting, but they are not v5 applicability tags.

2) **Apply v5 filtering using tags + doc scoping**

   - Build a Pinecone filter from retrieval scope:
     - `doc_id IN candidate_doc_ids` (when available)
     - AND `($or: is_universal==true OR primary_models overlaps X OR referenced_systems overlaps X)`
   - Use Tier A/B/C behavior from the contract (focus_models then boat_models).

3) **Preserve the existing timing/metrics shape**

   - Keep `pinecone_duration_ms`, `ranking_duration_ms`, and the `detailed_metrics.pinecone.*` keys populated.
   - Keep the “adaptive recall” behavior (complexity-based top_k per system) where it still helps.

4) **Node service note**

   - If `src/services/pinecone-rag.service.js` is unused in the chat path, treat it as legacy/debt; do not base v5 chat retrieval work on it.

### Phase 3 — DIP out becomes a real retriever

**Important reality check:** Chat “DIP out” is executed in the **Python sidecar**, not Node.

The Node file `src/services/dip-retriever.service.js` is not on the active chat path (dead code / legacy).

Active call site:

- `python-sidecar/app/chat/workflows/chat_workflow_sequential.py` (STEP 2: data retrieval)

Active retriever:

- `python-sidecar/app/chat/services/production_dip_retriever.py` (and/or `dip_retriever.py`)

Plan changes (Python):

1) **Fix table mapping to support all 5 v5 DIP buckets**

   - `specs` → `spec_suggestions`
   - `procedures` → `playbook_hints`
   - `troubleshooting` → `troubleshooting` (**currently wrong in retriever; must not map to golden_tests**)
   - `golden_rules` → `golden_tests`
   - `intent_router` → `intent_router` (existing “routing” bucket)

2) **Replace asset_uid-gated filtering with v5 filtering**

   - stop using `asset_uid IN (...)` as the primary filter gate
   - apply:
     - `doc_id IN candidate_doc_ids` (when available)
     - AND (`'all' in applies_to_models` OR overlap with focus/boat models)
   - keep `asset_uid` only as an optional boost/narrowing fallback (not the default)

3) **Preserve fast query relevance**

   - keep existing ILIKE/OR filters
   - leverage existing DB aids:
     - troubleshooting FTS index on `symptom`
     - helper `search_troubleshooting_causes(search_term)` to search symptom + causes

4) **Preserve telemetry**

   - ensure Python continues to populate:
     - `dip_duration_ms`
     - counts per DIP bucket (for reporting and budgeting)

## Performance + Telemetry Non-Regression (hard constraints)

We have already invested heavily in chat timing/step tracking and a “fast turnaround” UX.

This work must preserve:

### A) Node timing fields (must not regress)

`src/services/chat-proxy.service.js` currently returns `node_timing` with:

- `conversation_context_ms`
- `equipment_search_ms`
- `equipment_extraction_ms`
- `equipment_inference_ms`
- `equipment_context_build_ms`
- `system_details_fetch_ms`
- `equipment_context_update_ms`
- `python_call_ms`
- `response_format_ms`

When we add retrieval scoping, we will add (or fold into existing) timing fields without removing any:

- `retrieval_scope_ms` (recommended) OR:
  - `doc_candidate_ms`
  - `boat_models_ms`

### B) Python detailed_metrics (must not regress)

The Python sequential workflow returns `detailed_metrics` used by the stats panel.

We must preserve:

- timing keys: `classification_duration_ms`, `dip_duration_ms`, `pinecone_duration_ms`, `ranking_duration_ms`
- the `detailed_metrics.timing_summary.breakdown.*` structure
- `detailed_metrics.pinecone.*` and `detailed_metrics.dip_retrieval.*` fields (even if internals change)

We will add (without breaking existing keys):

- `detailed_metrics.timing_summary.breakdown.retrieval_scope_ms`
- `detailed_metrics.retrieval_scope`:
  - `focus_assets_count`
  - `candidate_primary_docs_count`
  - `candidate_referencing_docs_count`
  - `tier_used_pinecone` ("A" | "B" | "C")
  - `tier_used_dip` ("A" | "B" | "C")

### C) Envelope contract (must not regress)

Per `.cursorrules`, keep the HTTP contract unchanged:

- Every response stays `{ success, data?, error?, requestId? }`
- Do not break `src/routes/chat/process.route.js` response shape (`systemsContext`, `telemetry`, `detailed_metrics`)

### D) Latency strategy (how we keep chat fast)

- **Parallelize** independent reads:
  - doc candidates (primary docs + referenced docs) can run concurrently
  - model-key lookups for multiple assets can run concurrently
- **Cache** per-thread retrieval scope:
  - **Location**: Python in-memory cache inside `retrieval_scope_builder.py` (per-process; no Redis required)
  - **Cache key**: `(threadId, focus_asset_uid, equipment_hash)`
    - `equipment_hash = sha256(','.join(sorted(asset_uid_list)))`
  - **TTL**: `120s` default (tunable 60–180s)
  - **Invalidation**: recompute `equipment_hash` each request; if it differs, treat as cache-miss even if TTL not expired
- **Strict caps**:
  - enforce the Pinecone/DIP context budgets (Tier A/B/C + caps)
  - never allow unbounded “send full text of everything”

### E) Step-level reporting (must remain visible)

We must keep step observability:

- The chat debug logger should continue to emit:
  - classify → retrieve → synthesize → assemble
- We will add a new explicit step label:
  - `RETRIEVAL_SCOPE_BUILT` with counts (candidate docs, focus models, boat models) and duration

Implementation detail (Python):

- Emit via the existing debug mechanism:
  - `chat_debug.step('RETRIEVAL_SCOPE_BUILT', {...})`
- Also record the duration into `state` and `detailed_metrics.timing_summary.breakdown.retrieval_scope_ms`.

## Open decisions (must pick before coding)

1) **Model key source for chat filtering**

   - v1: use `systems.model_norm` as the model key **BUT always normalize/canonicalize in Node** before using it for any filter joins
   - later: add/derive explicit canonical model keys on `systems` and use those consistently everywhere

### Decision (2026-02-01): Option 1 canonicalization (Node is the source of truth)

Because the user can edit detected model names in the model validation screen, we must treat the **user-edited value**

as authoritative input and ensure it becomes the **canonical key** used downstream.

We will canonicalize in Node (not Python) using the canonical registry tables:

- `ref_canonical_models`
- `ref_model_synonyms`

Rules:

- Accept the user-edited raw string, then compute a canonical key using the same normalization:
  - uppercase
  - remove whitespace / hyphen / underscore
- Ensure the canonical key exists in `ref_canonical_models` (create if missing)
- Ensure the user-edited raw string is saved as a synonym to that canonical key (if it differs)

Outcome:

- Retrieval filters (Pinecone `primary_models`, DIP `applies_to_models`, document reference keys) can safely use canonical keys.
- This prevents silent filter failures like `"VC 20"` vs `"VC20"`.

#### Canonicalization timing (make it explicit)

- **Canonicalization happens at ingest / system creation time (Node)**:
  - `systems.model_norm` is written in canonical form when systems are created/updated.
  - `documents.models_covered` is stored as canonical primary model keys.
  - `document_referenced_systems.canonical_model` is stored as canonical referenced model keys.
  - Pinecone chunk metadata (`primary_models`, `referenced_systems`) is expected to already be canonical because it comes from those canonical lists.
- **Chat retrieval time (Python)**:
  - Python should **not** call the canonical registry tables, create synonyms, or “decide” canonical forms (Node remains the authority).
  - Python may apply a **lightweight normalization** only as a best-effort guard for legacy/test rows (e.g., uppercase + strip whitespace/hyphen/underscore) before building filters.

2) **How to infer “focus system(s)”**

   - **Locked**: use `state["primary_equipment"]` chosen by classifier:
     - if `primary_equipment_index` returned, use that index
     - else use the equipment with max `rank`
   - Multi-focus (optional): also include 1 secondary focus asset if the classifier returns an array of indices (or if intent indicates “compare”)

3) **Minimum threshold for Tier A→B fallback**

   - **Locked defaults**:
     - Pinecone A→B: `< 3` chunks
     - DIP A→B: `< 2` rows total
   - B→C: same thresholds

3a) **DIP budgeting hierarchy (make it explicit)**

- **Per-table query limit (fetch ceiling)**: `200` rows max per table per query (performance guardrail)
- **Tier fallback evaluation point**:
  - Evaluate “too little” after applying Tier filters **and** per-bucket caps (what we actually send to the LLM).
- **Per-bucket cap (what we send to the LLM)**: varies by intent (below)
- **Total DIP cap (across all buckets)**: derived from per-bucket caps (below) and is the true “context budget”

Per-bucket caps (default ranges; exact values chosen by intent + complexity):

- **specifications intent**
  - `specs`: 8–12
  - `procedures`: 2–4
  - `troubleshooting`: 0–2
  - `intent_router`: 2–4
  - `golden_rules`: 1–3
- **procedure / maintenance intent**
  - `procedures`: 6–10
  - `specs`: 3–6
  - `troubleshooting`: 2–4
  - `intent_router`: 2–4
  - `golden_rules`: 1–3
- **troubleshooting intent**
  - `troubleshooting`: 6–10
  - `procedures`: 4–8
  - `specs`: 2–4
  - `intent_router`: 2–4
  - `golden_rules`: 1–3

4) **How to treat chunks with missing/empty v5 tags**

   - **Decision**: missing/empty `primary_models` / `referenced_systems` do **not** qualify for overlap-based inclusion.
   - Include such chunks **only** if `is_universal == true`, otherwise they are excluded in Tier A/B and only considered in Tier C as a last resort.
   - Rationale: best-effort compatibility without letting “untagged” act like universal and pollute results.

5) **DIP query strategy (avoid PostgREST or_ quirks)**

   - **Decision**: avoid combining `or_()` with array overlap filters in one expression.
   - Implement DIP Tier filters as **two queries per table**, then union/dedupe:
     - Query 1: model-scoped (`applies_to_models` overlaps focus/boat models) (+ optional doc_id scoping)
     - Query 2: universal (`applies_to_models` contains `"all"`) (+ optional doc_id scoping)
   - Merge results in Python, then rank/cap per DIP budgeting.

### Supabase query builder snippets (implementation-ready)

These snippets match the existing sidecar style (`supabase.table(...).select(...).in_(...).or_(...).execute()`), but add v5 filtering.

#### Helpers (build PostgREST array literals)

```python
def _pg_array_literal(values: list[str]) -> str:
    # PostgREST expects overlap/contains operands as a Postgres array literal like "{A,B}"
    safe = [v.replace('"', '').replace('{', '').replace('}', '').replace(',', '') for v in values if v]
    return "{" + ",".join(safe) + "}"
```

#### Query 1: model-scoped rows (Tier A/B/C)

```python
def _dip_query_model_scoped(
    *,
    supabase,
    table_name: str,
    query_builder_or_filter: callable,  # existing per-table .or_(...) builder
    query: str,
    candidate_doc_ids: list[str],
    allowed_models: list[str],  # focus_models (Tier A) or boat_models (Tier B/C)
    limit: int,
):
    qb = supabase.table(table_name).select("*")

    if candidate_doc_ids:
        try:
            qb = qb.in_("doc_id", candidate_doc_ids)
        except Exception:
            # Table may not have doc_id yet; treat as “no doc restriction”
            pass

    # PostgREST overlap operator (array && array)
    # supabase-py does not currently use .overlaps() in this repo; use .filter(op='ov') explicitly.
    try:
        qb = qb.filter("applies_to_models", "ov", _pg_array_literal(allowed_models))
    except Exception:
        # Table may not have applies_to_models; caller should treat as Tier C only (best-effort)
        return []

    # Text relevance (existing approach)
    qb = query_builder_or_filter(qb, table_name, query)

    return qb.limit(limit).execute().data or []
```

#### Query 2: universal rows (Tier A/B/C)

```python
def _dip_query_universal(
    *,
    supabase,
    table_name: str,
    query_builder_or_filter: callable,
    query: str,
    candidate_doc_ids: list[str],
    limit: int,
):
    qb = supabase.table(table_name).select("*")

    if candidate_doc_ids:
        try:
            qb = qb.in_("doc_id", candidate_doc_ids)
        except Exception:
            pass

    # PostgREST contains operator (array @> array). This checks applies_to_models contains "all".
    try:
        qb = qb.filter("applies_to_models", "cs", _pg_array_literal(["all"]))
    except Exception:
        return []

    qb = query_builder_or_filter(qb, table_name, query)

    return qb.limit(limit).execute().data or []
```

#### Union + dedupe (per table)

```python
def _dedupe_rows(rows: list[dict]) -> list[dict]:
    # Prefer stable primary keys when present (many tables have 'id')
    seen: set[str] = set()
    out: list[dict] = []
    for r in rows:
        key = str(r.get("id") or r.get("uid") or (
            r.get("doc_id"),
            r.get("symptom") or r.get("parameter") or r.get("question") or r.get("expected_outcome"),
            r.get("cause") or r.get("value") or r.get("answer")
        ))
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out
```

#### Tier wiring (how to call it)

```python
if not candidate_doc_ids:
    # per plan: skip A/B and start at Tier C
    tier_candidate_docs = []
else:
    tier_candidate_docs = candidate_doc_ids

model_scoped = _dip_query_model_scoped(
    supabase=supabase,
    table_name=table_name,
    query_builder_or_filter=self._add_production_table_filters,
    query=query,
    candidate_doc_ids=tier_candidate_docs,  # [] means "no doc restriction"
    allowed_models=focus_models,            # Tier A; use boat_models for Tier B/C
    limit=200,
)
universal = _dip_query_universal(
    supabase=supabase,
    table_name=table_name,
    query_builder_or_filter=self._add_production_table_filters,
    query=query,
    candidate_doc_ids=tier_candidate_docs,
    limit=200,
)
rows = _dedupe_rows(model_scoped + universal)
```

Notes:

- This keeps the query semantics as: \((model\_overlap) \land (text\_match)\) OR \((contains\_all) \land (text\_match)\), implemented as two queries (more reliable than a single OR expression).
- If a given table lacks `doc_id` or `applies_to_models` (unexpected after migration 040), log it and treat that table as “Tier C only” (best-effort).
- Status filter semantics:
  - The existing sidecar filter `status='approved'` is incompatible with current production data (`status='dip_extracted'`).
  - Retrieval should allow **both**: `status IN ('dip_extracted', 'approved')`.
  - If a table has no `status` column, skip the status filter (best-effort).

6) **Node service cleanup (reduce confusion)**

   - Add an explicit “debt cleanup” task after retrieval is working:
     - mark `src/services/dip-retriever.service.js` as deprecated (or delete if safe)
     - mark `src/services/pinecone-rag.service.js` as deprecated for chat-path usage (or delete if safe)
   - Rationale: prevent future contributors from “fixing the wrong retriever”.

## Validation plan

### Functional checks (manual)

- Ask a VC20 question:
  - expects: VC20 manual content + Yanmar manual VC20-related content (if referenced), not random unrelated docs
- Ask a 4JH57 question:
  - expects: 4JH57-specific + universal chunks, not 3JH40-only content

### Telemetry checks

- Log scope used:
  - focus assets/models
  - candidate doc ids count
  - tier selected (A/B/C)

### SQL you can run (doc candidate sets)

```sql
-- Primary docs for a system (asset)
SELECT doc_id, asset_uid, is_primary
FROM document_systems
WHERE asset_uid = '<ASSET_UID_UUID>'; -- note: must be a valid uuid literal

-- Docs that reference a model key (canonical_model)
SELECT doc_id, canonical_model, source
FROM document_referenced_systems
WHERE canonical_model = '<MODEL_KEY>';
```

### Preflight validation (completed 2026-02-01)

These checks remove key assumptions before implementation:

1) **DIP production tables have required columns**

- Verified: `doc_id`, `applies_to_models`, `status` exist on:
  - `spec_suggestions`
  - `playbook_hints`
  - `troubleshooting`
  - `golden_tests`
  - `intent_router`

2) **DIP status semantics**

- Verified: all current production rows use `status='dip_extracted'` (counts observed across all tables).
- Retrieval must therefore treat `dip_extracted` as “production-eligible”.
- Plan decision: filter allows `status IN ('dip_extracted','approved')` (forward compatible).

3) **Pinecone metadata fields exist (v5-ready)**

- Verified Pinecone vectors include:
  - `doc_id` (string) and redundant `document_id` (same value)
  - `primary_models` (list)
  - `referenced_systems` (list)
  - `is_universal` (bool)
- Plan note: filters can safely use `doc_id` (preferred) and ignore `document_id` redundancy.

4) **Referenced systems propagation policy**

- Decision (confirmed): keep current behavior (“as-is”):
  - `referenced_systems` is computed per-chunk from the user-selected `referenced_selections` list.
  - We will not attempt to propagate “all detected references” onto every chunk.

## Risks / mitigations

- **Legacy tag mismatch** (systems.model_norm may not equal applies_to_models keys):
  - mitigate by starting with doc-scoped retrieval (candidate docs) + universal
  - then iteratively improve model key mapping
- **Too few results** in strict tier:
  - use explicit tier fallbacks (A→B→C)
- **Performance**:
  - cache per-thread retrieval scope (candidate docs and boat_models) for short TTL

---

## Implementation Progress

### Phase 1: Retrieval Scope Builder ✅ COMPLETE (2026-02-01)

**File created:** `python-sidecar/app/chat/services/retrieval_scope_builder.py`

**Implementation details:**

- Class: `RetrievalScopeBuilder(BaseService)`
- Method: `build_retrieval_scope()` returns:
  - `focus_assets`: asset_uids from primary_equipment
  - `focus_models`: model keys from `systems.model_norm` (normalized)
  - `boat_models`: all models in systems_context (normalized)
  - `candidate_primary_doc_ids`: from `document_systems`
  - `candidate_referencing_doc_ids`: from `document_referenced_systems`
  - `candidate_doc_ids`: union of above
  - `cache_hit`, `duration_ms`: telemetry

**Features implemented:**

- Extends `BaseService` for Supabase client
- Parallel DB reads via `asyncio.gather()`
- In-memory cache with 120s TTL
- Cache key: `(thread_id, focus_asset_uid)` + equipment_hash invalidation
- Lightweight model normalization (uppercase, strip whitespace/hyphen/underscore)
- Removes overlap between primary and referencing doc_ids

**Next:** Wire into `chat_workflow_sequential.py::_retrieve_data()` and implement Phase 2.

### Phase 2: Pinecone v5 Filtering ✅ COMPLETE (2026-02-01)

**File modified:** `python-sidecar/app/chat/workflows/chat_workflow_sequential.py`

**Changes:**

1. Added import for `RetrievalScopeBuilder`
2. Instantiated `self.retrieval_scope_builder` in `__init__`
3. Updated `_retrieve_data()`:

   - Calls `build_retrieval_scope()` before DIP/Pinecone queries
   - Stores scope in `state["retrieval_scope"]`
   - Logs `RETRIEVAL_SCOPE_BUILT` step with counts
   - Passes `retrieval_scope` to Pinecone query

4. Rewrote `_query_pinecone_for_equipment()`:

   - New signature accepts `retrieval_scope` parameter
   - Builds two-category v5 filter via `_build_v5_pinecone_filter()`
   - Implements Tier A → B → C fallback (threshold: <3 chunks)
   - Primary docs: allow `is_universal` OR model overlap
   - Referencing docs: require `referenced_systems` overlap (strict)
   - Preserves threshold filtering, dedup, ranking, cap at 10

5. Added helper methods:

   - `_build_v5_pinecone_filter(tier, primary_doc_ids, referencing_doc_ids, model_list)`
   - `_execute_pinecone_search(query, filter_dict, top_k)`

6. Updated `detailed_metrics`:

   - Added `retrieval_scope_ms` to timing breakdown
   - Added `retrieval_scope` section with counts, focus_models, cache_hit, tier_used
   - Added `tier_used` to pinecone metrics

### Phase 3: DIP v5 Filtering ✅ COMPLETE (2026-02-01)

**File modified:** `python-sidecar/app/chat/services/production_dip_retriever.py`

**Changes:**

1. Fixed table mapping:

   - `'troubleshooting'` → `'troubleshooting'` (was incorrectly `golden_tests`)
   - Added `'golden_rules'` → `'golden_tests'`
   - Now supports all 5 DIP buckets

2. Fixed status filter:

   - Now allows `status IN ('dip_extracted', 'approved')` for forward compatibility
   - Uses `qb.in_("status", [...]) `instead of `qb.eq("status", "approved")`

3. Replaced `asset_uid` filtering with v5 filtering:

   - `doc_id IN candidate_doc_ids` scoping
   - `applies_to_models` overlap with focus/boat models
   - Two queries per table: `_dip_query_model_scoped()` + `_dip_query_universal()`
   - Union and dedupe via `_dedupe_rows()`

4. Implemented Tier A → B → C fallback:

   - `_query_table_with_tiers()` method
   - Threshold: <2 rows triggers fallback
   - Tier A: focus_models + candidate_doc_ids
   - Tier B: boat_models + candidate_doc_ids
   - Tier C: boat_models, no doc restriction

5. Added helper functions:

   - `_pg_array_literal()` for PostgREST array literals
   - `_dedupe_rows()` for row deduplication
   - `_add_text_filters()` for per-table text search
   - `_add_status_filter()` for status filtering

**File modified:** `python-sidecar/app/chat/workflows/chat_workflow_sequential.py`

**Changes:**

- Updated DIP retriever call to pass `retrieval_scope`
- Added `_get_dip_tier_summary()` helper for telemetry
- Added `tier_used_dip` to `detailed_metrics.retrieval_scope`

---

## Implementation Complete ✅

All three phases are now complete:

- Phase 1: Retrieval Scope Builder ✅
- Phase 2: Pinecone v5 Filtering ✅
- Phase 3: DIP v5 Filtering ✅

### Node UI Parity: retrieval_scope_ms ✅ COMPLETE (2026-02-01)

**File modified:** `src/services/chat-proxy.service.js`

**Changes:**

- Added `retrieval_scope_ms: 0` to `nodeTiming` initialization
- After Python response, extracts `detailed_metrics.timing_summary.breakdown.retrieval_scope_ms` into `nodeTiming`
- UI can now display retrieval scope timing alongside other Node timing fields

---

**Next steps:**

1. Test with real queries (VC20, 4JH57)
2. Verify telemetry shows correct tier usage
3. Monitor for regressions in response quality