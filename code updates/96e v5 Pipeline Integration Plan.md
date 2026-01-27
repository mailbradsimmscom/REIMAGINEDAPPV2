# 96e v5 Pipeline Integration Plan

**Date:** 2026-01-14
**Status:** Planning Complete, Ready to Build
**Parent Documents:** 96, 96c, 96d

---

## Overview

This document details how to integrate the new v5 pipeline stages into the existing document processing system. We are **adding to** the existing pipeline, not replacing it.

**Goal:** Process the Yanmar 4JH57 manual through the complete v5 pipeline to validate the approach before scaling to all 81 documents.

---

## Current Pipeline Architecture

### Existing Flow (Working)

```
Frontend: src/public/upload.html
    │
    ▼ POST /document/ingest (multipart: PDF + metadata)
    │
Backend: src/routes/document/ingest.route.js
    │
    ▼ Validates, stores file, creates job
    │
Orchestrator: src/services/document.service.js
    │
    ├── 1. Upload to Supabase Storage (/manuals/{doc_id}/)
    ├── 2. Create document record in DB
    ├── 3. POST /v1/parse → Python sidecar (LlamaParse)
    ├── 4. POST /v1/chunk → Python sidecar (semantic chunking)
    ├── 5. POST /v1/embed → Python sidecar (OpenAI embeddings)
    ├── 6. Upsert vectors to Pinecone
    ├── 7. DIP extraction (Anthropic Claude)
    ├── 8. Colloquial extraction (OpenAI)
    └── 9. Update job status → "completed"
```

### Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/services/document.service.js` | Main orchestrator | ~830 |
| `src/routes/document/ingest.route.js` | Upload endpoint | ~150 |
| `python-sidecar/app/routes/parse.py` | LlamaParse wrapper | ~100 |
| `python-sidecar/app/routes/chunk.py` | Semantic chunking | ~150 |
| `python-sidecar/app/routes/embed.py` | OpenAI embeddings | ~100 |
| `python-sidecar/scripts/dip_extraction_cached.py` | DIP extraction | ~400 |
| `src/services/colloquial-extraction.service.js` | Colloquial keywords | ~315 |

---

## v5 Pipeline Stages

### Stage Order (14 total)

```
 1. uploading              ← exists
 2. verifying              ← exists
 3. parsing                ← exists (LlamaParse - MOVED UP)
 4. model_detection        ← NEW (uses parsed output)
 5. model_selection        ← NEW (blocking)
 6. vision_analysis        ← NEW
 7. figure_cropping        ← NEW
 8. chunking               ← exists (modify)
 9. embedding              ← exists (modify)
10. indexing               ← exists
11. colloquial_extraction  ← exists
12. dip_extraction         ← exists (modify)
13. storing                ← exists (modify for figures)
14. completed              ← exists
```

**IMPORTANT (2026-01-15):** Pipeline reordered. Parsing now happens FIRST, then model detection uses the parsed output. This eliminates the need for a separate pdfplumber/OCR parse step and speeds up the pipeline significantly.

---

## Stage 3: Parsing (LlamaParse)

### Purpose
Parse the entire document with LlamaParse FIRST. This provides text for model detection and content for chunking - one parse, multiple uses.

### Implementation
Uses existing LlamaParse integration in Python sidecar.

**Endpoint:** `POST /v1/parse` (existing)

**Output used by model detection:**
- First ~15K characters of parsed text
- No separate pdfplumber/OCR needed

---

## Stage 4: Model Detection

### Purpose
Detect what models a manual covers using the parsed output from Stage 3. This enables model-specific tagging throughout the pipeline.

### Implementation

**Endpoint:** `POST /v1/detect-models` (existing, built 2026-01-14)

**Input:**
```json
{
  "text": "First ~15,000 characters from LlamaParse output",
  "doc_id": "uuid",
  "filename": "Yanmar_4JH_Manual.pdf"
}
```

**Output:**
```json
{
  "success": true,
  "models_detected": ["4JH45", "4JH57", "4JH80", "4JH110"],
  "is_multi_model": true,
  "confidence": "high",
  "evidence": "Title page lists 'Model 4JH45/4JH57/4JH80/4JH110'"
}
```

**Integration Point in document.service.js:**
```javascript
// NEW ORDER: Parse first, then detect models
async function processJob(jobId) {
  // 1. Upload/verify (existing)

  // 2. Parse with LlamaParse (moved up)
  await updateJobStatusV2(jobId, 'parsing');
  const parseResult = await this.callLlamaParse(fileBuffer, fileName);

  // 3. Model detection uses parsed output
  await updateJobStatusV2(jobId, 'model_detection');
  const parsedText = parseResult.text.substring(0, 15000);
  const modelDetection = await detectModels(parsedText, fileName, docId);

  // 4. If multi-model, pause for user selection
  if (modelDetection.is_multi_model) {
    await updateJobStatusV2(jobId, 'model_selection');
    return { paused: true, stage: 'model_selection' };
  }

  // 5. Continue with chunking using parseResult
  await this.processChunking(parseResult, selectedModels);
}
```

**Benefits of new order:**
- LlamaParse runs once (not twice)
- No pdfplumber/OCR dependency
- Faster (no 4-minute OCR wait)
- Simpler code path

**Validated:** Model detection working with Yanmar manual (2026-01-15)

---

## Stage 5: Model Selection (Blocking)

### Purpose
When a manual covers multiple models, pause and ask the user which model(s) apply to their boat.

### Implementation Options

**Option A: Polling-based (simpler)**
1. Backend sets job status to `model_selection`
2. Backend stores detected models in job record
3. Frontend polls job status, sees `model_selection`
4. Frontend shows interaction UI with model choices
5. User selects, frontend POSTs to `/document/jobs/:jobId/model-selection`
6. Backend receives selection, resumes pipeline

**Option B: Auto-match (skip blocking)**
1. User already selected system when uploading (Yanmar 4JH57)
2. System has `model_variant` = "4JH57" (from systems table)
3. Auto-match detected models to user's system
4. No blocking needed

**Recommended:** Start with Option B (auto-match). Implement Option A later if needed for edge cases.

**New Endpoint:** `POST /document/jobs/:jobId/model-selection`

**Input:**
```json
{
  "selected_models": ["4JH57"],
  "user_model_variant": "4JH57"
}
```

**Frontend (already built in upload.html):**
```javascript
// In interaction area - show model selection UI
showInteraction(`
  <div class="interaction-title">Which model is installed on REIMAGINED?</div>
  <div class="interaction-description">
    This manual covers multiple models. Please select yours:
  </div>
  <div class="interaction-options">
    ${models.map(m => `
      <label class="interaction-option ${m === userModelVariant ? 'recommended' : ''}">
        <input type="checkbox" name="model" value="${m}" ${m === userModelVariant ? 'checked' : ''}>
        <span class="interaction-option-label">${m}</span>
      </label>
    `).join('')}
  </div>
  <div class="interaction-actions">
    <button class="btn btn-primary" onclick="confirmModelSelection()">Confirm Selection</button>
  </div>
`);
```

---

## Stage 6: Vision Analysis (unchanged number)

### Purpose
Analyze page screenshots to identify figures, diagrams, tables, and their model applicability.

### Implementation

**New File:** `python-sidecar/app/routes/vision_analysis.py`

**New Endpoint:** `POST /v1/vision/analyze-pages`

**Input:**
```json
{
  "doc_id": "uuid",
  "pages": [
    { "page_number": 1, "image_base64": "..." },
    { "page_number": 2, "image_base64": "..." }
  ],
  "models_covered": ["4JH45", "4JH57", "4JH80", "4JH110"],
  "user_model": "4JH57"
}
```

**Output:**
```json
{
  "success": true,
  "pages_analyzed": 84,
  "figures_found": 23,
  "results": [
    {
      "page_number": 12,
      "figures": [
        {
          "figure_id": "fig_12_1",
          "type": "wiring_diagram",
          "title": "Fuel Injection System Wiring",
          "bbox": { "x": 10, "y": 25, "width": 80, "height": 45 },
          "applies_to_models": ["4JH57", "4JH80", "4JH110"],
          "caption": "Figure 3.2"
        }
      ],
      "tables": [...]
    }
  ]
}
```

**Uses Claude Vision (claude-sonnet-4)** - already tested in `test_vision_page_analysis.py`.

**Cost:** ~$0.017 per page = ~$1.40 for 84-page manual

**Integration Point:**
```javascript
// After parsing, parallel with or after model detection
await updateJobStatus(jobId, 'vision_analysis');
const pageScreenshots = parsedContent.screenshots; // From LlamaParse
const visionResults = await analyzePages(pageScreenshots, modelsDetected);
```

---

## Stage 7: Figure Cropping

### Purpose
Crop individual figures from page screenshots using bounding boxes from vision analysis.

### Implementation

**New File:** `python-sidecar/app/routes/figure_cropping.py`

**New Endpoint:** `POST /v1/vision/crop-figures`

**Input:**
```json
{
  "doc_id": "uuid",
  "page_number": 12,
  "image_base64": "...",
  "figures": [
    {
      "figure_id": "fig_12_1",
      "bbox": { "x": 10, "y": 25, "width": 80, "height": 45 },
      "applies_to_models": ["4JH57"]
    }
  ]
}
```

**Output:**
```json
{
  "success": true,
  "cropped_figures": [
    {
      "figure_id": "fig_12_1",
      "image_base64": "...",
      "width": 904,
      "height": 512
    }
  ]
}
```

**Uses PIL/Pillow** - already tested in `test_figure_cropping.py`.

**Integration Point:**
```javascript
// After vision analysis
await updateJobStatus(jobId, 'figure_cropping');
for (const page of pagesWithFigures) {
  const cropped = await cropFigures(page);
  // Upload to Supabase Storage
  await uploadFiguresToStorage(docId, cropped);
  // Create doc_assets records
  await createDocAssetRecords(docId, cropped, visionResults);
}
```

---

## Stages 8-9: Modified Chunking & Embedding

### Purpose
Add model tags to chunks and include in Pinecone metadata for filtered search.

### Changes to Chunking

**File:** `python-sidecar/app/chunking/chunker.py`

**Current chunk metadata:**
```json
{
  "chunk_id": "abc123",
  "doc_id": "xyz",
  "asset_uid": "engine-yanmar",
  "text": "Oil capacity is 4.2L...",
  "section_title": "Specifications"
}
```

**New chunk metadata:**
```json
{
  "chunk_id": "abc123",
  "doc_id": "xyz",
  "asset_uid": "engine-yanmar",
  "text": "Oil capacity is 4.2L...",
  "section_title": "Specifications",
  "applies_to_models": ["4JH57"],
  "is_universal": false,
  "figure_refs": ["Figure 3.2"]
}
```

### Changes to Embedding

**File:** `python-sidecar/app/chunking/embeddings.py`

**Pinecone metadata update:**
```python
metadata = {
    ...existing_metadata,
    "applies_to_models": chunk.applies_to_models,
    "is_universal": chunk.is_universal,
    "user_model": user_selected_model  # For filtering
}
```

---

## Stage 12: Modified DIP Extraction

### Purpose
Extract specs, procedures, troubleshooting with model applicability tags.

### Changes

**File:** `python-sidecar/scripts/dip_extraction_cached.py`

**Current extraction:**
```json
{
  "parameter": "Oil Capacity",
  "value": "4.2L",
  "unit": "liters"
}
```

**New extraction:**
```json
{
  "parameter": "Oil Capacity",
  "value": "4.2L",
  "unit": "liters",
  "applies_to_models": ["4JH57"],
  "source_page": 23,
  "source_figure": "Table 2.1"
}
```

### New Extraction Category: Troubleshooting

**Prompt addition:**
```
TROUBLESHOOTING:
Extract symptom → cause → resolution chains.
Include cross-system references (e.g., "check battery isolator").

Format:
{
  "symptom": "Engine won't start",
  "possible_causes": [
    {
      "cause": "Battery isolator off",
      "resolution": "Turn battery isolator to ON position",
      "related_system": "Battery Isolator",
      "applies_to_models": ["4JH45", "4JH57", "4JH80", "4JH110"]
    }
  ]
}
```

---

## Build Order

| Order | Stage | Complexity | Dependencies |
|-------|-------|------------|--------------|
| 1 | Model Detection | Low | None |
| 2 | Vision Analysis | Medium | Model Detection (for model tags) |
| 3 | Figure Cropping | Low | Vision Analysis |
| 4 | Modified Chunking | Low | Model Detection |
| 5 | Modified Embedding | Low | Modified Chunking |
| 6 | Model Selection | Medium | Model Detection, Frontend ready |
| 7 | Modified DIP | Medium | All above |

---

## Test Plan

### For Each Stage

1. **Build Python endpoint** with standalone test
2. **Test with Yanmar manual** (our single test document)
3. **Integrate into document.service.js**
4. **Test full pipeline** with upload.html
5. **Verify job status updates** show in UI

### Validation Queries

After processing Yanmar manual:

```sql
-- Check document has model tags
SELECT doc_id, models_covered, is_multi_model, figure_count
FROM documents WHERE doc_id = '...';

-- Check figures were extracted
SELECT * FROM doc_assets WHERE doc_id = '...';

-- Check chunks have model tags (in Pinecone)
-- Query Pinecone with filter: applies_to_models contains "4JH57"

-- Check DIP extraction has model tags
SELECT * FROM staging_spec_suggestions WHERE doc_id = '...' LIMIT 5;
```

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `python-sidecar/app/routes/model_detection.py` | Model detection endpoint |
| `python-sidecar/app/routes/vision_analysis.py` | Vision analysis endpoint |
| `python-sidecar/app/routes/figure_cropping.py` | Figure cropping endpoint |
| `src/routes/document/model-selection.route.js` | Model selection POST handler |

### Modified Files

| File | Changes |
|------|---------|
| `src/services/document.service.js` | Add new stage calls, status updates |
| `python-sidecar/app/chunking/chunker.py` | Add model tags to chunks |
| `python-sidecar/app/chunking/embeddings.py` | Add model metadata to Pinecone |
| `python-sidecar/scripts/dip_extraction_cached.py` | Add applies_to_models, troubleshooting |
| `python-sidecar/app/main.py` | Register new routes |

---

## Next Action

**Start with Stage 3: Model Detection**

1. Create `python-sidecar/app/routes/model_detection.py`
2. Test with first 15K chars of Yanmar manual
3. Integrate into document.service.js
4. Verify job status shows "Model Detection" in upload.html

Ready to begin?
