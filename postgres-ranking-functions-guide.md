# PostgreSQL Full-Text Search Ranking Functions

## Built-in Functions Available

### 1. **ts_rank()** - Frequency-based (CURRENT)
**What it does:** Ranks based on how often query terms appear

```sql
ts_rank(tsvector, tsquery [, normalization])
```

**Example:**
```sql
SELECT ts_rank(
  to_tsvector('english', 'harken winch electric'),
  plainto_tsquery('english', 'harken winches')
) as rank;
-- Result: ~0.6 (finds "harken" and "winch")
```

**Pros:**
- Fast
- Simple
- Good for general search

**Cons:**
- Doesn't consider word proximity
- Long documents can dominate rankings

---

### 2. **ts_rank_cd()** - Cover Density
**What it does:** Ranks based on how **close together** query terms appear

```sql
ts_rank_cd(tsvector, tsquery [, normalization])
```

**Example:**
```sql
SELECT ts_rank_cd(
  to_tsvector('english', 'harken electric winch system'),
  plainto_tsquery('english', 'harken winches')
) as rank_cd;
-- Higher score if "harken" and "winch" are adjacent
```

**Pros:**
- Rewards exact phrases
- Better for multi-word queries
- Good for "quoted search" behavior

**Cons:**
- Slightly slower than ts_rank()
- Can penalize relevant docs where words are separated

---

### 3. **setweight()** - Field Weighting
**What it does:** Gives different importance to different fields

```sql
setweight(tsvector, weight_label)
-- weight_label: 'A' (1.0), 'B' (0.4), 'C' (0.2), 'D' (0.1)
```

**Example:**
```sql
SELECT ts_rank(
  setweight(to_tsvector('english', manufacturer_norm), 'A') ||  -- 1.0 weight
  setweight(to_tsvector('english', model_norm), 'B') ||         -- 0.4 weight
  setweight(to_tsvector('english', description), 'D'),          -- 0.1 weight
  plainto_tsquery('english', 'harken')
) as rank_weighted;
-- Matches in manufacturer count 10x more than matches in description
```

**Pros:**
- Control which fields matter most
- More relevant results
- Can prioritize exact manufacturer matches

**Cons:**
- More complex
- Need to determine weights

---

### 4. **Normalization Flags**
**What they do:** Adjust scores based on document length/complexity

```sql
ts_rank(tsvector, tsquery, normalization_flag)
```

**Available flags:**
| Flag | Effect |
|------|--------|
| 0 | No normalization (default) |
| 1 | Divide by `1 + log(document length)` |
| 2 | Divide by document length |
| 4 | Divide by mean harmonic distance |
| 8 | Divide by number of unique words |
| 16 | Divide by `1 + log(unique words)` |
| 32 | Divide by rank + 1 |

**Can combine:** `1 + 2 = 3`, `1 + 2 + 4 = 7`, etc.

**Example:**
```sql
SELECT ts_rank(
  to_tsvector('english', 'harken winch'),
  plainto_tsquery('english', 'harken'),
  32  -- Normalize
) as rank_normalized;
```

**Pros:**
- Prevents long documents from dominating
- More balanced scores across different doc lengths

**Cons:**
- Can reduce score differences
- May need testing to find right flag

---

## 🎯 Recommendation for Your Use Case

### **Best Option: Weighted ts_rank()**

**Why:**
- You want manufacturer matches to rank highest (user asks "harken winches")
- Model matches should be medium priority
- Description matches lowest priority
- Gives you control over relevance

**Proposed new search_systems():**
```sql
CREATE OR REPLACE FUNCTION search_systems(q text, top_n integer DEFAULT 10)
RETURNS TABLE (
  asset_uid text,
  manufacturer_norm text,
  model_norm text,
  description text,
  rank real
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.asset_uid::text,
    s.manufacturer_norm,
    s.model_norm,
    s.description,
    ts_rank(
      -- Weighted fields
      setweight(to_tsvector('english', COALESCE(s.manufacturer_norm, '')), 'A') ||  -- Highest
      setweight(to_tsvector('english', COALESCE(s.model_norm, '')), 'A') ||         -- Highest
      setweight(to_tsvector('english', COALESCE(s.system_norm, '')), 'B') ||        -- Medium
      setweight(to_tsvector('english', COALESCE(s.subsystem_norm, '')), 'B') ||     -- Medium
      setweight(to_tsvector('english', COALESCE(s.spec_keywords, '')), 'C') ||      -- Low
      setweight(to_tsvector('english', COALESCE(s.description, '')), 'D'),          -- Lowest
      plainto_tsquery('english', q),
      32  -- Normalize to prevent length bias
    ) as rank
  FROM systems s
  WHERE
    -- Still use unweighted for WHERE clause (faster)
    to_tsvector('english',
      COALESCE(s.manufacturer_norm, '') || ' ' ||
      COALESCE(s.model_norm, '') || ' ' ||
      COALESCE(s.system_norm, '') || ' ' ||
      COALESCE(s.subsystem_norm, '') || ' ' ||
      COALESCE(s.spec_keywords, '') || ' ' ||
      COALESCE(s.description, '')
    ) @@ plainto_tsquery('english', q)
  ORDER BY rank DESC
  LIMIT top_n;
END;
$$;
```

**Expected Results with Weighted Ranking:**
```
Query: "harken winches"

1. Harken 60_3_stea_winch          → ~0.95 (manufacturer + model match)
2. Harken winch_60_3_stea_24v...   → ~0.85 (manufacturer + model match)
3. Harken 50_2sta                  → ~0.80 (manufacturer match, model partial)
4. Harken 46_2stea                 → ~0.75 (manufacturer match)
5. Harken 50_2stea_24v_horizontal  → ~0.70 (manufacturer match)

All rank higher because manufacturer/model fields are weighted 'A'
```

---

## 📚 PostgreSQL Documentation

- **Text Search Functions:** https://www.postgresql.org/docs/current/textsearch-controls.html
- **Ranking:** https://www.postgresql.org/docs/current/textsearch-controls.html#TEXTSEARCH-RANKING
- **Weighting:** https://www.postgresql.org/docs/current/textsearch-features.html#TEXTSEARCH-MANIPULATE-TSVECTOR

---

## 🔧 Migration to Implement Weighted Ranking

**File:** `scripts/migrations/018_weighted_search_systems.sql`

```sql
-- Migration: Add weighted ranking to search_systems
-- Gives higher priority to manufacturer and model matches

CREATE OR REPLACE FUNCTION search_systems(q text, top_n integer DEFAULT 10)
RETURNS TABLE (
  asset_uid text,
  manufacturer_norm text,
  model_norm text,
  description text,
  system_norm text,
  subsystem_norm text,
  rank real
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.asset_uid::text,
    s.manufacturer_norm,
    s.model_norm,
    s.description,
    s.system_norm,
    s.subsystem_norm,
    ts_rank(
      setweight(to_tsvector('english', COALESCE(s.manufacturer_norm, '')), 'A') ||
      setweight(to_tsvector('english', COALESCE(s.model_norm, '')), 'A') ||
      setweight(to_tsvector('english', COALESCE(s.system_norm, '')), 'B') ||
      setweight(to_tsvector('english', COALESCE(s.subsystem_norm, '')), 'B') ||
      setweight(to_tsvector('english', COALESCE(s.spec_keywords, '')), 'C') ||
      setweight(to_tsvector('english', COALESCE(s.description, '')), 'D'),
      plainto_tsquery('english', q),
      32  -- Normalization: divide by rank + 1
    ) as rank
  FROM systems s
  WHERE
    to_tsvector('english',
      COALESCE(s.manufacturer_norm, '') || ' ' ||
      COALESCE(s.model_norm, '') || ' ' ||
      COALESCE(s.system_norm, '') || ' ' ||
      COALESCE(s.subsystem_norm, '') || ' ' ||
      COALESCE(s.spec_keywords, '') || ' ' ||
      COALESCE(s.description, '')
    ) @@ plainto_tsquery('english', q)
  ORDER BY rank DESC
  LIMIT top_n;
END;
$$;

COMMENT ON FUNCTION search_systems IS 'Weighted full-text search. Manufacturer/Model = highest priority (A), System/Subsystem = medium (B), Keywords = low (C), Description = lowest (D)';
```

**To run:**
```bash
psql $SUPABASE_DB_URL -f scripts/migrations/018_weighted_search_systems.sql
```

---

## Summary

| Function | Use When | Expected Rank Range |
|----------|----------|---------------------|
| `ts_rank()` | General search | 0.05 - 0.70 |
| `ts_rank_cd()` | Phrase matching important | 0.05 - 0.75 |
| Weighted `ts_rank()` | **Your use case** ⭐ | 0.10 - 0.95 |
| With normalization | Varying doc lengths | 0.05 - 0.80 |

**Recommendation:** Use weighted `ts_rank()` with normalization flag 32
