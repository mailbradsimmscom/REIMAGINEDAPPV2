# 100 Vision Analysis Schema Update and Pipeline Status

**Date:** 2026-01-19
**Status:** Schema updated, ready for testing
**Parent Documents:** 96, 96e, 97, 99

---

## Executive Summary

This session completed two things:
1. **Migration 040** - Schema cleanup (dropped unused columns, fixed dependent views)
2. **Vision analysis schema update** - Added `referenced_systems` field to distinguish primary models from other equipment shown

---

## Migration 040 Completed

**Issue encountered:** Migration failed multiple times due to dependent views not being checked.

**Views that had to be dropped/recreated:**
- `systems_to_fetch` - DROPPED (obsolete, used `manual_url`, `oem_page`)
- `v_systems_with_instances` - DROPPED and recreated without old columns

**Function updated:**
- `search_systems` - Removed `canonical_model_id` reference

**Columns dropped:**
| Table | Columns Dropped |
|-------|-----------------|
| documents | `manufacturer`, `model`, `source_url` |
| systems | `canonical_model_id`, `manual_url`, `oem_page`, `local_manual_file_name`, `serial_number` |

**Code updated to use new column names:**
- `src/schemas/document.schema.js` - 4 response schemas
- `src/services/document-deletion.service.js`
- `src/routes/admin/jobs.route.js`
- `src/routes/admin/suggestions.route.js`
- `src/public/documents.html`

---

## Vision Analysis Schema Update

### The Problem

The existing vision analysis only captured `applies_to_models` which tracks which primary models content applies to. But when an ENGINE manual shows a SAILDRIVE installation diagram, we need to track both:
- Which engines this applies to (primary models)
- Which saildrive is shown (referenced system)

### Example: Yanmar 4JH Engine Manual

**Before (incomplete):**
```json
{
  "type": "installation_diagram",
  "title": "SD60 Saildrive Installation",
  "applies_to_models": ["4JH57", "4JH80"]
}
```

**After (complete):**
```json
{
  "type": "installation_diagram",
  "title": "SD60 Saildrive Installation",
  "applies_to_models": ["4JH57", "4JH80"],
  "referenced_systems": ["SD60"]
}
```

### Schema Definition

| Field | Purpose | Example |
|-------|---------|---------|
| `applies_to_models` | Which PRIMARY models this content is relevant to | `["4JH57", "4JH80"]` |
| `referenced_systems` | OTHER equipment shown/mentioned (not primary) | `["SD60", "VC20"]` |
| `is_universal` | True if applies to ALL primary models | `true` / `false` |

### Files Updated

| File | Changes |
|------|---------|
| `python-sidecar/scripts/test_vision_page_analysis.py` | Added `applies_to_models`, `referenced_systems` to figures, tables, text_sections, page_metadata |
| `python-sidecar/scripts/test_pdf_vision_analysis.py` | Added `referenced_systems` to figures, tables, text_sections, page_metadata |

### Updated Prompt Schema

**figures:**
```
- applies_to_models: Which specific PRIMARY models this figure applies to
- referenced_systems: Other equipment/systems shown in this figure that aren't the primary product
```

**tables:**
```
- applies_to_models: Which PRIMARY models this table applies to
- referenced_systems: Other equipment/systems referenced in this table
```

**text_sections:**
```
- applies_to_models: Which PRIMARY models this section applies to (or ["all"])
- referenced_systems: Other equipment/systems mentioned in this section
```

**page_metadata:**
```
- models_mentioned: List of specific PRIMARY model numbers/names mentioned
- systems_referenced: List of OTHER equipment/systems mentioned (not primary product)
```

---

## Test Scripts Location

### Vision Analysis Tests

| Script | Purpose | Usage |
|--------|---------|-------|
| `python-sidecar/scripts/test_vision_page_analysis.py` | Single page analysis | `python scripts/test_vision_page_analysis.py --image /path/to/page.jpg` |
| `python-sidecar/scripts/test_pdf_vision_analysis.py` | Multi-page PDF analysis | `python scripts/test_pdf_vision_analysis.py --pdf /path/to/manual.pdf --pages 1-5` |
| `python-sidecar/scripts/test_figure_cropping.py` | Crop figures from pages | See script for usage |

### Test Results Location

```
python-sidecar/visual_extraction_work/vision_test_results/
├── yanmar_sail_drive/
│   ├── aggregate_analysis.json
│   ├── page_001_analysis.json
│   └── ...
├── victron_smart_solar_mppt/
│   └── ...
└── cropped/
    └── ...
```

---

## v5 Pipeline Status (from 96e)

| Stage | Status | Notes |
|-------|--------|-------|
| 1. uploading | ✅ exists | |
| 2. verifying | ✅ exists | |
| 3. parsing | ✅ exists | LlamaParse |
| 4. model_detection | ✅ Done | `/ingest` has this |
| 5. model_selection | ✅ Done | `/ingest` approval screen |
| **6. vision_analysis** | ⏳ Schema updated | Test scripts exist, NOT integrated into pipeline |
| **7. figure_cropping** | ⏳ Test exists | NOT integrated into pipeline |
| **8. chunking (modified)** | ❌ NOT DONE | Need model tags on chunks |
| **9. embedding (modified)** | ❌ NOT DONE | Need model tags in Pinecone |
| 10. indexing | ✅ exists | |
| 11. colloquial_extraction | ✅ exists | |
| **12. dip_extraction (modified)** | ❌ NOT DONE | Need inclusion/exclusion logic |
| 13. storing | ⏳ partial | Need figure storage |
| 14. completed | ✅ exists | |

---

## Next Steps for Vision Analysis

When returning to this work:

### 1. Test Updated Schema
```bash
cd python-sidecar
python scripts/test_pdf_vision_analysis.py \
  --pdf /path/to/yanmar_4jh_manual.pdf \
  --pages 1-10 \
  --models "4JH45,4JH57,4JH80,4JH110" \
  --context "Yanmar 4JH series marine diesel engine manual"
```

Verify output includes `referenced_systems` for saildrive/controller content.

### 2. Integrate into Pipeline
Create endpoint: `POST /v1/vision/analyze-pages` in `python-sidecar/app/routes/vision_analysis.py`

### 3. Figure Cropping
Create endpoint: `POST /v1/vision/crop-figures` in `python-sidecar/app/routes/figure_cropping.py`

### 4. Wire into document.service.js
Add stages 6 and 7 to the processing pipeline.

---

## Query Examples with New Schema

**User has 4JH57 engine, asks "show me saildrive installation":**

```sql
-- Find figures that apply to their engine AND reference saildrives
SELECT * FROM doc_assets
WHERE 'JH57' = ANY(applies_to_models)
  AND referenced_systems && ARRAY['SD60', 'SD80'];
```

**User asks "SD60 specifications":**

```sql
-- Find content that references SD60
SELECT * FROM doc_assets
WHERE 'SD60' = ANY(referenced_systems);
```

---

## Files Reference

| File | Purpose | Status |
|------|---------|--------|
| `scripts/migrations/040_cleanup_unused_columns.sql` | Schema cleanup | ✅ RUN |
| `python-sidecar/scripts/test_vision_page_analysis.py` | Vision test (single page) | ✅ Updated |
| `python-sidecar/scripts/test_pdf_vision_analysis.py` | Vision test (PDF) | ✅ Updated |
| `python-sidecar/scripts/test_figure_cropping.py` | Figure cropping test | Exists |
| `python-sidecar/app/routes/vision_analysis.py` | Vision endpoint | ❌ NOT CREATED |
| `python-sidecar/app/routes/figure_cropping.py` | Cropping endpoint | ❌ NOT CREATED |

---

## Post-Compact Recovery

**Read this file after /compact if working on vision analysis.**

**Key context:**
1. Vision analysis test scripts are in `python-sidecar/scripts/test_*_vision*.py`
2. Test results are in `python-sidecar/visual_extraction_work/vision_test_results/`
3. Schema now includes `referenced_systems` field (not just `applies_to_models`)
4. Migration 040 has been run - columns dropped, views recreated

**Quick test:**
```bash
cd python-sidecar
source venv/bin/activate
python scripts/test_pdf_vision_analysis.py --pdf /path/to/manual.pdf --pages 1-3
```
