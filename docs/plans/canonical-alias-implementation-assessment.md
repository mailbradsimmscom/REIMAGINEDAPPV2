# Canonical Alias Level 2 — Implementation Assessment

**Plan reference:** `/Users/brad/.cursor/plans/canonical_alias_level_2_only_62f063e9.plan.md`  
**Assessment date:** 2026-01-21

---

## Summary

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0: Level 1 Normalize | ✅ Implemented | Node + Python shared utils, wired at ingest and chat |
| Phase 0b: Ref table auto-enrich | ✅ Implemented | `generateRefTableSynonyms` + reference-data.route.js |
| Phase 1a: SYNONYMS_PROMPT rewrite | ✅ Implemented | Semantic-first, max_tokens 600 |
| Phase 1b: Ref table injection | ✅ Implemented | `fetchRefTableSynonyms` + prompt context + deterministic append |
| Phase 1c: Post-processing | ✅ Implemented | `postProcessSynonyms` with no-space variants, dedup |
| Phase 1d: colloquial_keywords in RPC | ✅ Implemented | Migration 001 |
| Phase 2a: ref_model_synonyms LLM population | ✅ Implemented | `scripts/populate-model-synonyms.mjs` |
| Phase 2b: Chat-time lookup | ✅ Implemented | chat-proxy → resolveModelAliases → Python merge |
| Phase 2c: ref_manufacturers expansion | ✅ Implemented | `scripts/expand-manufacturer-synonyms.mjs` |
| Phase 3: GIN index | ✅ Implemented | Migration 002 |

---

## Detailed Verification

### Phase 0: Level 1 Normalize

| Item | Location | Status |
|------|----------|--------|
| Node `normalizeModelKey()` | `src/utils/normalize-model-key.js` | ✅ Uses `[\s\-_]` (matches all whitespace) |
| Python `normalize_model_key()` | `python-sidecar/app/utils/normalize.py` | ✅ Uses `re.sub(r'[\s\-_]', '', raw.upper())` |
| Python imports | `main.py`, `retrieval_scope_builder.py` | ✅ Both import from `app.utils.normalize` |
| Ingest wiring | `document-ingest.service.js` | ✅ Normalizes before saving to `models_covered`, `document_systems`, `document_referenced_systems`, `model_norm` |
| Chat wiring | `chat-proxy.service.js`, `retrieval_scope_builder.py` | ✅ Both use normalize for model keys |

**Note:** `system-management.service.js` accepts `model_norm` from denormalized fields but does not call `normalizeModelKey` itself. The caller (ingest flow) normalizes before passing. Verified in document-ingest flow.

---

### Phase 0b: Ref Table Auto-Enrich

| Item | Location | Status |
|------|----------|--------|
| `generateRefTableSynonyms()` | `keywords-synonyms-generation.service.js` | ✅ LLM generates synonyms + description |
| Route integration | `reference-data.route.js` | ✅ After creating row, calls enrichment and updates |
| Table mapping | manufacturer, product_type, system_category, subsystem_category | ✅ All four supported |

---

### Phase 1: synonyms_fts + Search

| Item | Location | Status |
|------|----------|--------|
| SYNONYMS_PROMPT | `keywords-synonyms-generation.service.js` | ✅ Rewritten: semantic-first, refContext placeholder |
| max_tokens | Same file | ✅ 600 (was 200) |
| `fetchRefTableSynonyms()` | Same file | ✅ Fetches via manufacturer_id, product_type_id |
| Ref context in prompt | `generateSynonyms(system, refContext)` | ✅ Injected as `{refContext}` |
| Deterministic append | `postProcessSynonyms(llmSynonyms, allRefTerms)` | ✅ Ref terms appended after LLM |
| No-space variants | `postProcessSynonyms` | ✅ Joins multi-word terms for tsvector matching |
| Deduplication | Same | ✅ Case-insensitive dedup |

---

### Phase 1d: colloquial_keywords in search_systems

| Item | Location | Status |
|------|----------|--------|
| Migration 001 | `scripts/migrations/001_add_colloquial_to_search_systems.sql` | ✅ Full `CREATE OR REPLACE FUNCTION` |
| WHERE clause | Same | ✅ `COALESCE(s.colloquial_keywords, '')` in tsvector |
| Ranking | Same | ✅ `setweight(to_tsvector(..., colloquial_keywords), 'D')` |
| plainto_tsquery | Same | ✅ Uses `plainto_tsquery('english', q)` |

---

### Phase 2a: ref_model_synonyms LLM Population

| Item | Location | Status |
|------|----------|--------|
| Batch script | `scripts/populate-model-synonyms.mjs` | ✅ Iterates ref_canonical_models, LLM generates, inserts |
| Uses normalizeModelKey | Same | ✅ For synonym_norm |
| Skips canonicals | Same | ✅ Only inserts synonyms whose norm differs from canonical_norm |

---

### Phase 2b: Chat-Time Lookup

| Item | Location | Status |
|------|----------|--------|
| Node lookup | `chat-proxy.service.js` (STEP 6B) | ✅ `resolveModelAliases(uniqueNorms)` |
| Source of norms | systemsContext model_norms | ✅ `normalizeModelKey(eq.model)` |
| Repository | `systems.repository.js` | ✅ `resolveModelAliases()` queries ref_model_synonyms |
| Pass to Python | `python-sidecar.client.js` | ✅ `resolved_model_aliases` in requestBody |
| Python main.py | Request model + workflow | ✅ `request.resolved_model_aliases` passed through |
| Workflow state | `chat_workflow_sequential.py` | ✅ `resolved_model_aliases` in state |
| Scope builder | `retrieval_scope_builder.py` | ✅ Merges into focus_models before building filters |

**Note:** Plan said "Optionally also resolve significant model-like terms from the raw user query." Current implementation only uses model_norms from systems_context. That is acceptable (optional).

---

### Phase 2c: ref_manufacturers Expansion

| Item | Location | Status |
|------|----------|--------|
| Batch script | `scripts/expand-manufacturer-synonyms.mjs` | ✅ LLM enriches empty/thin rows |
| Targets | Empty + thin rows | ✅ Per plan |

---

### Phase 3: GIN Index

| Item | Location | Status |
|------|----------|--------|
| Migration 002 | `scripts/migrations/002_gin_index_search_systems.sql` | ✅ `CREATE INDEX CONCURRENTLY` |
| Expression | Same | ✅ Matches WHERE clause in migration 001 (all 8 columns) |

---

## Potential Issues / Edge Cases

### 1. Cache and resolved_model_aliases (Low)

**Behavior:** When retrieval scope is cached, the cached result was built with `resolved_model_aliases` from the request that populated the cache. If `ref_model_synonyms` is updated between requests, a cache hit could return stale `focus_models` until TTL (120s) expires.

**Impact:** Low. Synonym updates are rare. Cache TTL limits staleness.

**Recommendation:** Optional: include a hash of `resolved_model_aliases` in the cache key if this becomes a concern.

---

### 2. Migration 001 vs Live DB

**Note:** Migration 001 defines the full `search_systems` function. If the live DB has a different version (e.g., from an older backup), the migration must be applied to take effect. Verify with:

```sql
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'search_systems';
```

---

### 3. Migration 002 CONCURRENTLY

**Note:** `CREATE INDEX CONCURRENTLY` does not run inside a transaction. Some migration runners may wrap in a transaction and fail. If so, run manually:

```bash
psql $DATABASE_URL -f scripts/migrations/002_gin_index_search_systems.sql
```

---

## Out of Scope (Per Plan)

- Level 3 (query-time LLM typo resolution) — correctly not implemented
- `synonyms_human` — left as-is (redundant)
- `model_synonyms` TEXT[] — left unused
- ref_system_categories / ref_subsystem_categories injection — not in Phase 1b (plan said "could be added later")

---

## Conclusion

The Canonical Alias Level 2 plan is **fully implemented** as specified. All phases (0, 0b, 1a–1d, 2a–2c, 3) are present in the codebase with the expected behavior. The only items to watch are the cache edge case and migration application to the live DB.
