# 96f Model Detection Testing

**Date:** 2026-01-14 (updated 2026-01-15)
**Status:** BROKEN ❌ - LlamaParse refactor failed, need to revert
**Parent Documents:** 96d, 96e

---

## Current Status (2026-01-15 EOD)

### What Was Working (before refactor)
Model detection with pdfplumber/OCR was **validated and working**:
- Detected: `["3JH40", "4JH45", "4JH57", "4JH80", "4JH110"]`
- `is_multi_model: true`
- `confidence: "high"`
- UI showed model selection checkboxes ✅
- Only issue: OCR was slow (~4 minutes)

### What Broke It
Attempted to refactor to use LlamaParse instead of pdfplumber/OCR:
1. Added `/v1/llamaparse` endpoint to Python sidecar
2. Added `callLlamaParse()` method to Node.js
3. Reordered pipeline: parsing → model_detection → model_selection
4. Simplified `detectModels()` to accept text instead of fileBuffer

**Result:** "LlamaParse failed: fetch failed" - the endpoint times out or fails

### Root Cause (suspected)
- LlamaParse cloud service may be slow/timing out
- Or the endpoint implementation has issues
- The original pdfplumber/OCR approach WORKED, shouldn't have changed it

### Next Session Options

**Option A: Revert to working code**
- Restore pdfplumber/OCR approach in `detectModels()`
- Remove `callLlamaParse()` method
- Keep original pipeline order (model_detection before full parsing)
- Accept the 4-minute OCR wait for now

**Option B: Fix LlamaParse approach**
- Debug why `/v1/llamaparse` is failing
- Check if USE_SEMANTIC_CHUNKING is enabled
- Check LlamaParse API key and connectivity
- May need longer timeout

**Recommendation:** Option A - revert to working code. Don't break what works.

---

## Files Modified (need revert)

| File | What Changed | Revert Action |
|------|--------------|---------------|
| `src/services/document.service.js` | Reordered pipeline, replaced detectModels(), added callLlamaParse() | Restore original detectModels() with pdfplumber/OCR, remove callLlamaParse(), restore original processJob() order |
| `python-sidecar/app/main.py` | Added /v1/llamaparse endpoint | Can keep or remove - not harmful |
| `python-sidecar/app/models.py` | Added LlamaParseResponse | Can keep or remove - not harmful |

**Key:** The Node.js document.service.js is what broke. Need to restore:
1. `detectModels(fileBuffer, fileName, docId)` - original signature with pdfplumber/OCR parsing
2. `processJob()` - original order (model_detection before chunking, no callLlamaParse)

---

## Previous Status (before refactor)

---

## What Was Built (Original Approach - Being Replaced)

### 1. Python Sidecar - Model Detection Endpoint
**File:** `python-sidecar/app/main.py` (lines 794-918)
**Endpoint:** `POST /v1/detect-models`

```python
# Input
{
  "text": "First ~15K chars of parsed document",
  "doc_id": "uuid",
  "filename": "Yanmar_4JH_Manual.pdf"
}

# Output
{
  "success": true,
  "models_detected": ["4JH45", "4JH57", "4JH80", "4JH110"],
  "is_multi_model": true,
  "confidence": "high",
  "evidence": "..."
}
```

**Tested successfully with curl:**
```bash
curl -s -X POST http://localhost:8000/v1/detect-models \
  -H "Content-Type: application/json" \
  -d '{"text": "YANMAR 4JH COMMON RAIL SERIES... Model: 4JH45 / 4JH57 / 4JH80 / 4JH110", "doc_id": "test-123", "filename": "Yanmar_4JH_Manual.pdf"}'
```

### 2. Frontend - Model Selection UI
**File:** `src/public/upload.html`

Added:
- `showModelSelectionPrompt(modelsDetected, jobId, userModelVariant)` - Shows checkboxes for detected models
- `submitModelSelection(jobId, useAll)` - POSTs selection to backend
- CSS for `.model-selection-options`, `.model-option`, `.recommended-badge`
- Handling in `updateProgressUI()` for `model_selection` stage

### 3. Backend - Model Selection Endpoint
**File:** `src/routes/document/job-status.route.js`
**Endpoint:** `POST /document/jobs/:jobId/model-selection`

- Receives `{ selected_models: ["4JH57"] }`
- Saves to job record
- Calls `documentService.processJob(jobId)` to resume pipeline

### 4. Database Migration
**File:** `scripts/migrations/038_jobs_v5_columns.sql`

Added columns to `jobs` table:
- `models_detected text[]` - Array of detected models
- `selected_models text[]` - Array of user-selected models
- `is_multi_model boolean` - Flag for multi-model documents

### 5. Pipeline Integration
**File:** `src/services/document.service.js`

Added:
- `detectModels(fileBuffer, fileName, docId)` method (lines 777-912)
  - Calls `/v1/parse` to get text
  - Calls `/v1/detect-models` with first 15K chars
  - Returns detection result

- Integration in `processJob()` (lines 472-536)
  - After file download, runs model detection
  - If multi-model: pauses at `model_selection` stage
  - If single model: auto-selects and continues
  - Skip logic for resuming after user selection

### 6. Test Reset Script
**File:** `scripts/reset-test-upload.cjs`

```bash
node scripts/reset-test-upload.cjs --all
```

Clears: jobs, documents, document_chunks, staging_* tables, Pinecone vectors, storage

---

## Issues Resolved (2026-01-15)

### Issue 1: Empty models_detected
**Problem:** Model detection returned empty `models_detected: []`
**Root cause:** pdfplumber filtered for `element_type === 'text'` but OCR returns `element_type === 'ocr'`
**Fix:** Changed filter to include both 'text' and 'ocr' element types

### Issue 2: OCR slow (4+ minutes)
**Problem:** pdfplumber + tesseract OCR took 4+ minutes for Yanmar manual
**Solution:** Switch to LlamaParse (already handles OCR, faster)

### Issue 3: Unnecessary complexity
**Problem:** Running separate parse for model detection when LlamaParse runs anyway
**Solution:** Reorder pipeline - parse first, use output for model detection

**ALL ISSUES RESOLVED** by switching to LlamaParse approach.

---

## Temporary Stop Added

To test model detection in isolation, added a temporary stop in `processJob()` (lines 522-536):

```javascript
// TEMPORARY STOP: Pause here to test model detection in isolation
this.requestLogger.info('TEMPORARY STOP: Model detection complete, pausing for testing', {
  jobId,
  models_detected: job.models_detected || [],
  is_multi_model: job.is_multi_model || false
});
await documentRepository.updateJobStatusV2(jobId, 'model_detection_complete');
return { success: true, paused: true, stage: 'model_detection_complete' };
// END TEMPORARY STOP
```

---

## How to Test

### 1. Reset test data
```bash
node scripts/reset-test-upload.cjs --all
```

### 2. Ensure services running
- Node: `npm run dev` (port 3000)
- Python sidecar: `cd python-sidecar && source venv/bin/activate && python -m app.main` (port 8000)

### 3. Upload Yanmar manual
- Go to http://localhost:3000/upload.html
- Select Yanmar / 4JH57
- Upload `0AJHC-EN0015_2019.12.pdf`

### 4. Check results
```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
async function check() {
  const { data } = await supabase
    .from('jobs')
    .select('job_id, status, status_v2, models_detected, is_multi_model, selected_models')
    .order('created_at', { ascending: false })
    .limit(1);
  console.log('Latest job:', JSON.stringify(data, null, 2));
}
check();
"
```

### 5. Check logs
```bash
grep -i "model detection" logs/debug/node-debug.log | tail -20
```

---

## Expected Behavior (Once Working)

1. **Upload starts** → status_v2: `uploading`
2. **File verified** → status_v2: `verifying`
3. **Model detection runs** → status_v2: `model_detection`
   - Parses PDF (with OCR if needed)
   - Calls Claude to detect models
   - Saves `models_detected: ["4JH45", "4JH57", "4JH80", "4JH110"]`
   - Saves `is_multi_model: true`
4. **TEMPORARY STOP** → status_v2: `model_detection_complete`
   - Pipeline pauses for testing
   - Check job record for detected models

Once validated, remove temporary stop and:
5. **Model selection** → status_v2: `model_selection`
   - UI shows prompt with checkboxes
   - User selects their model (4JH57 pre-checked)
6. **Resume processing** → continues to chunking, embedding, etc.

---

## Files Modified This Session

| File | Changes |
|------|---------|
| `python-sidecar/app/models.py` | Added ModelDetectionRequest, ModelDetectionResponse |
| `python-sidecar/app/main.py` | Added `/v1/detect-models` endpoint, fixed stale LangGraph comment |
| `src/public/upload.html` | Added model selection UI, CSS, JavaScript methods |
| `src/routes/document/job-status.route.js` | Added POST model-selection endpoint |
| `src/routes/document/ingest.route.js` | Removed body validation (was failing multipart) |
| `src/routes/admin/jobs.route.js` | Added models_detected, user_model_variant to response |
| `src/services/document.service.js` | Added detectModels(), pipeline integration, temporary stop |
| `scripts/migrations/038_jobs_v5_columns.sql` | New - adds v5 columns to jobs table |
| `scripts/reset-test-upload.cjs` | New - test data reset script |

---

## Post-Compact Instructions (UPDATED 2026-01-15)

1. **Read this file first:** `code updates/96f Model Detection Testing.md`

2. **Current state:**
   - Model detection endpoint VALIDATED ✅ (works with Yanmar manual)
   - pdfplumber/OCR approach being replaced with LlamaParse
   - Pipeline reorder in progress

3. **Immediate next step:**
   - Reorder `processJob()` in document.service.js:
     1. Move LlamaParse call before model detection
     2. Pass parsed text to `detectModels()` instead of fileBuffer
     3. Remove pdfplumber/OCR code from detectModels
   - Remove temporary stop
   - Test full flow

4. **Key files to modify:**
   - `src/services/document.service.js` - reorder processJob, simplify detectModels
   - Remove DEBUG-V5 logging when done (see `code updates/DEBUG-V5-LOGGING.md`)

5. **Key files to read:**
   - `code updates/96d Single System Validation Approach.md`
   - `code updates/96e v5 Pipeline Integration Plan.md`

---

## Resolved Questions

1. ~~Is the Yanmar PDF scanned?~~ **Yes** - OCR needed, LlamaParse handles it
2. ~~Is OCR taking too long?~~ **Yes** - 4+ minutes with pdfplumber. LlamaParse is faster.
3. ~~Does parse return expected structure?~~ **Yes** - but element_type is 'ocr' not 'text' (fixed)

---

*This document tracks model detection testing progress. Update as issues are resolved.*
