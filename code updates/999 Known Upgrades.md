# Known Upgrades

Tracking future improvements identified during development.

---

## 1. Equipment Keyword Search - Prefix/Synonym Boosting

**Status:** Identified
**Priority:** Medium
**Date Identified:** 2025-12-10

### Problem

When users search for equipment using natural language like "for my nemesis how do I lock the screen", the keyword search extracts individual words (`nemesis`, `lock`, `screen`) and searches each separately. The results are then sorted by rank.

The issue: generic action words like "lock" can match equipment names (e.g., `quick_lock_deck_filler`) with a higher rank than the actual equipment the user is asking about.

**Example:**

| Keyword | Match | Rank |
|---------|-------|------|
| `nemesis` | B&G nemesis_9 | 0.760 |
| `lock` | Osculati quick_lock_deck_filler | **0.827** |
| `screen` | B&G triton_display | 0.608 |

After sorting by rank, the deck filler (irrelevant) outranks the Nemesis 9 (what the user wants).

### Current Workaround

Users can include the full model name (e.g., "nemesis 9" instead of "nemesis") to get correct results.

### Proposed Solution

Boost rank for results where the keyword matches the **beginning** of the model name (prefix match) or appears in the **synonyms** field.

**Option A - Prefix Match Boost:**
```
"nemesis" → "nemesis_9" starts with "nemesis"? YES → boost rank 1.5x
"lock" → "quick_lock_deck_filler" starts with "lock"? NO → no boost
```

**Option B - Synonym Match Boost:**
The `systems` table has `synonyms_fts` containing variations like "Nemesis 9", "NEMESIS", "nemesis", "B&G Nemesis". If the user's keyword appears in synonyms, apply a rank boost.

**Option C - First Keyword Priority:**
Since users typically phrase questions as "for my [equipment] how do I [action]", prioritize results from the first keyword over later keywords.

### Files Involved

- `src/services/chat-proxy.service.js` (lines 148-172) - keyword search logic
- `src/repositories/systems.repository.js` - `searchSystems()` function
- Supabase RPC `search_systems` - may need to return `model_norm` and `synonyms_fts` for boosting

### Test Case

Query: `for my nemesis how do I lock the screen`
Expected: Should find B&G nemesis_9 and return Pinecone docs for screen lock procedure
Actual (before fix): Falls back to Perplexity web search because deck filler outranks nemesis
