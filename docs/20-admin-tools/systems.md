# Systems Management

## Overview

Systems management tracks all equipment on the boat - engines, electronics, pumps, anchors, etc. This is the "equipment inventory" that the AI chat uses for context when answering questions.

**Who uses it:** Administrators
**Access:** `/systems.html`

---

## User Flow

### Viewing Systems

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Navigate to Systems page (/systems.html)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Browse Equipment List                                       │
│     ├── Filter by system/subsystem category                     │
│     ├── Search by manufacturer/model                            │
│     └── GET /systems?cursor=X for pagination                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. View System Details                                         │
│     └── GET /systems/:assetUid                                  │
│     └── Shows: manufacturer, model, description, linked docs    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

| Term | Definition |
|------|------------|
| **System** | Equipment item on the boat |
| **asset_uid** | Unique identifier (e.g., `engine-yanmar-4jh57`) |
| **Manufacturer** | Equipment maker (Yanmar, Raymarine, etc.) |
| **Model** | Specific model number |
| **System/Subsystem** | Category hierarchy (Engine/Propulsion, Electronics/Navigation) |
| **Rank** | Search relevance weight (0-1, higher = more relevant) |
| **spec_keywords_jsonb** | Extracted specifications for AI context |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Systems UI (systems.html)                                      │
│  └── List, search, view equipment                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Node.js Backend                                                │
│  ├── systems.router.js (public routes)                          │
│  ├── systems.service.js (business logic)                        │
│  └── systems.repository.js (database queries)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase                                                       │
│  └── systems table + search_systems() RPC function              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Service Layer

**File:** `src/services/systems.service.js`

### listSystemsSvc - Paginated List

```javascript
// src/services/systems.service.js:19-37
export async function listSystemsSvc({ limit, cursor } = {}) {
  try {
    // Check Supabase availability before listing systems
    await checkSupabaseAvailability();

    const safeLimit = validateLimit(limit);
    const rows = await listSystems({ limit: safeLimit, cursor });
    const nextCursor = rows.length > 0 ? rows[rows.length - 1].asset_uid : null;
    return { systems: rows, nextCursor };
  } catch (error) {
    // Enhance error with service context
    error.context = {
      ...error.context,
      service: 'listSystemsSvc',
      input: { limit, cursor }
    };
    throw error;
  }
}
```

### getSystemSvc - Get by ID

```javascript
// src/services/systems.service.js:39-57
export async function getSystemSvc(assetUid) {
  try {
    // Check Supabase availability before getting system
    await checkSupabaseAvailability();

    if (!assetUid || String(assetUid).trim() === '') {
      throw new Error('asset_uid is required');
    }
    return await getSystemByAssetUid(assetUid);
  } catch (error) {
    // Enhance error with service context
    error.context = {
      ...error.context,
      service: 'getSystemSvc',
      input: { assetUid }
    };
    throw error;
  }
}
```

### searchSystemsSvc - Full-Text Search with Rank Filtering

```javascript
// src/services/systems.service.js:72-111
export async function searchSystemsSvc(q, { limit } = {}) {
  try {
    // Check Supabase availability before searching systems
    await checkSupabaseAvailability();

    const safeQ = validateQuery(q);
    const { getEnv } = await import('../config/env.js');
    const { searchMaxRows = 8, searchRankFloor = 0.05 } = getEnv();

    // Use explicit limit if provided, otherwise use env default
    const maxRows = limit ? Math.min(Math.max(Number(limit), 1), searchMaxRows) : searchMaxRows;

    const raw = await searchSystems(safeQ, { limit: maxRows });
    const filtered = raw.filter((r) => Number(r.rank) >= searchRankFloor).slice(0, maxRows);

    return {
      systems: filtered,
      meta: {
        floor: searchRankFloor,
        maxRows: searchMaxRows,
        rawCount: raw.length,
        filteredCount: filtered.length,
        query: safeQ
      }
    };
  } catch (error) {
    // Enhance error with service context
    const { getEnv } = await import('../config/env.js');
    const { searchRankFloor = 0, searchMaxRows = 8 } = getEnv();
    error.context = {
      ...error.context,
      service: 'searchSystemsSvc',
      input: { query: q, limit },
      config: { searchRankFloor, searchMaxRows }
    };
    throw error;
  }
}
```

### Query Validation

```javascript
// src/services/systems.service.js:59-70
function validateQuery(q) {
  const s = (q ?? '').trim();
  if (s.length < 2) throw new Error('query must be at least 2 characters');
  if (s.length > 100) throw new Error('query too long (max 100 characters)');

  // Basic character validation - allow alphanumeric, spaces, hyphens, underscores, ampersands
  if (!/^[a-zA-Z0-9\s\-_&]+$/.test(s)) {
    throw new Error('query contains invalid characters (only letters, numbers, spaces, hyphens, underscores, and ampersands allowed)');
  }

  return s;
}
```

### Limit Validation

```javascript
// src/services/systems.service.js:4-8
function validateLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return 25;
  return Math.min(n, 100);  // Max 100 per request
}
```

---

## Repository Layer

**File:** `src/repositories/systems.repository.js`

### listSystems - Cursor-Based Pagination

```javascript
// src/repositories/systems.repository.js:24-38
export async function listSystems({ limit = 25, cursor } = {}) {
  const supabase = await checkSupabaseAvailability();
  let query = supabase
    .from(TABLE)
    .select('*')
    .order('asset_uid', { ascending: true })
    .limit(limit);

  if (cursor) {
    query = query.gt('asset_uid', cursor);
  }

  const { data, error } = await query;
  if (error) {
    const err = new Error(`Failed to list systems: ${error.message}`);
    err.cause = error;
    err.context = { operation: 'list', limit, cursor, table: TABLE };
    throw err;
  }
  return data ?? [];
}
```

### getSystemByAssetUid - Single System Lookup

```javascript
// src/repositories/systems.repository.js:40-55
export async function getSystemByAssetUid(assetUid) {
  const supabase = await checkSupabaseAvailability();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('asset_uid', assetUid)
    .limit(1)
    .single();

  if (error) {
    const err = new Error(`Failed to get system: ${error.message}`);
    err.cause = error;
    err.context = { operation: 'get_by_asset_uid', assetUid, table: TABLE };
    throw err;
  }
  return data ?? null;
}
```

### searchSystems - PostgreSQL RPC with Validation

```javascript
// src/repositories/systems.repository.js:57-148
export async function searchSystems(query, { limit = 10 } = {}) {
  const supabase = await checkSupabaseAvailability();

  try {
    const { data, error } = await supabase.rpc('search_systems', {
      q: query,
      top_n: limit
    });

    if (error) {
      const err = new Error(`RPC search_systems failed: ${error.message}`);
      err.cause = error;
      err.context = {
        operation: 'search_rpc',
        query,
        limit,
        rpcFunction: 'search_systems',
        table: TABLE
      };
      throw err;
    }

    // Validate RPC response structure
    if (!Array.isArray(data)) {
      const err = new Error('RPC search_systems returned invalid data structure');
      err.context = {
        operation: 'search_rpc',
        query,
        limit,
        expectedType: 'array',
        actualType: typeof data,
        data
      };
      throw err;
    }

    // Transform and validate each result
    const results = data.map((row, index) => {
      if (!row || typeof row !== 'object') {
        throw new Error(`Invalid row structure at index ${index}`);
      }

      // Expect full system object with rank
      if (!row.asset_uid || typeof row.asset_uid !== 'string') {
        throw new Error(`Missing or invalid asset_uid at index ${index}`);
      }

      if (typeof row.rank !== 'number' || !Number.isFinite(row.rank)) {
        throw new Error(`Missing or invalid rank at index ${index}`);
      }

      return row;
    });

    return results;

  } catch (error) {
    if (!error.context) {
      error.context = {
        operation: 'search_rpc',
        query,
        limit,
        rpcFunction: 'search_systems',
        table: TABLE
      };
    }
    throw error;
  }
}
```

### lookupSystemByManufacturerAndModel - Document Upload Helper

```javascript
// src/repositories/systems.repository.js:159-231
export async function lookupSystemByManufacturerAndModel(manufacturerNorm, modelNorm) {
  const supabase = await checkSupabaseAvailability();

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('asset_uid, system_norm, subsystem_norm')
      .eq('manufacturer_norm', manufacturerNorm)
      .eq('model_norm', modelNorm)
      .limit(1)
      .single();

    if (error) {
      // Handle "not found" case specifically
      if (error.code === 'PGRST116') {
        const err = new Error(`No system found for manufacturer "${manufacturerNorm}" and model "${modelNorm}"`);
        err.code = 'SYSTEM_NOT_FOUND';
        err.status = 400;
        err.context = {
          operation: 'lookup_by_manufacturer_model',
          manufacturerNorm,
          modelNorm,
          table: TABLE
        };
        throw err;
      }

      // Handle other database errors
      const err = new Error(`Failed to lookup system: ${error.message}`);
      err.cause = error;
      err.context = {
        operation: 'lookup_by_manufacturer_model',
        manufacturerNorm,
        modelNorm,
        table: TABLE
      };
      throw err;
    }

    // Validate required fields are present
    if (!data || !data.asset_uid || !data.system_norm || !data.subsystem_norm) {
      const err = new Error(`Incomplete system data for "${manufacturerNorm}" / "${modelNorm}"`);
      err.code = 'INCOMPLETE_SYSTEM_DATA';
      err.status = 500;
      throw err;
    }

    return {
      asset_uid: data.asset_uid,
      system_norm: data.system_norm,
      subsystem_norm: data.subsystem_norm
    };

  } catch (error) {
    if (!error.context) {
      error.context = {
        operation: 'lookup_by_manufacturer_model',
        manufacturerNorm,
        modelNorm,
        table: TABLE
      };
    }
    throw error;
  }
}
```

### listMinimal - Admin Dropdown Helper

```javascript
// src/repositories/systems.repository.js:262-271
async function listMinimal() {
  const supabase = await checkSupabaseAvailability();
  const { data, error } = await supabase
    .from(TABLE)
    .select('asset_uid, manufacturer_norm, model_norm, system_norm')
    .order('manufacturer_norm')
    .limit(5000);
  if (error) throw error;
  return data ?? [];
}
```

### Spec Keywords Operations

```javascript
// src/repositories/systems.repository.js:236-257
async function getSystemByUid(systemUid) {
  const supabase = await checkSupabaseAvailability();
  const { data, error } = await supabase
    .from(TABLE)
    .select('asset_uid, spec_keywords_jsonb')
    .eq('asset_uid', systemUid)
    .single();
  if (error) throw error;
  return data;
}

async function updateSpecKeywords(systemUid, next) {
  const supabase = await checkSupabaseAvailability();
  const { error } = await supabase
    .from(TABLE)
    .update({ spec_keywords_jsonb: next })
    .eq('asset_uid', systemUid);
  if (error) throw error;
}
```

---

## Files & Locations

| Purpose | Path |
|---------|------|
| **Frontend** | |
| Systems page | `src/public/systems.html` |
| **Backend** | |
| Public router | `src/routes/systems.router.js` |
| Admin route | `src/routes/admin/systems.route.js` |
| Minimal route | `src/routes/admin/systems-minimal.route.js` |
| Service | `src/services/systems.service.js` |
| Repository | `src/repositories/systems.repository.js` |

---

## API Endpoints

### Public Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/systems` | List all systems (paginated) |
| GET | `/systems/:assetUid` | Get system by ID |
| GET | `/systems/search?q=X` | Search systems |

### Admin Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/systems` | List systems (admin view) |
| GET | `/admin/api/systems/lookup` | Lookup by manufacturer/model |
| GET | `/admin/api/systems/minimal` | Minimal list for dropdowns |

---

## Database Tables

### systems

| Column | Type | Description |
|--------|------|-------------|
| asset_uid | text | **Primary key** (unique ID) |
| manufacturer | text | Raw manufacturer name |
| manufacturer_norm | text | Normalized for matching |
| model | text | Raw model number |
| model_norm | text | Normalized for matching |
| description | text | Equipment description |
| system_norm | text | Category (Engine, Electronics, etc.) |
| subsystem_norm | text | Subcategory (Propulsion, Navigation, etc.) |
| rank | numeric | Search weight (0-1) |
| spec_keywords_jsonb | jsonb | Extracted specs for AI |
| colloquial_keywords | text[] | Common names extracted from docs |
| manual | boolean | Has manual (URL or local) |
| manual_url | text | External manual URL |
| Manual_Local_Copy | boolean | Has local uploaded PDF |
| local_manual_file_name | text | Original uploaded filename |
| created_at | timestamp | Creation time |
| updated_at | timestamp | Last update |

**Manual flags:** When a document is uploaded, both `manual` and `Manual_Local_Copy` are set to `true`. The Pipeline Funnel checks `Manual_Local_Copy` for data integrity validation.

### PostgreSQL RPC: search_systems

Full-text search function with ranking:

```sql
-- Signature (simplified)
CREATE FUNCTION search_systems(q text, top_n integer)
RETURNS TABLE (
  asset_uid text,
  manufacturer text,
  manufacturer_norm text,
  model text,
  model_norm text,
  system_norm text,
  subsystem_norm text,
  description text,
  rank numeric,
  ... -- all system columns
)
AS $$
  SELECT *, ts_rank(search_vector, plainto_tsquery(q)) as rank
  FROM systems
  WHERE search_vector @@ plainto_tsquery(q)
  ORDER BY rank DESC
  LIMIT top_n
$$ LANGUAGE sql;
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SEARCH_MAX_ROWS` | `8` | Max results from search |
| `SEARCH_RANK_FLOOR` | `0.05` | Min rank to include in results |

---

## How Chat Uses Systems

```
1. User asks: "How do I change the oil in my engine?"
     │
     ▼
2. Chat proxy extracts equipment keywords
     │  └── Keywords: "oil", "engine"
     │
     ▼
3. searchSystemsSvc('engine') called
     │  └── Returns: [{ asset_uid: 'engine-yanmar-4jh57', rank: 0.85 }]
     │
     ▼
4. System details fetched → systemsContext built
     │  └── { manufacturer: 'Yanmar', model: '4JH57', system_norm: 'Engine' }
     │
     ▼
5. Context sent to Python sidecar with user message
     │
     ▼
6. AI uses context to find relevant document chunks
     └── Searches Pinecone with asset_uid filter
```

See [Chat Data Flow](../10-user-features/chat.md#data-flow-non-streaming---detailed-steps) for full details.

---

## Pagination

Uses cursor-based pagination via `asset_uid`:

```javascript
// First page
GET /systems?limit=25
// Response: { systems: [...], nextCursor: 'engine-yanmar-4jh57' }

// Next page
GET /systems?limit=25&cursor=engine-yanmar-4jh57
// Response: { systems: [...], nextCursor: 'pump-rule-3700' }
```

---

## Error Handling

All repository functions include context for debugging:

```javascript
// Error structure
{
  message: "Failed to get system: ...",
  code: "SYSTEM_NOT_FOUND",  // or "SUPABASE_DISABLED", etc.
  status: 400,               // HTTP status
  cause: originalError,      // Original Supabase error
  context: {
    operation: "get_by_asset_uid",
    assetUid: "engine-yanmar-4jh57",
    table: "systems"
  }
}
```

---

## Testing

| Test File | What It Tests |
|-----------|---------------|
| `tests/integration/systems.test.js` | Systems API |
| `tests/unit/services/systems.service.test.js` | Service logic |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Systems are auto-discovered" | **No.** Manually added or from document extraction |
| "One document = one system" | **No.** Documents link to systems via asset_uid |
| "Can delete systems freely" | **Careful.** May break document/chunk links |
| "Search is SQL LIKE" | **No.** Uses PostgreSQL full-text search RPC |
| "No pagination limit" | **No.** Max 100 per request |
| "Rank is optional" | **No.** Required for search results, validated |

---

## Related Docs

- [Documents](./documents.md) - Documents link to systems via asset_uid
- [Chat](../10-user-features/chat.md) - Uses systems for equipment context
- [Pinecone](./pinecone.md) - Vectors have asset_uid in metadata
- [Supplies](../10-user-features/supplies.md) - Supplies can link to systems
- [Agents](../30-backend/agents.md) - Manual hunter finds manuals for systems
