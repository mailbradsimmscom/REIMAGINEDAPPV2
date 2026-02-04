---
name: dip_chat_text_search_or_and_fallback
overview: Fix v5 chat DIP retrieval returning 0 rows by replacing phrase-based ILIKE with OR-across-terms (term-level OR across table-specific columns) while keeping v5 doc/model/status scoping. No fallback that drops text filters; if nothing matches, return 0 and rely on Pinecone/Perplexity for recall.
todos:
  - id: terms-not-phrase
    content: Replace phrase-based DIP query string with normalized term list derived from classification keywords and/or user query.
    status: pending
  - id: or-across-terms
    content: Update ProductionDIPRetriever text filters to OR across terms and table-specific columns using PostgREST or_().
    status: pending
---

# DIP chat retrieval: OR-across-terms (no fallback)

## Problem statement

In v5 chat retrieval, DIP queries can return **0 rows even when relevant DIP data exists**.

Root cause: we sometimes pass a **long, multi-word phrase** into PostgREST ILIKE filters (e.g., `"watermaker desalination marine watermaker operation maintenance"`), and the current query uses:

- `col.ilike.%{query}%`

This requires the **entire phrase** to appear verbatim in a single column value (e.g., `parameter`, `steps_text`, etc.), which is unlikely.

We want DIP to behave like a reliable structured source alongside Pinecone + Perplexity, but **we will not “stack the deck”** by returning rows that don’t match the user’s query terms. If there are no term matches after v5 scoping, **return 0** and let Pinecone/Perplexity carry recall.

---

## Current behavior (verified in code)

### Where the long phrase is created

In the Python chat workflow retrieval step, when classification provides `search_keywords`, the workflow sets:

```714:722:/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/app/chat/workflows/chat_workflow_sequential.py
# INTELLIGENCE: Extract search keywords from classification
search_query = state["user_query"]
used_keywords = False
if "classification" in state and state["classification"]:
    keywords = state["classification"].get("search_keywords", [])
    if keywords:
        search_query = " ".join(keywords)
        used_keywords = True
```

That `search_query` is then passed into `ProductionDIPRetriever.query_production_dip_tables()`.

### How ProductionDIPRetriever applies text filters

`ProductionDIPRetriever` builds tiered queries (A/B/C) and in each query applies:

- `doc_id IN candidate_doc_ids` (Tier A/B)
- `applies_to_models` overlap (model-scoped)
- `applies_to_models contains {"all"}` (universal)
- `referenced_systems` overlap (referenced-scoped, when provided)
- `status IN ("dip_extracted","approved")` (best-effort)
- **text relevance filters** via ILIKE

The text relevance filter is a set of `or_()` clauses using `ilike.%{query}%` across table-specific columns.

File: `/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/app/chat/services/production_dip_retriever.py`

---

## Goal

Make DIP retrieval **high-recall** under v5 scope:

- Keep v5 scoping (doc_id + applies_to_models + referenced_systems + status)
- Replace phrase-based text matching with **OR-across-terms**
- No fallback that drops text filters (if no term match, DIP can legitimately return 0)

Non-goals:

- No change to Pinecone retrieval
- No change to DIP schema
- No change to response envelope shape

---

## Proposed approach

### 1) Build a term set (not a phrase)

Instead of joining keywords into one long string for ILIKE, produce a small set of search terms.

**Inputs:**

- `state.user_query`
- `classification.search_keywords` (if present)

**Term normalization rules:**

- lowercase
- strip punctuation
- dedupe
- drop stop-words (`the`, `how`, `what`, etc.)
- enforce min length (>= 3)
- cap to `MAX_TERMS` (recommend 6)

**Preference order:**

- Use classification keywords first (already “intent-aware”), but include at least 1–2 terms from the raw query if classification is empty.

### 2) Text filter becomes OR across terms AND OR across columns

For each table type, we already have a list of searchable columns.

New behavior:

- For each term in `terms[:MAX_TERMS]`:
  - add `col.ilike.%{term}%` for each column in that table’s column set
- join all conditions with commas into a single PostgREST `or_()` string
  - This yields: **any term matches any column**

Example (specs):

- terms = `["watermaker", "pressure", "operating"]`
- columns = `parameter, normalized_parameter, value, range, ...`
- or string includes conditions like:
  - `parameter.ilike.%watermaker%`
  - `value.ilike.%pressure%`
  - ... etc.

---

## How the 3 example questions would work

### Q1: “tell me about my watermaker”

- Terms: `["watermaker", "overview", "operation"]` (depending on classifier)
- Pass 1 may return few rows or **0** if the DIP rows don’t contain these tokens.\n+- Expected behavior when DIP=0: Pinecone provides narrative overview chunks; Perplexity provides real-world context.\n+- If you want DIP to contribute to broad “tell me about …” questions, that is a *separate* product decision (e.g., add a dedicated “overview” DIP mode/table or maintain explicit keywords per row), not a fallback that ignores text relevance.

### Q2: “how do I depressurize the system”

- Terms: `["depressurize", "pressure", "relief", "valve"]` (after normalization)
- Pass 1 likely hits `playbook_hints.steps_text` or `expected_outcome`.
- No fallback; if terms don’t match, DIP returns 0 and Pinecone should still match semantically.

### Q3: “what is the operating pressure of the watermaker”

- Terms: `["operating", "pressure", "psi", "bar"]`
- Pass 1 likely hits `spec_suggestions.parameter/value/range`.
- No fallback; if terminology mismatch causes 0, Pinecone should surface the spec section/table text.

---

## Telemetry requirements

We keep existing timing and add small counters to `detailed_metrics`:

- `dip.text_terms_used_count`
- `dip.text_terms_used` (maybe first 6 terms)

This helps confirm the fix without guesswork.

---

## Safety/performance guardrails

- `MAX_TERMS = 6`
- `MAX_COLUMNS_PER_TABLE`: keep current sets; avoid expanding.
- `PER_TABLE_LIMIT` remains 200.

---

## Implementation touchpoints (for later execution)

- Python workflow term construction:
  - `/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/app/chat/workflows/chat_workflow_sequential.py`
  - Replace phrase-join behavior or change the contract to pass `terms` to retriever.
- DIP text filter builder:
  - `/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/app/chat/services/production_dip_retriever.py`
  - Update `_add_text_filters()` to accept `terms: list[str] `and build PostgREST `or_()` accordingly.

---

## Test plan

- Use a doc known to have DIP rows (verified by direct table query).
- Run 3 queries:

1) “tell me about my watermaker” → DIP may be 0 (acceptable). Verify Pinecone/Perplexity carry the response.

2) “how do I depressurize the system” → procedure rows ideally returned via term OR; otherwise 0.

3) “operating pressure” → spec rows returned.

- Validate:
  - v5 scoping still applied (doc_id/model/status filters)
  - `detailed_metrics` shows terms used.