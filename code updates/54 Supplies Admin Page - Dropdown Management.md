# Supplies Admin Page - Dropdown Management

**Date:** 2025-11-27
**Status:** In Progress (90% complete)
**Branch:** Stable-v4-Working

---

## Overview

Creating an admin page to manage supply dropdown options (Categories, Units, Locations) and converting Location from text autocomplete to a proper dropdown.

---

## What's Been Completed

### 1. Database: `supply_locations` Table
**Status:** ✅ DONE

Created in Supabase with SQL:
```sql
CREATE TABLE supply_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Migrated existing locations from supplies table
-- RLS policies added
```

### 2. Backend: Config Routes for CRUD
**Status:** ✅ DONE

**File:** `src/routes/supplies/config.route.js` (NEW)

Endpoints created:
- `GET /api/supplies/config/categories` - List all
- `POST /api/supplies/config/categories` - Create
- `PUT /api/supplies/config/categories/:id` - Update
- `DELETE /api/supplies/config/categories/:id` - Delete (checks if in use)

Same pattern for `/units` and `/locations`

**File:** `src/routes/supplies/index.js` (MODIFIED)
- Added: `import configRoute from './config.route.js';`
- Added: `router.use('/config', configRoute);`

### 3. Admin HTML Page
**Status:** ✅ DONE

**File:** `src/public/supplies-admin.html` (NEW)

Features:
- Back link to /supplies
- Three tabs: Categories, Units, Locations
- Add form at top of each tab
- List of items with Edit/Delete buttons
- Inline editing
- Toast notifications
- Mobile navigation footer

### 4. Admin JavaScript
**Status:** ✅ DONE

**File:** `src/public/js/supplies/supplies-admin.js` (NEW)

Functions:
- Tab switching
- CRUD for all three tables
- Inline editing mode
- Toast notifications
- Confirmation on delete

### 5. Route in app.js
**Status:** ✅ DONE

**File:** `src/app.js` (MODIFIED)

Added route:
```javascript
app.get('/supplies/admin', async (req, res) => {
  // serves supplies-admin.html
});
```

### 6. Admin Link on Supplies Page
**Status:** ✅ DONE

**File:** `src/public/supplies.html` (MODIFIED)

Added under type tabs:
```html
<div style="margin-bottom: 1rem;">
  <a href="/supplies/admin">⚙️ Manage Categories, Units & Locations</a>
</div>
```

### 7. Update supplies-api.js for Locations
**Status:** ✅ DONE

**File:** `src/public/js/supplies/supplies-api.js` (MODIFIED)

Changed `getLocations()` to fetch from new endpoint:
```javascript
async getLocations() {
  const response = await fetch('/api/supplies/config/locations');
  // returns array of {id, name, description} objects
}
```

### 8. Update Location Fields to Select Dropdowns
**Status:** ⚠️ PARTIALLY DONE

#### supplies.html - Desktop Modal
**Status:** ✅ DONE
- Changed from `<input type="text" list="locationsList">` + `<datalist>`
- To: `<select id="location" class="form-select">`

#### supplies.html - Mobile Wizard
**Status:** ✅ DONE
- Changed from `<input type="text" list="wizardLocationsList">` + `<datalist>`
- To: `<select id="wizardLocation" class="form-select">`

#### supplies-form.js
**Status:** ✅ DONE
- Renamed `populateLocationsDatalist()` to `populateLocationSelect()`
- Updated to populate `<select>` with options

#### supplies-wizard.js
**Status:** ✅ DONE
- Updated `loadLocations()` to populate `<select>` instead of `<datalist>`

#### supplies-list.js - Location Filter
**Status:** ❌ NOT DONE - NEEDS UPDATE

**File:** `src/public/js/supplies/supplies-list.js`
**Line ~169:** `populateLocationFilter()` needs update to handle object format

Current code:
```javascript
populateLocationFilter() {
  const select = document.getElementById('locationFilter');
  if (!select) return;

  let html = '<option value="">All Locations</option>';
  this.locations.forEach(loc => {
    html += `<option value="${loc}">${loc}</option>`;  // <-- expects string
  });

  select.innerHTML = html;
}
```

**Needs to be:**
```javascript
populateLocationFilter() {
  const select = document.getElementById('locationFilter');
  if (!select) return;

  let html = '<option value="">All Locations</option>';
  this.locations.forEach(loc => {
    const name = typeof loc === 'string' ? loc : loc.name;
    html += `<option value="${name}">${name}</option>`;
  });

  select.innerHTML = html;
}
```

---

## What's Left To Do

### 1. Fix `populateLocationFilter()` in supplies-list.js
**Priority:** HIGH

Update line ~169-178 to handle object format from API.

### 2. Test Locally
- Visit `/supplies` - verify admin link appears
- Visit `/supplies/admin` - test all CRUD operations
- Add/Edit supply - verify location dropdown works
- Verify location filter on list page works

### 3. Push to Git
```bash
git add .
git commit -m "Add supplies admin page for managing dropdowns"
git push
```

---

## Files Changed (Summary)

### New Files:
1. `src/routes/supplies/config.route.js` - CRUD API for categories, units, locations
2. `src/public/supplies-admin.html` - Admin page HTML
3. `src/public/js/supplies/supplies-admin.js` - Admin page JS

### Modified Files:
1. `src/routes/supplies/index.js` - Mount config routes
2. `src/app.js` - Add /supplies/admin route
3. `src/public/supplies.html` - Admin link + location selects
4. `src/public/js/supplies/supplies-api.js` - getLocations() uses new endpoint
5. `src/public/js/supplies/supplies-form.js` - populateLocationSelect()
6. `src/public/js/supplies/supplies-wizard.js` - loadLocations() for select
7. `src/public/js/supplies/supplies-list.js` - **NEEDS FIX** for populateLocationFilter()

---

## API Endpoints Reference

### Config Endpoints (all under /api/supplies/config)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /categories | List all categories |
| POST | /categories | Create category |
| PUT | /categories/:id | Update category |
| DELETE | /categories/:id | Delete category |
| GET | /units | List all units |
| POST | /units | Create unit |
| PUT | /units/:id | Update unit |
| DELETE | /units/:id | Delete unit |
| GET | /locations | List all locations |
| POST | /locations | Create location |
| PUT | /locations/:id | Update location |
| DELETE | /locations/:id | Delete location |

---

## Data Model Notes

- `supply_categories` table: id, category_name, category_path
- `supply_units` table: id, unit_name, abbreviation
- `supply_locations` table: id, name, description (NEW)
- `supplies.location` is still TEXT field (stores location name, not FK)

---

## Resume After Compact

1. Open `src/public/js/supplies/supplies-list.js`
2. Find `populateLocationFilter()` around line 169
3. Update to handle object format (see code above)
4. Test locally at `http://192.168.20.106:3000/supplies`
5. Test admin at `http://192.168.20.106:3000/supplies/admin`
6. Push to git when working
