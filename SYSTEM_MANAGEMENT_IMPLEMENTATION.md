# System Management Implementation - Detailed Progress Tracker

## ⚠️ CRITICAL RULES: ZERO REGRESSION + CURSOR RULES ⚠️

**🚨 DO NOT MODIFY ANY EXISTING FILES 🚨**

### Zero Regression Policy

1. ✅ **CAN USE** existing routes/services/repositories by calling them (READ-ONLY)
2. ❌ **CANNOT MODIFY** any existing route files, services, or repositories
3. ✅ **CAN CREATE** new files only:
   - `src/routes/system-management.route.js` (NEW)
   - `src/public/systems.html` (NEW)
   - `src/middleware/system-validation.middleware.js` (NEW)
   - `src/repositories/system-management.repository.js` (NEW - for DB operations)
   - `src/services/system-management.service.js` (NEW - for business logic)
   - Any documentation files (NEW)
4. ❌ **CANNOT CHANGE** existing database schema (can only ADD new tables)
5. ✅ **CAN QUERY** existing tables, but CANNOT alter table structure

### Cursor Rules Compliance (.cursorrules)

**Architecture (MUST FOLLOW):**
- Flow: `routes → services → repositories`
- Routes: Thin, no I/O or business logic
- Services: Business logic only
- Repositories: All DB/storage/network I/O
- **FORBIDDEN:** route → repository direct imports

**Code Standards:**
- Node 20, ESM only
- ❌ NO `console.log()` - Use `src/utils/logger.js`
- Read env ONLY via `src/config/env.js`
- Never hardcode - ask for .env additions

**HTTP Contract:**
- Every response: `{ success, data?, error?, requestId? }`
- Use Zod for input validation at route edge

**File Standards:**
- Max 250 lines per file (soft limit for migrations)
- Use `*.route.js` for leaf endpoints (NOT `*.routes.js`)
- No artifacts in repo

**Security:**
- `/admin/*` routes need `adminOnly` middleware (x-admin-token)
- JSON body ≤ 2 MB
- CORS allow-list only

**Changes:**
- Schema/data changes need: SQL migration + Zod + tests + docs
- Breaking API changes: propose first, then code

**Files you can READ/CALL but NEVER MODIFY:**
- ❌ `src/routes/systems.route.js` - Use for reference only
- ❌ `src/services/systems.service.js` - Call `getSystemSvc()` but don't modify
- ❌ `src/repositories/systems.repository.js` - Reference only
- ❌ Any other existing `.js` files

**Only file you MAY edit (to register new route):**
- ⚠️ `src/start.js` or app setup file - ADD TWO LINES ONLY to register route

---

## Project Overview
Building a standalone system management UI (`src/public/systems.html`) for CRUD operations on marine equipment systems and their instances. This is a **100% standalone page** with no dependencies on existing routes.

**Architecture:**
- **Frontend:** Apple-inspired HTML page matching existing `src/public/` design patterns
- **Backend:** New isolated routes in `src/routes/system-management.route.js` (NO modifications to existing routes)
- **Database:** Systems table (existing) + Instances table (existing) + instances_archived (NEW)

---

## Current Status: Phase 0 - Setup Complete ✅

**Last Updated:** 2025-09-30
**Current Phase:** Phase 1 - Read-Only UI
**Next Checkpoint:** UX/Data Display Validation

---

## Phase 0: Setup & State Tracking ✅

### Completed Items:
- ✅ Created `SYSTEM_MANAGEMENT_IMPLEMENTATION.md` (this file) for progress tracking
- ✅ Defined 6-phase implementation plan
- ✅ Identified database tables: `systems`, `instances`, `instances_archived` (to be created)
- ✅ Confirmed instance deletion strategy: Archive to `instances_archived` table
- ✅ Confirmed no rollback plan needed (dev environment, standalone page)
- ✅ Confirmed no migration plan needed (no existing data changes)

### Key Decisions Made:
1. **Instance Deletion:** Archive to `instances_archived` table (soft delete pattern)
2. **No Feature Flag:** Not needed - standalone page in dev
3. **🚨 ZERO REGRESSION POLICY:** All new routes in `system-management.route.js` - NO MODIFICATIONS to existing files
4. **Standalone Design:** Page works independently, doesn't affect existing functionality
5. **Existing Code Usage:** Can CALL existing functions (getSystemSvc, etc.) but NEVER modify them

---

## Phase 1: Read-Only UI (IN PROGRESS)

### Goal
Build and test the HTML interface with data display ONLY. All save/create functionality disabled.

### File to Create
**Location:** `/Users/brad/code/REIMAGINEDAPPV2/src/public/systems.html`

### Implementation Checklist

#### 1.1 HTML Structure ✅ (COMPLETED - Code Provided)
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>System Management - Mantis</title>
    <link rel="stylesheet" href="style.css">
    <!-- Custom styles embedded in <style> tag -->
</head>
<body>
    <!-- Navigation matching existing pages -->
    <!-- Mode selector (Find/Edit vs New System) -->
    <!-- Dropdown section (manufacturer + model) -->
    <!-- System form with all fields -->
    <!-- Instances section with dynamic rows -->
    <!-- Action buttons (disabled in Phase 1) -->
</body>
</html>
```

**Status:** ✅ Full HTML code provided in previous conversation (see artifact above)

#### 1.2 Wire Up Read-Only Functionality (NEXT STEP)

**Current Blockers:**
- Need to create temporary read endpoints that wrap existing functionality
- Dropdowns need to be populated from existing systems table

**Implementation Steps:**

**Step 1.2.1: Create Repository Layer (DB Operations)**
Create: `/Users/brad/code/REIMAGINEDAPPV2/src/repositories/system-management.repository.js`

**⚠️ CURSOR RULES COMPLIANCE:**
- This is the ONLY place that touches the database
- All DB/storage/network I/O goes here
- No business logic - just data access

```javascript
import { logger } from '../utils/logger.js';

/**
 * Get distinct manufacturers from systems table
 */
export async function getManufacturers(supabase) {
  const requestLogger = logger.createRequestLogger();

  try {
    const { data, error } = await supabase
      .from('systems')
      .select('manufacturer_norm')
      .not('manufacturer_norm', 'is', null)
      .order('manufacturer_norm');

    if (error) throw error;

    // Get unique manufacturers
    const manufacturers = [...new Set(data.map(row => row.manufacturer_norm))];
    return manufacturers.sort();

  } catch (error) {
    requestLogger.error('Repository error fetching manufacturers', { error: error.message });
    throw error;
  }
}

/**
 * Get models for a specific manufacturer
 */
export async function getModelsByManufacturer(supabase, manufacturer) {
  const requestLogger = logger.createRequestLogger();

  try {
    const { data, error } = await supabase
      .from('systems')
      .select('model_norm')
      .eq('manufacturer_norm', manufacturer)
      .not('model_norm', 'is', null)
      .order('model_norm');

    if (error) throw error;

    const models = [...new Set(data.map(row => row.model_norm))];
    return models.sort();

  } catch (error) {
    requestLogger.error('Repository error fetching models', { error: error.message, manufacturer });
    throw error;
  }
}

/**
 * Search for system by manufacturer and model
 */
export async function findSystemByManufacturerModel(supabase, manufacturer, model) {
  const requestLogger = logger.createRequestLogger();

  try {
    const { data, error } = await supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, model_norm, description')
      .eq('manufacturer_norm', manufacturer)
      .eq('model_norm', model);

    if (error) throw error;

    return data;

  } catch (error) {
    requestLogger.error('Repository error searching systems', { error: error.message, manufacturer, model });
    throw error;
  }
}

/**
 * Get instances for a system
 */
export async function getInstancesByAssetUid(supabase, assetUid) {
  const requestLogger = logger.createRequestLogger();

  try {
    const { data, error } = await supabase
      .from('instances')
      .select('instance_uid, asset_uid, serial_number, location, instance_index')
      .eq('asset_uid', assetUid)
      .order('instance_index', { nullsFirst: false });

    if (error) throw error;

    return data || [];

  } catch (error) {
    requestLogger.error('Repository error fetching instances', { error: error.message, assetUid });
    throw error;
  }
}
```

**Step 1.2.2: Create Service Layer (Business Logic)**
Create: `/Users/brad/code/REIMAGINEDAPPV2/src/services/system-management.service.js`

**⚠️ CURSOR RULES COMPLIANCE:**
- Business logic ONLY - no direct DB access
- Calls repositories for data
- Can call existing services (getSystemSvc) but doesn't modify them

```javascript
import { getSystemSvc } from './systems.service.js';
import * as repo from '../repositories/system-management.repository.js';
import { logger } from '../utils/logger.js';

/**
 * Get list of all manufacturers
 */
export async function getManufacturersList(supabase) {
  const requestLogger = logger.createRequestLogger();

  try {
    requestLogger.info('Fetching manufacturers list');
    const manufacturers = await repo.getManufacturers(supabase);
    return { success: true, manufacturers };

  } catch (error) {
    requestLogger.error('Service error getting manufacturers', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Get models for a manufacturer
 */
export async function getModelsForManufacturer(supabase, manufacturer) {
  const requestLogger = logger.createRequestLogger();

  if (!manufacturer) {
    return { success: false, error: 'manufacturer is required' };
  }

  try {
    requestLogger.info('Fetching models', { manufacturer });
    const models = await repo.getModelsByManufacturer(supabase, manufacturer);
    return { success: true, models };

  } catch (error) {
    requestLogger.error('Service error getting models', { error: error.message, manufacturer });
    return { success: false, error: error.message };
  }
}

/**
 * Search for a system by manufacturer and model
 */
export async function searchSystem(supabase, manufacturer, model) {
  const requestLogger = logger.createRequestLogger();

  if (!manufacturer || !model) {
    return { success: false, error: 'manufacturer and model are required' };
  }

  try {
    requestLogger.info('Searching for system', { manufacturer, model });
    const systems = await repo.findSystemByManufacturerModel(supabase, manufacturer, model);
    return { success: true, systems };

  } catch (error) {
    requestLogger.error('Service error searching system', { error: error.message, manufacturer, model });
    return { success: false, error: error.message };
  }
}

/**
 * Get full system details with instances
 * Uses existing getSystemSvc + queries instances
 */
export async function getSystemWithInstances(supabase, assetUid) {
  const requestLogger = logger.createRequestLogger();

  if (!assetUid) {
    return { success: false, error: 'assetUid is required' };
  }

  try {
    requestLogger.info('Fetching system details', { assetUid });

    // ✅ ALLOWED: Calling existing service (not modifying)
    const systemData = await getSystemSvc(assetUid);

    // Get instances from repository
    const instances = await repo.getInstancesByAssetUid(supabase, assetUid);

    return {
      success: true,
      system: {
        ...systemData,
        instances
      }
    };

  } catch (error) {
    requestLogger.error('Service error getting system with instances', { error: error.message, assetUid });
    return { success: false, error: error.message };
  }
}
```

**Step 1.2.3: Create Route Layer (HTTP Endpoints)**
Create: `/Users/brad/code/REIMAGINEDAPPV2/src/routes/system-management.route.js`

**⚠️ CURSOR RULES COMPLIANCE:**
- Routes are THIN - no I/O or business logic
- Only calls services (never repositories directly)
- Returns standard format: `{ success, data?, error?, requestId? }`

```javascript
import { Router } from 'express';
import * as service from '../services/system-management.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

// GET /api/system-management/manufacturers
router.get('/manufacturers', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();

  try {
    // ✅ CURSOR RULES: Route calls service (not repository)
    const result = await service.getManufacturersList(req.supabase);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error,
        requestId: requestLogger.requestId
      });
    }

    res.json({
      success: true,
      manufacturers: result.manufacturers,
      requestId: requestLogger.requestId
    });

  } catch (error) {
    requestLogger.error('Route error fetching manufacturers', { error: error.message });
    next(error);
  }
});

// GET /api/system-management/models?manufacturer=Fortress
router.get('/models', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();
  const { manufacturer } = req.query;

  if (!manufacturer) {
    return res.status(400).json({
      success: false,
      error: 'manufacturer query parameter is required',
      requestId: requestLogger.requestId
    });
  }

  try {
    // ✅ CURSOR RULES: Route calls service (not repository)
    const result = await service.getModelsForManufacturer(req.supabase, manufacturer);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error,
        requestId: requestLogger.requestId
      });
    }

    res.json({
      success: true,
      models: result.models,
      requestId: requestLogger.requestId
    });

  } catch (error) {
    requestLogger.error('Route error fetching models', { error: error.message });
    next(error);
  }
});

// GET /api/system-management/search?manufacturer=Fortress&model=FX-7
router.get('/search', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();
  const { manufacturer, model } = req.query;

  if (!manufacturer || !model) {
    return res.status(400).json({
      success: false,
      error: 'manufacturer and model query parameters are required',
      requestId: requestLogger.requestId
    });
  }

  try {
    // ✅ CURSOR RULES: Route calls service (not repository)
    const result = await service.searchSystem(req.supabase, manufacturer, model);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error,
        requestId: requestLogger.requestId
      });
    }

    res.json({
      success: true,
      systems: result.systems,
      requestId: requestLogger.requestId
    });

  } catch (error) {
    requestLogger.error('Route error searching systems', { error: error.message });
    next(error);
  }
});

// GET /api/system-management/:assetUid
router.get('/:assetUid', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();
  const { assetUid } = req.params;

  try {
    // ✅ CURSOR RULES: Route calls service (not repository)
    const result = await service.getSystemWithInstances(req.supabase, assetUid);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error,
        requestId: requestLogger.requestId
      });
    }

    res.json({
      success: true,
      system: result.system,
      requestId: requestLogger.requestId
    });

  } catch (error) {
    requestLogger.error('Route error fetching system details', { error: error.message });
    next(error);
  }
});

export default router;
```

**Summary of Phase 1 Architecture:**
- ✅ Repository: `system-management.repository.js` - All DB queries
- ✅ Service: `system-management.service.js` - Business logic
- ✅ Route: `system-management.route.js` - HTTP endpoints
- ✅ Follows cursor rules: routes → services → repositories
- ✅ Standard response format: `{ success, data?, error?, requestId? }`
- ✅ Uses logger (no console.log)
- ✅ Calls existing `getSystemSvc()` without modifying it

**Step 1.2.4: Register Routes in App**
Edit: `/Users/brad/code/REIMAGINEDAPPV2/src/start.js` (or wherever routes are registered)

**⚠️ ZERO REGRESSION REMINDER:**
- This is the ONLY existing file you're allowed to modify
- ADD EXACTLY TWO LINES (import + route registration)
- DO NOT modify any other existing code in this file

```javascript
// ✅ ALLOWED: Add this import at the top with other imports
import systemManagementRoutes from './routes/system-management.route.js';

// ✅ ALLOWED: Add this ONE line where other routes are registered
// (Find the section with app.use('/api/...', ...) statements)
app.use('/api/system-management', systemManagementRoutes);

// ❌ DO NOT modify any other lines in this file
```

**Step 1.2.3: Update HTML to Use New Endpoints**
Edit: `/Users/brad/code/REIMAGINEDAPPV2/src/public/systems.html`

Find these functions and update the fetch URLs:

```javascript
// Line ~250: Update loadManufacturers()
async function loadManufacturers() {
    try {
        const response = await fetch('/api/system-management/manufacturers');
        // ... rest of code unchanged
    }
}

// Line ~270: Update loadModels()
async function loadModels() {
    // ... existing code
    const response = await fetch(`/api/system-management/models?manufacturer=${encodeURIComponent(manufacturer)}`);
    // ... rest unchanged
}

// Line ~300: Update loadSystemData()
async function loadSystemData() {
    // ... existing code
    const searchResponse = await fetch(`/api/system-management/search?manufacturer=${encodeURIComponent(manufacturer)}&model=${encodeURIComponent(model)}`);
    // ... then ...
    const response = await fetch(`/api/system-management/${assetUid}`);
    // ... rest unchanged
}
```

**Step 1.2.4: Disable All Save/Create Buttons**
Add to HTML in `<script>` section:

```javascript
// Add this to init() function
function init() {
    // Disable save buttons in Phase 1
    const saveButton = document.querySelector('.btn-primary');
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.title = 'Save functionality coming in Phase 4';
        saveButton.style.opacity = '0.5';
        saveButton.style.cursor = 'not-allowed';
    }

    // Disable "New System" button
    const newSystemBtn = document.getElementById('newSystemBtn');
    if (newSystemBtn) {
        newSystemBtn.disabled = true;
        newSystemBtn.title = 'Create functionality coming in Phase 4';
        newSystemBtn.style.opacity = '0.5';
        newSystemBtn.style.cursor = 'not-allowed';
    }

    // Disable instance add buttons
    const addInstanceBtn = document.querySelector('.add-instance-btn');
    if (addInstanceBtn) {
        addInstanceBtn.disabled = true;
        addInstanceBtn.style.opacity = '0.5';
        addInstanceBtn.style.cursor = 'not-allowed';
    }

    await loadManufacturers();
}
```

#### 1.3 Testing Checklist

**Manual Testing Steps:**
1. ✅ Start server: `npm run dev`
2. ✅ Navigate to: `http://localhost:3000/systems.html`
3. ✅ Click "Find/Edit System" button
4. ✅ Verify manufacturer dropdown populates
5. ✅ Select a manufacturer (e.g., "Fortress")
6. ✅ Verify model dropdown populates with models for that manufacturer
7. ✅ Select a model (e.g., "FX-7")
8. ✅ Verify system form displays with all fields populated
9. ✅ Verify instances section shows serial_number/location pairs
10. ✅ Verify "Save" button is disabled
11. ✅ Verify "New System" button is disabled
12. ✅ Verify "+Add Instance" button is disabled

**Expected Data Display:**
- Asset UUID shown in gray box at top
- All system fields populated from database
- Instances listed with serial/location pairs
- All form fields are EDITABLE (but save is disabled)

**Known Issues to Document:**
- [ ] List any display issues here
- [ ] List any data loading issues here
- [ ] List any UI/UX concerns here

### Phase 1 Completion Criteria
- [ ] Can select manufacturer/model dropdowns
- [ ] System data displays correctly in form
- [ ] Instances display in variable-height section
- [ ] All save/create buttons are disabled
- [ ] No console errors in browser
- [ ] Page matches Apple-inspired design of existing pages

**CHECKPOINT:** Once all criteria met, document findings and proceed to Phase 2

---

## Phase 2: Database Discovery (PENDING)

### Goal
Run SQL queries to discover all validation rules, constraints, and data patterns before building write operations.

### SQL Queries to Run

**Query 2.1: Check for Unique Constraints**
```sql
SELECT
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    tc.constraint_type
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
WHERE tc.table_schema = 'public'
    AND tc.table_name IN ('systems', 'instances')
    AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
ORDER BY tc.table_name, tc.constraint_name;
```

**Expected Results:**
- systems: UNIQUE on (manufacturer_norm, model_norm) - ✅ Known
- systems: PRIMARY KEY on asset_uid - ✅ Known
- instances: PRIMARY KEY on instance_uid - ✅ Known
- instances: [ DOCUMENT ANY OTHER UNIQUE CONSTRAINTS HERE ]

**Query 2.2: Serial Number Patterns**
```sql
-- Check if serial numbers have consistent patterns
SELECT
    serial_number,
    LENGTH(serial_number) as length,
    serial_number ~ '^[A-Z0-9-]+$' as is_alphanumeric,
    COUNT(*) as count
FROM instances
WHERE serial_number IS NOT NULL
GROUP BY serial_number, LENGTH(serial_number)
ORDER BY count DESC, length DESC
LIMIT 50;

-- Check for duplicate serial numbers (cross-system)
SELECT serial_number, COUNT(*) as duplicate_count
FROM instances
WHERE serial_number IS NOT NULL
GROUP BY serial_number
HAVING COUNT(*) > 1;
```

**Document Results Here:**
- Serial number format pattern: [ TO BE FILLED ]
- Max length observed: [ TO BE FILLED ]
- Are duplicates allowed across systems? [ YES/NO - TO BE FILLED ]
- Validation rule to implement: [ TO BE FILLED ]

**Query 2.3: Location Patterns**
```sql
-- Understand location value patterns
SELECT
    location,
    COUNT(*) as frequency,
    LENGTH(location) as length
FROM instances
WHERE location IS NOT NULL
GROUP BY location
ORDER BY frequency DESC
LIMIT 30;
```

**Document Results Here:**
- Common location formats: [ TO BE FILLED - e.g., "Deck 3, Port", "Engine Room", etc. ]
- Is location free-text or restricted values? [ TO BE FILLED ]
- Max length observed: [ TO BE FILLED ]
- Validation rule to implement: [ TO BE FILLED ]

**Query 2.4: System/Subsystem Values from spec_lexicon**
```sql
-- Check if spec_lexicon has system/subsystem definitions
SELECT
    parameter_name,
    parameter_value,
    COUNT(*) as usage_count
FROM spec_lexicon
WHERE parameter_name ILIKE '%system%'
    OR parameter_name ILIKE '%subsystem%'
GROUP BY parameter_name, parameter_value
ORDER BY parameter_name, usage_count DESC;

-- Also check what system values are currently in use
SELECT system_norm, COUNT(*) as count
FROM systems
WHERE system_norm IS NOT NULL
GROUP BY system_norm
ORDER BY count DESC;

SELECT subsystem_norm, COUNT(*) as count
FROM systems
WHERE subsystem_norm IS NOT NULL
GROUP BY subsystem_norm
ORDER BY count DESC;
```

**Document Results Here:**
- Is spec_lexicon used for system values? [ YES/NO - TO BE FILLED ]
- Current system_norm values in use: [ TO BE FILLED ]
- Current subsystem_norm values in use: [ TO BE FILLED ]
- Should we use dropdown or free text for system? [ TO BE FILLED ]
- Should we use dropdown or free text for subsystem? [ TO BE FILLED ]

**Query 2.5: Instance Index Patterns**
```sql
-- Understand instance_index usage
SELECT
    asset_uid,
    COUNT(*) as instance_count,
    ARRAY_AGG(instance_index ORDER BY instance_index) as indices,
    MAX(instance_index) as max_index
FROM instances
WHERE instance_index IS NOT NULL
GROUP BY asset_uid
ORDER BY instance_count DESC
LIMIT 20;

-- Check for gaps in indices
SELECT
    asset_uid,
    instance_index,
    serial_number,
    location
FROM instances
WHERE asset_uid IN (
    SELECT asset_uid FROM instances
    WHERE instance_index IS NOT NULL
    GROUP BY asset_uid
    HAVING COUNT(*) > 1
)
ORDER BY asset_uid, instance_index
LIMIT 50;
```

**Document Results Here:**
- Is instance_index used? [ YES/NO - TO BE FILLED ]
- Does it start at 0 or 1? [ TO BE FILLED ]
- Are there gaps in sequences? [ TO BE FILLED ]
- Should we auto-increment on insert? [ TO BE FILLED ]
- Validation rule to implement: [ TO BE FILLED ]

**Query 2.6: Check Constraints on Systems Table**
```sql
SELECT
    con.conname AS constraint_name,
    con.contype AS constraint_type,
    pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
    AND rel.relname = 'systems'
    AND con.contype = 'c';  -- CHECK constraints
```

**Document Results Here:**
- CHECK constraints found: [ TO BE FILLED ]
- Field validation rules: [ TO BE FILLED ]

**Query 2.7: NULL/NOT NULL Analysis**
```sql
-- Already have this from previous queries:
-- systems table: manufacturer_norm (required), model_norm (required), all others nullable
-- instances table: instance_uid (required), asset_uid (required), all others nullable

-- Double-check field usage to determine business rules
SELECT
    COUNT(*) FILTER (WHERE manufacturer_norm IS NULL) as null_manufacturer,
    COUNT(*) FILTER (WHERE model_norm IS NULL) as null_model,
    COUNT(*) FILTER (WHERE description IS NULL) as null_description,
    COUNT(*) FILTER (WHERE manual_url IS NULL) as null_manual_url,
    COUNT(*) FILTER (WHERE oem_page IS NULL) as null_oem_page,
    COUNT(*) FILTER (WHERE system_norm IS NULL) as null_system,
    COUNT(*) FILTER (WHERE subsystem_norm IS NULL) as null_subsystem,
    COUNT(*) as total_rows
FROM systems;
```

**Document Results Here:**
- Which fields are consistently populated? [ TO BE FILLED ]
- Which fields are rarely used? [ TO BE FILLED ]
- Should any nullable fields become required in UI? [ TO BE FILLED ]

### Phase 2 Deliverable: Validation Rules Document

Create: `/Users/brad/code/REIMAGINEDAPPV2/SYSTEM_MANAGEMENT_VALIDATION_RULES.md`

```markdown
# System Management Validation Rules

## Systems Table

### Required Fields (NOT NULL in DB)
- `manufacturer_norm` (text)
- `model_norm` (text)

### Unique Constraints
- `(manufacturer_norm, model_norm)` must be unique

### Field Validation Rules

**manufacturer_norm:**
- Required: YES
- Format: [ FROM QUERY 2.7 ]
- Max length: [ FROM DATA ]
- Validation: Non-empty string

**model_norm:**
- Required: YES
- Format: [ FROM QUERY 2.7 ]
- Max length: [ FROM DATA ]
- Validation: Non-empty string

**system_norm:**
- Required: NO
- Allowed values: [ FROM QUERY 2.4 - dropdown or free text ]
- Validation: [ TO BE FILLED ]

**subsystem_norm:**
- Required: NO
- Allowed values: [ FROM QUERY 2.4 - dropdown or free text ]
- Validation: [ TO BE FILLED ]

**description:**
- Required: NO
- Max length: [ FROM DATA ]
- Validation: Free text

**manual_url:**
- Required: NO
- Format: Valid URL (https?://.*)
- Validation: URL format check

**oem_page:**
- Required: NO
- Format: Valid URL (https?://.*)
- Validation: URL format check

**canonical_model_id:**
- Required: NO
- Format: [ FROM DATA ]
- Validation: [ TO BE FILLED ]

**spec_keywords:**
- Required: NO
- Format: [ FROM DATA ]
- Validation: [ TO BE FILLED ]

**synonyms_fts:**
- Required: NO
- Format: [ FROM DATA ]
- Validation: [ TO BE FILLED ]

**synonyms_human:**
- Required: NO
- Format: [ FROM DATA ]
- Validation: [ TO BE FILLED ]

## Instances Table

### Required Fields (NOT NULL in DB)
- `instance_uid` (UUID - auto-generated)
- `asset_uid` (UUID - foreign key)

### Field Validation Rules

**serial_number:**
- Required: NO
- Format: [ FROM QUERY 2.2 ]
- Uniqueness: [ FROM QUERY 2.2 - per system or global? ]
- Validation: [ TO BE FILLED ]

**location:**
- Required: NO
- Format: [ FROM QUERY 2.3 - free text or restricted? ]
- Max length: [ FROM QUERY 2.3 ]
- Validation: [ TO BE FILLED ]

**instance_index:**
- Required: NO
- Format: Integer
- Auto-increment: [ FROM QUERY 2.5 - YES/NO ]
- Validation: [ TO BE FILLED ]

## Business Rules

1. **System Creation:**
   - [ TO BE FILLED based on queries ]

2. **Instance Management:**
   - [ TO BE FILLED based on queries ]

3. **Deletion Rules:**
   - Systems: [ TO BE FILLED ]
   - Instances: Archive to instances_archived table

4. **Update Rules:**
   - Can manufacturer/model be changed? [ TO BE FILLED ]
   - What happens to instances if system is deleted? CASCADE (from schema)
```

### Phase 2 Completion Criteria
- [ ] All SQL queries executed and results documented
- [ ] `SYSTEM_MANAGEMENT_VALIDATION_RULES.md` created and filled out
- [ ] Business rules confirmed with stakeholder
- [ ] Decision made on all "TO BE FILLED" items

**CHECKPOINT:** Review validation rules before proceeding to Phase 3

---

## Phase 3: Backend Write Routes (PENDING)

### Goal
Implement CREATE, UPDATE, DELETE operations with full validation based on Phase 2 discoveries.

### File to Modify
Continue editing: `/Users/brad/code/REIMAGINEDAPPV2/src/routes/system-management.route.js`

### Implementation Checklist

#### 3.1: Create instances_archived Table

**SQL Migration to Run:**
```sql
-- Create archive table for soft-deleted instances
CREATE TABLE IF NOT EXISTS instances_archived (
    instance_uid UUID PRIMARY KEY,
    asset_uid UUID NOT NULL,
    serial_number TEXT,
    location TEXT,
    system_norm TEXT,
    subsystem_norm TEXT,
    manufacturer_norm TEXT,
    model_norm TEXT,
    canonical_model_id TEXT,
    instance_index INTEGER,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_by TEXT,
    deletion_reason TEXT
);

-- Index for querying archived instances by system
CREATE INDEX idx_instances_archived_asset_uid ON instances_archived(asset_uid);

-- Index for querying recent archives
CREATE INDEX idx_instances_archived_archived_at ON instances_archived(archived_at DESC);
```

**Run this in Supabase SQL Editor**
- [ ] Migration executed
- [ ] Table created successfully
- [ ] Indexes created

#### 3.2: Implement POST /api/system-management/systems (Create)

Add to `system-management.route.js`:

```javascript
// POST /api/system-management/systems
// Body: { system: { manufacturer_norm, model_norm, ... }, instances: [...] }
// Returns: { success: true, asset_uid: "...", message: "System created" }
router.post('/systems', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();
  const { system, instances } = req.body;

  try {
    // VALIDATION STEP 1: Required fields
    if (!system.manufacturer_norm || !system.model_norm) {
      return res.status(400).json({
        success: false,
        message: 'manufacturer_norm and model_norm are required',
        errors: {
          manufacturer_norm: !system.manufacturer_norm ? 'Required field' : null,
          model_norm: !system.model_norm ? 'Required field' : null
        }
      });
    }

    // VALIDATION STEP 2: URL format validation
    const urlErrors = {};
    if (system.manual_url && !isValidUrl(system.manual_url)) {
      urlErrors.manual_url = 'Invalid URL format';
    }
    if (system.oem_page && !isValidUrl(system.oem_page)) {
      urlErrors.oem_page = 'Invalid URL format';
    }

    if (Object.keys(urlErrors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'URL validation failed',
        errors: urlErrors
      });
    }

    // VALIDATION STEP 3: [ ADD MORE BASED ON PHASE 2 FINDINGS ]
    // e.g., system_norm allowed values check
    // e.g., canonical_model_id format check

    // VALIDATION STEP 4: Check uniqueness (manufacturer_norm + model_norm)
    const { data: existing, error: checkError } = await req.supabase
      .from('systems')
      .select('asset_uid')
      .eq('manufacturer_norm', system.manufacturer_norm)
      .eq('model_norm', system.model_norm)
      .maybeSingle();

    if (checkError) throw checkError;

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'System already exists with this manufacturer and model',
        errors: {
          manufacturer_norm: 'Duplicate combination',
          model_norm: 'Duplicate combination'
        }
      });
    }

    // Generate UUID for new system
    const { v4: uuidv4 } = await import('uuid');
    const assetUid = uuidv4();

    requestLogger.info('Creating new system', {
      assetUid,
      manufacturer: system.manufacturer_norm,
      model: system.model_norm
    });

    // INSERT system
    const systemData = {
      asset_uid: assetUid,
      manufacturer_norm: system.manufacturer_norm,
      model_norm: system.model_norm,
      system_norm: system.system_norm || null,
      subsystem_norm: system.subsystem_norm || null,
      canonical_model_id: system.canonical_model_id || null,
      description: system.description || null,
      manual_url: system.manual_url || null,
      oem_page: system.oem_page || null,
      spec_keywords: system.spec_keywords || null,
      synonyms_fts: system.synonyms_fts || null,
      synonyms_human: system.synonyms_human || null
    };

    const { error: insertError } = await req.supabase
      .from('systems')
      .insert([systemData]);

    if (insertError) throw insertError;

    // INSERT instances (if provided)
    if (instances && instances.length > 0) {
      const instanceRecords = instances.map((inst, index) => ({
        instance_uid: uuidv4(),
        asset_uid: assetUid,
        serial_number: inst.serial_number || null,
        location: inst.location || null,
        instance_index: index + 1  // [ ADJUST BASED ON PHASE 2 - 0-based or 1-based? ]
      }));

      const { error: instancesError } = await req.supabase
        .from('instances')
        .insert(instanceRecords);

      if (instancesError) throw instancesError;

      requestLogger.info('Created instances', {
        assetUid,
        instanceCount: instanceRecords.length
      });
    }

    res.status(201).json({
      success: true,
      asset_uid: assetUid,
      message: 'System created successfully'
    });

  } catch (error) {
    requestLogger.error('Error creating system', { error: error.message });
    next(error);
  }
});

// Helper function for URL validation
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}
```

#### 3.3: Implement PUT /api/system-management/:assetUid (Update)

Add to `system-management.route.js`:

```javascript
// PUT /api/system-management/:assetUid
// Body: { system: { manufacturer_norm, model_norm, ... }, instances: [...] }
// Returns: { success: true, message: "System updated" }
router.put('/:assetUid', async (req, res, next) => {
  const requestLogger = logger.createRequestLogger();
  const { assetUid } = req.params;
  const { system, instances } = req.body;

  try {
    // VALIDATION STEP 1: Check system exists
    const { data: existingSystem, error: fetchError } = await req.supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, model_norm')
      .eq('asset_uid', assetUid)
      .single();

    if (fetchError || !existingSystem) {
      return res.status(404).json({
        success: false,
        message: 'System not found'
      });
    }

    // VALIDATION STEP 2: Required fields
    if (!system.manufacturer_norm || !system.model_norm) {
      return res.status(400).json({
        success: false,
        message: 'manufacturer_norm and model_norm are required',
        errors: {
          manufacturer_norm: !system.manufacturer_norm ? 'Required field' : null,
          model_norm: !system.model_norm ? 'Required field' : null
        }
      });
    }

    // VALIDATION STEP 3: URL format validation
    const urlErrors = {};
    if (system.manual_url && !isValidUrl(system.manual_url)) {
      urlErrors.manual_url = 'Invalid URL format';
    }
    if (system.oem_page && !isValidUrl(system.oem_page)) {
      urlErrors.oem_page = 'Invalid URL format';
    }

    if (Object.keys(urlErrors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'URL validation failed',
        errors: urlErrors
      });
    }

    // VALIDATION STEP 4: Check uniqueness if manufacturer/model changed
    if (system.manufacturer_norm !== existingSystem.manufacturer_norm ||
        system.model_norm !== existingSystem.model_norm) {

      const { data: duplicate, error: checkError } = await req.supabase
        .from('systems')
        .select('asset_uid')
        .eq('manufacturer_norm', system.manufacturer_norm)
        .eq('model_norm', system.model_norm)
        .neq('asset_uid', assetUid)
        .maybeSingle();

      if (checkError) throw checkError;

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: 'Another system exists with this manufacturer and model',
          errors: {
            manufacturer_norm: 'Duplicate combination',
            model_norm: 'Duplicate combination'
          }
        });
      }
    }

    requestLogger.info('Updating system', { assetUid });

    // UPDATE system
    const systemData = {
      manufacturer_norm: system.manufacturer_norm,
      model_norm: system.model_norm,
      system_norm: system.system_norm || null,
      subsystem_norm: system.subsystem_norm || null,
      canonical_model_id: system.canonical_model_id || null,
      description: system.description || null,
      manual_url: system.manual_url || null,
      oem_page: system.oem_page || null,
      spec_keywords: system.spec_keywords || null,
      synonyms_fts: system.synonyms_fts || null,
      synonyms_human: system.synonyms_human || null
    };

    const { error: updateError } = await req.supabase
      .from('systems')
      .update(systemData)
      .eq('asset_uid', assetUid);

    if (updateError) throw updateError;

    // HANDLE INSTANCES: Compare existing vs new
    const { data: existingInstances, error: instancesFetchError } = await req.supabase
      .from('instances')
      .select('instance_uid, serial_number, location')
      .eq('asset_uid', assetUid);

    if (instancesFetchError) throw instancesFetchError;

    // Determine which instances to keep, add, or archive
    const { v4: uuidv4 } = await import('uuid');
    const incomingInstanceIds = instances
      .filter(inst => inst.instance_uid)
      .map(inst => inst.instance_uid);

    const existingInstanceIds = existingInstances.map(inst => inst.instance_uid);

    // Archive instances that were removed (not in incoming list)
    const toArchive = existingInstanceIds.filter(id => !incomingInstanceIds.includes(id));

    if (toArchive.length > 0) {
      // Get full instance data before archiving
      const instancesToArchive = existingInstances.filter(inst =>
        toArchive.includes(inst.instance_uid)
      );

      // Copy to archive table
      const archiveRecords = instancesToArchive.map(inst => ({
        ...inst,
        archived_at: new Date().toISOString(),
        archived_by: 'system-management-ui',  // [ REPLACE WITH ACTUAL USER IF AUTH EXISTS ]
        deletion_reason: 'Removed via system management UI'
      }));

      const { error: archiveError } = await req.supabase
        .from('instances_archived')
        .insert(archiveRecords);

      if (archiveError) {
        requestLogger.error('Failed to archive instances', { error: archiveError.message });
        // Continue anyway - don't block the update
      }

      // Delete from instances table
      const { error: deleteError } = await req.supabase
        .from('instances')
        .delete()
        .in('instance_uid', toArchive);

      if (deleteError) throw deleteError;

      requestLogger.info('Archived instances', {
        assetUid,
        archivedCount: toArchive.length
      });
    }

    // Update existing instances
    const toUpdate = instances.filter(inst => inst.instance_uid && incomingInstanceIds.includes(inst.instance_uid));

    for (const inst of toUpdate) {
      const { error: updateInstError } = await req.supabase
        .from('instances')
        .update({
          serial_number: inst.serial_number || null,
          location: inst.location || null
        })
        .eq('instance_uid', inst.instance_uid);

      if (updateInstError) throw updateInstError;
    }

    // Insert new instances (no instance_uid)
    const toInsert = instances.filter(inst => !inst.instance_uid);

    if (toInsert.length > 0) {
      const newInstances = toInsert.map((inst, index) => ({
        instance_uid: uuidv4(),
        asset_uid: assetUid,
        serial_number: inst.serial_number || null,
        location: inst.location || null,
        instance_index: existingInstances.length + index + 1  // [ ADJUST BASED ON PHASE 2 ]
      }));

      const { error: insertInstError } = await req.supabase
        .from('instances')
        .insert(newInstances);

      if (insertInstError) throw insertInstError;

      requestLogger.info('Added new instances', {
        assetUid,
        newCount: newInstances.length
      });
    }

    res.json({
      success: true,
      message: 'System updated successfully'
    });

  } catch (error) {
    requestLogger.error('Error updating system', { error: error.message });
    next(error);
  }
});
```

#### 3.4: Add Validation Middleware (Based on Phase 2 Findings)

Create: `/Users/brad/code/REIMAGINEDAPPV2/src/middleware/system-validation.middleware.js`

```javascript
// This file will be populated based on Phase 2 validation rules discovery

export function validateSystemData(req, res, next) {
  const { system } = req.body;
  const errors = {};

  // [ ADD VALIDATION BASED ON PHASE 2 FINDINGS ]
  // Example:
  // if (system.system_norm && !ALLOWED_SYSTEM_VALUES.includes(system.system_norm)) {
  //   errors.system_norm = 'Invalid system value';
  // }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors
    });
  }

  next();
}

export function validateInstanceData(req, res, next) {
  const { instances } = req.body;
  const errors = {};

  // [ ADD VALIDATION BASED ON PHASE 2 FINDINGS ]
  // Example:
  // Check serial number format
  // Check for duplicate serials

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Instance validation failed',
      errors
    });
  }

  next();
}
```

### Phase 3 Completion Criteria
- [ ] instances_archived table created
- [ ] POST /systems endpoint implemented with validation
- [ ] PUT /:assetUid endpoint implemented with validation
- [ ] Instance archival logic working
- [ ] All validation rules from Phase 2 applied
- [ ] Error responses include field-level error mapping
- [ ] Tested via Postman/curl (at least 5 test cases per endpoint)

**Test Cases to Document:**
1. Create system with valid data → Success
2. Create system with duplicate manufacturer/model → 409 Conflict
3. Create system with invalid URL → 400 Bad Request with field errors
4. Update system and add instance → Success
5. Update system and remove instance → Instance archived
6. [ ADD MORE BASED ON PHASE 2 RULES ]

**CHECKPOINT:** All routes tested and working before Phase 4

---

## Phase 4: Frontend Integration (PENDING)

### Goal
Connect the HTML UI to backend routes, enable save/create functionality, implement client-side validation.

### Implementation Checklist

#### 4.1: Enable Save/Create Buttons

Edit: `/Users/brad/code/REIMAGINEDAPPV2/src/public/systems.html`

**Remove disabled state from init() function:**
```javascript
function init() {
    // REMOVE or COMMENT OUT these lines from Phase 1:
    // saveButton.disabled = true;
    // newSystemBtn.disabled = true;
    // addInstanceBtn.disabled = true;

    await loadManufacturers();
}
```

#### 4.2: Implement Client-Side Validation (Mirror Backend)

Add to `systems.html` in `<script>` section:

```javascript
// Enhanced validation based on Phase 2 findings
function validateForm() {
    let isValid = true;
    const errors = [];

    // Clear previous errors
    document.querySelectorAll('.form-field').forEach(field => {
        field.classList.remove('error');
        const errorMsg = field.querySelector('.error-message');
        if (errorMsg) errorMsg.textContent = '';
    });

    // Required fields
    const manufacturerField = document.getElementById('manufacturerNorm');
    const modelField = document.getElementById('modelNorm');

    if (!manufacturerField.value.trim()) {
        markFieldError(manufacturerField, 'Manufacturer is required');
        errors.push('Manufacturer is required');
        isValid = false;
    }

    if (!modelField.value.trim()) {
        markFieldError(modelField, 'Model is required');
        errors.push('Model is required');
        isValid = false;
    }

    // URL validation
    const manualUrl = document.getElementById('manualUrl').value;
    const oemPage = document.getElementById('oemPage').value;

    if (manualUrl && !isValidUrl(manualUrl)) {
        markFieldError(document.getElementById('manualUrl'), 'Invalid URL format');
        errors.push('Manual URL must be a valid URL');
        isValid = false;
    }

    if (oemPage && !isValidUrl(oemPage)) {
        markFieldError(document.getElementById('oemPage'), 'Invalid URL format');
        errors.push('OEM Page must be a valid URL');
        isValid = false;
    }

    // [ ADD MORE VALIDATION RULES FROM PHASE 2 ]
    // Example: system_norm allowed values check
    const systemNorm = document.getElementById('systemNorm').value;
    // if (systemNorm && !ALLOWED_SYSTEMS.includes(systemNorm)) {
    //     markFieldError(document.getElementById('systemNorm'), 'Invalid system value');
    //     errors.push('System must be one of: ...');
    //     isValid = false;
    // }

    // Validate instances
    const instanceRows = document.querySelectorAll('.instance-row');
    instanceRows.forEach((row, index) => {
        const serial = row.querySelector('.serial-input').value.trim();
        const location = row.querySelector('.location-input').value.trim();

        // [ ADD INSTANCE VALIDATION FROM PHASE 2 ]
        // Example: Check serial number format
        // if (serial && !SERIAL_PATTERN.test(serial)) {
        //     markFieldError(row.querySelector('.serial-input'), 'Invalid serial format');
        //     errors.push(`Instance ${index + 1}: Invalid serial number format`);
        //     isValid = false;
        // }
    });

    return { isValid, errors };
}
```

#### 4.3: Implement Server Error Mapping

Add to `systems.html`:

```javascript
// Map server validation errors to form fields
function displayServerErrors(errors) {
    if (!errors || typeof errors !== 'object') {
        return;
    }

    // Map error keys to form field IDs
    const fieldMapping = {
        'manufacturer_norm': 'manufacturerNorm',
        'model_norm': 'modelNorm',
        'system_norm': 'systemNorm',
        'subsystem_norm': 'subsystemNorm',
        'canonical_model_id': 'canonicalModelId',
        'description': 'description',
        'manual_url': 'manualUrl',
        'oem_page': 'oemPage',
        'spec_keywords': 'specKeywords',
        'synonyms_fts': 'synonymsFts',
        'synonyms_human': 'synonymsHuman'
    };

    Object.keys(errors).forEach(errorKey => {
        const fieldId = fieldMapping[errorKey];
        if (fieldId) {
            const field = document.getElementById(fieldId);
            if (field) {
                markFieldError(field, errors[errorKey]);
            }
        }
    });
}

// Update saveSystem() to handle server errors
async function saveSystem() {
    const validation = validateForm();
    if (!validation.isValid) {
        showError(validation.errors.join(', '));
        return;
    }

    const saveButton = document.querySelector('.btn-primary');
    saveButton.classList.add('loading');

    try {
        // ... existing code to collect form data ...

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const result = await response.json();

        if (result.success) {
            // ... existing success handling ...
        } else {
            // Handle validation errors from server
            if (result.errors) {
                displayServerErrors(result.errors);
            }
            throw new Error(result.message || 'Failed to save system');
        }
    } catch (error) {
        console.error('Error saving system:', error);
        showError(error.message || 'Failed to save system');
    } finally {
        saveButton.classList.remove('loading');
    }
}
```

#### 4.4: Update API Endpoints in saveSystem()

Ensure saveSystem() uses correct endpoints:

```javascript
// Update these lines in saveSystem()
if (currentMode === 'new') {
    url = '/api/system-management/systems';  // ✅ Correct
    method = 'POST';
    // ... rest
} else {
    url = `/api/system-management/${currentSystemData.asset_uid}`;  // ✅ Correct
    method = 'PUT';
    // ... rest
}
```

#### 4.5: Handle Instance Deletion Tracking

Update instance removal to track deletions:

```javascript
// Track removed instances for archival
let removedInstances = [];

function removeInstanceRow(button) {
    const row = button.parentElement;
    const instanceUid = row.dataset.instanceUid;

    // If this was an existing instance, track it for deletion
    if (instanceUid) {
        removedInstances.push(instanceUid);
    }

    row.remove();
}

// Clear removed instances when switching modes
function setMode(mode) {
    // ... existing code ...
    removedInstances = [];
    // ... rest
}

// Include removed instances in update request
async function saveSystem() {
    // ... existing code ...

    if (currentMode === 'edit') {
        body = {
            system: systemData,
            instances: instances,
            removed_instances: removedInstances  // Send to backend for archival
        };
    }

    // ... rest
}
```

**Update backend to handle removed_instances:**
```javascript
// In PUT /:assetUid route
const { system, instances, removed_instances } = req.body;

// Archive explicitly removed instances
if (removed_instances && removed_instances.length > 0) {
    // Archive logic here
}
```

#### 4.6: Add Loading States

Enhance loading indicators:

```javascript
function setLoadingState(isLoading) {
    const saveButton = document.querySelector('.btn-primary');
    const cancelButton = document.querySelector('.btn-secondary');
    const formInputs = document.querySelectorAll('input, select, textarea, button');

    if (isLoading) {
        saveButton.classList.add('loading');
        formInputs.forEach(input => input.disabled = true);
    } else {
        saveButton.classList.remove('loading');
        formInputs.forEach(input => input.disabled = false);
    }
}

// Use in saveSystem()
async function saveSystem() {
    const validation = validateForm();
    if (!validation.isValid) {
        showError(validation.errors.join(', '));
        return;
    }

    setLoadingState(true);

    try {
        // ... save logic ...
    } finally {
        setLoadingState(false);
    }
}
```

### Phase 4 Completion Criteria
- [ ] Save button creates new systems successfully
- [ ] Update button modifies existing systems
- [ ] Instance add/remove/edit works correctly
- [ ] Client-side validation matches backend rules
- [ ] Server errors map to correct form fields with red X
- [ ] Loading states display during operations
- [ ] Success/error messages are clear and helpful
- [ ] Removed instances are archived (verify in instances_archived table)

**Test Cases:**
1. Create new system with instances → Success
2. Edit system, add instance → Instance added
3. Edit system, remove instance → Instance archived
4. Try to create duplicate system → Error with field highlights
5. Enter invalid URL → Error with red X on URL field
6. Submit with missing required fields → Errors shown
7. Edit and cancel → No changes saved
8. [ ADD MORE BASED ON EDGE CASES ]

**CHECKPOINT:** Full CRUD working end-to-end

---

## Phase 5: Testing & Polish (PENDING)

### Goal
Comprehensive testing, edge case handling, UX improvements.

### Testing Checklist

#### 5.1: Functional Testing

**Create Operations:**
- [ ] Create system with minimal data (only required fields)
- [ ] Create system with all fields populated
- [ ] Create system with instances
- [ ] Create system without instances
- [ ] Try to create duplicate manufacturer/model → Expect 409 error
- [ ] Create with invalid URLs → Expect validation errors
- [ ] Create with [ EDGE CASES FROM PHASE 2 ]

**Read Operations:**
- [ ] Load manufacturers dropdown
- [ ] Load models dropdown for each manufacturer
- [ ] Load system data into form
- [ ] Display instances correctly
- [ ] Handle systems with 0 instances
- [ ] Handle systems with 10+ instances

**Update Operations:**
- [ ] Update system fields only (no instance changes)
- [ ] Add new instance to existing system
- [ ] Remove instance from system → Verify archival
- [ ] Update instance data (serial/location)
- [ ] Change manufacturer/model (unique constraint)
- [ ] Update to duplicate manufacturer/model → Expect error
- [ ] Update with invalid data → Expect validation errors

**Delete Operations (Instance Archival):**
- [ ] Remove instance → Check instances_archived table
- [ ] Verify archived_at timestamp
- [ ] Verify archived_by field
- [ ] Verify deletion_reason field

#### 5.2: Edge Case Testing

- [ ] System with very long description (1000+ chars)
- [ ] System with special characters in fields
- [ ] Instance with empty serial_number
- [ ] Instance with empty location
- [ ] Instance with both fields empty (should be ignored?)
- [ ] Multiple instances with same serial number (allowed?)
- [ ] Network failure during save
- [ ] Concurrent edits (two users editing same system)
- [ ] Browser back button behavior
- [ ] Page reload with unsaved changes

#### 5.3: UI/UX Testing

- [ ] All buttons have hover states
- [ ] Error messages are clear and actionable
- [ ] Success messages auto-dismiss after 5s
- [ ] Form fields tab order is logical
- [ ] Dropdown arrow keys work
- [ ] Enter key submits form
- [ ] Escape key cancels edit
- [ ] Red X appears on correct fields
- [ ] Loading spinner shows during all async operations
- [ ] Page matches design of upload.html and admin.html

#### 5.4: Browser Compatibility

- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)
- [ ] Mobile Safari (iOS)
- [ ] Mobile Chrome (Android)

#### 5.5: Performance Testing

- [ ] Page load time < 2s
- [ ] Manufacturer dropdown loads < 500ms
- [ ] Model dropdown loads < 500ms
- [ ] System data loads < 1s
- [ ] Save operation < 2s
- [ ] Handle 50+ instances without UI lag

### Polish & Improvements

#### 5.6: UX Enhancements to Consider

- [ ] Add "unsaved changes" warning
- [ ] Add keyboard shortcuts (Ctrl+S to save)
- [ ] Add search/filter to manufacturer dropdown (if 50+ manufacturers)
- [ ] Add pagination to instances (if 20+ instances)
- [ ] Add confirmation dialog before removing instance
- [ ] Add "duplicate system" feature
- [ ] Add bulk instance import (CSV)
- [ ] Add instance export (CSV)

#### 5.7: Accessibility (Optional but Recommended)

- [ ] Add ARIA labels to form fields
- [ ] Add role attributes to interactive elements
- [ ] Ensure keyboard-only navigation works
- [ ] Add focus indicators
- [ ] Add screen reader announcements for errors
- [ ] Test with VoiceOver (Mac) or NVDA (Windows)

### Phase 5 Completion Criteria
- [ ] All functional tests pass
- [ ] All edge cases handled gracefully
- [ ] UI/UX is polished and consistent
- [ ] No console errors
- [ ] No accessibility violations
- [ ] Performance benchmarks met
- [ ] Documented known limitations (if any)

**CHECKPOINT:** Production deployment ready

---

## Phase 6: Documentation & Handoff (PENDING)

### Goal
Document the feature for future maintenance and team knowledge transfer.

### Documentation Checklist

#### 6.1: User Documentation

Create: `/Users/brad/code/REIMAGINEDAPPV2/docs/SYSTEM_MANAGEMENT_USER_GUIDE.md`

```markdown
# System Management User Guide

## Overview
The System Management page allows you to create, view, edit, and manage marine equipment systems and their instances.

## Accessing the Page
Navigate to: `http://localhost:3000/systems.html`

## Features

### Finding and Editing a System
1. Click "Find/Edit System" button
2. Select manufacturer from dropdown
3. Select model from dropdown
4. System details will load automatically
5. Edit any fields as needed
6. Add or remove instances
7. Click "Update System" to save changes

### Creating a New System
1. Click "New System" button
2. Fill in required fields:
   - Manufacturer (required)
   - Model (required)
3. Fill in optional fields as needed
4. Add instances (serial number + location pairs)
5. Click "Create System" to save

### Managing Instances
- Click "+ Add Instance" to add a new serial/location pair
- Click "✕" to remove an instance
- Removed instances are archived, not deleted

## Validation Rules
[ COPY FROM SYSTEM_MANAGEMENT_VALIDATION_RULES.md ]

## Common Errors
- "Duplicate combination": System already exists with this manufacturer/model
- "Invalid URL format": URL must start with http:// or https://
- "Required field": This field must be filled in

## Troubleshooting
[ ADD BASED ON PHASE 5 FINDINGS ]
```

#### 6.2: Developer Documentation

Create: `/Users/brad/code/REIMAGINEDAPPV2/docs/SYSTEM_MANAGEMENT_DEVELOPER_GUIDE.md`

```markdown
# System Management Developer Guide

## Architecture

### Frontend
- **File:** `src/public/systems.html`
- **Styling:** Uses `style.css` (Apple-inspired design)
- **Dependencies:** None (vanilla JS)

### Backend
- **File:** `src/routes/system-management.route.js`
- **Database Tables:**
  - `systems` (main equipment table)
  - `instances` (equipment instances)
  - `instances_archived` (soft-deleted instances)

## API Endpoints

### GET /api/system-management/manufacturers
Returns list of unique manufacturers.

**Response:**
```json
{
  "success": true,
  "manufacturers": ["Fortress", "Danforth", ...]
}
```

### GET /api/system-management/models?manufacturer=Fortress
Returns models for specified manufacturer.

**Response:**
```json
{
  "success": true,
  "models": ["FX-7", "FX-11", ...]
}
```

### GET /api/system-management/search?manufacturer=X&model=Y
Find system by manufacturer and model.

**Response:**
```json
{
  "success": true,
  "systems": [{ "asset_uid": "...", ... }]
}
```

### GET /api/system-management/:assetUid
Get full system details with instances.

**Response:**
```json
{
  "success": true,
  "system": {
    "asset_uid": "...",
    "manufacturer_norm": "...",
    "instances": [...]
  }
}
```

### POST /api/system-management/systems
Create new system with instances.

**Request:**
```json
{
  "system": {
    "manufacturer_norm": "...",
    "model_norm": "...",
    ...
  },
  "instances": [
    { "serial_number": "...", "location": "..." }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "asset_uid": "...",
  "message": "System created successfully"
}
```

### PUT /api/system-management/:assetUid
Update existing system and instances.

**Request:**
```json
{
  "system": { ... },
  "instances": [
    { "instance_uid": "...", "serial_number": "...", "location": "..." },
    { "serial_number": "...", "location": "..." }  // New instance (no uid)
  ],
  "removed_instances": ["instance_uid_1", "instance_uid_2"]
}
```

## Validation Rules
[ COPY FROM SYSTEM_MANAGEMENT_VALIDATION_RULES.md ]

## Database Schema

### systems table
[ COPY SCHEMA ]

### instances table
[ COPY SCHEMA ]

### instances_archived table
[ COPY SCHEMA ]

## Instance Archival Logic
When an instance is removed:
1. Full instance data copied to `instances_archived`
2. `archived_at` timestamp set to NOW()
3. `archived_by` set to user/system identifier
4. `deletion_reason` set to context
5. Instance deleted from `instances` table

## Future Enhancements
- [ ] Bulk import/export
- [ ] Instance history tracking
- [ ] System versioning
- [ ] Advanced search/filtering
- [ ] Audit log

## Maintenance Notes
- No changes made to existing `systems.route.js`
- All functionality isolated in `system-management.route.js`
- Safe to disable by removing route registration
```

#### 6.3: Code Comments

Add comprehensive comments to:
- [ ] `src/public/systems.html` (document complex functions)
- [ ] `src/routes/system-management.route.js` (document validation logic)
- [ ] Complex SQL queries

#### 6.4: Update Main README

Edit: `/Users/brad/code/REIMAGINEDAPPV2/README.md`

Add section:
```markdown
## System Management

Standalone page for managing marine equipment systems and instances.

**URL:** `http://localhost:3000/systems.html`

**Features:**
- Create/edit/view equipment systems
- Manage instances (serial numbers + locations)
- Full validation and error handling
- Instance archival (soft delete)

**Documentation:**
- User Guide: [docs/SYSTEM_MANAGEMENT_USER_GUIDE.md](docs/SYSTEM_MANAGEMENT_USER_GUIDE.md)
- Developer Guide: [docs/SYSTEM_MANAGEMENT_DEVELOPER_GUIDE.md](docs/SYSTEM_MANAGEMENT_DEVELOPER_GUIDE.md)
- Validation Rules: [SYSTEM_MANAGEMENT_VALIDATION_RULES.md](SYSTEM_MANAGEMENT_VALIDATION_RULES.md)
```

### Phase 6 Completion Criteria
- [ ] User guide created
- [ ] Developer guide created
- [ ] Code is well-commented
- [ ] README updated
- [ ] All documentation reviewed and accurate
- [ ] Handoff meeting completed (if applicable)

---

## Progress Tracking

### Quick Status Reference

| Phase | Status | Completion Date | Notes |
|-------|--------|-----------------|-------|
| Phase 0: Setup | ✅ Complete | 2025-09-30 | State tracking established |
| Phase 1: Read-Only UI | 🔄 In Progress | - | HTML code provided, needs route wiring |
| Phase 2: Database Discovery | ⏳ Pending | - | SQL queries ready to run |
| Phase 3: Backend Routes | ⏳ Pending | - | Waiting on Phase 2 validation rules |
| Phase 4: Frontend Integration | ⏳ Pending | - | Waiting on Phase 3 |
| Phase 5: Testing | ⏳ Pending | - | Waiting on Phase 4 |
| Phase 6: Documentation | ⏳ Pending | - | Waiting on Phase 5 |

### Current Blockers
1. **Phase 1:** Need to create `system-management.route.js` and wire up read-only endpoints
2. **Phase 2:** Need to run SQL queries in Supabase to discover validation rules
3. All subsequent phases blocked until Phase 1 & 2 complete

### Next Immediate Steps
1. ✅ Create `/Users/brad/code/REIMAGINEDAPPV2/src/routes/system-management.route.js`
2. ✅ Add read-only endpoints (manufacturers, models, search, get system)
3. ✅ Register route in app startup file
4. ✅ Update HTML to use new endpoints
5. ✅ Test Phase 1 - verify data displays correctly
6. ✅ Run Phase 2 SQL queries
7. ✅ Document validation rules

---

## Key Files Reference

### Files Created/Modified in This Project

| File | Purpose | Status |
|------|---------|--------|
| `src/public/systems.html` | Main UI page | ✅ Code provided |
| `src/routes/system-management.route.js` | Backend API routes | ⏳ To be created |
| `src/middleware/system-validation.middleware.js` | Validation logic | ⏳ To be created |
| `SYSTEM_MANAGEMENT_IMPLEMENTATION.md` | This progress tracker | ✅ Created |
| `SYSTEM_MANAGEMENT_VALIDATION_RULES.md` | Validation rules doc | ⏳ To be created in Phase 2 |
| `docs/SYSTEM_MANAGEMENT_USER_GUIDE.md` | User documentation | ⏳ To be created in Phase 6 |
| `docs/SYSTEM_MANAGEMENT_DEVELOPER_GUIDE.md` | Developer docs | ⏳ To be created in Phase 6 |

### Existing Files Referenced (DO NOT MODIFY)

**🚨 CRITICAL: These files are READ-ONLY for reference/calling only:**

- ❌ `src/routes/systems.route.js` - Existing route (REFERENCE ONLY, never modify)
- ❌ `src/services/systems.service.js` - Contains `getSystemSvc()` (CALL IT, never modify)
- ❌ `src/repositories/systems.repository.js` - Contains `searchSystems()` (REFERENCE ONLY)
- ❌ `src/public/style.css` - Shared styles (USE IT, never modify)
- ❌ `src/public/upload.html` - Design reference (READ ONLY)
- ❌ `src/public/admin.html` - Design reference (READ ONLY)
- ⚠️ `src/start.js` - App setup (ADD 2 LINES ONLY for route registration)

**Why this is non-negotiable:**
- Modifying these files risks breaking the chat system, upload functionality, admin panel
- Chat system depends on existing routes working unchanged
- Other users/features may be using these files
- Easier to debug if all System Management code is isolated

---

## Recovery Instructions (After Compacting)

If this conversation gets compacted and you lose context, follow these steps:

1. **Read this file:** `/Users/brad/code/REIMAGINEDAPPV2/SYSTEM_MANAGEMENT_IMPLEMENTATION.md`
2. **READ THE ZERO REGRESSION POLICY** at the top (CRITICAL!)
3. **Check Quick Status Reference** to see current phase
4. **Find "Next Immediate Steps"** section for what to do next
5. **Review validation rules** (if Phase 2 complete): `SYSTEM_MANAGEMENT_VALIDATION_RULES.md`
6. **Check the Current Blockers** section to understand dependencies
7. **Resume work** at the current phase's "Implementation Checklist"

### Critical Context to Remember
- 🚨 **ZERO REGRESSION POLICY** - DO NOT modify any existing files (except 2 lines in start.js)
- This is a **standalone page** - no existing code modifications
- Instance deletion uses **archive table** (instances_archived)
- All routes go in **system-management.route.js** (NEW file only)
- Validation rules must be discovered in **Phase 2** before building writes
- HTML code already provided - see `src/public/systems.html`
- Can CALL existing functions (getSystemSvc, etc.) but NEVER modify them

---

## Session Notes

### Session 1: 2025-09-30 (Initial Planning)
- Defined 6-phase implementation plan
- Created detailed progress tracker
- Decided on instance archival strategy
- Generated HTML UI code
- 🚨 **ENFORCED ZERO REGRESSION POLICY** - Added critical warnings throughout document
- Ready to begin Phase 1 implementation

**Key Decisions:**
- Archive instances to `instances_archived` table (not hard delete)
- No feature flag needed (dev environment)
- Build read-only UI first, then discover validation rules
- 🚨 **ZERO REGRESSION:** Use existing `getSystemSvc()` by CALLING it, NEVER modify
- 🚨 **ZERO REGRESSION:** Only create NEW files, only modify start.js (2 lines)
- All new code isolated in `system-management.route.js` and `systems.html`

**Critical Constraints Established:**
- ❌ Cannot modify: systems.route.js, systems.service.js, systems.repository.js
- ✅ Can import and call: getSystemSvc(), logger, etc.
- ⚠️ Can add 2 lines to: start.js (import + route registration)
- ✅ Can create: system-management.route.js, systems.html, validation middleware

**Next Session:** Create `system-management.route.js` and wire up Phase 1 read-only endpoints

---

## Appendix: Code Snippets

### A1: HTML Form Field IDs Reference
```
manufacturerNorm
modelNorm
systemNorm
subsystemNorm
canonicalModelId
description
manualUrl
oemPage
specKeywords
synonymsFts
synonymsHuman
```

### A2: Database Column Names Reference
```
systems table:
- asset_uid (PK)
- manufacturer_norm (required)
- model_norm (required)
- system_norm
- subsystem_norm
- canonical_model_id
- description
- manual_url
- oem_page
- spec_keywords
- synonyms_fts
- synonyms_human

instances table:
- instance_uid (PK)
- asset_uid (FK -> systems.asset_uid)
- serial_number
- location
- instance_index

instances_archived table:
- (same as instances) +
- archived_at
- archived_by
- deletion_reason
```

### A3: Validation Error Response Format
```json
{
  "success": false,
  "message": "Human-readable error message",
  "errors": {
    "field_name": "Field-specific error message",
    "another_field": "Another error"
  }
}
```

### A4: Success Response Format
```json
{
  "success": true,
  "asset_uid": "uuid-here",  // Only on create
  "message": "Operation successful"
}
```

---

---

## Compliance Checklist

Before completing ANY phase, verify compliance with all rules:

### ✅ Zero Regression Policy
- [ ] NO modifications to existing route files
- [ ] NO modifications to existing service files
- [ ] NO modifications to existing repository files
- [ ] Only added 2 lines to start.js (import + route registration)
- [ ] All new code in NEW files only

### ✅ Cursor Rules (.cursorrules)
- [ ] Architecture follows: routes → services → repositories
- [ ] Routes are thin (no DB access, no business logic)
- [ ] Services contain business logic only
- [ ] Repositories contain all DB/I/O operations
- [ ] NO direct route → repository imports
- [ ] All responses use: `{ success, data?, error?, requestId? }`
- [ ] Using `logger` (NO console.log)
- [ ] Reading env via `src/config/env.js`
- [ ] Files under 250 lines (soft limit)
- [ ] Using `*.route.js` naming (not `*.routes.js`)

### ✅ Security & Quality
- [ ] Input validation with Zod at route edge
- [ ] No hardcoded values (asked for .env additions)
- [ ] CORS and security headers enabled
- [ ] Request ID in all responses

### ✅ Documentation (Phase 6)
- [ ] SQL migration for schema changes
- [ ] Zod schemas for new endpoints
- [ ] Tests for new functionality
- [ ] Developer documentation
- [ ] User documentation

**If ANY checkbox is unchecked, STOP and fix before proceeding!**

---

**END OF DOCUMENT**

*Last Updated: 2025-09-30*
*Current Phase: Phase 1 - Read-Only UI*
*Next Checkpoint: UX/Data Display Validation*
*Compliance: Zero Regression + Cursor Rules*
