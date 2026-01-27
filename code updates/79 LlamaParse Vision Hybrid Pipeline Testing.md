# LlamaParse Vision Hybrid Pipeline Testing

**Date:** 2026-01-25
**Session Focus:** Implementing LlamaParse as replacement for Claude Vision bbox detection
**Planning Doc:** `/Users/brad/.cursor/plans/v5_stage6_7_vision_and_cropping_62318b7a.plan.md`

---

## Status: IMPLEMENTATION COMPLETE (Pending Final Test)

### What Was Done This Session

| Task | Status |
|------|--------|
| `parser.py` - add `extract_layout=True` + `parse_document_with_layout()` | ✅ Done |
| `/v1/llamaparse` - accept `doc_id`, store JSON to Storage | ✅ Done |
| `document.service.js` - pass `doc_id` as query param | ✅ Done |
| `/v1/vision/analyze-pages` - refactored for text-based model detection | ✅ Done |
| Migration 044 - `confidence` + `attribution_warnings` columns | ✅ Applied |
| `VisionAsset` Pydantic model - add confidence/warnings fields | ✅ Done |
| `vision-pipeline.service.js` - add confidence/warnings to DB upsert | ✅ Done |
| `DocAssetSchema` Zod - add confidence/warnings | ✅ Done |
| MIME type fix (text/plain for Storage uploads) | ✅ Done |
| Fix `doc_id` Form→Query param (FastAPI quirk) | ✅ Done |
| Fix frontend parallel→sequential flow for doc_id | ✅ Done |
| Fix Node proxy to forward query params | ✅ Done |
| Test with Yanmar PDF | ⏳ Pending |

---

## Problem Statement

Claude Vision (Sonnet 4) for bbox detection was unreliable:
- Bboxes cut off titles, callouts, legends
- Ignored "SKIP" instructions (captured junk safety icons)
- Inconsistent run-to-run (19, 20, 21 assets on same doc)
- Bbox contamination (included unrelated elements)

---

## Solution: LlamaParse `extract_layout=True`

LlamaParse with `extract_layout=True` returns:
- **`items[]`** - text/table content with pixel bboxes
- **`layout[]`** - visual elements with percentage bboxes (0-1 range)
- **`isLikelyNoise`** - built-in junk filter
- **Stable** - no LLM inference variability (true determinism from stored JSON)

### Key Insight
Store `llamaparse_raw.json` to Supabase Storage during initial parse. All subsequent operations read from this snapshot, ensuring true determinism.

---

## Files Changed

### Python Sidecar
- `python-sidecar/app/chunking/parser.py` - Added `extract_layout=True`, new `parse_document_with_layout()` method
- `python-sidecar/app/main.py` - Refactored `/v1/llamaparse` and `/v1/vision/analyze-pages`
- `python-sidecar/app/models.py` - Added `llamaparse_path`, `pages_skipped`, `confidence`, `attribution_warnings`

### Node.js
- `src/services/document.service.js` - Pass `doc_id` as query param to `/v1/llamaparse`
- `src/services/vision-pipeline.service.js` - Add `confidence`, `attribution_warnings` to DB upsert
- `src/schemas/document.schema.js` - Add `confidence`, `attribution_warnings` to Zod schema
- `src/app.js` - Proxy forwards query params to Python sidecar

### Frontend
- `src/public/document-ingest.html` - Sequential upload flow (storage first, then LlamaParse with doc_id)

### Migrations
- `scripts/migrations/044_doc_assets_confidence.sql` - Already applied to DB

---

## Technical Details

### Confidence Levels
- **high** - model found in heading
- **medium** - model found in table cell or body text
- **low** - no models found, defaulted to universal

### Warning Codes
- `MODEL_ATTRIBUTION_DEFAULTED` - no models detected, defaulted to universal
- `MODEL_CONFIDENCE_LOW` - detection confidence is low
- `MODEL_FROM_TABLE_CELL` - model found in table cell (less reliable)

### Bbox Conversion
```python
# LlamaParse: 0-1 decimal, fields: x, y, w, h
# Our system: 0-100 percentage, fields: x, y, width, height
bbox = {
    'x': llama_bbox['x'] * 100,
    'y': llama_bbox['y'] * 100,
    'width': llama_bbox['w'] * 100,
    'height': llama_bbox['h'] * 100
}
```

### asset_type vs asset_kind
- `asset_kind` = 'figure' or 'table' (from LlamaParse layout)
- `asset_type` = richer classification like 'exploded_view', 'wiring_diagram' (null for now, would need Vision LLM on cropped image)

---

## Known Issue: doc_id Form Parameter

FastAPI doesn't reliably receive Form fields when combined with File uploads. Fixed by passing `doc_id` as query parameter instead:

```javascript
// Node.js
const url = `${sidecarUrl}/v1/llamaparse?doc_id=${encodeURIComponent(docId)}`;
```

```python
# Python
doc_id: Optional[str] = Query(None)  # NOT Form(None)
```

---

## Known Issue: Frontend Parallel Upload

**Problem:** Frontend was calling storage upload and LlamaParse in parallel. LlamaParse didn't have doc_id yet, so `json_stored=False`.

**Fix:** Changed to sequential flow:
1. Upload to storage first → get doc_id
2. Call LlamaParse with doc_id → JSON gets stored

Also updated Node proxy (`app.js`) to forward query params to Python.

---

## Test Document

**PDF:** `/Users/brad/Downloads/yanmar test.pdf`
**Doc ID:** `f6ba3c87fb9ec5f5bd817ce2b803cfb7d9a1d060d0373db4bd01dc5cfcab0207`
**Models in doc:** 3JH40, 4JH45, 4JH57, 4JH80, 4JH110
**Referenced systems:** VC10, VC20, VC30, KM35P, KM4A1, KMH4A (SD605 was missed by model detection LLM)

---

## Post-Compact Instructions

### To Resume This Work

```bash
# 1. Restart services
cd /Users/brad/code/REIMAGINEDAPPV2
./restart-all.sh

# 2. Upload Yanmar PDF through UI
# Go to http://localhost:3000/admin/document-ingest.html
# Upload yanmar test.pdf
# Wait for LlamaParse to complete
# Select models (e.g., 4JH57 as primary, VC20 as referenced)
# Click "Confirm & Process"

# 3. Check if llamaparse_raw.json was stored
# Look in Python logs for: json_stored=True

# 4. Test vision endpoint via curl
curl -X POST http://localhost:3000/admin/api/documents/{DOC_ID}/vision \
  -H "Content-Type: application/json" \
  -H "x-admin-token: YOUR_ADMIN_TOKEN" \
  -d '{
    "storage_path": "manuals/{DOC_ID}/yanmar test.pdf",
    "selected_models": ["4JH57"],
    "referenced_selections": ["VC20"],
    "pages": "1-30"
  }'

# 5. Check results
# - Python logs for page analysis
# - Supabase Storage for vision/analysis/*.json files
# - doc_assets table for upserted records
```

### Key Files to Read
- Planning doc: `/Users/brad/.cursor/plans/v5_stage6_7_vision_and_cropping_62318b7a.plan.md`
- Parser: `/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/app/chunking/parser.py`
- Main endpoints: `/Users/brad/code/REIMAGINEDAPPV2/python-sidecar/app/main.py` (search for `/v1/llamaparse` and `/v1/vision/analyze-pages`)
- Node service: `/Users/brad/code/REIMAGINEDAPPV2/src/services/document.service.js` (search for `detectModelsFromDocument`)

### What's Left
1. **Test the full flow** - upload → llamaparse_raw.json stored → vision/analyze-pages → crop-figures → doc_assets upsert
2. **Add UI button** (optional) - document-ingest.html doesn't have Vision button wired up yet
3. **SD605 model detection** - LLM missed this in model detection (separate issue from Vision pipeline)

### What's NOT Left (Already Done)
- ✅ LlamaParse stores JSON with layout data
- ✅ Vision endpoint reads from stored JSON
- ✅ Text-based model detection with confidence levels
- ✅ User selection filtering (skip irrelevant pages)
- ✅ Bbox conversion (0-1 → 0-100)
- ✅ DB schema has confidence + attribution_warnings
- ✅ Zod schema updated
- ✅ VisionAsset model updated
- ✅ DB upsert includes confidence + warnings
