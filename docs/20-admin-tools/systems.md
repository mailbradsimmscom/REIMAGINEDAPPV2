# Systems Management (v5 Schema)

## Overview

Systems management tracks all equipment on the boat -- engines, electronics, pumps, anchors, etc. This is the "equipment inventory" that the AI chat uses for context when answering questions.

In **v5**, the systems table was redesigned around **reference tables** for manufacturers, product types, and categories. Foreign key columns point to these seeded reference tables, while `_norm` columns are kept in sync for backward compatibility (39+ files depend on `_norm` columns). The database was purged and rebuilt; currently 1 system (Yanmar 4JH57) with 2 instances for validation. Backup tables `systems_old` (119 rows) and `instances_old` (161 rows) preserve prior data.

**Who uses it:** Administrators
**Access:** `/systems.html`

---

## User Flow

### Viewing / Managing Systems

```
+-----------------------------------------------------------------+
|  1. Navigate to Systems page (/systems.html)                     |
+-----------------------------------------------------------------+
                              |
                              v
+-----------------------------------------------------------------+
|  2. Choose Mode                                                  |
|     +-- Add New System (v5 form with reference dropdowns)        |
|     +-- Find/Edit System (search by manufacturer + model)        |
+-----------------------------------------------------------------+
                              |
                              v
+-----------------------------------------------------------------+
|  3. Add New System                                               |
|     +-- Select manufacturer from ref_manufacturers dropdown      |
|     +-- Select product type from ref_product_types dropdown      |
|     +-- Select system category from ref_system_categories        |
|     +-- Select subsystem category (filtered by category)         |
|     +-- Enter model, description, serial, OEM details            |
|     +-- POST /api/system-management/systems                      |
+-----------------------------------------------------------------+
                              |
                              v
+-----------------------------------------------------------------+
|  4. View System Details                                          |
|     +-- GET /api/system-management/:assetUid                     |
|     +-- Shows: all fields, instances, linked docs                |
|     +-- Manage instances (add Port/Stbd, serial numbers)         |
+-----------------------------------------------------------------+
```

---

## Key Concepts

| Term | Definition |
|------|------------|
| **System** | A type of equipment on the boat (e.g., "Yanmar 4JH57 engine") |
| **Instance** | A physical unit of a system (e.g., Port Engine, Starboard Engine) |
| **asset_uid** | UUID primary key for a system |
| **instance_uid** | UUID primary key for an instance |
| **Reference Tables** | Seeded lookup tables (`ref_manufacturers`, `ref_product_types`, `ref_system_categories`, `ref_subsystem_categories`) that the systems table points to via FK columns |
| **_norm columns** | Normalized text columns (e.g., `manufacturer_norm`, `model_norm`) kept in sync with FK references for backward compatibility |
| **Canonical Model** | The official model name in `ref_canonical_models`; variants live in `ref_model_synonyms` |
| **normalizeModelKey()** | Deterministic normalization: uppercase, strip whitespace/hyphens/underscores. Identical in Node, Python, and SQL |
| **Centroid** | An operational grouping of systems (e.g., "Engine Starting Port", "Autopilot Primary") |
| **System Relationship** | A typed edge between two systems (e.g., "powers", "controls", "monitors") |
| **OEM tracking** | Some components are OEM-branded (e.g., B&G transducer is actually made by Airmar). `oem_manufacturer_id` + `oem_model` + `oem_part_number` track this |
| **spec_keywords_jsonb** | Extracted specifications for AI context |
| **model_synonyms[]** | Array of variant names for a model, stored on the systems row |

---

## Architecture

```
+-----------------------------------------------------------------+
|  Systems UI (systems.html)                                       |
|  +-- v5 form with reference table dropdowns                      |
|  +-- Loads ref data on init via /api/system-management/ref/*     |
|  +-- CRUD systems and instances                                  |
+-----------------------------------------------------------------+
                              |
                              v
+-----------------------------------------------------------------+
|  Node.js Backend                                                 |
|  +-- system-management.route.js (admin CRUD + ref endpoints)     |
|  +-- systems.router.js (public read-only routes)                 |
|  +-- systems.service.js (search, list, get - public)             |
|  +-- system-management.service.js (CRUD business logic)          |
|  +-- systems.repository.js (public DB queries + model aliases)   |
|  +-- system-management.repository.js (CRUD + ref table queries)  |
+-----------------------------------------------------------------+
                              |
                              v
+-----------------------------------------------------------------+
|  Supabase                                                        |
|  +-- systems table (v5 schema with FK columns)                   |
|  +-- instances table (per-unit tracking)                         |
|  +-- ref_manufacturers, ref_product_types                        |
|  +-- ref_system_categories, ref_subsystem_categories             |
|  +-- ref_canonical_models, ref_model_synonyms                    |
|  +-- system_relationships, centroids, centroid_members           |
|  +-- system_photos                                               |
|  +-- search_systems() RPC function                               |
|  +-- normalize_model_key() SQL function                          |
+-----------------------------------------------------------------+
```

---

## Service Layer

### systems.service.js (Public Read Operations)

**File:** `src/services/systems.service.js`

Provides `listSystemsSvc`, `getSystemSvc`, and `searchSystemsSvc` for public-facing read operations. These are unchanged from pre-v5 -- they work with whatever columns are on the `systems` table.

Key behaviors:
- `listSystemsSvc` -- cursor-based pagination via `asset_uid`, max 100 per request
- `getSystemSvc` -- single system lookup by `asset_uid`
- `searchSystemsSvc` -- full-text search via `search_systems()` RPC with rank filtering (floor from `SEARCH_RANK_FLOOR` env var)

### system-management.service.js (Admin CRUD + Reference Tables)

**File:** `src/services/system-management.service.js`

Provides all admin operations:

- **`createSystem(data)`** -- validates, sanitizes, generates UUID, inserts, then auto-generates keywords/synonyms via `generateAndSaveKeywordsSynonyms()`
- **`updateSystem(assetUid, data)`** -- validates, sanitizes, updates (never changes PK)
- **`deleteSystem(assetUid)`** -- archives all instances first, then hard-deletes the system
- **`getSystemWithInstances(assetUid)`** -- fetches system + its instances
- **`createInstance(data, denormalizedFields?)`** -- auto-increments `instance_index`, supports optional denormalized fields for the document-ingest flow
- **`updateInstance(instanceUid, data)`** -- updates serial_number, location, instance_index
- **`deleteInstance(instanceUid)`** -- archives (soft delete) to `instances_archived`

**v5 Reference Table Services:**

- **`getRefManufacturersList()`** -- returns all rows from `ref_manufacturers`
- **`getRefProductTypesList()`** -- returns all rows from `ref_product_types`
- **`getRefSystemCategoriesList()`** -- returns all rows from `ref_system_categories`
- **`getRefSubsystemCategoriesList(categoryId?)`** -- returns subsystem categories, optionally filtered by parent `system_id`

---

## Repository Layer

### systems.repository.js (Public Queries + Model Aliases)

**File:** `src/repositories/systems.repository.js`

- `listSystems({ limit, cursor })` -- cursor-based pagination
- `getSystemByAssetUid(assetUid)` -- single system lookup
- `searchSystems(query, { limit })` -- calls `search_systems()` RPC, validates response structure and rank
- `lookupSystemByManufacturerAndModel(manufacturerNorm, modelNorm)` -- used during document upload to resolve `asset_uid`
- `listMinimal()` -- returns `asset_uid, manufacturer_norm, model_norm, system_norm` for admin dropdowns
- `getSystemByUid(systemUid)` -- returns `asset_uid` + `spec_keywords_jsonb`
- `updateSpecKeywords(systemUid, next)` -- updates `spec_keywords_jsonb`
- **`resolveModelAliases(normalizedModels)`** -- queries `ref_model_synonyms` to map normalized model keys to canonical model names (used by chat-proxy for Pinecone filtering)

### system-management.repository.js (Admin CRUD + Reference Tables)

**File:** `src/repositories/system-management.repository.js`

**CRUD operations:**
- `createSystem(systemData)` -- inserts into `systems`
- `updateSystem(assetUid, systemData)` -- updates `systems` row
- `deleteSystem(assetUid)` -- hard deletes from `systems`
- `getInstancesByAssetUid(assetUid)` -- lists instances for a system
- `createInstance(instanceData)` -- inserts into `instances`
- `updateInstance(instanceUid, instanceData)` -- updates `instances` row
- `archiveInstance(instanceUid)` -- copies to `instances_archived` then deletes from `instances`
- `getNextInstanceIndex(assetUid)` -- finds max `instance_index` + 1
- `getSystemsToFetch()` -- reads `systems_to_fetch` view (systems needing manuals)

**v5 Reference Table Queries:**
- `getRefManufacturers()` -- `ref_manufacturers` (id, name, synonyms, is_oem)
- `getRefProductTypes()` -- `ref_product_types` (id, name, synonyms)
- `getRefSystemCategories()` -- `ref_system_categories` (id, name, synonyms)
- `getRefSubsystemCategories(categoryId?)` -- `ref_subsystem_categories` (id, name, synonyms, system_id), optionally filtered

**Legacy operations (from systems table directly):**
- `getManufacturers()` -- distinct `manufacturer_norm` values
- `getModelsByManufacturer(manufacturer)` -- distinct `model_norm` for a manufacturer
- `findSystemByManufacturerModel(manufacturer, model)` -- search by exact match

---

## Files & Locations

| Purpose | Path |
|---------|------|
| **Frontend** | |
| Systems page (v5 dropdowns) | `src/public/systems.html` |
| **Routes** | |
| Public router (list, search, get) | `src/routes/systems.router.js` |
| Admin systems route (stats, lookup) | `src/routes/admin/systems.route.js` |
| Admin minimal route (dropdown data) | `src/routes/admin/systems-minimal.route.js` |
| System management route (CRUD + ref) | `src/routes/system-management.route.js` |
| **Services** | |
| Public service (search, list, get) | `src/services/systems.service.js` |
| Admin service (CRUD + ref tables) | `src/services/system-management.service.js` |
| **Repositories** | |
| Public repository (queries + aliases) | `src/repositories/systems.repository.js` |
| Admin repository (CRUD + ref queries) | `src/repositories/system-management.repository.js` |
| **Utilities** | |
| Model key normalization (Node) | `src/utils/normalize-model-key.js` |

---

## API Endpoints

### Public Routes (systems.router.js)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/systems` | List all systems (paginated, cursor-based) |
| GET | `/systems/search?q=X` | Full-text search with rank filtering |
| GET | `/systems/:assetUid` | Get system by asset_uid |

### Admin Routes (systems.route.js, systems-minimal.route.js)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/systems` | System stats (total, last updated, doc/job/chunk counts) |
| GET | `/admin/api/systems/lookup?manufacturer=X&model=Y` | Lookup by manufacturer + model |
| GET | `/admin/api/systems/minimal` | Minimal list for admin dropdowns |

### System Management Routes (system-management.route.js)

**Reference Table Endpoints (v5):**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/system-management/ref/manufacturers` | All rows from `ref_manufacturers` |
| GET | `/api/system-management/ref/product-types` | All rows from `ref_product_types` |
| GET | `/api/system-management/ref/categories` | All rows from `ref_system_categories` |
| GET | `/api/system-management/ref/subcategories?categoryId=X` | Subsystem categories (filtered by parent) |

**CRUD Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/system-management/manufacturers` | Legacy: distinct manufacturers from systems |
| GET | `/api/system-management/models?manufacturer=X` | Legacy: models for a manufacturer |
| GET | `/api/system-management/search?manufacturer=X&model=Y` | Search by manufacturer + model |
| GET | `/api/system-management/:assetUid` | System details with instances |
| POST | `/api/system-management/systems` | Create new system |
| PUT | `/api/system-management/systems/:assetUid` | Update system |
| DELETE | `/api/system-management/systems/:assetUid` | Delete system (archives instances first) |
| POST | `/api/system-management/instances` | Create instance |
| PUT | `/api/system-management/instances/:instanceUid` | Update instance |
| DELETE | `/api/system-management/instances/:instanceUid` | Archive (soft delete) instance |

---

## Database Tables

### systems (v5 schema)

The core equipment table. v5 adds FK columns pointing to reference tables while preserving `_norm` columns for backward compatibility.

| Column | Type | Description |
|--------|------|-------------|
| asset_uid | uuid | **Primary key** |
| manufacturer | text | Raw manufacturer name |
| manufacturer_norm | text | Normalized for matching (kept in sync with FK) |
| manufacturer_id | uuid FK | Points to `ref_manufacturers.id` |
| model | text | Raw model number |
| model_norm | text | Normalized for matching |
| model_synonyms | text[] | Variant names for this model |
| product_type_id | uuid FK | Points to `ref_product_types.id` |
| description | text | Equipment description |
| system_norm | text | Category text (kept in sync with FK) |
| system_category_id | uuid FK | Points to `ref_system_categories.id` |
| subsystem_norm | text | Subcategory text (kept in sync with FK) |
| subsystem_category_id | uuid FK | Points to `ref_subsystem_categories.id` |
| oem_manufacturer_id | uuid FK | Points to `ref_manufacturers.id` (OEM maker, e.g., Airmar for a B&G transducer) |
| oem_model | text | OEM model designation |
| oem_part_number | text | OEM part number |
| serial_number | text | Serial for single-instance systems |
| rank | numeric | Search weight (0-1) |
| spec_keywords_jsonb | jsonb | Extracted specs for AI context |
| colloquial_keywords | text[] | Common names extracted from docs |
| manual | boolean | Has manual (URL or local) |
| manual_url | text | External manual URL |
| Manual_Local_Copy | boolean | Has local uploaded PDF |
| local_manual_file_name | text | Original uploaded filename |
| created_at | timestamp | Creation time |
| updated_at | timestamp | Last update |

**Dual-column strategy:** Both FK columns (e.g., `manufacturer_id`) and `_norm` text columns (e.g., `manufacturer_norm`) are maintained because 39+ files depend on the `_norm` columns. When a system is created or updated through the admin UI, both are set.

### instances

For equipment that has multiple physical units (e.g., twin engines, dual batteries).

| Column | Type | Description |
|--------|------|-------------|
| instance_uid | uuid | **Primary key** |
| asset_uid | uuid FK | Points to `systems.asset_uid` |
| serial_number | text | Serial number for this unit |
| location | text | Physical location (e.g., "Port", "Starboard") |
| instance_index | integer | Ordering index (auto-incremented) |
| manufacturer_norm | text | Denormalized for queries |
| model_norm | text | Denormalized for queries |
| system_norm | text | Denormalized for queries |
| subsystem_norm | text | Denormalized for queries |
| created_at | timestamp | Creation time |

**Instances pattern:**
- Single-instance systems (most equipment) use `serial_number` on the `systems` table directly.
- Multi-instance systems (twin engines, dual batteries) use the `instances` table with Port/Stbd rows.

### instances_archived

Soft-delete archive for instances. Same structure as `instances` plus:

| Column | Type | Description |
|--------|------|-------------|
| archived_at | timestamp | When archived |
| archived_by | text | Who/what archived it |
| original_data | jsonb | Full original instance record |

### Reference Tables (v5 -- Seeded with Data)

#### ref_manufacturers (51 rows)

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | **Primary key** |
| name | text | Canonical manufacturer name |
| synonyms | text[] | Alternate names / abbreviations |
| is_oem | boolean | Whether this is an OEM manufacturer |

#### ref_product_types (45 rows)

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | **Primary key** |
| name | text | Product type name (e.g., "Diesel Engine", "Chartplotter") |
| synonyms | text[] | Alternate names |

#### ref_system_categories (9 rows)

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | **Primary key** |
| name | text | Category name |
| synonyms | text[] | Alternate names |

The 9 categories: Propulsion, Navigation, Electrical DC, Communications, Control/Automation, Hull/Plumbing, Rigging/Deck, Interior/Comfort, Safety.

#### ref_subsystem_categories (54 rows)

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | **Primary key** |
| name | text | Subcategory name |
| synonyms | text[] | Alternate names |
| system_id | uuid FK | Points to parent `ref_system_categories.id` |

### Canonical Model Registry

#### ref_canonical_models (54 rows)

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | **Primary key** |
| canonical_model | text | The official model name |
| manufacturer_id | uuid FK | Points to `ref_manufacturers.id` |

#### ref_model_synonyms (17 rows)

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | **Primary key** |
| canonical_model | text | Maps back to the canonical name |
| synonym_norm | text | Normalized variant (output of `normalize_model_key()`) |

**normalize_model_key()** exists in three places with identical logic:
- **SQL:** `normalize_model_key()` function in PostgreSQL
- **Node:** `src/utils/normalize-model-key.js` -- `normalizeModelKey(raw)`: `raw.toUpperCase().replace(/[\s\-_]/g, '')`
- **Python:** `normalize_model_key(raw)`: `re.sub(r'[\s\-_]', '', raw.upper())`

Examples: `"VC 20"` -> `"VC20"`, `"FUSION-LINK"` -> `"FUSIONLINK"`, `"B70770"` -> `"B70770"`

### System Relationships (NEW in v5)

#### system_relationships

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | **Primary key** |
| source_system_uid | uuid FK | Points to `systems.asset_uid` |
| target_system_uid | uuid FK | Points to `systems.asset_uid` |
| relationship_type | text | One of: `controls`, `powers`, `feeds`, `monitors`, `connects_to`, `provides_feedback`, `requires`, `cools` |
| created_at | timestamp | Creation time |

#### staging_system_relationships

Same structure as `system_relationships`, used as a staging area for DIP-extracted relationships before promotion to the main table.

### Centroids (NEW in v5)

Operational groupings that cluster related systems for context retrieval.

#### centroids (15 rows)

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | **Primary key** |
| name | text | Grouping name (e.g., "Engine Starting Port", "Autopilot Primary", "Charging Underway") |
| synonyms | text[] | Query matching terms |

#### centroid_members

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | **Primary key** |
| centroid_id | uuid FK | Points to `centroids.id` |
| asset_uid | uuid FK | Points to `systems.asset_uid` |

### System Photos (NEW in v5)

#### system_photos

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | **Primary key** |
| asset_uid | uuid FK | Points to `systems.asset_uid` |
| storage_path | text | Path in Supabase storage |
| extracted_text | text | Vision-extracted text from photo |
| extracted_manufacturer | text | Vision-extracted manufacturer |
| extracted_model | text | Vision-extracted model |
| extracted_serial | text | Vision-extracted serial number |
| created_at | timestamp | Upload time |

### PostgreSQL RPC: search_systems

Full-text search function with ranking:

```sql
-- Signature (simplified)
CREATE FUNCTION search_systems(q text, top_n integer)
RETURNS TABLE (
  asset_uid uuid,
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

## How Chat Uses Systems

```
1. User asks: "How do I change the oil in my engine?"
     |
     v
2. Chat proxy extracts equipment keywords
     |  +-- Keywords: "oil", "engine"
     |
     v
3. searchSystemsSvc('engine') called
     |  +-- Returns: [{ asset_uid: '...', model: '4JH57', rank: 0.85 }]
     |
     v
4. System details fetched -> systemsContext built
     |  +-- { manufacturer: 'Yanmar', model: '4JH57', system_norm: 'Propulsion' }
     |
     v
5. Model alias resolution (v5)
     |  +-- normalizeModelKey('4JH57') -> '4JH57'
     |  +-- resolveModelAliases(['4JH57']) queries ref_model_synonyms
     |  +-- Returns canonical model names for Pinecone filtering
     |
     v
6. Context sent to Python sidecar with user message
     |
     v
7. AI uses context to find relevant document chunks
     +-- Searches Pinecone with asset_uid + canonical model filters
```

See [Chat Data Flow](../10-user-features/chat.md#data-flow-non-streaming---detailed-steps) for full details.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SEARCH_MAX_ROWS` | `8` | Max results from search |
| `SEARCH_RANK_FLOOR` | `0.05` | Min rank to include in results |

---

## Pagination

Uses cursor-based pagination via `asset_uid`:

```javascript
// First page
GET /systems?limit=25
// Response: { systems: [...], nextCursor: 'some-uuid' }

// Next page
GET /systems?limit=25&cursor=some-uuid
// Response: { systems: [...], nextCursor: 'another-uuid' }
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
    assetUid: "...",
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
| "Systems are auto-discovered" | **No.** Manually added via admin UI or from document extraction. System photos with vision extraction assist discovery but still require admin review. |
| "One document = one system" | **No.** Documents link to systems via asset_uid |
| "Can delete systems freely" | **Careful.** Instances are archived first, but document/chunk links and system_relationships may break |
| "Search is SQL LIKE" | **No.** Uses PostgreSQL full-text search RPC |
| "No pagination limit" | **No.** Max 100 per request |
| "Rank is optional" | **No.** Required for search results, validated |
| "FK columns replaced _norm columns" | **No.** Both are maintained. 39+ files depend on `_norm` columns. The dual-column strategy keeps both in sync. |
| "Reference tables are editable via UI" | **Not yet.** Reference tables are seeded; the admin UI reads from them for dropdowns but does not currently provide CRUD for the reference data itself. |
| "Centroids are auto-computed" | **Not yet.** Centroids are manually defined. Centroid members link systems to centroids. |

---

## Current State (v5 Rebuild)

- **Database purged and rebuilt** with v5 schema
- **1 system** currently: Yanmar 4JH57 with 2 instances (Port/Stbd) for validation
- **Backup tables:** `systems_old` (119 rows), `instances_old` (161 rows) preserve all prior data
- **Reference tables seeded:** 51 manufacturers, 45 product types, 9 system categories, 54 subsystem categories, 54 canonical models, 17 model synonyms, 15 centroids

---

## Related Docs

- [Documents](./documents.md) - Documents link to systems via asset_uid
- [Chat](../10-user-features/chat.md) - Uses systems for equipment context
- [Pinecone](./pinecone.md) - Vectors have asset_uid in metadata
- [Supplies](../10-user-features/supplies.md) - Supplies can link to systems
- [Agents](../30-backend/agents.md) - Manual hunter finds manuals for systems
