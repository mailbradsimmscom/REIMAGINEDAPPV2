# Supplies Admin Page - Dropdown Management

**Date:** 2025-11-29 (Updated)
**Status:** ✅ Complete
**Branch:** Agent-Enablement

---

## Overview

Creating an admin page to manage supply dropdown options (Categories, Units, Locations) and converting Location from text autocomplete to a proper dropdown. Also adding inline "quick-add" buttons so users can add new categories/locations without leaving the form.

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

### 6. Admin Link on Supplies Page
**Status:** ✅ DONE

### 7. Update supplies-api.js for Locations
**Status:** ✅ DONE

### 8. Update Location Fields to Select Dropdowns
**Status:** ✅ DONE (all forms converted)

### 9. Quick-Add "+" Buttons for Dropdowns
**Status:** ✅ DONE (2025-11-29)

Added inline quick-add buttons next to Category and Location dropdowns so users can add new items without leaving the form.

**Files Modified:**
- `src/public/supplies.html` - Added quick-add modal + "+" buttons next to dropdowns
- `src/public/css/supplies.css` - Added styles for `.select-with-add`, `.btn-quick-add`, `.quick-add-modal`
- `src/public/js/supplies/supplies-form.js` - Added `refreshCategories()` and `refreshLocations()` methods
- `src/public/js/supplies/supplies-wizard.js` - Added `refreshCategories()` and `refreshLocations()` methods

**How it works:**
1. User taps "+" next to Category or Location dropdown
2. Modal pops up (form data preserved underneath)
3. User enters name and taps "Add"
4. API saves new item
5. Dropdown refreshes and auto-selects the new item
6. User continues filling out form

### 10. Manual System Selection in Related Systems Modal
**Status:** ✅ DONE (2025-11-29)

Added ability to browse and manually select from all available systems alongside AI suggestions.

**Files Modified:**
- `src/routes/supplies/supplies.route.js` - Added `GET /api/supplies/systems` endpoint (moved before `/:id` to fix routing)
- `src/public/supplies.html` - Updated modal with two sections (AI Suggestions + Browse All)
- `src/public/css/supplies.css` - Added styles for browse section (`.system-browse-item`, `.system-browse-checkbox`, etc.)
- `src/public/js/supplies/supplies-ai.js` - Added `loadAllSystems()`, `renderAllSystems()`, `filterSystems()` methods

**How it works:**
1. Modal opens and loads AI suggestions + all systems in parallel
2. AI suggestions appear at top with confidence scores
3. "Browse All Systems" section shows searchable list of all boat systems
4. User can select from either section (checkboxes work independently)
5. "Accept Selected Systems" combines all selections and passes to form

---

## What's Left To Do (Summary)

### LOWER PRIORITY:
1. Fix `populateLocationFilter()` in supplies-list.js if not already done
2. Full end-to-end testing
3. Push to git

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

### Systems Endpoint (for Related Systems modal)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/supplies/systems | List all boat systems for manual selection |
| POST | /api/supplies/suggest-systems | AI-powered system suggestions |

---

## Files Changed (Summary)

### New Files:
1. `src/routes/supplies/config.route.js` - CRUD API for categories, units, locations
2. `src/public/supplies-admin.html` - Admin page HTML
3. `src/public/js/supplies/supplies-admin.js` - Admin page JS

### Modified Files:
1. `src/routes/supplies/index.js` - Mount config routes
2. `src/routes/supplies/supplies.route.js` - Added `/systems` endpoint (before `/:id` route)
3. `src/app.js` - Add /supplies/admin route
4. `src/public/supplies.html` - Admin link + location selects + quick-add modal + system sections
5. `src/public/css/supplies.css` - Quick-add styles + browse systems styles
6. `src/public/js/supplies/supplies-api.js` - getLocations() uses new endpoint
7. `src/public/js/supplies/supplies-form.js` - populateLocationSelect() + refresh methods
8. `src/public/js/supplies/supplies-wizard.js` - loadLocations() + refresh methods
9. `src/public/js/supplies/supplies-ai.js` - Added browse all systems functionality
