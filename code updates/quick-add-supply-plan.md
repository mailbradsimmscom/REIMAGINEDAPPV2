# Quick-Add Supply Capture Tool — Implementation Plan

**Date:** 2026-05-02
**Status:** IMPLEMENTED
**Goal:** Fast mobile capture of supplies with name, photos, quantity, and location. Reconciliation happens later during off-season.

---

## What It Does

A mobile-friendly page at `/supplies/quick-add` for rapidly capturing supply items while walking the boat. No category, no AI, no system linking — just:

1. Type the item name
2. Snap 1-5 photos
3. Enter quantity
4. Pick location from dropdown
5. Save → form resets → next item

The page also includes a collapsible **Location Manager** so you can build/edit your location list before and during the capture session.

---

## Isolation Principle

This feature is fully isolated from production data. It uses:

- Its own table: `supply_audit_items` (not `supplies`)
- Its own locations table: `supply_audit_locations` (not `supply_locations`)
- Its own storage bucket: `supply-audit` (not `documents`)
- Its own RPC function: `rename_audit_location`
- Its own route file: `quick-add.route.js`

**Zero production tables are read from or written to.** Removal is: drop 2 tables, drop 1 function, delete 3 files, remove 3 lines, delete 1 bucket.

---

## User Pre-Requisites

Before the code ships, you need to:

1. **Create the `supply-audit` bucket** in Supabase Dashboard → Storage → New Bucket
   - Set to **public** (so photo URLs are directly accessible, same as existing `documents` bucket)

---

## Database

### New table: `supply_audit_locations`

Own location list for the audit tool. No connection to production `supply_locations`.

**Migration file:** `scripts/migrations/006_supply_audit.sql` (run in Supabase SQL editor — DONE)

```sql
-- UP

-- Audit locations (separate from production supply_locations)
CREATE TABLE supply_audit_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit items (separate from production supplies)
CREATE TABLE supply_audit_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name TEXT NOT NULL,
  current_stock NUMERIC DEFAULT 1 CHECK (current_stock >= 0),
  location TEXT,
  photos TEXT[] DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_supply_audit_items_location ON supply_audit_items(location);
CREATE INDEX idx_supply_audit_items_created_at ON supply_audit_items(created_at);

-- Atomic rename: cascades to audit items only
CREATE OR REPLACE FUNCTION rename_audit_location(location_id UUID, new_name TEXT)
RETURNS JSON AS $$
DECLARE
  old_name TEXT;
  trimmed_name TEXT;
  audit_count INT;
BEGIN
  -- Trim and validate
  trimmed_name := TRIM(new_name);
  IF trimmed_name = '' OR trimmed_name IS NULL THEN
    RAISE EXCEPTION 'Location name cannot be empty';
  END IF;

  -- Check for duplicate name
  IF EXISTS (SELECT 1 FROM supply_audit_locations WHERE name = trimmed_name AND id != location_id) THEN
    RAISE EXCEPTION 'A location with that name already exists';
  END IF;

  -- Get current name
  SELECT name INTO old_name FROM supply_audit_locations WHERE id = location_id;
  IF old_name IS NULL THEN
    RAISE EXCEPTION 'Location not found';
  END IF;

  -- Rename in audit locations
  UPDATE supply_audit_locations SET name = trimmed_name, updated_at = NOW() WHERE id = location_id;

  -- Cascade to audit items
  UPDATE supply_audit_items SET location = trimmed_name, updated_at = NOW() WHERE location = old_name;
  GET DIAGNOSTICS audit_count = ROW_COUNT;

  RETURN json_build_object(
    'old_name', old_name,
    'new_name', trimmed_name,
    'audit_items_updated', audit_count
  );
END;
$$ LANGUAGE plpgsql;

-- DOWN (rollback)
-- DROP FUNCTION IF EXISTS rename_audit_location(UUID, TEXT);
-- DROP TABLE supply_audit_items;
-- DROP TABLE supply_audit_locations;
```

---

## New Files (3)

### 1. `src/public/supplies-quick-add.html`

The page itself. Mobile-first layout with two sections:

**Location Manager (collapsible, starts expanded on first visit)**
- Lists all locations from `supply_audit_locations` table
- Each row shows: location name, usage count (from `supply_audit_items`), edit/delete buttons
- Delete button is **disabled** if any items in `supply_audit_items` use that location
- Rename is always allowed — cascades atomically via RPC to `supply_audit_locations` and `supply_audit_items`
- "Add Location" input + button at top
- Inline rename: click edit → name becomes text input → save/cancel
- Duplicate name errors surfaced from RPC as toast

**Quick Capture Form**
- Item name — text input, autofocus after save
- Photos — tap to open camera/picker, thumbnail strip, remove button per photo, max 5
- Quantity — number input, default 1
- Location — `<select>` dropdown, populated from location manager list above
- Save button — full width, prominent

**After save:**
- Success toast with item name
- Form clears (name, photos, quantity reset to 1)
- Location stays selected (you're probably capturing multiple items in the same spot)
- Focus returns to item name input

### 2. `src/public/js/supplies/supplies-quick-add.js`

All frontend logic in one file. No imports from other supplies JS modules.

**Photo resizing (client-side, before upload):**
- On capture, each photo is resized via `<canvas>` before storing in state
- Max dimension: 1200px (long edge, aspect ratio preserved)
- Output format: JPEG at 0.7 quality
- Result: ~150-400KB per photo instead of 5-10MB raw camera files
- Well within the existing app-wide `express.json({ limit: '10mb' })` at `src/app.js:62`

```js
function resizeImage(base64, maxDimension = 1200, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = base64;
  });
}
```

**LocationManager class:**
- `loadLocations()` — `GET /api/supplies/quick-add/locations`
- `addLocation(name)` — `POST /api/supplies/quick-add/locations`
- `renameLocation(id, newName)` — `PUT /api/supplies/quick-add/locations/:id` (calls RPC)
- `deleteLocation(id)` — `DELETE /api/supplies/quick-add/locations/:id`
- `renderLocations()` — renders list with edit/delete states
- Tracks usage counts to enable/disable delete

**QuickAddForm class:**
- `handlePhotoCapture(files)` — reads files as base64, resizes via canvas, renders thumbnails
- `removePhoto(index)` — removes from array and re-renders
- `save()` — validates (name required, location required), POSTs item, uploads photos sequentially, resets form
- `reset()` — clears name, photos, quantity back to 1, keeps location selected

### 3. `src/routes/supplies/quick-add.route.js`

Self-contained Express router. Uses Supabase client directly — no dependency on existing services or repositories.

**Endpoints:**

| Method | Path | What it does |
|--------|------|-------------|
| `GET` | `/locations` | List all audit locations with usage counts |
| `POST` | `/locations` | Create new audit location |
| `PUT` | `/locations/:id` | Rename — calls `rename_audit_location` RPC |
| `DELETE` | `/locations/:id` | Delete (blocked if used in `supply_audit_items`) |
| `POST` | `/item` | Create audit item in `supply_audit_items` |
| `POST` | `/item/:id/photo` | Upload photo to `supply-audit` bucket |

**Location rename — atomic cascade via RPC:**
```js
const { data, error } = await supabase.rpc('rename_audit_location', {
  location_id: id,
  new_name: newName
});
// Returns { old_name, new_name, audit_items_updated }
// RPC handles trim, empty check, duplicate check, and updated_at
```

**Location delete — blocked if in use:**
```js
const { count } = await supabase
  .from('supply_audit_items')
  .select('*', { count: 'exact', head: true })
  .eq('location', locationName);

if (count > 0) return res.status(409).json({ error: 'Location is in use' });
```

**Create audit item — `POST /item`:**

Backend validation:
- `item_name` required, trimmed, must be non-empty after trim
- `current_stock` must be >= 0 (also enforced by CHECK constraint)
- `location` trimmed if present

```js
// Request body
{
  item_name: "Racor 2010PM Filter",
  current_stock: 3,
  location: "Stbd Engine Room",
  notes: null  // optional
}

// INSERT into supply_audit_items table
// Return { success: true, data: { id, item_name, ... } }
```

**Upload photo — `POST /item/:id/photo`:**

Backend validation:
- `photoIndex` must be integer 1-5
- `imageBase64` must match `data:image/(jpeg|png|webp);base64,...`
- Decoded buffer must be <= 5MB

```js
// Request body (already resized client-side)
{
  imageBase64: "data:image/jpeg;base64,...",
  photoIndex: 1
}

// Upload to supply-audit bucket: {id}-{index}.jpg
// Update supply_audit_items.photos array with new URL
// Return { success: true, data: { url, photos } }
```

---

## Existing File Changes (minimal)

### `src/routes/supplies/index.js`
Add one import + one mount line. **Mount before the catch-all `/` route** to avoid conflicts:
```js
import quickAddRouter from './quick-add.route.js';

// Mount BEFORE the catch-all supplies route
router.use('/quick-add', quickAddRouter);
router.use('/config', configRoute);
router.use('/', suppliesRoute);
```

### `src/app.js`
Add page route using the existing `fs.readFile` pattern (matching `src/app.js:284-291`):
```js
app.get('/supplies/quick-add', async (req, res) => {
  try {
    const content = await fs.readFile(join(process.cwd(), 'src/public/supplies-quick-add.html'));
    res.setHeader('content-type', 'text/html');
    res.end(content);
  } catch (error) {
    res.status(404).json({ error: 'Quick-add page not found' });
  }
});
```

### `src/public/other-links.html`
Add link in "Tools & Utilities" section:
```html
<a href="/supplies/quick-add" class="link-item">
    <div class="link-icon">📋</div>
    <div class="link-content">
        <div class="link-title">Supply Audit</div>
        <div class="link-description">Quick-capture supplies with photos & locations</div>
    </div>
    <div class="link-arrow">›</div>
</a>
```

---

## What This Does NOT Touch

- `supplies` table — no reads, no writes, no mutations
- `supply_locations` table — no reads, no writes, no mutations
- `supply_categories` table — not used
- `supply_units` table — not used
- `supplies.service.js` — no changes
- `supplies.repository.js` — no changes
- `photo-storage.service.js` — no changes
- `supplies-form.js` — no changes
- `supplies-wizard.js` — no changes
- `config.route.js` — no changes

---

## Removal Plan

If this feature doesn't survive:

1. Delete `src/public/supplies-quick-add.html`
2. Delete `src/public/js/supplies/supplies-quick-add.js`
3. Delete `src/routes/supplies/quick-add.route.js`
4. Remove mount lines from `src/routes/supplies/index.js`
5. Remove page route from `src/app.js`
6. Remove link from `src/public/other-links.html`
7. Delete the `supply-audit` bucket from Supabase Storage
8. In Supabase SQL editor (order matters):
   ```sql
   DROP FUNCTION IF EXISTS rename_audit_location(UUID, TEXT);
   DROP TABLE supply_audit_items;
   DROP TABLE supply_audit_locations;
   ```
9. Delete migration file

---

## Data Flow Diagram

```
[Mobile Browser]
      |
      |-- GET /supplies/quick-add ----------- serves HTML page
      |
      |-- GET  /api/supplies/quick-add/locations --- list audit locations + usage counts
      |-- POST /api/supplies/quick-add/locations --- add new audit location
      |-- PUT  /api/supplies/quick-add/locations/:id --- rename via RPC (audit tables only)
      |-- DELETE /api/supplies/quick-add/locations/:id --- delete (blocked if used in audit items)
      |
      |-- POST /api/supplies/quick-add/item --- create audit item
      |     \-- INSERT into supply_audit_items (name, qty, location)
      |         Backend validates: name non-empty, stock >= 0
      |
      \-- POST /api/supplies/quick-add/item/:id/photo --- upload each photo
            |-- Client-side resize: 1200px max, JPEG 0.7 quality (~150-400KB)
            |-- Backend validates: photoIndex 1-5, valid image mime, <= 5MB decoded
            |-- Supabase Storage: supply-audit/{id}-{n}.jpg
            \-- UPDATE supply_audit_items.photos array
```

---

## Resolved Questions

1. **Full isolation** — own tables (`supply_audit_items`, `supply_audit_locations`), own bucket (`supply-audit`), own RPC (`rename_audit_location`). Zero production tables touched.
2. **Location rename** — always allowed. Cascades atomically via RPC across `supply_audit_locations` and `supply_audit_items` only. RPC trims input, rejects empty/duplicate names, updates `updated_at`.
3. **Location delete** — blocked if location is used in `supply_audit_items`.
4. **Auth** — open, no admin token required.
5. **Navigation** — link added to `src/public/other-links.html` in "Tools & Utilities" section.
6. **Photo size** — resized client-side via canvas before upload. Max 1200px long edge, JPEG 0.7 quality. ~150-400KB per photo, well within existing 10mb JSON limit.
7. **Backend validation** — item name trimmed and non-empty, stock >= 0 (also DB CHECK constraint), photo index 1-5, valid image mime type, decoded size <= 5MB.
8. **Migration** — single migration file with both tables, RPC function, indexes, and DOWN/rollback section. Drop order: function first, then tables.
9. **updated_at** — present on both tables. Set by RPC on rename cascade. Useful during reconciliation.
10. **Route mount order** — `/quick-add` mounted before catch-all `/` in `src/routes/supplies/index.js`.
11. **Page serving** — uses existing `fs.readFile` pattern from `src/app.js:284`.
