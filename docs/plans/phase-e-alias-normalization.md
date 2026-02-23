# Phase E: Alias Normalization
**Date:** 2026-02-22
**Plan:** Model Detection Map-Reduce Redesign — Alias resolution in Python sidecar
**Status:** Implemented (undocumented until now)

---

## Purpose

The Python sidecar receives raw model strings from LLM extraction (Vision, Index chunking, DIP parsing). These strings often contain variant names, abbreviations, or alternate spellings that do not match the canonical model stored in the database.

`alias_map` enables the sidecar to resolve these variant names to their canonical forms during Vision, Index, and DIP processing. Without it, chunks and DIP entries could reference model names that never match the canonical model, causing data to be silently dropped or misattributed during filtering.

---

## What alias_map Contains

**Structure:** `{ "alias_string": ["canonical_model_1", ...] }`

Each key is an alias string (original form); each value is an array containing the canonical model(s) it resolves to.

**Built by:** `buildPipelineModelParams(docId)` in `src/services/alias-map.service.js`

**Sources:**

| Source | Key | Value |
|--------|-----|-------|
| `documents.family_aliases` | Each family alias string | `[model_norm]` (the document's normalized primary model) |
| `document_referenced_systems` (user_selected=true) | `raw_model` | `[canonical_model]` |
| `document_referenced_systems` (user_selected=true) | Each entry in `aliases[]` | `[canonical_model]` |

---

## How It's Passed

Node.js routes call `buildPipelineModelParams(docId)` and include `dbParams.alias_map` in the payload sent to the sidecar.

| Pipeline | Endpoint | Route code |
|----------|----------|------------|
| Vision | `POST /v1/vision/analyze-pages` | `aliasMap: dbParams.alias_map` passed to `runVisionPipeline` |
| Index | `POST /v1/index-document` | `aliasMap: dbParams.alias_map` passed to indexing call |
| DIP | `POST /v1/dip/run` | `alias_map` included in DIP run request body |

The Python request models (`VisionPipelineRequest`, `IndexDocumentRequest`, `DIPRunRequest` in `app/models.py`) each declare:

```python
alias_map: Dict[str, List[str]] = Field(default_factory=dict, description="Alias->canonical mapping for normalization")
```

---

## Normalization Algorithm

For each `applies_to_models` (or `referenced_systems`) entry in extracted data:

1. Check if the raw string is a key in `alias_map`.
2. **If yes:** replace it with the canonical model(s) from `alias_map[key]`.
3. **If no:** keep the original string.
4. Normalize the resolved form via `normalize_model_key()` — uppercase, strip whitespace, hyphens, and underscores.
5. Deduplicate the normalized results.
6. Filter against the normalized allowed set (`selected_models` or `referenced_selections`).

Special case: if `"all"` appears in `applies_to_models`, normalize to `["all"]` exclusively (Decision #11).

---

## Endpoints Using alias_map

### 1. Vision (`POST /v1/vision/analyze-pages`)

After analyzing each page for model applicability, the `normalize_model_info()` helper resolves `applies_to_models` and `referenced_systems` via `alias_map` before storing vision results. This ensures vision page metadata contains canonical, normalized model names.

### 2. Index (`POST /v1/index-document`)

After chunking, iterates over all chunks and resolves `primary_models` and `referenced_systems` in each chunk's metadata via `alias_map`. Normalized values are stored in the chunk metadata that gets upserted to Pinecone.

### 3. DIP (`POST /v1/dip/run`)

The `store_dip_mode_results()` function resolves `applies_to_models` and `referenced_systems` for each extracted item via `alias_map` before upserting to the DIP tables. Items whose resolved models do not intersect the allowed set are filtered out.

---

## Implementation Files

| Layer | File | Role |
|-------|------|------|
| Node service | `src/services/alias-map.service.js` | Builds `alias_map` from `documents.family_aliases` and `document_referenced_systems` |
| Node route | `src/routes/admin/document-ingest.route.js` | Calls `buildPipelineModelParams(docId)`, passes `alias_map` to sidecar |
| Python entry | `python-sidecar/app/main.py` | Consumes `alias_map` in Vision, Index, and DIP endpoints |
| Python models | `python-sidecar/app/models.py` | Request schemas declaring `alias_map: Dict[str, List[str]]` |
| Python util | `python-sidecar/app/utils/normalize.py` | `normalize_model_key()` — uppercase, strip whitespace/hyphens/underscores |
