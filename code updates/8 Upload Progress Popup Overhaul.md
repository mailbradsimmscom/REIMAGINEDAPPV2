# Upload Progress Popup Overhaul

**Date:** 2025-10-07
**Goal:** Fix upload progress popup to show real-time status with 9 clean stages, remove broken chunk counting, and improve error handling.

---

## 🎯 PROBLEM STATEMENT

**Current Issues:**
- Progress popup shows incorrect/missing status updates
- Chunk counting displays broken "1/1" value
- Popup only appears after upload completes (should show immediately)
- Old status names are confusing and don't map to actual processing steps
- Failed jobs don't show red error state clearly
- Button says "Close" instead of "OK"

**Solution:**
Implement 9-stage status system that matches actual processing flow, remove chunk counting from UI, show popup immediately on upload, and add clear error visualization.

---

## 📋 NEW STATUS SYSTEM (9 STAGES)

### Status Flow

Replace all existing statuses with these 9:

1. **`uploading`** - Upload document
2. **`verifying`** - Verify upload
3. **`parsing`** - Parse content
4. **`chunking`** - Split intelligently
5. **`embedding`** - Create vectors
6. **`indexing`** - Index for search
7. **`extracting`** - Extract insights
8. **`storing`** - Store data
9. **`completed`** - Complete
10. **`failed`** - (error state only)

### Statuses to Remove

**Kill these:**
- `queued`
- `upload_success`
- `upload_complete`
- `pinecone_upsert`
- `ingestion`

**Why:** These don't map clearly to user-facing steps and cause confusion.

---

## 🔧 IMPLEMENTATION DETAILS

### Part 1: Backend Status Updates

#### File: `src/services/document.service.js`

**Location 1: `createIngestJob()` method (~line 340-370)**

Add status updates for Steps 1-2 (Upload + Verify):

```javascript
// Step 1: Uploading (set when job created)
await documentRepository.updateJobStatusV2(job.job_id, 'uploading');

await documentRepository.updateJobStatus(job.job_id, 'upload_success', {
  storage_path: storagePath
});

// Step 2: Verifying
await documentRepository.updateJobStatusV2(job.job_id, 'verifying');
await this.verifyFileInStorage(storagePath, job.job_id);

await documentRepository.updateDocumentStoragePath(finalDocId, storagePath);

// Process job immediately
await this.processJob(job.job_id);
```

---

**Location 2: `processJob()` method (~line 430-565)**

**Before `callPythonSidecar()` call:**

```javascript
// Step 3: Parsing
await documentRepository.updateJobStatusV2(jobId, 'parsing');

const processingResult = await this.callPythonSidecar(fileBuffer, job, document, fileName);
```

**After `callPythonSidecar()` returns, before Anthropic extraction:**

```javascript
// Manual flag update (existing code)
if (document.asset_uid) {
  await documentRepository.updateSystemManualFlag(document.asset_uid, true);
}

// Step 7: Extracting
await documentRepository.updateJobStatusV2(jobId, 'extracting');

const extractionResult = await anthropicExtractionService.runAnthropicExtraction(
  job.doc_id,
  job.storage_path,
  { ... }
);
```

**After DIP ingestion:**

```javascript
const ingestionResult = await ingestDipOutputsToDb({ ... });

// Step 8: Storing
await documentRepository.updateJobStatusV2(jobId, 'storing');

// REMOVE the second updateJobProgress() call (lines ~537-558)
// This call overwrites chunk counters with zeros - DELETE IT

// Step 9: Completed
await documentRepository.updateJobStatus(jobId, 'completed');
await documentRepository.updateJobStatusV2(jobId, 'completed');
```

**In error handler (~line 587-595):**

```javascript
catch (error) {
  // Update job status to failed
  await documentRepository.updateJobStatus(jobId, 'failed', {
    error: {
      message: error.message,
      stack: error.stack
    }
  });

  // ADD THIS:
  await documentRepository.updateJobStatusV2(jobId, 'failed');

  throw error;
}
```

---

**Location 3: `callPythonSidecar()` method (~line 667-744)**

Add status updates for Steps 4-6 (Chunk + Embed + Index):

```javascript
async callPythonSidecar(fileBuffer, job, document, fileName) {
  try {
    // Check sidecar availability
    this.checkSidecarAvailability();

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: 'application/pdf' });
    formData.append('file', blob, fileName);

    // Add metadata
    const metadata = { ... };
    formData.append('doc_metadata', JSON.stringify(metadata));
    formData.append('extract_tables', 'true');
    formData.append('ocr_enabled', job.params.ocr_enabled ? 'true' : 'false');

    // Step 4: Chunking
    await documentRepository.updateJobStatusV2(job.job_id, 'chunking');

    // Call Python sidecar
    const { getEnv } = await import('../config/env.js');
    const sidecarUrl = getEnv().PYTHON_SIDECAR_URL;
    const response = await fetch(`${sidecarUrl}/v1/process-document`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Python sidecar error: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(`Processing failed: ${result.error || 'Unknown error'}`);
    }

    // Step 5: Embedding
    await documentRepository.updateJobStatusV2(job.job_id, 'embedding');

    this.requestLogger.info('Python sidecar processing completed', {
      jobId: job.job_id,
      filename: result.filename,
      chunksProcessed: result.chunks_processed,
      vectorsUpserted: result.vectors_upserted
    });

    // Update job with chunk progress (this is fine - keeps counters for logs)
    await documentRepository.updateJobProgress(job.job_id, {
      chunks_total: result.chunks_processed || 0,
      chunks_processed: result.chunks_processed || 0,
      vectors_upserted: result.vectors_upserted || 0
    });

    // Step 6: Indexing
    await documentRepository.updateJobStatusV2(job.job_id, 'indexing');

    return result;

  } catch (error) {
    this.requestLogger.error('Failed to call Python sidecar', {
      error: error.message,
      jobId: job.job_id
    });
    throw error;
  }
}
```

---

### Part 2: Frontend Updates

#### File: `src/public/upload.html`

**Change 1: Update STAGES array (lines 1270-1277)**

Replace the entire STAGES array:

```javascript
STAGES = [
  { name: 'uploading', label: 'Uploading', color: '#007AFF', progress: 11.11 },
  { name: 'verifying', label: 'Verifying', color: '#007AFF', progress: 22.22 },
  { name: 'parsing', label: 'Parsing', color: '#5856D6', progress: 33.33 },
  { name: 'chunking', label: 'Chunking', color: '#5856D6', progress: 44.44 },
  { name: 'embedding', label: 'Embedding', color: '#FF9500', progress: 55.55 },
  { name: 'indexing', label: 'Indexing', color: '#FF9500', progress: 66.66 },
  { name: 'extracting', label: 'Extracting', color: '#5AC8FA', progress: 77.77 },
  { name: 'storing', label: 'Storing', color: '#5AC8FA', progress: 88.88 },
  { name: 'completed', label: 'Completed', color: '#34C759', progress: 100 }
];
```

**Note:** Each stage is ~11% progress increment (100% / 9 steps)

---

**Change 2: Show popup immediately (lines 929-1015)**

**Current flow:**
```javascript
// Upload happens
const response = await fetch('/document/ingest', { ... });
const result = await response.json();

// THEN show popup
if (result.success && result.data.job_id) {
    this.showProgressPopup(result.data.job_id);
}
```

**New flow:**
```javascript
// Show popup BEFORE upload starts
this.showProgressPopup('uploading'); // Temporary ID

// Upload happens
const response = await fetch('/document/ingest', { ... });
const result = await response.json();

if (result.success) {
    this.hideUploadProgress();

    if (result.data && result.data.job_id) {
        // Stop temp tracking, start real tracking with actual job_id
        if (window.progressInterval) {
            clearInterval(window.progressInterval);
        }
        this.startProgressTracking(result.data.job_id);
    }
}
```

**Also update `showProgressPopup()` method (~line 1050):**

Add initial state setup:

```javascript
showProgressPopup(jobId) {
    // ... existing popup creation code ...

    document.head.appendChild(style);
    overlay.appendChild(progressCard);
    document.body.appendChild(overlay);

    // Set initial UI state for uploading
    const stageEl = document.getElementById('popup-current-stage');
    const percentageEl = document.getElementById('popup-progress-percentage');
    if (stageEl) stageEl.textContent = 'Uploading';
    if (percentageEl) percentageEl.textContent = '0%';
    this.updateProgressRing(0, '#007AFF');

    // Only start tracking if we have a real job ID
    if (jobId !== 'uploading') {
        this.startProgressTracking(jobId);
    }
}
```

---

**Change 3: Update button text (line 1096)**

```html
<!-- Before -->
<button class="close-button" onclick="closeProgressPopup()">Close</button>

<!-- After -->
<button class="close-button" onclick="closeProgressPopup()">OK</button>
```

---

**Change 4: Remove chunk counting from UI (lines 1328-1334)**

**Before:**
```javascript
// Build progress text with chunk info if available
let progressText = `${Math.round(progress)}%`;
if (jobData.counters && jobData.counters.chunks_total > 0) {
    const current = jobData.counters.chunks_processed || 0;
    const total = jobData.counters.chunks_total;
    progressText = `${Math.round(progress)}% (chunk ${current}/${total})`;
}
```

**After:**
```javascript
// Build progress text (clean, no chunk counting)
let progressText = `${Math.round(progress)}%`;
```

**Why:** Chunk counters get overwritten with zeros later in the process, causing broken "1/1" display. Backend still tracks chunks for logging.

---

**Change 5: Red circle on failure (lines 1294-1365)**

**Update `updateProgressUI()` method:**

**Before:**
```javascript
// Update progress ring
this.updateProgressRing(progress, color);

// Update status indicator
const statusIndicator = document.getElementById('popup-status-indicator');
if (statusIndicator) {
    statusIndicator.className = 'status-indicator';

    if (stage === 'completed') {
        statusIndicator.classList.add('completed');
        statusIndicator.innerHTML = '<span>✓ Completed</span>';
    } else if (jobData.status === 'failed') {
        statusIndicator.classList.add('error');
        statusIndicator.innerHTML = '<span>✗ Failed</span>';
    } else {
        statusIndicator.classList.add('active');
        statusIndicator.innerHTML = '<div class="loading-spinner"></div><span>Processing</span>';
    }
}
```

**After:**
```javascript
// Check for failure state
const isFailed = jobData.status === 'failed' || stage === 'failed';

// Update progress ring with RED color if failed
if (isFailed) {
    this.updateProgressRing(progress, '#FF3B30'); // Red
} else {
    this.updateProgressRing(progress, color);
}

// Update status indicator
const statusIndicator = document.getElementById('popup-status-indicator');
if (statusIndicator) {
    statusIndicator.className = 'status-indicator';

    if (stage === 'completed') {
        statusIndicator.classList.add('completed');
        statusIndicator.innerHTML = '<span>✓ Completed</span>';
    } else if (isFailed) {
        statusIndicator.classList.add('error');
        statusIndicator.innerHTML = '<span>✗ Failed</span>';

        // Update stage text to show "Failed"
        if (stageEl) stageEl.textContent = 'Failed';
    } else {
        statusIndicator.classList.add('active');
        statusIndicator.innerHTML = '<div class="loading-spinner"></div><span>Processing</span>';
    }
}
```

---

## 🐛 BUG FIX: Chunk Counting Shows 1/1

### Root Cause

1. **Python returns chunk count:** `chunks_processed: 8, chunks_total: 8`
2. **Node updates counters correctly:** `updateJobProgress({ chunks_total: 8, chunks_processed: 8 })`
3. **Later, after DIP extraction:** `updateJobProgress({ chunks_total: 0, chunks_processed: 0 })` ❌ **OVERWRITES**
4. **UI shows:** `0/0` or defaults to `1/1`

### Solution

**Backend:** Remove the second `updateJobProgress()` call in `processJob()` method (~line 537-558) that overwrites chunk counters with zeros.

**Frontend:** Remove chunk counting display from UI (Change 4 above).

**Result:** Backend still tracks chunks for logging, but UI shows clean percentages without broken counters.

---

## ✅ TESTING CHECKLIST

After implementation, verify:

| Test | Expected Result |
|------|-----------------|
| **Click Upload** | Popup appears immediately showing "Uploading 11%" |
| **File uploads** | Status changes to "Verifying 22%" |
| **Parsing starts** | Status changes to "Parsing 33%" |
| **Chunking** | Status changes to "Chunking 44%" |
| **Embedding** | Status changes to "Embedding 55%" |
| **Indexing** | Status changes to "Indexing 66%" |
| **Extracting** | Status changes to "Extracting 77%" |
| **Storing** | Status changes to "Storing 88%" |
| **Complete** | Green circle, "✓ Completed", button says "OK" |
| **Failure** | Red circle, "✗ Failed", stage text shows "Failed" |
| **No chunk count** | Progress shows "67%" (NOT "67% (chunk 1/1)") |
| **Polling** | Status updates every 2 seconds |
| **Real-time** | All 9 stages appear as processing happens |

---

## 📊 BEFORE vs AFTER

### Before (Broken)

**Statuses:**
```
upload_complete → parsing → pinecone_upsert → extraction → ingestion → completed
(6 stages, confusing names, doesn't match actual flow)
```

**Issues:**
- ❌ Popup appears after upload completes (user sees nothing during upload)
- ❌ Chunk counting shows "1/1" (broken counter)
- ❌ Status names don't match actual processing steps
- ❌ Failed jobs show text error but progress ring stays blue
- ❌ Button says "Close" instead of "OK"

### After (Fixed)

**Statuses:**
```
uploading → verifying → parsing → chunking → embedding → indexing → extracting → storing → completed
(9 stages, clear names, matches actual flow 1:1)
```

**Improvements:**
- ✅ Popup appears immediately when upload button clicked
- ✅ Clean progress percentages (no chunk counting)
- ✅ Status names match user-facing processing steps
- ✅ Failed jobs show red progress ring + "Failed" text
- ✅ Button says "OK" (standard UI pattern)
- ✅ Real-time status updates every 2 seconds
- ✅ Each stage advances ~11% progress

---

## 🎯 KEY IMPLEMENTATION POINTS

### Status Update Timing

**Upload Phase (Steps 1-2):**
- `uploading`: Set when job created in `createIngestJob()`
- `verifying`: Set before `verifyFileInStorage()` call

**Python Sidecar Phase (Steps 3-6):**
- `parsing`: Set before `callPythonSidecar()`
- `chunking`: Set inside sidecar call before fetch
- `embedding`: Set after fetch returns successfully
- `indexing`: Set before returning from sidecar

**Anthropic Extraction Phase (Steps 7-8):**
- `extracting`: Set before `runAnthropicExtraction()`
- `storing`: Set after `ingestDipOutputsToDb()`

**Completion (Step 9):**
- `completed`: Set after all processing finishes

**Error Handling:**
- `failed`: Set in catch block with error details

---

## 🔄 DATABASE IMPACT

**No schema changes required.**

The `jobs.status_v2` field is a text column that accepts any string value. New status names will be stored without migration.

**Existing jobs:** Will retain old status values, but new jobs use new system.

---

## 🚨 ROLLBACK PLAN

If issues arise:

```bash
# Revert backend changes
git checkout HEAD -- src/services/document.service.js

# Revert frontend changes
git checkout HEAD -- src/public/upload.html

# Restart services
npm run dev
```

Old statuses will work immediately since database doesn't enforce specific values.

---

## 📝 FILES MODIFIED

| File | Change Type | Lines Changed |
|------|-------------|---------------|
| `src/services/document.service.js` | Add 9 status updates throughout processing | ~15 additions, ~15 deletions |
| `src/public/upload.html` | Update STAGES, remove chunk counting, red failure, "OK" button, immediate popup | ~30 changes |
| **Total** | | **~45 line changes** |

---

## ⏱️ EXPECTED EFFORT

**Implementation:** 20-30 minutes
**Testing:** 10 minutes
**Total:** **30-40 minutes**

---

## 🎓 LESSONS LEARNED

1. **User-facing statuses should match actual processing steps** - Generic names like "processing" hide what's actually happening
2. **Show progress immediately** - Users need feedback that something is happening from the moment they click
3. **Clean up broken features** - If chunk counting doesn't work reliably, remove it from UI
4. **Error states need visual feedback** - Red circle + "Failed" text is clearer than text alone
5. **Don't overwrite counters unnecessarily** - Second `updateJobProgress()` call was destroying good data
6. **Status granularity matters** - 9 stages gives better sense of progress than 6

---

## 📌 COMPLETION CRITERIA

Implementation is complete when:

- [ ] All 9 status updates added to backend
- [ ] STAGES array updated in frontend
- [ ] Popup appears immediately on upload
- [ ] Chunk counting removed from UI
- [ ] Failed jobs show red circle
- [ ] Button says "OK"
- [ ] Test upload completes with all 9 stages showing
- [ ] Failed upload shows red error state
- [ ] No "chunk 1/1" display appears

---

## 🎯 SUCCESS METRICS

**Before:**
- Status updates: 6 vague stages
- Popup delay: 5+ seconds (after upload)
- Chunk display: Broken "1/1"
- Error clarity: Text only
- User feedback: Confusing

**After:**
- Status updates: 9 clear stages
- Popup delay: 0 seconds (immediate)
- Chunk display: Removed (clean percentages)
- Error clarity: Red circle + text
- User feedback: Clear, real-time progress

---

**Implementation Status:** ⏳ Ready for implementation
**Risk Level:** Low (rollback plan available, no database changes)
**User Impact:** High (significant UX improvement)
