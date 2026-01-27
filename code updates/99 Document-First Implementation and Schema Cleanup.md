# 99 Document-First Implementation and Schema Cleanup

**Date:** 2026-01-18
**Status:** Implementation complete, migration pending
**Parent Documents:** 97 Document-First Architecture

---

## Executive Summary

This session implemented the document-first upload flow from doc 97 and performed a comprehensive schema cleanup to remove unused columns and ensure proper field population.

**Key Achievements:**
1. Built `/ingest` page with LLM-powered model detection and category suggestions
2. Implemented UI validation for required category fields
3. Fixed multiple bugs discovered during testing
4. Created migration to clean up unused database columns
5. Updated code to populate all required fields

---

## Implementation Completed

### 1. Document-First Flow (`/ingest` page)

**Files Created/Modified:**
- `src/public/document-ingest.html` - Full UI with category dropdowns
- `src/routes/admin/document-ingest.route.js` - Backend endpoint
- `src/routes/admin/reference-data.route.js` - Add new reference values
- `src/routes/admin/index.js` - Route registration

**Flow:**
1. User uploads PDF
2. LlamaParse parses → markdown
3. Model detection (gpt-4.1-mini) with reference table data
4. LLM returns suggested categories + detected models
5. UI shows 4 dropdowns pre-populated with suggestions
6. User selects models, fills serial/location
7. User can add new values to reference tables
8. Confirm → creates document, systems, instances, links

### 2. LLM Integration Updates

**Files Modified:**
- `python-sidecar/app/models.py` - Added `ReferenceData`, enhanced `ModelDetectionResponse`
- `python-sidecar/app/main.py` - Updated prompt with reference data
- `src/app.js` - Proxy fetches reference tables, includes in response

**LLM now returns:**
```json
{
  "manufacturer": "Yanmar",
  "product_type": "Engine",
  "system_category": "Propulsion",
  "subsystem_category": "Engines",
  "primary_models": ["4JH57", "4JH80"],
  "referenced_products": [{"model": "VC20", "type": "Vessel Control"}]
}
```

### 3. UI Validation

**Features:**
- Red asterisks on required fields
- Red/green borders on dropdowns
- Validation message shows missing fields
- Confirm button disabled until categories filled
- "Add New" buttons for each category dropdown

### 4. Bug Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| `source: "manual_entry"` instead of `"document"` | `sanitizeSystemData()` stripped `source` field | Added `source` and `detected_from_doc_id` to sanitization |
| `instance_uid` null constraint violation | Instance creation didn't generate UUID | Added `instance_uid: crypto.randomUUID()` |
| Categories not enforced | No UI validation | Added validation + disabled button logic |

---

## Schema Analysis and Cleanup

### Documents Table

| Column | Decision | Reason |
|--------|----------|--------|
| `manufacturer` | **DELETE** | Replaced by `manufacturer_norm` |
| `model` | **DELETE** | Replaced by `model_norm` |
| `source_url` | **DELETE** | Never used |
| `asset_uid` | **KEEP (don't populate)** | Deprecated, backwards compat |
| `models_covered` | **POPULATE** | From detection (primary + referenced) |
| `is_multi_model` | **POPULATE** | True if multiple primary models |

### Systems Table

| Column | Decision | Reason |
|--------|----------|--------|
| `system_norm` | **POPULATE** | From ref_system_categories.name |
| `subsystem_norm` | **POPULATE** | From ref_subsystem_categories.name |
| `canonical_model_id` | **DELETE** | Removed from keywords service |
| `manual_url` | **DELETE** | Never used |
| `oem_page` | **DELETE** | Never used |
| `local_manual_file_name` | **DELETE** | Never used |
| `serial_number` | **DELETE** | Moved to instances table |

### Instances Table

| Column | Decision | Reason |
|--------|----------|--------|
| `manufacturer_norm` | **POPULATE** | Denormalized from parent system |
| `model_norm` | **POPULATE** | Denormalized from parent system |
| `system_norm` | **POPULATE** | Denormalized from parent system |
| `subsystem_norm` | **POPULATE** | Denormalized from parent system |

### Keywords Discussion

| Column | Decision | Notes |
|--------|----------|-------|
| `colloquial_keywords` | **KEEP** | Actively used by extraction service |
| `model_synonyms` | **KEEP** | Stored, may be useful for future search |

---

## Code Changes Summary

### Files Modified

| File | Changes |
|------|---------|
| `src/services/document.service.js` | Use `manufacturer_norm`/`model_norm` instead of deprecated columns |
| `src/services/keywords-synonyms-generation.service.js` | Remove `canonical_model_id` from prompt |
| `src/utils/validation.js` | Remove `manual_url`/`oem_page` validation, add `system_norm`/`subsystem_norm` to sanitization |
| `src/routes/admin/document-ingest.route.js` | Populate `models_covered`, `system_norm`, `subsystem_norm`, instance denormalized fields |
| `src/schemas/systems.schema.js` | Remove deleted columns from Zod schemas |

### Files Created

| File | Purpose |
|------|---------|
| `src/routes/admin/reference-data.route.js` | POST endpoint to add new reference table values |
| `scripts/migrations/040_cleanup_unused_columns.sql` | Drop unused columns, populate missing fields |

---

## Migration 040: Cleanup Unused Columns

**Location:** `scripts/migrations/040_cleanup_unused_columns.sql`

**What it does:**
1. **Documents:** Drops `manufacturer`, `model`, `source_url`
2. **Systems:** Drops `canonical_model_id`, `manual_url`, `oem_page`, `local_manual_file_name`, `serial_number`
3. **Systems:** Populates `system_norm`, `subsystem_norm` from reference tables
4. **Instances:** Populates denormalized fields from parent systems

**Run AFTER deploying code changes.**

---

## Test Results

**Test:** Uploaded Yanmar manual via `/ingest`

**Results:**
- Document: yanmar test.pdf
- Systems created: 3 (4JH57, VC20, SD60)
- Instances created: 5 (2 engines, 1 controller, 2 saildrives)
- All FK IDs populated correctly
- document_systems links created with correct `is_primary` flags

**Database verification:**
```
systems: All have manufacturer_id, product_type_id, system_category_id, subsystem_category_id
instances: All have instance_uid, asset_uid, instance_index
document_systems: All columns populated, correct is_primary flags
```

---

## Next Steps (Clear Order)

### Immediate (Before Compact)

1. **Test the updated flow**
   - Restart services: `./restart-all.sh`
   - Upload document via `/ingest`
   - Verify `system_norm`, `subsystem_norm` are now populated
   - Verify instance denormalized fields are populated

### After Testing

2. **Run Migration 040**
   ```sql
   -- In Supabase SQL Editor
   -- File: scripts/migrations/040_cleanup_unused_columns.sql
   ```

3. **Update Document Schemas** (after migration)
   - File: `src/schemas/document.schema.js`
   - Remove `manufacturer`, `model`, `source_url` from response schemas
   - Or replace with `manufacturer_norm`, `model_norm`

### Future (Per Doc 97 Roadmap)

4. **DIP Extraction with Model Filtering**
   - Update DIP prompts with inclusion/exclusion logic
   - Run DIP AFTER model approval
   - Write directly to production tables (not staging)

5. **Pinecone Metadata Migration**
   - Change `linked_asset_uid` → `primary_models[]`
   - Add `referenced_systems[]`, `is_universal`
   - Update query filters
   - See doc 98 for full inventory

---

## Files Reference

| File | Purpose | Status |
|------|---------|--------|
| `src/public/document-ingest.html` | Upload UI with dropdowns | ✅ Done |
| `src/routes/admin/document-ingest.route.js` | Backend save endpoint | ✅ Done |
| `src/routes/admin/reference-data.route.js` | Add new ref values | ✅ Done |
| `python-sidecar/app/main.py` | Model detection endpoint | ✅ Done |
| `src/utils/validation.js` | System validation | ✅ Done |
| `src/schemas/systems.schema.js` | Zod schemas | ✅ Done |
| `scripts/migrations/040_cleanup_unused_columns.sql` | Column cleanup | ⏳ Ready to run |
| `src/schemas/document.schema.js` | Document schemas | ⏳ Update after migration |

---

## Post-Compact Recovery

**Read this file first after /compact**

**Key context:**
1. Document-first flow is WORKING at `/ingest`
2. Migration 040 is READY but NOT RUN yet
3. Next: Run migration, then update document schemas
4. After that: DIP integration (doc 97 steps 5-6)

**Quick test:**
```bash
./restart-all.sh
# Navigate to localhost:3000/ingest
# Upload a PDF and verify systems/instances created
```

**Verify database:**
```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
supabase.from('systems').select('model_norm, system_norm, subsystem_norm, source').then(r => console.log(r.data));
"
```
