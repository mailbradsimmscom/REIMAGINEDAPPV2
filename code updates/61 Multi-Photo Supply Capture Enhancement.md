# 61 Multi-Photo Supply Capture Enhancement

**Started:** 2025-12-13
**Status:** COMPLETE (with known issue)
**Branch:** Stable-v4-Working
**Last Updated:** 2025-12-13

---

## Overview

Enhance the supplies photo capture to support multiple photos per item, analyzed together in a single AI call for better accuracy. Add configurable vision model (GPT-5.2), extract quantity and additional insights, fix two UI bugs.

---

## Scope

### Features
1. Multi-photo capture (1-3+ photos analyzed together)
2. Configurable vision model via `VISION_MODEL` env var (default: gpt-5.2)
3. Quantity extraction → pre-fill Current Stock field
4. Additional insights → append to Notes field

### Bug Fixes
1. Unit dropdown truncation in wizard
2. Can't manually add systems in wizard Screen 3

---

## Files to Modify

| File | Changes | Status |
|------|---------|--------|
| `src/config/env.js` | Add VISION_MODEL to Zod schema | ✅ Done |
| `src/clients/openai.client.js` | Add oaiVisionMulti(), use env var | ✅ Done |
| `src/services/supplies/ai-analysis.service.js` | Add multi-photo, quantity, insights | ✅ Done |
| `src/routes/supplies/supplies.route.js` | Add POST /analyze-photos endpoint | ✅ Done |
| `src/public/js/supplies/supplies-wizard.js` | Multi-photo state, handlers, browse systems | ✅ Done |
| `src/public/supplies.html` | Photo UI, browse systems section | ✅ Done |
| `src/public/css/supplies-wizard.css` | Unit dropdown fix, browse systems styles | ✅ Done |
| `.env` | Add VISION_MODEL=gpt-5.2 | ⬜ USER ACTION |

### Tests
| File | Changes | Status |
|------|---------|--------|
| `tests/integration/openai-client.test.js` | Add oaiVisionMulti test | ⬜ Pending |
| `tests/integration/supplies-ai.test.js` | NEW - AI endpoint tests | ⬜ Pending |
| `tests/e2e/page-interactions.json` | Add wizard elements | ⬜ Pending |

---

## Implementation Progress

### Phase 1: Configurable Vision Model
**Status:** ✅ COMPLETE

**Tasks:**
- [x] Add VISION_MODEL to env.js Zod schema
- [x] Update openai.client.js to use env var in oaiVision()
- [ ] Add VISION_MODEL=gpt-5.2 to .env (USER ACTION REQUIRED)

**Code Changes:**

**src/config/env.js** (line 20):
```javascript
VISION_MODEL: z.string().optional().default('gpt-4o'),  // Vision model for photo analysis
```

**src/clients/openai.client.js** (line 189):
```javascript
const openaiModel = model || env.VISION_MODEL || 'gpt-4o';
```

**USER ACTION:** Add to .env:
```
VISION_MODEL=gpt-5.2
```

---

### Phase 2: Multi-Image Vision API
**Status:** ✅ COMPLETE

**Tasks:**
- [x] Add oaiVisionMulti() function to openai.client.js
- [x] Support array of image URLs
- [x] Export new function

**Code Changes:**

**src/clients/openai.client.js** (lines 221-280):
```javascript
export async function oaiVisionMulti({ system, user, imageUrls, model, maxOutputTokens }) {
  // Uses VISION_MODEL env var
  // Accepts imageUrls array
  // Higher token limit (800) and timeout (45s) for multi-image
  // Spreads all images into content array
}
```

Added to default export (line 299)

---

### Phase 3: Multi-Photo Analysis Service
**Status:** ✅ COMPLETE

**Tasks:**
- [x] Add analyzeMultipleSupplyPhotos() to ai-analysis.service.js
- [x] Update prompt for multi-image analysis
- [x] Add quantity_visible and additional_insights extraction
- [x] Export new function

**Code Changes:**

**src/services/supplies/ai-analysis.service.js**:
- Import: Added `oaiVisionMulti` to imports (line 8)
- New function: `analyzeMultipleSupplyPhotos()` (lines 262-398)
- Export: Added to default export (line 555)

**New fields extracted:**
- `quantity_visible` - count of items or "Pack of X"
- `additional_insights` - material, specs, condition, etc.
- `photos_analyzed` - number of photos processed

---

### Phase 4: Backend Endpoint
**Status:** ✅ COMPLETE

**Tasks:**
- [x] Add POST /api/supplies/analyze-photos route
- [x] Accept imageBase64Array in request body
- [x] Return merged analysis result
- [x] Add max 5 photos limit

**Code Changes:**

**src/routes/supplies/supplies.route.js** (lines 399-458):
```javascript
router.post('/analyze-photos', async (req, res) => {
  // Accepts: { imageBase64Array: ["data:image/...", ...] }
  // Max 5 photos
  // Returns: { item_name, brand, part_number, quantity_visible, additional_insights, ... }
});
```

---

### Phase 5: Frontend State (Wizard)
**Status:** ✅ COMPLETE

**Tasks:**
- [x] Change state.photo to state.photos array
- [x] Update handlePhotoSelected() for multiple files
- [x] Add removePhoto(index) method
- [x] Add analyzeAllPhotos() method (uses multi-photo endpoint)
- [x] Update prefillFormFromAI() for quantity, unit, insights
- [x] Update reset() to clear photos array
- [x] Add selectUnitByName() for fuzzy unit matching

**Code Changes:**

**src/public/js/supplies/supplies-wizard.js**:
- State: `state.photos = []` with `analysisStatus` (lines 12-29)
- `handlePhotoSelected()` - handles multiple files (lines 246-293)
- `readFileAsBase64()` - helper for async file reading (lines 295-303)
- `renderPhotoThumbnails()` - shows thumbnail strip (lines 305-343)
- `removePhoto(index)` - removes photo and re-analyzes (lines 345-368)
- `analyzeAllPhotos()` - uses multi-photo or single endpoint (lines 370-462)
- `prefillFormFromAI()` - handles quantity_visible, additional_insights, suggested_unit (lines 523-576)
- `selectUnitByName()` - fuzzy unit matching (lines 579-595)

---

### Phase 6: Frontend UI (Wizard)
**Status:** ✅ COMPLETE

**Tasks:**
- [x] Change file input to accept multiple
- [x] Add photo thumbnails container
- [x] Update placeholder text
- [x] Add thumbnail CSS

**Code Changes:**

**src/public/supplies.html** (lines 355-365):
- Added `multiple` attribute to file input
- Added `wizardPhotoThumbnails` container
- Updated placeholder text

**src/public/css/supplies-wizard.css** (lines 197-249):
- `.wizard-photo-thumbnails` - thumbnail strip container
- `.wizard-photo-thumb` - individual thumbnail
- `.wizard-photo-remove` - remove button on thumbnails

---

### Phase 7: Photo Upload Flow
**Status:** ✅ COMPLETE

**Tasks:**
- [x] Update saveSupply() to loop through photos array
- [x] Upload each photo with incrementing index
- [x] Show progress per photo

**Code Changes:**

**src/public/js/supplies/supplies-wizard.js** (lines 701-738):
- Loop through `state.photos` array
- Upload each with `photoIndex: i + 1`
- Show "Uploading photo X/Y..." progress

---

### Bug Fix 1: Unit Dropdown Truncation
**Status:** ✅ COMPLETE

**Tasks:**
- [x] Add CSS for text-overflow on select
- [x] Ensure option text doesn't truncate

**Code Changes:**

**src/public/css/supplies-wizard.css** (lines 340-357):
```css
.wizard-form .form-group select {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  min-width: 0;
  box-sizing: border-box;
}

.wizard-form .form-group select option {
  white-space: normal;
  word-wrap: break-word;
}
```

---

### Bug Fix 3: Gallery Shows All Photos
**Status:** ✅ COMPLETE

**Problem:** Clicking photo in list only showed first photo, not all photos

**Files:**
- `src/public/js/supplies/supplies-list.js` - Pass all photos to viewPhoto()
- `src/public/css/supplies.css` - Photo count badge styles

**Changes:**
- Table view and grid view now pass full photos array to gallery
- Added photo count badge (shows "3" etc) on thumbnails with multiple photos
- Added `escapeAttr()` helper for safe JSON in onclick

---

### Bug Fix 2: Browse Systems in Wizard
**Status:** ✅ COMPLETE

**Tasks:**
- [x] Add "Browse All Systems" section to Screen 3 HTML
- [x] Add loadAllSystems() method
- [x] Add filterSystems() method
- [x] Add renderAllSystemsList() method
- [x] Add updateSystemCheckboxes() for sync
- [x] Add CSS for browse section

**Code Changes:**

**src/public/supplies.html** (lines 506-515):
- Added browse section with search input and list container

**src/public/js/supplies/supplies-wizard.js**:
- `loadAllSystems()` - fetches /api/supplies/systems (lines 699-719)
- `renderAllSystemsList()` - renders system cards (lines 721-739)
- `filterSystems()` - filters by search query (lines 741-762)
- `updateSystemCheckboxes()` - syncs checkbox state (lines 675-695)
- Event listener for search input (lines 111-113)
- Calls loadAllSystems() on step 3 (line 173)

**src/public/css/supplies-wizard.css** (lines 457-512):
- `.wizard-systems-browse` - container styles
- `.wizard-systems-search` - search input styles
- `.wizard-all-systems-list` - scrollable list styles

---

### Testing Updates
**Status:** ⬜ Not Started

**Tasks:**
- [ ] Add oaiVisionMulti test to openai-client.test.js
- [ ] Create supplies-ai.test.js with endpoint tests
- [ ] Update page-interactions.json with wizard elements

**Code Changes:**
```
(Will be documented after implementation)
```

---

## AI Field Mapping

| AI Extracts | → | Form Field | Status |
|-------------|---|------------|--------|
| `item_name` | → | Item Name * | ✅ Existing |
| `brand` | → | Brand | ✅ Existing |
| `part_number` | → | Part # | ✅ Existing |
| `suggested_category` | → | Category * | ✅ Existing |
| `suggested_unit` | → | Unit | ✅ Existing |
| `quantity_visible` | → | Current Stock * | 🆕 NEW |
| `additional_insights` | → | Notes | 🆕 NEW |

---

## Technical Decisions

1. **AI Strategy:** Single merged analysis (all photos in one GPT call)
2. **Photo UX:** Free-form multiple photos (not guided prompts)
3. **Vision Model:** Configurable via VISION_MODEL env var, default GPT-5.2
4. **Backward Compatibility:** Single photo still works via existing endpoint

---

## Rollout Plan

1. Deploy with VISION_MODEL=gpt-4o first (no behavior change)
2. Test multi-photo flow with GPT-4o
3. Switch to VISION_MODEL=gpt-5.2
4. Compare accuracy/speed/cost

---

## Session Recovery Notes

If context is compacted, read this file to resume:

1. Check "Implementation Progress" section for current phase
2. Look at "Status" column in "Files to Modify" table
3. Each phase has detailed tasks with checkboxes
4. Code changes are documented after each phase completes

**Key files to read for context:**
- `src/services/supplies/ai-analysis.service.js` - Current AI analysis
- `src/public/js/supplies/supplies-wizard.js` - Current wizard state
- `src/clients/openai.client.js` - Current vision API client
