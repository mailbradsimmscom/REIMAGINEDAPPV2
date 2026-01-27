# Document Ingest Page - Failed Session

**Date:** 2026-01-17
**Status:** INCOMPLETE - Wasted ~25 minutes
**Problem:** Made assumptions, didn't validate, built untested code

---

## What Was Supposed to Happen

Build a single unified page for document-first flow:
1. Upload PDF
2. Parse with LlamaParse → get markdown
3. Run model detection (gpt-4.1-mini) → get primary_models, referenced_products
4. Show detected models to user
5. User selects which they have + fills serial/location
6. Confirm → save document, create systems, create document_systems links

---

## What Actually Happened

### Mistake 1: Wrong Architecture
- Started by patching existing `upload.html` and creating separate `onboarding.html`
- User wanted ONE NEW PAGE for the entire flow
- Wasted time building the wrong thing

### Mistake 2: Built Untested Code
Created files that don't work:
- `src/public/onboarding.html` - Wrong approach (separate page)
- `src/public/document-ingest.html` - Built but untested
- `src/routes/admin/document-ingest.route.js` - Built but untested
- Modified `src/app.js` with proxy routes that weren't tested
- Modified `python-sidecar/app/main.py` with `/v1/llamaparse` endpoint

### Mistake 3: Environment Issue
- Built endpoint that imports `llama_parse`
- Python sidecar was running WITHOUT venv activated
- So `llama_parse` module not available
- Should have verified environment before building

---

## Files Created (May Need Cleanup or Fixing)

| File | Status | Notes |
|------|--------|-------|
| `src/public/document-ingest.html` | UNTESTED | The unified page UI |
| `src/public/onboarding.html` | WRONG | Separate page approach - may delete |
| `src/routes/admin/document-ingest.route.js` | UNTESTED | Saves doc + creates systems |
| `python-sidecar/app/main.py` | MODIFIED | Added `/v1/llamaparse` and `/v1/detect-models` |
| `python-sidecar/app/models.py` | MODIFIED | Added `ModelDetectionRequest/Response` |
| `src/app.js` | MODIFIED | Added proxy routes + `/ingest` page route |
| `src/routes/admin/index.js` | MODIFIED | Added documents route |
| `src/services/document.service.js` | MODIFIED | Added model detection step (may conflict) |
| `src/routes/document/job-status.route.js` | MODIFIED | Added `/confirm-systems` endpoint |

---

## What Actually Works (Pre-existing)

1. **LlamaParse parsing** - Works via script `scripts/extract-llamaparse-markdown.py`
2. **Model detection** - Works via script `scripts/test-model-detection-llm.py`
3. **Existing parsed markdown** at `python-sidecar/llamaparse_output/`
4. **Migration 039** - Database schema is ready (document_systems, applies_to_models, etc.)

---

## Next Steps (For Next Session)

### Step 1: Fix Environment
```bash
cd python-sidecar
source venv/bin/activate
python -m app.main
```

### Step 2: Test What Was Built
1. Go to `http://localhost:3000/ingest`
2. Upload a PDF
3. See if it works now with venv activated

### Step 3: If Still Broken, Simplify
Instead of calling LlamaParse from the endpoint, could:
- Have user upload to get file stored
- Call LlamaParse separately (async job)
- Or use pre-parsed markdown for testing

### Step 4: Core Requirement
**The page needs to:**
1. Accept PDF upload
2. Parse it (LlamaParse)
3. Detect models (gpt-4.1-mini)
4. Show results to user
5. Let user select/confirm
6. Save document + systems to DB

---

## Key Files to Read for Context

- `code updates/97 Document-First Architecture and Model-Specific Content Problem.md` - Full design doc
- `code updates/98 Pinecone Metadata Migration` - Pinecone changes (do LAST)
- `scripts/extract-llamaparse-markdown.py` - Working LlamaParse code
- `scripts/test-model-detection-llm.py` - Working model detection code

---

## Database Ready (Migration 039 Completed)

- `document_systems` junction table ✓
- `applies_to_models TEXT[]` on all DIP tables ✓
- `systems.source` column ✓
- `systems.detected_from_doc_id` column ✓
- `filter_by_user_models()` function ✓
