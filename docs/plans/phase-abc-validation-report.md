# Phase A, B, C Validation Report
**Date:** 2026-02-08  
**Plan:** Model Detection Map-Reduce Redesign

---

## Phase A: Detection endpoint (Python + proxy) — VALIDATED ✓

| Requirement | Status | Evidence |
|-------------|--------|----------|
| `/v1/detect-models-v2` in Python | ✓ | `python-sidecar/app/main.py:934` — `@app.post("/v1/detect-models-v2")` |
| Returns `primary_family` structure | ✓ | `main.py:986-1012` — builds PrimaryFamily with family_name, family_aliases, members[] |
| No normalization at detection | ✓ | Returns raw from REDUCE result; no `normalize_model_key` on output |
| Proxy routes to v2 | ✓ | `src/app.js:194` — `fetch(\`${sidecarUrl}/v1/detect-models-v2\`)` |
| 120s timeout | ✓ | `src/app.js:198` — `AbortSignal.timeout(120000)` |
| Old v1 endpoint preserved | ✓ | `document.service.js` not modified; Python has both endpoints |

**Phase A: COMPLETE**

---

## Phase B: Store new data (schema + backend) — MOSTLY VALIDATED ✓

| Requirement | Status | Evidence |
|-------------|--------|----------|
| `upsertDocumentRecord` — familyAliases, brandFamily | ✓ | `document-ingest.service.js:410-444` — family_aliases, brand_family |
| `findOrCreateSystem` — description, modelSynonyms, userDisplayName | ✓ | `document-ingest.service.js:89` — accepts params; passes to systemRecord |
| `saveReferencedSystems` — v2 shape, description, aliases, product_type, user_display_name | ✓ | `document-ingest.service.js:282-338` — handles display_name, description, aliases, type |
| FK ref_canonical_models before upsert | ✓ | `document-ingest.service.js:304-314` — upsert to ref_canonical_models |
| `sanitizeSystemData` — user_display_name | ✓ | `validation.js:154` — `user_display_name: sanitizeText(...)` |
| Route passes family_aliases, primary_family_name | ✓ | `document-ingest.route.js:56-57, 123-124, 218-219` |

**Schema note:** The `scripts/migrations/actual/2026-02-08_tables/` dump does **not** show the 6 new columns (`documents.family_aliases`, `document_referenced_systems.user_display_name`, `description`, `aliases`, `product_type`, `systems.user_display_name`). The plan states these were added in Supabase. Either:
- The dump predates the migration, or
- Columns were added directly in Supabase and the dump needs refreshing.

**Action:** Re-run `node scripts/migrations/actual/dump-live-schema.mjs` to confirm the 6 columns exist. If they do not, Phase B schema migration is incomplete.

**Phase B: COMPLETE (code)** — Schema verification recommended.

---

## Phase C: Frontend UI — MOSTLY VALIDATED ⚠️

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Family header display | ✓ | `document-ingest.html:1682-1683` — `familyHeader.innerHTML = \`<strong>${detection.primary_family.family_name}</strong>\`` |
| Descriptions as helper text | ✓ | `document-ingest.html:1687, 1725, 1760-1763` — `createModelItem(..., member.description)` |
| User edit tracking (user_display_name) | ✓ | `document-ingest.html:1817, 1833` — sets `user_display_name` when edited |
| New payload: family_aliases, primary_family_name | ✓ | `document-ingest.html:2576-2577` |
| New payload: models_detected from primary_family.members | ✓ | `document-ingest.html:2569` |
| New payload: referenced_products with display_name, aliases, description | ✓ | `document-ingest.html:2571` — sends `detectionResult.referenced_products` |

**referenced_selections — potential gap:**  
The plan specifies that `referenced_selections` must use **original** display_name (never user-edited) so the backend can match against `referenced_products[].display_name` for the `user_selected` flag.

Current behavior:
- `onModelNameEdited` updates `rp.display_name` and `rp.model` to the edited value (`document-ingest.html:1831`)
- `selectedModels` entry `data.model` is updated to the edited name (`document-ingest.html:1842`)
- `referenced_selections.push(data.model)` sends the edited name (`document-ingest.html:2501`)

If the user edits "SD60" → "Main Saildrive", the backend receives:
- `referenced_products`: `[{ display_name: "Main Saildrive", ... }]` (mutated)
- `referenced_selections`: `["Main Saildrive"]`

The backend matches `referenced_selections` to `referenced_products[].display_name`, so it will match. But the **intent** of the plan was to keep original display_name for matching and store user_display_name separately. With the current approach, the canonical ref becomes "Main Saildrive" (normalized) instead of "SD60", and the link to the original detected ref is lost.

**Recommendation:** For strict plan compliance, use original display_name in `referenced_selections` and keep `referenced_products[].display_name` as original; store edited name in `user_display_name` only. This may require frontend changes: `referenced_selections.push(member._original_name ?? data.model)` and not mutating `rp.display_name` when building the payload.

**Phase C: COMPLETE (visual / payload shape)** — `referenced_selections` semantics may need adjustment per plan.

---

## Summary

| Phase | Status | Blockers |
|-------|--------|----------|
| A | ✓ Complete | None |
| B | ✓ Complete (code) | Re-dump schema to confirm 6 columns |
| C | ✓ Complete (visual) | Consider referenced_selections using original display_name per plan |
