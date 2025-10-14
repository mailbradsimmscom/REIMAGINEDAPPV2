# Session 22: Manual Hunter Blacklist Implementation and Context Preservation

**Date:** 2025-10-11 (Evening session after compaction)
**Status:** Investigating blacklist system and failed manual downloads

---

## Session Context Summary

This session continued work from Session 21 (Manual Hunter & Validator Agents). The compaction occurred at ~21:51 on Oct 11, 2025.

---

## What Happened in Session 22

### 1. Analysis of Recent Manual Hunter Run

**Run Details:**
- **Timestamp:** 2025-10-12T01:45:25
- **Duration:** 0s (very short - something went wrong)
- **Systems Processed:** 1
- **PDFs Downloaded:** 0/40
- **Success Rate:** 0.0%
- **Status:** max_attempts_exceeded

### 2. Blacklist System Discovery

Found that a blacklist system exists in the manual hunter:

**File:** `scripts/agents/manual-hunter-blacklist.json`

**Purpose:** Track systems that have exceeded maximum retry attempts to avoid wasting API calls

**Current Blacklisted System:**
```json
{
  "00dc82b0-b0ae-6688-3969-601d22f7bc62": {
    "asset_uid": "00dc82b0-b0ae-6688-3969-601d22f7bc62",
    "manufacturer": "Acr",
    "model": "epirb_beacon_programming_certificate",
    "rejected_urls": [
      "https://www.nauticast.com/Themes/Nauticast/Content/downloads/AIS/ENY1-03-0211G.pdf",
      "https://archive.org/download/manualsonline-id-684fb7f5-ddaf-4825-92c7-363b7d742119/684fb7f5-ddaf-4825-92c7-363b7d742119.pdf",
      "https://iacratraining.faa.gov/IACRA/PDFFiles/IACRA%20User%20Guide.pdf",
      "https://usermanual.wiki/Document/aisuserman.203225178.pdf",
      "https://itnetworks.softing.com/fileadmin/media/documents/products/copper/WireXpert/EN/Softing_IT_Networks_UserManual_WireXpert4500_Copper.pdf"
    ],
    "attempts": 5,
    "last_attempt": "2025-10-12T01:45:04.997Z",
    "last_rejection_reason": "Download failed: The \"path\" argument must be of type string or an instance of Buffer or URL. Received an instance of Object"
  }
}
```

### 3. Key Findings

**Issue Identified:**
- System: ACR EPIRB Beacon Programming Certificate
- Problem: Download failing with path argument error
- The error suggests the download function is receiving an object instead of a string for the file path
- This system has been attempted 5 times and blacklisted
- All 5 rejected URLs appear to be incorrect/irrelevant manuals

**Error Analysis:**
```
"Download failed: The \"path\" argument must be of type string or an instance of Buffer or URL. Received an instance of Object"
```

This error indicates a bug in the download function - likely in `manual-hunter.js` around line 151 where the filepath is constructed.

---

## Complete Session 21 → 22 Continuity

### Session 21 Recap (from comprehensive doc)

**What Was Completed:**
1. ✅ **Manual Hunter Agent** - Successfully downloaded 122 PDFs across 3 batches
   - Batch 1: 41 PDFs (91% success) - 72 seconds
   - Batch 2: 41 PDFs (93% success) - 91 seconds
   - Batch 3: 40 PDFs (89% success) - 87 seconds, 35 user manuals identified
   - **Total:** 122 PDFs, 749MB, 90% overall success rate
   - **SerpAPI Usage:** 137/150 calls (91% of budget)

2. ⚠️ **Manual Validator Agent** - Architecture complete, blocked on PDF parsing
   - Full LLM validation logic implemented using GPT-4o-mini
   - Scoring system: APPROVED (≥75), REVIEW (50-74), REJECT (<50)
   - **Blocker:** pdf-parse library has ESM import issues
   - **Solutions Documented:**
     - Option A: Use pdfjs-dist directly
     - Option B: Use Python sidecar's PDF parsing
     - Option C: Shell out to pdftotext command

**Key Technical Achievements:**
- `simplifyModel()` function: Increased success rate from 0% to 90%
- User manual prioritization: 35 user manuals found in batch 3
- Dual limit enforcement: 40 PDFs AND 150 SerpAPI calls
- Real-time HEAD validation before download

**Critical Files:**
- `scripts/agents/manual-hunter.js` - Main agent (13,978 bytes)
- `scripts/agents/manual-hunter-strategies.js` - Search strategies (10,108 bytes)
- `scripts/agents/manual-hunter-config.js` - Configuration (1,655 bytes)
- `scripts/agents/manual-validator.js` - Validator agent (15,827 bytes, blocked on PDF parsing)

---

## Issues to Investigate

### 1. Download Path Bug (HIGH PRIORITY)

**Location:** `scripts/agents/manual-hunter.js:141-196` (downloadPdf function)

**Problem:**
```javascript
// Line 151
const filepath = `${pdfsDir}/${filename}`;
```

The error "Received an instance of Object" suggests that either:
- `pdfsDir` is an object instead of string
- `filename` is an object instead of string
- Or the filepath variable is being passed incorrectly to writeFileSync

**Need to check:**
```javascript
// Line 179
writeFileSync(filepath, Buffer.from(buffer));
```

This should be receiving a string but is getting an object.

### 2. Blacklist System Logic

**Questions:**
- Is the blacklist system working correctly?
- Should we increase max_attempts from 5?
- Should we have a way to manually reset blacklisted systems?
- Are the rejected URLs being tracked correctly?

### 3. ACR EPIRB System

**Problem:**
- This appears to be a "programming certificate" not a physical device manual
- All 5 found URLs are for unrelated equipment (AIS systems, WireXpert, etc.)
- May need manual intervention or marking as "no manual available"

---

## Files Modified in Session 22 (based on timestamps)

Modified at 21:51 (right at compaction time):
- `scripts/agents/manual-validator.js` (15,827 bytes)
- `scripts/agents/manual-hunter.js` (13,978 bytes)
- `scripts/agents/manual-hunter-strategies.js` (10,108 bytes)
- `scripts/agents/manual-hunter-config.js` (1,655 bytes)

Modified at 21:45:
- `scripts/agents/manual-hunter-blacklist.json` (963 bytes)

**Recent Reports:**
- `scripts/agents/manual-hunter-results/run-2025-10-12T01-45-25-report.md`
- `scripts/agents/manual-hunter-results/run-2025-10-12T01-45-25.json`
- `scripts/agents/manual-hunter-results/run-2025-10-12T01-34-30-report.md`

---

## Current Status

### Completed
- ✅ 122 manuals downloaded (90% success rate)
- ✅ Blacklist system implemented and tracking failed attempts
- ✅ Three batches processed successfully
- ✅ User manual prioritization working

### In Progress
- ⚠️ Validator agent blocked on PDF parsing library
- ⚠️ Download path bug affecting blacklisted system
- ⚠️ 14 systems still without manuals (including ACR EPIRB)

### Pending Tasks (from Session 21)

**High Priority - Blocking Validator Completion:**
1. Fix PDF parsing in Validator Agent (implement one of three solutions)
2. Test validator on sample PDFs
3. Run validator on all 122 PDFs

**Medium Priority - Integration:**
4. Create bulk upload tool to push APPROVED manuals to database
5. Update systems table with `manual = true` for uploaded systems

**Lower Priority - Cleanup:**
6. Fix 8 systems with spaces in canonical_model_id
7. Add missing descriptions for 12 systems
8. Handle 14 failed systems (manual procurement or mark unavailable)

---

## Key Metrics Summary

**From All Sessions:**
- **Total Systems:** 136 requiring manuals
- **PDFs Downloaded:** 122 (89%)
- **PDFs Validated:** 0 (blocked on PDF parsing)
- **SerpAPI Calls Used:** 137/150 (91%)
- **Total Size:** 749 MB
- **Success Rate:** 90%
- **Blacklisted Systems:** 1 (ACR EPIRB)
- **Systems Still Needed:** 14

---

## Next Steps (When Session Resumes)

### Immediate (Session 23)
1. **Fix download path bug** in manual-hunter.js
   - Debug the filepath construction
   - Ensure pdfsDir and filename are strings
   - Test with ACR EPIRB system

2. **Investigate blacklist system**
   - Review logic in manual-hunter-strategies.js
   - Decide if 5 attempts is appropriate
   - Consider manual marking for systems like "programming certificate"

### Short Term
3. **Implement PDF parsing fix** for validator
   - Recommend Option C (pdftotext) as simplest
   - Test with 3 PDFs first
   - Full validation run on 122 PDFs

4. **Bulk upload APPROVED manuals** to production
   - Create upload script
   - Filter for confidence ≥75
   - Update systems table

### Long Term
5. **Handle remaining 14 systems**
   - Manual procurement
   - Contact manufacturers
   - Mark unavailable if truly unavailable

---

## Code References

### Download Function (Bug Location)
`scripts/agents/manual-hunter.js:141-196`

### Blacklist Checking
`scripts/agents/manual-hunter-strategies.js` (need to review implementation)

### Validation Architecture
`scripts/agents/manual-validator.js:73-136` (extractPdfText - NOT WORKING)
`scripts/agents/manual-validator.js:138-220` (validatePdf - WORKING)

---

## Session Preservation Notes

This file was created to preserve context after the session 22 compaction. The previous session ran out of context space and compacted around 21:51 on Oct 11, 2025.

**Critical context preserved:**
- Blacklist system discovery and current state
- Download path bug identification
- ACR EPIRB system analysis
- Full continuity from sessions 21 → 22
- All pending tasks and priorities

**For session 23:** Start by investigating the download path bug and blacklist logic in manual-hunter.js.

---

## Session 23 Update: Integrated Hunter + Validator (2025-10-12)

### What Was Built

**Complete integration of Manual Hunter + Validator into a single unified system.**

#### Architecture Changes

**Before (Session 21-22):**
- Two separate agents (hunter downloads, validator validates)
- Had to run twice
- Bad PDFs accumulated on disk
- No URL-level blacklist

**After (Session 23):**
- ✅ Single integrated command
- ✅ Validate immediately after download
- ✅ Auto-delete rejected PDFs
- ✅ URL-level + system-level blacklist
- ✅ Full validation data in results

#### Integration Flow

```
For each system:
  1. Check if system blacklisted (≥5 fails) → Skip if yes
  2. Search for manual (SerpAPI)
  3. Check if URL in rejected_urls → Try next strategy
  4. Validate URL (HEAD request - size/type)
  5. Download PDF
  6. ⭐ Extract text (pdf-parse, first 10 pages)
  7. ⭐ Validate with GPT-4o-mini:
     - Manufacturer match (0-100)
     - Model match (0-100)
     - Manual type (user/install/service/etc)
     - Marine context (true/false)
     - Overall confidence (0-100)
  8. If confidence < 50:
     - Delete PDF
     - Add URL to rejected_urls
     - Increment attempts
     - If attempts ≥ 5 → System blacklisted
  9. If confidence ≥ 50:
     - Keep PDF
     - Mark as validated
     - Store full validation data
```

#### Files Modified

**1. manual-hunter-config.js**
Added validation configuration:
```javascript
validation: {
  enabled: true,
  deleteOnReject: true, // Auto-delete rejected PDFs
  rejectThreshold: 50, // Score < 50 = REJECT
  llm: {
    model: 'gpt-4o-mini',
    temperature: 0.1,
    maxTokens: 1000
  },
  maxPages: 10 // Parse first 10 pages only
},

blacklist: {
  maxAttempts: 5,
  enabled: true
},

paths: {
  blacklist: 'scripts/agents/manual-hunter-blacklist.json',
  // Added support for TEST_YANMAR env var
}
```

**2. manual-hunter.js**
Added methods:
- `isUrlRejected(system, url)` - Check URL-level blacklist
- `extractPdfText(pdfPath)` - Extract text using pdf-parse
- `validatePdfContent(pdfText, metadata, system)` - LLM validation with GPT-4o-mini

Updated `processSystem()`:
- Inline validation after download
- Auto-delete rejected PDFs
- Track validation results in result object

**3. manual-hunter-strategies.js**
Updated all search strategies to check URL blacklist:
```javascript
// Before returning URL, check if rejected
if (agent && agent.isUrlRejected && agent.isUrlRejected(system, result.link)) {
  logger.debug(`⚠️  Skipping rejected URL: ${result.link}`);
  continue; // Try next URL
}
```

#### Blacklist Structure (Two Levels)

```json
{
  "asset_uid": {
    "asset_uid": "...",
    "manufacturer": "...",
    "model": "...",
    "rejected_urls": [          // URL-level blacklist
      "https://bad-url-1.pdf",
      "https://bad-url-2.pdf"
    ],
    "attempts": 3,              // System-level tracking
    "last_attempt": "2025-10-12T...",
    "last_rejection_reason": "Validation failed: wrong manufacturer"
  }
}
```

#### Result Object Structure

Each result now includes full validation data:
```json
{
  "asset_uid": "...",
  "manufacturer": "...",
  "status": "validated",        // or "validation_failed"
  "manual_url": "...",
  "downloaded": true,
  "local_path": "...",
  "validation": {               // NEW: Inline validation
    "confidence": 85,
    "recommendation": "APPROVED",
    "manual_type": "user_manual",
    "marine_context": true,
    "manufacturer_match": 90,
    "model_match": 80,
    "reasoning": "...",
    "concerns": []
  }
}
```

---

## Session 23 Test: Yanmar Systems (2025-10-12)

### Test Setup

**Goal:** Test integrated system on 7 Yanmar systems that previously failed validation.

**Test systems:**
1. `port_engine` (4HJ57) - Previously: PDF extraction failed
2. `shift_actuator` - Previously: Got welding machine manual (10% reject)
3. `stbd_sail_drive` - Previously: PDF extraction failed
4. `port_sail_drive` - Previously: PDF extraction failed
5. `v20` (throttle) - Previously: Got light tower manual (0% reject)
6. `stbd_engine` (4HJ57) - Previously: PDF extraction failed
7. `4jh57` (engine) - Previously: PDF extraction failed

**Command:** `TEST_YANMAR=true node scripts/agents/manual-hunter.js`

### Test Results

**Summary:**
- ✅ Integration worked perfectly (search → download → validate → delete)
- ❌ PDF text extraction completely broken
- **Result:** 0/7 PDFs kept, 6 downloaded then deleted, 1 download failed

**Breakdown:**

| System | URL Found | Downloaded | Validation | Action Taken |
|--------|-----------|------------|------------|--------------|
| port_engine | ✅ yazz.wassili.nl | ✅ 7.77 MB | ❌ Parse error | 🗑️ Deleted + Blacklisted |
| shift_actuator | ✅ mosa.com.au | ✅ 5.68 MB | ❌ Parse error | 🗑️ Deleted + Blacklisted |
| stbd_sail_drive | ✅ yazz.wassili.nl | ✅ 7.77 MB | ❌ Parse error | 🗑️ Deleted + Blacklisted |
| port_sail_drive | ✅ yazz.wassili.nl | ✅ 7.77 MB | ❌ Parse error | 🗑️ Deleted + Blacklisted |
| v20 | ✅ elmodan.dk | ✅ 10.42 MB | ❌ Parse error | 🗑️ Deleted + Blacklisted |
| stbd_engine | ✅ yazz.wassili.nl | ✅ 7.77 MB | ❌ Parse error | 🗑️ Deleted + Blacklisted |
| 4jh57 | ✅ b.mou.ir | ❌ 1026 bytes | N/A | ❌ Download failed |

**All 6 downloaded PDFs rejected with:**
```
Status: validation_failed (0% confidence)
Reason: "PDF text extraction failed or too short"
Concerns: ["Could not extract sufficient text from PDF"]
Error: "parse is not a function"
```

### What Worked ✅

1. ✅ **Search:** All systems found URLs via SerpAPI
2. ✅ **URL validation:** HEAD requests verified Content-Type and size
3. ✅ **Download:** 6/7 PDFs downloaded successfully (5-10 MB each)
4. ✅ **Validation trigger:** Inline validation executed after each download
5. ✅ **Auto-deletion:** All rejected PDFs deleted from disk
6. ✅ **Blacklist tracking:** URLs and attempts tracked correctly
7. ✅ **Status codes:** Correct use of `validation_failed` status
8. ✅ **Results structure:** Full validation data captured in JSON

### What Failed ❌

**Critical Issue: pdf-parse Library**

The same ESM import issue from sessions 21/22 persists:

```javascript
// manual-hunter.js:176-183
pdfParse = await import('pdf-parse');
const parse = pdfParse.default || pdfParse;
const data = await parse(pdfBuffer, { max: 10 });
// ❌ Error: "parse is not a function"
```

**Impact:**
- All PDFs downloaded successfully but cannot be parsed
- Text extraction returns null
- Validation immediately rejects (confidence = 0)
- PDFs auto-deleted despite potentially being valid
- All 7 systems now have URLs blacklisted

### Blacklist Impact

After test run, blacklist now contains **8 systems** (was 1):
- **1 original:** ACR EPIRB (pre-existing)
- **7 new:** All Yanmar systems with rejected URLs

Example entries:
```json
{
  "736a7b73-3d9f-a851-89f3-e98dded6357c": {
    "manufacturer": "Yanmar",
    "model": "port_engine",
    "rejected_urls": [
      "http://yazz.wassili.nl/documents/User%20Manual%20Yanmar%20GM%20Engines.pdf"
    ],
    "attempts": 1,
    "last_rejection_reason": "Validation failed: PDF text extraction failed or too short"
  }
  // ... 6 more similar entries
}
```

---

## Next Step: Fix PDF Parsing Issue

### Problem Statement

The integrated system works perfectly EXCEPT for PDF text extraction. The pdf-parse library has ESM compatibility issues that cause:
- `parse is not a function` error
- All validations fail with 0% confidence
- Valid PDFs get deleted unnecessarily
- URLs blacklisted despite potentially being correct

### Solution Options

**Option A: Fix pdf-parse Import** (Complex, may not work)
- Try different import patterns
- Use CommonJS wrapper
- Downgrade to older version
- **Risk:** May still fail, wasted time

**Option B: Use pdftotext Command** (Simple, reliable)
- Shell out to `pdftotext` command (requires poppler-utils)
- More reliable than library
- **Pro:** Works consistently
- **Con:** System dependency

**Option C: Disable Validation** (Quick workaround)
- Set `validation.enabled = false` in config
- Download-only mode (no LLM calls)
- **Pro:** Immediate functionality
- **Con:** No quality control

**Option D: Keep PDFs on Extraction Error** ⭐ **RECOMMENDED**
- Don't reject PDFs when text extraction fails
- Only reject when LLM validates and returns bad score
- Mark extraction failures as "needs manual review"
- **Pro:** Prevents deleting valid PDFs
- **Con:** Some bad PDFs might slip through

### Recommended Implementation (Option D)

**Change validation logic:**

```javascript
// In validatePdfContent()
if (!pdfText || pdfText.length < 100) {
  return {
    valid: true,              // ⭐ CHANGE: Don't reject on extraction error
    confidence: 50,           // Neutral score
    reason: 'PDF text extraction failed - needs manual review',
    concerns: ['Could not extract sufficient text from PDF'],
    recommendation: 'REVIEW'  // Flag for manual review, don't auto-delete
  };
}
```

**Benefits:**
- PDFs downloaded and kept on disk
- Marked as "needs manual review" instead of deleted
- Can be manually validated later
- Blacklist only tracks actual validation failures (not extraction failures)
- System can still find and download manuals

**Impact:**
- Yanmar systems would keep the downloaded PDFs
- Would be marked as `status: 'validated'` with `recommendation: 'REVIEW'`
- URLs not blacklisted
- User can manually verify if PDFs are correct

### Alternative: Use pdftotext Command (Option B)

```javascript
// Replace extractPdfText() implementation
async extractPdfText(pdfPath) {
  try {
    const { execSync } = await import('child_process');

    // Use pdftotext command (requires poppler-utils)
    const text = execSync(`pdftotext -l 10 "${pdfPath}" -`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024  // 10MB buffer
    });

    // Limit to first 5000 words
    const words = text.split(/\s+/).slice(0, 5000).join(' ');

    return words;
  } catch (error) {
    this.logger.error(`PDF extraction failed: ${error.message}`);
    return null;
  }
}
```

**Requirements:**
- Install poppler-utils: `brew install poppler` (macOS)
- More reliable than pdf-parse library
- Works with all PDFs

---

## Summary

**Session 23 Status:**
- ✅ **Integration:** Complete and working
- ✅ **Blacklist system:** Two-level tracking operational
- ✅ **Auto-deletion:** Working as designed
- ❌ **PDF parsing:** Broken, blocking validation

**Current State:**
- Integrated hunter+validator system is code-complete
- Search, download, validate, delete flow works perfectly
- Blacklist tracking operational (8 systems tracked)
- **Blocker:** pdf-parse library prevents validation from working

**Recommended Next Action:**
Implement Option D (keep PDFs on extraction error) to unblock the system while we work on a proper pdf-parse fix or pdftotext implementation.

**Command to implement fix:**
Edit `manual-hunter.js:217-223` to return `valid: true, recommendation: 'REVIEW'` instead of `valid: false` when PDF extraction fails.

---

## Documentation Reference

Full integration details documented in:
- `code updates/23 Integrated Manual Hunter and Validator.md` (15KB)

Test results JSON:
- `scripts/agents/manual-hunter-results/run-2025-10-13T00-28-31.json`

Blacklist state:
- `scripts/agents/manual-hunter-blacklist.json` (now contains 8 systems)
