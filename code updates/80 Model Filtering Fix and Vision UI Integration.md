# Model Filtering Fix and Vision UI Integration

**Date:** 2026-01-27
**Session Focus:** Fix model filtering bug and integrate vision pipeline into document-ingest UI
**Planning Doc:** `/Users/brad/.cursor/plans/model_matching_cleanup_and_naming_alignment.plan.md`

---

## Status: IMPLEMENTED AND TESTED

### What Was Done This Session

| Task | Status |
|------|--------|
| Phase A1: Fetch `models_covered` from DB | ✅ Done |
| Phase A3: Remove referenced from `models_covered` | ✅ Done |
| Phase B1: Require `models_covered` in Python | ✅ Done |
| Phase B2: Skip unknown attribution (with referenced-only fix) | ✅ Done |
| Phase B3: Exact match for "all models" check | ✅ Done |
| UI Integration: Vision pipeline in document-ingest.html | ✅ Done |
| Test with Yanmar PDF | ✅ Passed |

---

## Problem Statement

### The Bug
`vision-pipeline.service.js:63` built `models_covered` from user selections:
```javascript
models_covered: [...selectedModels, ...referencedSelections]  // BUG!
```

This resulted in `models_covered = ["4JH57", "VC20"]` when it should be all primary models in the manual: `["3JH40", "4JH45", "4JH57", "4JH80", "4JH110"]`.

### The Result
- Page 21 (for 3JH40) wasn't recognized as a specific model page
- Defaulted to "universal" with low confidence
- Incorrectly included for user who selected 4JH57
- Polluted retrieval with wrong-model diagrams

---

## Solution

### Terminology Clarified
| Term | Meaning | Example |
|------|---------|---------|
| `models_covered` | All primary models the **manual** covers | `["3JH40", "4JH45", "4JH57", "4JH80", "4JH110"]` |
| `selected_models` | User's installed **primary** equipment | `["4JH57"]` |
| `referenced_selections` | User's installed **accessories** | `["VC20"]` |

### Key Rule
`models_covered` must NOT include referenced systems.

---

## Files Changed

### Node.js

#### `src/services/vision-pipeline.service.js`
- Added import: `import documentRepository from '../repositories/document.repository.js'`
- Fetch `models_covered` from `documents` table instead of building from user selections
- Return error `MODELS_COVERED_MISSING` if not found

#### `src/services/document-ingest.service.js`
- Changed `models_covered` to only include `modelsDetected` (primary models)
- Removed `referencedModels` from `models_covered`

#### `src/public/document-ingest.html`
- Added processing card with 3-step pipeline progress
- Auto-runs vision endpoint after document creation
- Shows results with stats: pages analyzed, figures, tables, filtered
- Expandable details showing skipped pages and reasons

### Python Sidecar

#### `python-sidecar/app/main.py`
- **B1:** Require `models_covered`, return error if missing (no fallback)
- **B2:** Skip unknown attribution pages instead of defaulting to universal
- **B2 fix:** Referenced-only pages set `applies_to_models = user_models` (DB constraint)
- **B3:** Exact set match for "mentions all models" (was `>= n-1`)
- Added `user_models` parameter to `analyze_page_for_models()`

---

## Test Results

### Yanmar 40-page PDF
| Metric | Before Fix | After Fix |
|--------|-----------|-----------|
| Pages analyzed | 23 | 4 |
| Figures cropped | 31 | 4 |
| Assets saved | 38 | **6** |

### Key Filtering Results
- Page 21 (3JH40): **SKIPPED** - "not relevant (page has ['3JH40'])"
- Page 16: **SKIPPED** - "not relevant (page has ['3JH40', '4JH45', '4JH80'])"
- Page 18: **SKIPPED** - "not relevant (page has ['4JH110', '4JH80'])"
- Pages 24-40: **SKIPPED** - "unknown attribution (no models detected)"

---

## Known Limitations

### Universal Section Detection
Current keywords: `SAFETY, TABLE OF CONTENTS, RECORD OF OWNERSHIP, WARRANTY, DISCLAIMER, PRECAUTION, NOTICE`

Pages 24-40 were skipped because their headings don't match these keywords and no model numbers were found in the text. May need to expand:
- MAINTENANCE
- SPECIFICATIONS
- GENERAL
- TROUBLESHOOTING

### DB Constraint Compliance
`doc_assets.applies_to_models` has `CHECK (cardinality(applies_to_models) > 0)`.

For referenced-only pages (no primary model, but matches user's referenced system), we set:
- `applies_to_models = user_models` (user's selected primaries)
- `is_universal = True`
- Warning: `APPLIES_TO_DEFAULTED_FROM_REFERENCED_ONLY_PAGE`

---

## How to Test

```bash
# 1. Restart services
./restart-all.sh

# 2. Fix existing document's models_covered (if polluted)
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
supabase.from('documents')
  .update({ models_covered: ['3JH40', '4JH45', '4JH57', '4JH80', '4JH110'] })
  .eq('doc_id', 'YOUR_DOC_ID')
  .then(console.log);
"

# 3. Test via UI
# Go to http://localhost:3000/admin/document-ingest.html
# Upload PDF, select primary model, confirm & process
# Watch pipeline progress

# 4. Or test via curl
ADMIN_TOKEN=your_token
curl -X POST "http://localhost:3000/admin/api/documents/{DOC_ID}/vision" \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -d '{
    "storage_path": "manuals/{DOC_ID}/filename.pdf",
    "selected_models": ["4JH57"],
    "referenced_selections": ["VC20"],
    "pages": "1-40"
  }'
```

---

## Related Files

- Planning doc: `/Users/brad/.cursor/plans/model_matching_cleanup_and_naming_alignment.plan.md`
- Previous session: `/Users/brad/code/REIMAGINEDAPPV2/code updates/79 LlamaParse Vision Hybrid Pipeline Testing.md`
- Migration: `scripts/migrations/044_doc_assets_confidence.sql`
