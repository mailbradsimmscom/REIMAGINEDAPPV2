# Session 21: Manual Hunter & Validator Agents - Complete Implementation

**Date:** 2025-10-11
**Status:** Manual Hunter ✅ Complete | Validator ⚠️ PDF parsing issues
**Duration:** ~3 hours

---

## Table of Contents
1. [Overview](#overview)
2. [Manual Hunter Agent - COMPLETE](#manual-hunter-agent)
3. [Manual Validator Agent - IN PROGRESS](#manual-validator-agent)
4. [Results Achieved](#results-achieved)
5. [Files Created](#files-created)
6. [Known Issues](#known-issues)
7. [Next Steps](#next-steps)

---

## Overview

### Problem Statement
- **136 marine systems** in database need manuals
- Manual procurement is time-intensive (weeks of work)
- Need to prioritize USER MANUALS over installation guides
- Need validation to ensure downloaded PDFs are correct

### Solution Built
1. **Manual Hunter Agent**: Automated PDF search and download using SerpAPI
2. **Manual Validator Agent**: LLM-based validation of downloaded manuals

---

## Manual Hunter Agent - COMPLETE ✅

### What It Does
Automatically searches for and downloads PDF manuals for marine equipment systems using:
- **SerpAPI** for Google searches
- **ManualsLib.com** scraping
- **Archive.org** searches
- Pattern-based manufacturer URLs

### Architecture

```
┌─────────────────────────────────────────────┐
│  1. Export Systems (systems-needing-manuals.csv)  │
│     Query: manual != true                   │
│     Result: 136 systems                     │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  2. Manual Hunter Agent                     │
│     - Batch processing (5 at a time)        │
│     - 40 PDF download limit                 │
│     - 150 SerpAPI call limit                │
│     - Query simplification (dst810 vs full) │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  3. Search Strategies (priority order)      │
│     1. SerpAPI: "mfg" "model" "user manual" │
│     2. ManualsLib: HTTP scraping            │
│     3. Archive.org: Search API              │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  4. Validation & Download                   │
│     - HEAD request (Content-Type, size)     │
│     - Binary download (10KB - 50MB)         │
│     - Disk write with error handling        │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  5. Output                                  │
│     - JSON results                          │
│     - Markdown report                       │
│     - Downloaded PDFs                       │
└─────────────────────────────────────────────┘
```

### Key Implementation Details

#### Query Simplification (Critical for Success)
```javascript
// BEFORE (0% success rate)
"Airmar" "triducer_multisensor_airmar_dst810" manual filetype:pdf

// AFTER (90%+ success rate)
"Airmar" "dst810" manual filetype:pdf

// Implementation:
function simplifyModel(modelNorm) {
  // Extract alphanumeric sequences that look like model numbers
  const modelPattern = /([A-Z]{2,}[-\s]?\d+[A-Z]*|\d+[A-Z]{2,})/i;
  const match = modelNorm.match(modelPattern);

  if (match) {
    return match[0].replace(/[-_\s]/g, '');
  }

  // Fallback: Remove underscores, take last significant word
  const words = modelNorm.split('_').filter(w => w.length > 2);
  return words[words.length - 1] || modelNorm;
}
```

#### User Manual Prioritization (Batch 3 Enhancement)
```javascript
// Prioritize user manuals, de-prioritize installation guides
const userManualResults = [];
const otherResults = [];

for (const result of organicResults) {
  const title = (result.title || '').toLowerCase();
  const link = result.link.toLowerCase();

  if (title.includes('user') || link.includes('user')) {
    userManualResults.push({ ...result, priority: 'high' });
  } else if (title.includes('install') || link.includes('install')) {
    otherResults.push({ ...result, priority: 'low' });
  } else {
    otherResults.push({ ...result, priority: 'medium' });
  }
}

// Return user manuals first, then general, then installation as fallback
```

#### SerpAPI Integration
```javascript
const query = `"${manufacturer}" "${simpleModel}" "user manual" filetype:pdf`;
const searchUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${serpApiKey}`;

const response = await fetch(searchUrl);
const data = await response.json();
const organicResults = data.organic_results || [];

// Extract PDF URLs from results
for (const result of organicResults) {
  if (result.link && result.link.toLowerCase().endsWith('.pdf')) {
    return {
      url: result.link,
      confidence: 'high',
      title: result.title,
      type: 'user_manual'
    };
  }
}
```

#### PDF Validation
```javascript
async validatePdf(url) {
  // HEAD request to check Content-Type and size
  const response = await fetch(url, {
    method: 'HEAD',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ManualHunter/1.0)' },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    return { valid: false, reason: `HTTP ${response.status}` };
  }

  // Check Content-Type
  const contentType = response.headers.get('content-type');
  if (!contentType.includes('application/pdf')) {
    return { valid: false, reason: `Wrong content type: ${contentType}` };
  }

  // Check file size (10KB - 50MB)
  const contentLength = parseInt(response.headers.get('content-length'), 10);
  if (contentLength < 10240) {
    return { valid: false, reason: 'File too small' };
  }
  if (contentLength > 52428800) {
    return { valid: false, reason: 'File too large' };
  }

  return { valid: true, size: contentLength };
}
```

#### PDF Download
```javascript
async downloadPdf(url, filename) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ManualHunter/1.0)' },
    signal: AbortSignal.timeout(60000)
  });

  const buffer = await response.arrayBuffer();
  const size = buffer.byteLength;

  // Validate size
  if (size < 10240 || size > 52428800) {
    throw new Error(`Invalid file size: ${size} bytes`);
  }

  // Write to disk
  writeFileSync(filepath, Buffer.from(buffer));

  this.pdfsDownloaded++;
  return { success: true, path: filepath, size };
}
```

### Configuration

**File:** `scripts/agents/manual-hunter-config.js`

```javascript
export const config = {
  maxPdfs: 40,                    // Stop after 40 downloads
  maxSerpApiCalls: 150,           // API budget limit
  batchSize: 5,                   // Process 5 systems in parallel
  requestDelay: 3000,             // 3 seconds between batches
  searchTimeout: 30000,           // 30 second timeout per search

  pdf: {
    minSize: 10 * 1024,           // 10 KB
    maxSize: 50 * 1024 * 1024,    // 50 MB
    contentTypes: ['application/pdf', 'application/x-pdf']
  },

  strategies: [
    { name: 'websearch', enabled: true },
    { name: 'manualslib', enabled: true },
    { name: 'archive', enabled: true },
    { name: 'manufacturer', enabled: false }
  ],

  paths: {
    input: process.env.BATCH === '3'
      ? 'scripts/agents/systems-needing-manuals-batch3.csv'
      : process.env.BATCH === '2'
      ? 'scripts/agents/systems-needing-manuals-batch2.csv'
      : 'scripts/agents/systems-needing-manuals.csv',
    output: 'scripts/agents/manual-hunter-results',
    pdfs: 'scripts/agents/manual-hunter-results/pdfs',
    state: 'scripts/agents/manual-hunter-state.json'
  }
};
```

### Running the Agent

#### Export Systems (One-time)
```bash
node scripts/export-systems-needing-manuals.js
# Output: scripts/agents/systems-needing-manuals.csv (136 systems)
```

#### Run Full Agent
```bash
# All systems
node scripts/agents/manual-hunter.js

# Test mode (3 systems)
TEST_MODE=true node scripts/agents/manual-hunter.js

# Specific batch
BATCH=2 node scripts/agents/manual-hunter.js
```

#### Background Execution
```bash
node scripts/agents/manual-hunter.js > manual-hunter-run.log 2>&1 &

# Monitor progress
tail -f manual-hunter-run.log
```

### Results Structure

#### JSON Output
```json
{
  "timestamp": "2025-10-11T17-21-52",
  "summary": {
    "total_systems": 45,
    "pdfs_downloaded": 41,
    "serpapi_calls": 45,
    "duration_seconds": 72,
    "status_breakdown": {
      "found": 41,
      "invalid": 2,
      "not_found": 2
    },
    "success_rate": "91.1%"
  },
  "results": [
    {
      "asset_uid": "603ed86f-...",
      "manufacturer": "Acr",
      "model": "epirb_beacon_programming_certificate",
      "system": "Safety",
      "subsystem": "Epirb/plb",
      "status": "found",
      "manual_url": "https://acrcarbon.org/.../ACR-Standard-v8.0.pdf",
      "source": "websearch",
      "confidence": "high",
      "verified": true,
      "downloaded": true,
      "local_path": "scripts/agents/manual-hunter-results/pdfs/Acr_epirb_beacon.pdf",
      "file_size": 2740000
    }
  ]
}
```

#### Markdown Report
```markdown
# Manual Hunter Report

**Generated:** 2025-10-11T17:21:52.000Z
**Duration:** 72s

## Summary
- **Total Systems:** 45
- **PDFs Downloaded:** 41/40
- **Success Rate:** 91.1%

## Found Manuals
### Acr epirb_beacon_programming_certificate
- **URL:** https://acrcarbon.org/.../ACR-Standard-v8.0.pdf
- **Source:** websearch
- **Downloaded:** Yes
- **System:** Safety / Epirb/plb

## Not Found
- Cyclops Marine smartlink_sr_5t_sr12_5t (Navigation / Sonar)
```

---

## Manual Validator Agent - IN PROGRESS ⚠️

### What It Does
Validates downloaded PDFs using LLM analysis to ensure:
1. Correct manufacturer match
2. Correct model match
3. Manual type (user manual vs installation guide)
4. Marine-specific vs generic
5. Content relevance to system description

### Architecture

```
┌─────────────────────────────────────────────┐
│  1. Load Metadata                           │
│     - systems-needing-manuals.csv           │
│     - manual-hunter-results/*.json          │
│     - Map PDFs to systems                   │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  2. Extract PDF Text                        │
│     - pdf-parse library                     │
│     - First 10 pages / 5000 words           │
│     - Extract metadata                      │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  3. LLM Validation (GPT-4o-mini)           │
│     - Manufacturer match (0-100)            │
│     - Model match (0-100)                   │
│     - Manual type classification            │
│     - Marine context check                  │
│     - Content relevance (0-100)             │
│     - Overall confidence (0-100)            │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  4. Scoring & Ranking                       │
│     - APPROVED: >=75                        │
│     - REVIEW: 50-74                         │
│     - REJECT: <50                           │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  5. Output                                  │
│     - Ranked CSV report                     │
│     - JSON results                          │
│     - Markdown summary                      │
└─────────────────────────────────────────────┘
```

### Implementation (Partial)

#### Configuration
**File:** `scripts/agents/manual-validator-config.js`

```javascript
export const config = {
  batchSize: 10,

  llamaParse: {
    maxPages: 10,
    timeout: 30000
  },

  llm: {
    model: 'gpt-4o-mini',
    temperature: 0.1,
    maxTokens: 1000
  },

  thresholds: {
    approved: 75,
    review: 50
  },

  paths: {
    pdfs: process.env.TEST_MODE_VALIDATOR === 'true'
      ? 'scripts/agents/manual-hunter-results/pdfs-test'
      : 'scripts/agents/manual-hunter-results/pdfs',
    systemsCsv: 'scripts/agents/systems-needing-manuals.csv',
    resultsJson: 'scripts/agents/manual-hunter-results/run-*.json',
    output: 'scripts/agents/validation-results',
    reportCsv: 'scripts/agents/validation-results/ranked-manuals.csv',
    reportJson: 'scripts/agents/validation-results/validation-results.json',
    reportMd: 'scripts/agents/validation-results/validation-report.md'
  }
};
```

#### LLM Validation Prompt
```javascript
const prompt = `
Expected Marine Equipment:
- Manufacturer: ${metadata.manufacturer}
- Model: ${metadata.model}
- Description: ${systemInfo?.description || 'N/A'}
- System Type: ${metadata.system} / ${metadata.subsystem}

PDF Content (first 10 pages):
${pdfText.substring(0, 4000)}

Validate this PDF and provide scores (0-100):

1. manufacturer_match: Does the PDF match the expected manufacturer?
2. model_match: Does the model number in the PDF match the expected model?
3. manual_type: What type is this? ("user_manual" | "installation_guide" | "service_manual" | "parts_catalog" | "unknown")
4. marine_context: Is this specifically for marine/boat use? (true/false)
5. content_relevance: Does the content match the system description?

Also provide:
- overall_confidence: Overall score 0-100
- reasoning: Brief explanation of scores
- concerns: Array of any issues found
- recommendation: "APPROVED" (>=75) | "REVIEW" (50-74) | "REJECT" (<50)

Return ONLY valid JSON, no markdown.
`;

const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a marine systems documentation expert. Validate PDFs and return structured JSON.'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    temperature: 0.1,
    max_tokens: 1000,
    response_format: { type: 'json_object' }
  })
});
```

#### Expected Output Structure
```json
{
  "manufacturer_match": 95,
  "model_match": 90,
  "manual_type": "user_manual",
  "marine_context": true,
  "content_relevance": 88,
  "overall_confidence": 90,
  "reasoning": "Correct manufacturer and model. User manual clearly labeled. Marine-specific documentation with boat terminology.",
  "concerns": ["Model number format slightly different (DST-810 vs dst810)"],
  "recommendation": "APPROVED"
}
```

#### Output Reports

**CSV:** `validation-results/ranked-manuals.csv`
```csv
rank,filename,confidence,recommendation,manual_type,marine_specific,manufacturer_match,model_match,concerns
1,Airmar_dst810.pdf,95,APPROVED,user_manual,true,100,95,""
2,Acuva_water.pdf,88,APPROVED,user_manual,true,100,85,"Generic model variant"
...
```

**Markdown:** `validation-results/validation-report.md`
```markdown
# Manual Validation Report

**Generated:** 2025-10-11T20:30:00.000Z
**Duration:** 180s

## Summary
- **Total Manuals:** 122
- **Approved:** 95 (77.9%)
- **Review Needed:** 18 (14.8%)
- **Rejected:** 9 (7.3%)

## Document Types
- **User Manuals:** 78
- **Installation Guides:** 31
- **Marine-Specific:** 103

## Top 10 Approved Manuals
1. **Airmar_dst810.pdf** (95%)
   - Type: user_manual
   - Marine: Yes

...
```

---

## Results Achieved

### Manual Hunter - 3 Batches Completed

#### Batch 1 (Systems 1-45)
```
Duration: 72 seconds
Systems Processed: 45
PDFs Downloaded: 41
SerpAPI Calls: 45/150
Success Rate: 91.1%
```

#### Batch 2 (Systems 46-90)
```
Duration: 91 seconds
Systems Processed: 45
PDFs Downloaded: 41
SerpAPI Calls: 45/150
Success Rate: 93.3%
```

#### Batch 3 (Systems 91-136) - With User Manual Priority
```
Duration: 87 seconds
Systems Processed: 47
PDFs Downloaded: 40
User Manuals Found: 35 (marked explicitly)
SerpAPI Calls: 47/150
Success Rate: 89.4%
```

#### Combined Totals
```
📦 Total PDFs Downloaded: 122 manuals
💾 Total Size: 749 MB
🎯 User Manuals Found: 35+ (batch 3 only)
🔍 SerpAPI Calls Used: 137/150 (91%)
📊 Systems Processed: 136/136 (100%)
✨ Overall Success Rate: 90%
⏱️ Total Duration: ~4 minutes
💰 Estimated Cost: $0.14 (SerpAPI free tier)
```

### Sample Successful Downloads
```
✅ Acr_epirb_beacon_programming_certificate.pdf (2.7 MB)
✅ Airmar_dst810_smart_multisensor.pdf (5.3 MB)
✅ Acuva_uv_led_water_purification_system.pdf (964 KB)
✅ Bosch_induction_hob.pdf (7.9 MB)
✅ Cyclops_Marine_bg03_smartfittings_gateway.pdf (1.3 MB)
✅ Peplink_balance_20x_2_wan.pdf (9.7 MB)
✅ Yanmar_port_sail_drive.pdf (7.8 MB)
... 115 more
```

### Files Not Found (14 systems)
```
❌ Cyclops Marine smartlink_sr_5t_sr12_5t
❌ Yanmar 4jh57 (PDF found but too small: 1KB)
... 12 more
```

---

## Files Created

### Core Agent Files

#### Manual Hunter Agent
```
scripts/agents/
├── manual-hunter.js                         # Main agent (550 lines)
├── manual-hunter-config.js                  # Configuration (60 lines)
├── manual-hunter-strategies.js              # Search strategies (310 lines)
├── systems-needing-manuals.csv              # Input (136 systems)
├── systems-needing-manuals-batch2.csv       # Batch 2 input (92 systems)
├── systems-needing-manuals-batch3.csv       # Batch 3 input (47 systems)
├── systems-needing-manuals-test.csv         # Test input (3 systems)
├── test-manual-hunter.sh                    # Test script
└── README.md                                # Documentation

scripts/agents/manual-hunter-results/
├── pdfs/                                    # Downloaded PDFs (122 files, 749MB)
├── run-2025-10-11T17-21-52.json            # Batch 1 results
├── run-2025-10-11T17-21-52-report.md       # Batch 1 report
├── run-2025-10-11T18-24-26.json            # Batch 2 results
├── run-2025-10-11T18-24-26-report.md       # Batch 2 report
├── run-2025-10-11T20-22-19.json            # Batch 3 results
└── run-2025-10-11T20-22-19-report.md       # Batch 3 report

scripts/agents/
├── manual-hunter-run.log                    # Batch 1 execution log
├── manual-hunter-run-batch2.log             # Batch 2 execution log
└── manual-hunter-run-batch3.log             # Batch 3 execution log
```

#### Manual Validator Agent (Incomplete)
```
scripts/agents/
├── manual-validator.js                      # Main agent (540 lines) ⚠️
├── manual-validator-config.js               # Configuration (40 lines) ✅
├── test-validator.sh                        # Test script ✅
├── test-pdf-parse.js                        # PDF parsing test ⚠️
└── STATUS.md                                # Status documentation ✅

scripts/agents/validation-results/
├── ranked-manuals.csv                       # Output (empty - not working)
├── validation-results.json                  # Output (empty - not working)
└── validation-report.md                     # Output (empty - not working)
```

#### Supporting Files
```
scripts/
├── export-systems-needing-manuals.js        # Export utility (100 lines)
└── analyze-systems-noise.js                 # Analysis utility (140 lines)

.github/workflows/
└── manual-hunter.yml                        # GitHub Actions workflow (ready but not used)
```

---

## Known Issues

### 1. Manual Validator - PDF Parsing Not Working ⚠️

**Problem:**
```javascript
// pdf-parse library has ESM export issues
import { PDFParse } from 'pdf-parse';  // ❌ Doesn't work
const parser = new PDFParse({});       // ❌ Class constructor issues
parser.load(buffer);                    // ❌ Requires 'url' parameter
```

**Error Messages:**
```
- "The requested module 'pdf-parse' does not provide an export named 'default'"
- "Class constructor PDFParse cannot be invoked without 'new'"
- "parser.parse is not a function"
- "getDocument - no `url` parameter provided"
```

**Attempted Solutions:**
1. Default import: `import pdf from 'pdf-parse'` - Failed
2. Named import: `import { PDFParse } from 'pdf-parse'` - Failed
3. Dynamic import: `await import('pdf-parse')` - Failed
4. Class instantiation: `new PDFParse({})` - Failed
5. Parser methods: `.parse()`, `.parseBuffer()`, `.load()`, `.getText()` - All failed

**Root Cause:**
- `pdf-parse` library has complex ESM/CommonJS interop issues
- Library exports `PDFParse` class but doesn't expose parsing methods correctly
- Requires `pdfjs-dist` which expects file paths not buffers

**Workaround Options:**
1. **Use a different PDF parsing library:**
   - `pdf2json` (simpler API)
   - `pdfreader` (event-based)
   - `pdfjs-dist` directly (more complex but reliable)

2. **Use LlamaParse API directly:**
   - Already have `LLAMAPARSE_API_KEY` in `.env`
   - Requires fixing form-data upload
   - Costs: 1000 pages/day free tier

3. **Use Python sidecar:**
   - Call existing Python PDF parsing via HTTP
   - More reliable, already working in codebase

4. **Shell out to `pdftotext`:**
   - System command if available
   - Simple and reliable
   - `pdftotext file.pdf -`

### 2. Minor Issues

#### Manual Hunter
- **No resume capability:** If agent crashes, starts over (not implemented state management)
- **Large PDFs timeout:** 60-second limit may not be enough for very large files
- **Rate limiting:** No retry logic for failed SerpAPI calls

#### General
- **No bulk upload tool:** Need to manually upload 122 PDFs to system
- **No systems table update:** Need to mark `manual = true` for downloaded systems
- **No deduplication:** May download same PDF twice if run multiple times

---

## Next Steps

### Immediate (To Continue Session)

#### 1. Fix PDF Parsing in Validator
**Option A: Use pdfjs-dist directly**
```bash
npm install pdfjs-dist
```

```javascript
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

async function extractPdfText(pdfPath) {
  const data = new Uint8Array(readFileSync(pdfPath));
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;

  let text = '';
  const maxPages = Math.min(10, pdf.numPages);

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    text += pageText + '\n';
  }

  return text.split(/\s+/).slice(0, 5000).join(' ');
}
```

**Option B: Use Python sidecar**
```javascript
async function extractPdfText(pdfPath) {
  const response = await fetch('http://localhost:8000/parse-pdf', {
    method: 'POST',
    body: readFileSync(pdfPath),
    headers: { 'Content-Type': 'application/pdf' }
  });

  const data = await response.json();
  return data.text.slice(0, 5000);
}
```

**Option C: Use pdftotext command**
```javascript
import { execSync } from 'child_process';

async function extractPdfText(pdfPath) {
  try {
    const text = execSync(`pdftotext "${pdfPath}" -`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    return text.split(/\s+/).slice(0, 5000).join(' ');
  } catch (error) {
    throw new Error(`pdftotext failed: ${error.message}`);
  }
}
```

#### 2. Test Validator on 3 PDFs
```bash
# After fixing PDF parsing
TEST_MODE_VALIDATOR=true node scripts/agents/manual-validator.js
```

#### 3. Run Validator on All 122 PDFs
```bash
node scripts/agents/manual-validator.js

# Expected output:
# - validation-results/ranked-manuals.csv
# - validation-results/validation-report.md
# - ~$12 cost for GPT-4o-mini (122 PDFs × $0.10 each)
```

### Short-term (Next Session)

#### 4. Create Bulk Upload Tool
```javascript
// scripts/bulk-upload-manuals.js
// Reads validation-results/ranked-manuals.csv
// Filters APPROVED manuals
// Uploads via POST /admin/api/documents/upload
// Updates systems table with manual = true
```

#### 5. Update Systems Table
```sql
-- Mark systems as having manuals
UPDATE systems
SET manual = true
WHERE asset_uid IN (
  -- List of 122 asset_uids from successful downloads
);
```

#### 6. Handle Failed Systems
```javascript
// For 14 systems without manuals:
// 1. Manual procurement (Google search, manufacturer contact)
// 2. Re-run hunter with different strategies
// 3. Mark as "manual_unavailable" in database
```

### Medium-term (Future Enhancements)

#### 7. Add State Management to Hunter
```javascript
// manual-hunter-state.json
{
  "lastProcessed": 45,
  "completed": ["asset_uid_1", "asset_uid_2"],
  "failed": ["asset_uid_x"],
  "resumed": false
}

// Enable resume on crash:
if (existsSync(stateFile)) {
  const state = JSON.parse(readFileSync(stateFile));
  systems = systems.filter(s => !state.completed.includes(s.asset_uid));
}
```

#### 8. Improve Search Strategies
```javascript
// Add retry logic with exponential backoff
async function retrySearch(system, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await searchSystems(system);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await setTimeout(1000 * Math.pow(2, i)); // 1s, 2s, 4s
    }
  }
}

// Add fallback queries
const queries = [
  `"${manufacturer}" "${model}" "user manual" filetype:pdf`,
  `"${manufacturer}" "${model}" manual filetype:pdf`,  // Fallback
  `${manufacturer} ${model} manual PDF`,               // Fallback 2
];
```

#### 9. Add Manual Management UI
```javascript
// Admin dashboard feature:
// - View all 122 manuals
// - Preview PDFs inline
// - Edit metadata
// - Re-run validation
// - Bulk actions (approve, reject, re-download)
```

---

## Code Snippets for Quick Reference

### Run Manual Hunter (All Batches)
```bash
# Batch 1 (systems 1-45)
node scripts/agents/manual-hunter.js

# Batch 2 (systems 46-90)
BATCH=2 node scripts/agents/manual-hunter.js

# Batch 3 (systems 91-136)
BATCH=3 node scripts/agents/manual-hunter.js
```

### Check Results
```bash
# View downloaded PDFs
ls -lh scripts/agents/manual-hunter-results/pdfs/ | wc -l
du -sh scripts/agents/manual-hunter-results/pdfs/

# View latest report
cat scripts/agents/manual-hunter-results/run-*-report.md | tail -100

# View JSON results
cat scripts/agents/manual-hunter-results/run-*.json | python3 -m json.tool | head -50
```

### Query Systems Table
```sql
-- Count systems needing manuals
SELECT COUNT(*) FROM systems WHERE manual != true OR manual IS NULL;

-- List systems with manuals downloaded
SELECT s.asset_uid, s.manufacturer_norm, s.model_norm
FROM systems s
WHERE s.asset_uid IN (
  -- List from manual-hunter-results/*.json
);

-- Update after upload
UPDATE systems SET manual = true WHERE asset_uid = 'xxx';
```

### Validation (Once Fixed)
```bash
# Test on 3 PDFs
TEST_MODE_VALIDATOR=true node scripts/agents/manual-validator.js

# Validate all PDFs
node scripts/agents/manual-validator.js

# View ranked results
cat scripts/agents/validation-results/ranked-manuals.csv | head -20
```

---

## Environment Variables Used

```bash
# Required for Manual Hunter
SERPAPI_KEY=a36a146d47c69325a063f5ad4fc8675fdb50b8581ea66b6bf110c4d5056e3e78

# Required for Validator (not yet working)
OPENAI_API_KEY=<from .env>
LLAMAPARSE_API_KEY=llx-P0ssUVpqgHwmMBs8Qy3DvjCSvAQHGr0YJb9I4gT8bKTFiFuB

# Database
DATABASE_URL=<from .env>
SUPABASE_URL=<from .env>
SUPABASE_KEY=<from .env>

# Optional
TEST_MODE=true                    # Use test CSV (3 systems)
TEST_MODE_VALIDATOR=true          # Use test PDF directory
BATCH=2                           # Use batch 2 CSV
BATCH=3                           # Use batch 3 CSV
LOG_LEVEL=debug                   # Verbose logging
```

---

## Performance Metrics

### Manual Hunter

#### Batch Processing Speed
```
Batch 1: 45 systems in 72s  = 1.6s per system
Batch 2: 45 systems in 91s  = 2.0s per system
Batch 3: 47 systems in 87s  = 1.8s per system

Average: 1.8 seconds per system
Throughput: 33 systems/minute
```

#### API Usage
```
SerpAPI Calls: 137/150 (91% of budget)
Success Rate: 90% (122/136 systems)
Cost: $0 (free tier)
```

#### Storage
```
Total PDFs: 122
Total Size: 749 MB
Average Size: 6.1 MB per PDF
Largest: 23.07 MB (Cyclops Marine smarttoggle)
Smallest: 340 KB (Cyclops Marine smarttune)
```

### Manual Validator (Projected)

#### Processing Time (Estimated)
```
PDF Parsing: 2-3s per PDF
LLM Validation: 3-5s per PDF
Total: 5-8s per PDF

122 PDFs × 6s = 732 seconds = 12.2 minutes
With batch processing (10 parallel): ~2-3 minutes
```

#### Costs (Estimated)
```
GPT-4o-mini:
- Input: ~5000 tokens per PDF
- Output: ~200 tokens per PDF
- Cost: $0.15/1M input, $0.60/1M output
- Per PDF: ~$0.001
- Total: 122 PDFs × $0.001 = $0.12

LlamaParse (if used):
- First 1000 pages/day: Free
- 122 PDFs × ~10 pages = 1220 pages
- Cost: $0 (free tier covers it)
```

---

## Testing Performed

### Manual Hunter Testing

#### Test 1: Small Batch (3 systems)
```bash
TEST_MODE=true node scripts/agents/manual-hunter.js
```
**Result:** ✅ 3/3 PDFs downloaded, 100% success

#### Test 2: Full Batch 1 (45 systems)
```bash
node scripts/agents/manual-hunter.js
```
**Result:** ✅ 41/45 PDFs downloaded, 91% success

#### Test 3: Batch 2 (45 systems)
```bash
BATCH=2 node scripts/agents/manual-hunter.js
```
**Result:** ✅ 41/45 PDFs downloaded, 93% success

#### Test 4: Batch 3 with User Manual Priority (47 systems)
```bash
BATCH=3 node scripts/agents/manual-hunter.js
```
**Result:** ✅ 40/47 PDFs downloaded, 89% success, 35 user manuals

### Manual Validator Testing

#### Test 1: PDF Parsing
```bash
node scripts/agents/test-pdf-parse.js
```
**Result:** ❌ Multiple ESM import errors

#### Test 2: Validator Agent (3 PDFs)
```bash
TEST_MODE_VALIDATOR=true node scripts/agents/manual-validator.js
```
**Result:** ❌ PDF extraction failed, 0/3 validated

---

## Lessons Learned

### What Worked Well

1. **Query Simplification Critical**
   - Simplified model names (`dst810` vs `triducer_multisensor_airmar_dst810`)
   - Increased success rate from 0% to 90%+

2. **SerpAPI Reliable**
   - Fast response times
   - Good PDF results
   - Free tier sufficient for testing

3. **Batch Processing Efficient**
   - 5 parallel requests optimal
   - 3-second delays prevent rate limiting
   - Total time: ~4 minutes for 136 systems

4. **User Manual Prioritization Effective**
   - 35 user manuals explicitly identified in Batch 3
   - Filtering by title/URL keywords worked well

5. **Validation Before Download**
   - HEAD requests caught invalid PDFs
   - Prevented downloading 404s and HTML pages

### What Didn't Work

1. **Initial Query Too Specific**
   - Database model names too verbose
   - Google found nothing
   - Required simplification function

2. **pdf-parse Library Issues**
   - ESM export problems
   - Complex API
   - Insufficient documentation

3. **No State Management**
   - Had to restart from beginning on errors
   - Could improve with state file

### What Would Improve

1. **Resume Capability**
   - Save progress after each batch
   - Skip already-downloaded PDFs

2. **Better Error Handling**
   - Retry failed downloads
   - Exponential backoff for API errors

3. **PDF Quality Check**
   - Some PDFs are parts catalogs, not user manuals
   - Validator would catch these

4. **Deduplication**
   - Check if PDF already exists before downloading
   - Compare file hashes

---

## Summary

### Achievements
- ✅ Built fully functional Manual Hunter Agent
- ✅ Downloaded 122 manuals (90% success rate)
- ✅ Processed all 136 systems in 4 minutes
- ✅ Used only 91% of SerpAPI budget
- ✅ Created comprehensive documentation
- ✅ Designed Manual Validator Agent architecture
- ⚠️ Validator partially implemented (PDF parsing blocked)

### Remaining Work
- ⚠️ Fix PDF parsing in Validator (use pdfjs-dist or alternative)
- ⚠️ Test Validator on 3-5 PDFs
- ⚠️ Run Validator on all 122 PDFs
- ⚠️ Create bulk upload tool
- ⚠️ Update systems table with manual = true

### Files to Review
```
Key files to understand the implementation:
1. scripts/agents/manual-hunter.js (main agent)
2. scripts/agents/manual-hunter-strategies.js (search logic)
3. scripts/agents/manual-hunter-results/run-*.json (results)
4. scripts/agents/manual-validator.js (incomplete validator)
5. This document (complete session summary)
```

---

**Session End:** 2025-10-11
**Next Steps:** Fix PDF parsing, complete validator, bulk upload manuals
