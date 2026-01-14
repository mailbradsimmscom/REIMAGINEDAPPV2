# 96 Document Foundation Crisis - Multi-Model, Images, and System Relationships

**Date:** 2026-01-11
**Status:** Analysis Complete, Planning Test Scripts
**Priority:** CRITICAL - Foundational issues affecting entire system
**Next Action:** Build standalone test scripts to validate approach before refactor

---

## Executive Summary

The document layer - which is supposed to make BoatOS specific to YOUR boat - has fundamental architectural problems that cascade through the entire system. This isn't a bug to fix; it's a foundation that needs rebuilding.

**Core Problems Identified:**
1. **Multi-Model Manuals (78%)** - Most manuals cover entire product families, but we can't distinguish which specs apply to which model
2. **Visual Content Lost** - Diagrams, schematics, exploded views are completely missing from the system
3. **Systems Table Missing Variants** - No `model_variant` field to know user has "4JH57" vs generic "Yanmar engine"
4. **No System Relationships** - Engine, saildrive, controller are isolated rows with no family/connection modeling
5. **Document↔System is 1:1** - Reality is many-to-many (one manual covers multiple systems, one system has multiple manuals)

**The Result:** Chat answers are confused, DIP agent approves wrong content, users can't see diagrams, and the system that's supposed to be "specific to your boat" often isn't.

---

## The Conversation That Led Here

### Starting Point

User asked Claude to deeply review:
- `CLAUDE.md` - Project overview
- `.cursorrules` - Coding standards
- `/docs/**/*.md` - All documentation

Then revealed: "We have a big problem."

### The Problem Statement

> "Documents are core to this system... they are what is supposed to make the chat specific to my boat, and not generic. And the tasks specific to my systems."

User then asked to review connected projects:
- Doc 69: Autonomous DIP and Maintenance Review Agents
- Doc 70: DIP Agent v2 Production-Ready Autonomous Processing
- Doc 65: Visual Extraction - Image Extraction from Documents
- Doc 71: Multi-Model Manual Problem Analysis

### The Realization

All these systems were built independently but share a common problem: **the document foundation is broken**.

> "All of these. Answers in AI are confused... which sail drive do I have, which model of fridge, the DIP agent I am trying to build wants to auto approve content for wrong models, we are losing critical tables and images that are needed for chat and they are not there. Overall the system is sub par."

---

## Problem 1: Multi-Model Manuals (78% of Documents)

### What We Found

Analysis of 76 documents in Pinecone:
- **59 multi-model manuals (78%)**
- Only 17 single-model manuals (22%)

This isn't an edge case - it's the default state.

### Examples of Multi-Model Manuals

| Manufacturer | Model in Systems Table | Actual Variants in Manual |
|--------------|------------------------|---------------------------|
| Yanmar | Port_Stbd_Engine | 4JH45, 4JH57, 4JH80, 4JH110 |
| Yanmar | Sail_drive | SD25, SD60, SD110, SD150 |
| Kenyon | silken_grill | B70750, B70770, B70772, B70790 |
| Victron | quattro_48_5000... | 12/5000, 24/5000, 48/5000, 48/8000, 48/10000, 48/15000 |
| Quick | hector_hc3_series... | HC3 712, HC3 724, HC3 1012, HC3 1512... (18 variants) |

### Why This Breaks Everything

**User asks:** "What's the oil capacity for my engine?"

**What happens:**
1. System searches Pinecone for engine-related chunks
2. Finds chunk with table: `4JH45=3.8L, 4JH57=4.2L, 4JH80=5.1L, 4JH110=6.2L`
3. LLM sees 4 different values
4. Response either guesses wrong model OR hedges with "it depends on your model"

**But we KNOW the user has a 4JH57.** That information exists in build spreadsheets but isn't in the systems table or Pinecone metadata.

### Where Context Is Lost

1. **Systems Table:** Has `model_norm: "Port_Stbd_Engine"` not `model_variant: "4JH57"`
2. **Pinecone Metadata:** Only has generic `asset_uid`, can't filter by specific model
3. **DIP Extraction:** Extracts `parameter: "Oil Capacity", value: "4.2L"` without `applies_to: "4JH57"`
4. **Synthesis Prompt:** Doesn't emphasize user's specific model variant

---

## Problem 2: Visual Content Lost

### What Doc 65 Discovered

81 documents were processed with `result_type="markdown"` which extracts **text only**. All images were lost:
- Wiring diagrams
- Exploded views
- Schematics
- Installation diagrams
- Complex tables with embedded images

### What Doc 65 "Solved" (Poorly)

Phase 1 implemented:
```python
self.parser = LlamaParse(
    result_type="markdown",
    take_screenshot=True,  # Captures FULL PAGES as images
)
```

**Test results (Marco pump manual):**
- 16 page screenshots (full pages with headers, footers, everything)
- 10 embedded images (all logos and CE marks - NOT the diagrams)

### Why This Solution Is Inadequate

| User Request | What We Have | What They Get |
|--------------|--------------|---------------|
| "Show me the wiring diagram" | Full page screenshot | Page with header, footer, 3 paragraphs, and diagram buried somewhere |
| "Show me the exploded view" | Full page screenshot | Same problem - whole page, not the figure |
| "What's in Figure 3.2?" | No figure-to-reference linking | "I don't know which image is Figure 3.2" |

**The real diagrams (wiring, schematics, exploded views) are vector graphics baked into the PDF.** LlamaParse can't extract them as separate images. They only appear in full-page screenshots.

### What's Actually Needed

Not just screenshots, but **semantic visual understanding**:

```json
{
  "figure_id": "fig_3_2",
  "type": "wiring_diagram",
  "title": "Fuel Injection System Wiring",
  "applies_to_models": ["4JH57", "4JH80", "4JH110"],
  "page": 23,
  "bbox": {"x": 0.1, "y": 0.15, "w": 0.8, "h": 0.45},
  "cropped_image_url": "...",
  "related_chunks": ["chunk_abc", "chunk_def"],
  "caption": "Figure 3.2 - Fuel injection wiring diagram"
}
```

This requires a **Vision LLM pass** (Claude Vision or GPT-4V) that looks at each page and understands what it's seeing.

---

## Problem 3: Systems Table Missing Model Variants

### Current Schema

```javascript
// From src/schemas/systems.schema.js
asset_uid: z.string(),
system_norm: z.string(),           // "propulsion"
subsystem_norm: z.string(),        // "engine"
manufacturer_norm: z.string(),     // "Yanmar"
model_norm: z.string(),            // "Port_Stbd_Engine" ← NORMALIZED NAME, NOT ACTUAL MODEL
canonical_model_id: z.string(),
```

### The Problem

`model_norm` is a **normalized/generic name** for grouping, not the actual model number.

**What's stored:** `manufacturer_norm: "Yanmar", model_norm: "Port_Stbd_Engine"`
**What's needed:** `manufacturer_norm: "Yanmar", model_norm: "Port_Stbd_Engine", model_variant: "4JH57"`

### User's Actual Equipment (from Build Spreadsheet)

| Equipment | In Systems Table | Actual Model |
|-----------|------------------|--------------|
| Yanmar Engines | Port_Stbd_Engine | **4JH57** (upgraded from 4JH45) |
| Yanmar Saildrive | Sail_drive | **SD60** |
| Kenyon Grill | silken_grill | **B70770** |
| Victron MPPT | smart_solar_mppt | **100/30** (x2) |
| Vitrifrigo | fridge_freezer | **DRW180A RFX** + **DRW180A BTX** |

The specific model variants exist in build documentation but were never captured in the systems table.

---

## Problem 4: No System Relationships (Family Connections)

### The Reality on a Boat

Systems aren't isolated - they're deeply interconnected:

```
PROPULSION FAMILY
├── Yanmar 4JH57 (engine)
│   ├── mechanically coupled to → SD60 Saildrive
│   ├── controlled by → VC20 Controller
│   └── powered through → Isolator Switch
├── Yanmar SD60 (saildrive)
│   └── drives → Propeller
├── Yanmar VC20 (controller)
│   └── connected to → Throttle Controls
└── Isolator Switch
    └── powered by → Battery Bank
```

### Why This Matters for Chat

**User asks:** "My engine won't start"

**Current behavior:** Search only Yanmar 4JH57 chunks

**What should happen:**
1. Identify "engine" = Yanmar 4JH57
2. Find family: propulsion
3. Search related systems: 4JH57 + SD60 + VC20 + Isolator
4. Answer might be:
   - Engine issue (4JH57 manual)
   - Controller error code (VC20 manual)
   - Saildrive clutch position (SD60 manual)
   - Isolator not engaged (isolator instructions)

### User's Insight: "Centroid Problem"

The user described this as a centroid/clustering problem:
- Systems cluster around functional families
- "Propulsion" is the centroid for engine, saildrive, controller
- "Electrical" is the centroid for Victron Quattro, MPPT, batteries, Lynx

### Current State

The systems table has **119 isolated rows**. Zero relationship data. No family groupings.

---

## Problem 5: Document↔System Relationship Complexity

### Current Model (Simplistic)

```
documents.asset_uid → systems.asset_uid  (1:1)
```

### Reality (Complex)

**Pattern A: One Document → One System** (works)
```
B&G WS310 manual → B&G WS310 system
```

**Pattern B: One Document → Multiple Models** (broken)
```
Yanmar 4JH manual → covers 4JH45, 4JH57, 4JH80, 4JH110
                    (user has 4JH57, system can't distinguish)
```

**Pattern C: One Document → Multiple Systems** (broken)
```
Cyclops Marine manual → SmartLink sensor
                      → SmartToggle
                      → SmartFittings Gateway
                      (one doc, many products)
```

**Pattern D: One System → Multiple Documents** (partially works)
```
ZeroJet Tender → ZeroJet manual
              → OC Tender manual
              → battery manual
              (multiple docs for one system, no relationship typing)
```

**Pattern E: System Families** (not modeled)
```
Yanmar 4JH57 ←→ SD60 Saildrive ←→ VC20 Controller
(interconnected but stored as isolated rows)
```

---

## The Cascade Effect

Every problem compounds through the pipeline:

```
PDF (has everything)
    │
    ▼ LlamaParse (markdown mode)
    │
TEXT ONLY (images gone)
    │
    ▼ Chunking
    │
CHUNKS (model context mixed - 4JH45, 4JH57, 4JH80 all together)
    │
    ▼ Embedding
    │
VECTORS (metadata has generic asset_uid, no model_variant)
    │
    ▼ DIP Extraction
    │
SPECS (parameter + value, no "applies_to_models")
    │
    ▼ DIP Agent
    │
AUTO-APPROVES (content for wrong models - garbage in production tables)
    │
    ▼ Pinecone Search
    │
RESULTS (can't filter by model, returns mixed-model chunks)
    │
    ▼ Synthesis
    │
RESPONSE (LLM sees 4 oil capacities, guesses or hedges)
    │
    ▼ User Experience
    │
"Which saildrive do I have?" - System that's supposed to be specific ISN'T
```

---

## Tool Stack Analysis

### Current Tools

| Tool | Purpose | Assessment |
|------|---------|------------|
| **LlamaParse** | PDF text extraction | Works, but loses images and semantics |
| **Pinecone** | Vector search | Fine, but garbage in = garbage out |
| **OpenAI** | Embeddings + Chat synthesis | Fine |
| **Anthropic** | DIP extraction + Chat | Fine |
| **Perplexity** | Web search fallback | Fine |
| **Cohere** | Reranking | Fine |
| **Supabase** | Database + Storage | Fine |
| **Render** | Hosting | Fine |
| **SERP** | Web search | Fine |

### User's Question

> "Am I using the wrong tools? Are we trying to do something that can't be done?"

### Answer: Tools Are Fine, Architecture Is Broken

**The tools aren't wrong.** The problem is:
1. No Vision understanding (need to add Claude Vision pass)
2. Context not preserved through pipeline
3. Model-aware extraction not implemented
4. System relationships not modeled

### What's Missing

| Gap | Solution |
|-----|----------|
| Visual understanding | Claude Vision or GPT-4V pass on page screenshots |
| Model context in chunks | Update chunking to tag model applicability |
| Model context in DIP | Update extraction prompts |
| Model variants in systems | Add `model_variant` column |
| System relationships | Add `system_families` tables |
| Figure-to-text linking | Parse chunk text for figure references |

---

## Proposed Solution Architecture

### New Pipeline

```
PDF
    │
    ▼ LlamaParse (get text + page screenshots)
    │
    ▼ Vision LLM Pass (Claude Vision) ← NEW
    │   - Identify figures, diagrams, tables on each page
    │   - Classify type (wiring_diagram, exploded_view, spec_table)
    │   - Extract bounding boxes
    │   - Identify model applicability
    │   - Extract figure references (Figure 3.2, etc.)
    │
    ▼ Crop figures from page screenshots
    │
    ▼ Chunk with model context
    │   - Tag chunks with applies_to_models
    │   - Link chunks to figures
    │
    ▼ DIP Extraction with model context
    │   - Extract specs with applies_to_models array
    │   - Link specs to source figures/tables
    │
    ▼ Embed with rich metadata
    │   - model_variants in metadata
    │   - figure_refs in metadata
    │
    ▼ Store in enhanced systems table
    │   - model_variant field
    │   - family relationships
    │
    ▼ Search with model filtering
    │   - Boost/filter by user's model variant
    │   - Include family systems
    │
    ▼ Synthesize with full context
    │   - Pass user's exact model variant
    │   - Include relevant figures in response
```

### Database Changes Needed

#### 1. Systems Table Enhancement
```sql
ALTER TABLE systems ADD COLUMN model_variant TEXT;
ALTER TABLE systems ADD COLUMN model_family TEXT;
```

#### 2. System Families Tables (New)
```sql
CREATE TABLE system_families (
  id UUID PRIMARY KEY,
  family_name TEXT NOT NULL,        -- 'propulsion_port'
  family_type TEXT NOT NULL,        -- 'propulsion', 'electrical', 'plumbing'
  description TEXT
);

CREATE TABLE system_family_members (
  family_id UUID REFERENCES system_families(id),
  asset_uid UUID REFERENCES systems(asset_uid),
  role TEXT,                        -- 'primary', 'controller', 'power_source'
  PRIMARY KEY (family_id, asset_uid)
);
```

#### 3. Document Coverage Table (New)
```sql
CREATE TABLE document_coverage (
  id UUID PRIMARY KEY,
  doc_id TEXT REFERENCES documents(doc_id),
  asset_uid UUID REFERENCES systems(asset_uid),
  coverage_type TEXT,               -- 'primary', 'supplementary', 'reference'
  model_variants TEXT[]             -- ['4JH45', '4JH57', '4JH80']
);
```

#### 4. Enhanced Doc Assets Table
```sql
ALTER TABLE doc_assets ADD COLUMN figure_type TEXT;        -- 'wiring_diagram', 'exploded_view'
ALTER TABLE doc_assets ADD COLUMN applies_to_models TEXT[];
ALTER TABLE doc_assets ADD COLUMN figure_reference TEXT;   -- 'Figure 3.2'
ALTER TABLE doc_assets ADD COLUMN linked_chunks TEXT[];
```

#### 5. DIP Tables Enhancement
```sql
ALTER TABLE staging_spec_suggestions ADD COLUMN applies_to_models TEXT[];
ALTER TABLE staging_playbook_hints ADD COLUMN applies_to_models TEXT[];
ALTER TABLE staging_intent_router ADD COLUMN applies_to_models TEXT[];
ALTER TABLE staging_golden_tests ADD COLUMN applies_to_models TEXT[];
```

---

## Cost Estimates

### Vision Processing (One-Time)
| Item | Count | Cost |
|------|-------|------|
| Pages to analyze | 81 docs × 50 pages = ~4,000 pages | |
| Claude Vision per page | ~$0.01-0.02 | |
| **Total** | **~$40-80** | |

### Re-Processing Documents
| Item | Cost |
|------|------|
| LlamaParse (already have credits) | Minimal |
| DIP re-extraction | OpenAI/Anthropic API costs |
| Embedding regeneration | OpenAI embeddings |
| **Estimate** | ~$50-100 |

**Total estimated cost: ~$100-200** for complete re-ingestion with new pipeline.

---

## Test Scripts Needed

Before full refactor, validate assumptions with standalone scripts:

### Test 1: Vision Page Analysis
**Question:** Can Claude Vision identify figures, tables, and model-specific content?
```
Input: Page screenshot from Yanmar manual
Output: JSON with figures, tables, model applicability, bounding boxes
```

### Test 2: Model-Specific Spec Extraction
**Question:** Can we extract specs WITH model context from multi-model tables?
```
Input: Chunk containing multi-model spec table
Output: Array of {parameter, value, applies_to_model}
```

### Test 3: Figure Cropping
**Question:** Given page screenshot + bounding box, can we crop cleanly?
```
Input: Page image + bbox from Vision analysis
Output: Cropped figure image
```

### Test 4: Figure-to-Text Linking
**Question:** Can we parse chunk text for figure references?
```
Input: Chunk text ("see Figure 3.2")
Output: Extracted references
```

### Test 5: Family Query Expansion
**Question:** Given a query about "engine", can we expand to related systems?
```
Input: "engine won't start" + family relationships
Output: List of systems to search (engine + saildrive + controller + isolator)
```

---

## Test Results (2026-01-11)

### Test 1: Vision Page Analysis ✅ PASSED

**Script:** `python-sidecar/scripts/test_vision_page_analysis.py`

Tested Claude Vision (claude-sonnet-4) on Marco pump manual page 12 (exploded view).

**Results:**
| Element | Detection | Details |
|---------|-----------|---------|
| **Exploded view diagram** | ✅ Correct | Type: `exploded_view`, found 29/30 numbered parts |
| **Parts table** | ✅ Correct | Type: `parts_list`, 5 columns identified |
| **Multi-model detection** | ✅ Correct | `is_multi_model: false` |
| **Secondary diagram** | ✅ Found | Antivibration mount detail |
| **Bounding boxes** | ✅ Accurate | Usable for cropping |

**Output JSON:**
```json
{
  "figures": [
    {
      "type": "exploded_view",
      "title": "EXPLODED VIEW",
      "bbox": {"x": 10, "y": 25, "width": 80, "height": 70},
      "numbered_parts": [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]
    }
  ],
  "tables": [
    {
      "type": "parts_list",
      "columns": ["Pos.", "Q.ta", "Descrizione", "Description", "Ricambio Spare Part"],
      "is_multi_model": false
    }
  ]
}
```

**Cost:** $0.017 per page (2093 input tokens, 715 output tokens)
**Time:** 10.87 seconds

### Test 2: Figure Cropping ✅ PASSED

**Script:** `python-sidecar/scripts/test_figure_cropping.py`

Used bounding boxes from Vision analysis to crop figures from page screenshot.

**Results:**
| Crop | Size | Quality |
|------|------|---------|
| Exploded view | 904x1120px | Clean, all numbered parts visible |
| Parts table | 904x320px | Clean, header + rows captured |
| Detail diagram | 169x160px | Clean |

**Conclusion:** Bounding boxes from Claude Vision are accurate enough for production use.

### Test 3: Multi-Model Detection ✅ PASSED

**Scripts:** `test_pdf_vision_analysis.py`

Tested on Yanmar Saildrive (SD25/SD60/SD110/SD150) and Victron MPPT (75/10, 75/15, 100/15, 100/20).

**Yanmar Saildrive Results:**
| Page | Detection |
|------|-----------|
| 16 | **SD25-specific page** - Exploded view tagged as SD25 only |
| 17 | **SD60-specific page** - Exploded view tagged as SD60 only |
| 18 | **SD110/SD150-specific page** - Content tagged correctly |
| 79 | **Model-specific page** - Figures 6-10 all tagged as SD110/SD150 |

**Victron MPPT Results (Critical Multi-Model Table Test):**

Page 66 - Technical Specifications table:
```json
{
  "type": "specifications",
  "is_multi_model": true,
  "columns": ["Parameter", "MPPT 75/10", "MPPT 75/15", "MPPT 100/15", "MPPT 100/20"],
  "model_columns": {
    "MPPT 75/10": "column 2",
    "MPPT 75/15": "column 3",
    "MPPT 100/15": "column 4",
    "MPPT 100/20": "column 5"
  }
}
```

**This proves:**
- ✅ Claude Vision can detect multi-model comparison tables
- ✅ Claude Vision can map columns to specific models
- ✅ Claude Vision correctly tags model-specific pages and figures
- ✅ DIP extraction can use this to tag specs with `applies_to_models`

**Implication:** When extracting "Maximum battery current: 10A" from the 75/10 column, we can tag it as `applies_to_models: ["75/10"]`

### Test 4: Yanmar Figure Cropping ✅ PASSED

Cropped all 5 figures from Yanmar Saildrive page 79 (SD110/SD150 Emergency Procedure):

| Figure | Type | Size | Models |
|--------|------|------|--------|
| Figure 6 | exploded_view | 390x498px | SD110, SD150 |
| Figure 7 | photo | 390x356px | SD110, SD150 |
| Figure 8 | photo | 390x356px | SD110, SD150 |
| Figure 9 | photo | 390x356px | SD110, SD150 |
| Figure 10 | photo | 390x356px | SD110, SD150 |

**Output filenames include model tagging:**
```
page_079_Figure_6_exploded_view_SD110_SD150.jpg
page_079_Figure_8_photo_SD110_SD150.jpg
```

**Observation:** Some bounding box overlap (Figure 6 crop included some of Figure 7's text). The prompt could be refined or we add padding adjustments in post-processing. Core approach works.

**Location:** `visual_extraction_work/vision_test_results/cropped/yanmar_sail_drive/`

### Test 5: Chat Integration Assessment

**Question:** Can we easily show these images in chat?

**Answer:** Yes, but requires integration work.

| Component | Current State | Work Needed |
|-----------|---------------|-------------|
| **Store figures** | Supabase Storage exists | Upload cropped images with metadata |
| **Figure metadata table** | `doc_assets` exists but basic | Add `figure_reference`, `applies_to_models`, link to chunks |
| **Chat retrieval** | Doesn't look for figures | Add logic to find and include relevant figures |
| **Frontend rendering** | Renders markdown | Test image rendering from Supabase URLs |

**Integration path:**
1. Chunk text says "see Figure 6" → linked to figure asset
2. Chat synthesis includes URL: `![Figure 6](https://supabase.../figure_6.jpg)`
3. Frontend renders image inline

**Complexity:** Medium. Infrastructure exists. Integration logic is the work.

---

## Scripts Created

| Script | Purpose | Status |
|--------|---------|--------|
| `test_vision_page_analysis.py` | Test Claude Vision on page screenshots | ✅ Working |
| `test_figure_cropping.py` | Crop figures using Vision bounding boxes | ✅ Working |
| `test_pdf_vision_analysis.py` | Extract pages from PDF and run Vision analysis | ✅ Working |
| `test_figure_linking.py` | Link "Figure 3.2" refs to assets | 🔄 TODO |

---

## Next Steps

1. ~~Create test scripts to validate Vision LLM approach~~ ✅ DONE
2. ~~Test on multi-model document~~ ✅ DONE (Yanmar Saildrive + Victron MPPT)
3. ~~Validate multi-model detection~~ ✅ DONE - Claude identifies model columns correctly
4. **Design final schema** based on test results
5. **Build new pipeline** with context preservation
6. **Re-ingest all 81 documents** (estimated cost: ~$100-200)
7. **Update chat synthesis** to use enhanced data

## Validated Approach

The Vision LLM approach is **VALIDATED**. Key findings:

| Capability | Status | Evidence |
|------------|--------|----------|
| Identify figures/diagrams | ✅ Works | Marco pump exploded view correctly typed |
| Provide accurate bounding boxes | ✅ Works | Cropped images are clean and usable |
| Detect multi-model comparison tables | ✅ Works | Victron MPPT spec table detected with column mapping |
| Tag model-specific content | ✅ Works | Yanmar pages correctly tagged per model |
| Extract figure references | ✅ Works | "Figure 6", "Figure 7" extracted |
| Crop with model metadata | ✅ Works | Yanmar figures cropped with SD110_SD150 in filename |
| Cost-effective | ✅ Acceptable | ~$0.017/page = ~$68 for 4,000 pages |

**Ready to proceed with pipeline refactor.**

---

## Summary of All Tests

| Test | Document | What We Proved |
|------|----------|----------------|
| 1. Vision Analysis | Marco pump | Claude identifies figures, tables, bounding boxes |
| 2. Figure Cropping | Marco pump | Bounding boxes are accurate enough to crop cleanly |
| 3. Multi-Model Detection | Victron MPPT | Claude detects comparison tables and maps columns to models |
| 4. Model-Specific Tagging | Yanmar Saildrive | Claude correctly tags content per model (SD25, SD60, SD110/SD150) |
| 5. Full Pipeline | Yanmar Saildrive | Cropped figures include model metadata in filenames |

**What this enables:**
1. **DIP extraction** can tag specs with `applies_to_models`
2. **Chat** can show cropped diagrams instead of "see page 12"
3. **Chat** knows user has SD60, so only SD60-specific content is returned
4. **Figures** can be stored with semantic metadata (type, reference, models)

**Known limitations:**
- Bounding boxes sometimes overlap adjacent content (refinable)
- Chat integration requires additional work (figure linking, URL rendering)
- Need to test on more document types (wiring diagrams, complex tables)

---

---

## Deep Dive: Current Document Ingestion Pipeline

### Pipeline Overview (Current State)

```
1. UPLOAD (Admin UI)
   POST /admin/api/docs/ingest
   └── Multipart form: PDF + metadata JSON

2. VALIDATION
   └── Zod schema validates manufacturer_norm, model_norm

3. SYSTEM LOOKUP
   └── lookupSystemByManufacturerAndModel(mfr, model)
   └── FAILS if system doesn't exist (must pre-exist)
   └── Returns: asset_uid, system_norm, subsystem_norm

4. FILE UPLOAD
   └── Supabase Storage: manuals/{doc_id}/{filename}
   └── 20 retries to verify upload

5. BACKGROUND PROCESSING (fire-and-forget)
   ├── LlamaParse → Markdown + sections
   ├── SemanticChunker → 400-1200 token chunks
   ├── OpenAI → 3,072-dim embeddings
   ├── Pinecone → Store vectors + metadata
   ├── Supabase → Backup chunks to document_chunks
   └── Colloquial extraction → Update systems.colloquial_keywords

6. DIP EXTRACTION (Anthropic Claude)
   ├── spec_suggestions → staging_spec_suggestions
   ├── golden_rules → staging_golden_tests
   ├── intent_router → staging_intent_router
   └── playbook_hints → staging_playbook_hints

7. COMPLETION
   └── Job status → "completed"
   └── systems.manual → true
   └── systems.Manual_Local_Copy → true
```

### Key Files

| Layer | File | Purpose |
|-------|------|---------|
| Upload endpoint | `src/routes/document/ingest.route.js` | Multipart parsing |
| Orchestrator | `src/services/document.service.js` (830 lines) | Full pipeline |
| PDF Parsing | `python-sidecar/app/chunking/parser.py` | LlamaParse integration |
| Chunking | `python-sidecar/app/chunking/chunker.py` | Semantic chunking |
| Embeddings | `python-sidecar/app/chunking/embeddings.py` | OpenAI embeddings |
| Pinecone | `python-sidecar/app/pinecone_client.py` | Vector storage |
| DIP Extraction | `python-sidecar/scripts/dip_extraction_cached.py` | Anthropic extraction |

---

## Deep Dive: Systems Table

### Actual Schema (from backup.sql)

```sql
CREATE TABLE systems (
    asset_uid UUID PRIMARY KEY,
    system_norm TEXT,              -- "propulsion", "electrical"
    subsystem_norm TEXT,           -- "engine", "battery"
    manufacturer_norm TEXT,        -- "Yanmar", "Victron"
    model_norm TEXT,               -- NORMALIZED name, NOT actual model
    canonical_model_id TEXT,
    description TEXT,
    manual_url TEXT,
    oem_page TEXT,
    spec_keywords TEXT,
    synonyms_fts TEXT,
    synonyms_human TEXT,
    search TSVECTOR GENERATED,     -- Auto-generated for full-text search
    spec_keywords_jsonb JSONB,     -- DIP extracted specs
    synonyms_jsonb JSONB
);
```

### Additional Columns (from docs)

| Column | Type | Purpose |
|--------|------|---------|
| `manual` | boolean | Has any manual (URL or local) |
| `Manual_Local_Copy` | boolean | Has locally uploaded PDF |
| `local_manual_file_name` | text | Original uploaded filename |
| `colloquial_keywords` | text[] | Common names from docs |
| `created_at` | timestamp | Creation time |
| `updated_at` | timestamp | Last update |

### How Data Gets In

| Method | Description |
|--------|-------------|
| **Initial seed** | CSV/spreadsheet import (119 systems) |
| **Manual SQL** | `INSERT INTO systems...` |
| **Admin UI** | Manual entry |
| **NOT auto-created** | Documents require existing system |

### The Critical Gap

`model_norm` is **NOT the actual model number**:

| System | model_norm (stored) | Actual Model (reality) |
|--------|---------------------|------------------------|
| Yanmar Engine | `Port_Stbd_Engine` | **4JH57** |
| Yanmar Saildrive | `sail_drive` | **SD60** |
| Victron MPPT | `smart_solar_mppt` | **100/30** |

**Missing columns needed:**
```sql
ALTER TABLE systems ADD COLUMN model_variant TEXT;   -- "4JH57"
ALTER TABLE systems ADD COLUMN model_family TEXT;    -- "4JH_series"
```

---

## Deep Dive: Model Detection Strategy

### Text-First Approach (Validated)

**Cost comparison:**
| Approach | Cost for model detection |
|----------|-------------------------|
| Vision on all pages | ~$1.40 per 84-page doc |
| Vision on first 5 pages | ~$0.085 |
| **Text + LLM (recommended)** | **~$0.01** |

**Test result (Yanmar Saildrive):**
```json
{
  "models_found": ["SD", "SD25", "SD60", "SD110", "SD150", "SD60-5", "SD60-4"],
  "confidence": "high",
  "evidence": "Title page lists 'SD, SD25, SD60, SD110, SD150'..."
}
```

### Workflow

```
1. LlamaParse extracts text (already doing this)
           ↓
2. Send first ~15K chars to LLM (~12 pages)
   Prompt: "What models does this manual cover?"
           ↓
3. LLM returns: ["SD25", "SD60", "SD110", "SD150"]
           ↓
4. Prompt user: "Which models are on REIMAGINED?"
   User selects: SD60
           ↓
5. UPDATE systems SET model_variant = 'SD60' WHERE asset_uid = '...'
           ↓
6. Continue with Vision analysis for figures
           ↓
7. Continue with chunking (tag chunks with applies_to_models)
```

---

## Deep Dive: Chunking Strategy

### Key Decision: Chunk Everything, Filter at Query Time

**Why NOT filter during chunking:**

| If we filter during chunking | Problems |
|------------------------------|----------|
| User has 4JH57, we only chunk 4JH57 content | User adds 4JH80 later → must re-ingest entire document |
| Discard other model content | Related model info lost (4JH80 turbo might help 4JH57) |
| Smaller index | But re-processing costs $1-2 + time |

**Why chunk everything:**

| Chunk everything, filter at query | Benefits |
|-----------------------------------|----------|
| Store ALL model content | User adds equipment → instant access |
| Tag each chunk with `applies_to_models` | Filter at query time |
| Slightly larger index | Storage cheap (~$0.025/MB/month) |
| No re-processing ever | Save $1-2 and time per model change |

### Chunking Changes Needed

| Aspect | Current | Proposed |
|--------|---------|----------|
| Algorithm | Same | Same (minor: respect model boundaries) |
| Token limits | 400-1200 | Same |
| Metadata | Basic | **Enhanced with model tags** |
| Multi-model tables | Split blindly | Keep intact or extract structured |

### Enhanced Chunk Metadata

**Current:**
```json
{
  "chunk_id": "abc123",
  "doc_id": "xyz",
  "asset_uid": "engine-yanmar",
  "text": "Oil capacity is 4.2L...",
  "section_title": "Specifications"
}
```

**Proposed:**
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

---

## Deep Dive: Storage Strategy

### What Goes Where

| Data | Storage | Why |
|------|---------|-----|
| **All chunks** (all models) | Pinecone `REIMAGINEDDOCS` | Searchable, filterable |
| **Chunk text backup** | Supabase `document_chunks` | Fallback |
| **Cropped figures** | Supabase Storage | Binary files |
| **Figure metadata** | Supabase `doc_assets` | Links to chunks |
| **DIP specs** | Supabase `staging_*` tables | Structured, with `applies_to_models` |
| **User's model** | Supabase `systems.model_variant` | Query filter |

### Pinecone Query with Model Filter

```python
# User asks about oil capacity
# System knows user has 4JH57

results = pinecone_index.query(
    vector=query_embedding,
    namespace="REIMAGINEDDOCS",
    filter={
        "asset_uid": "engine-yanmar",
        "$or": [
            {"applies_to_models": {"$in": ["4JH57"]}},
            {"is_universal": True}
        ]
    },
    top_k=10
)
```

**Result:** Only 4JH57 + universal chunks returned, even though 4JH45/4JH80/4JH110 chunks exist.

---

## Proposed New Pipeline

```
1. UPLOAD (existing)
        ↓
2. LLAMAPARSE (existing) → text + page screenshots
        ↓
3. [NEW] MODEL DETECTION
   └── Send first 15K chars to LLM (~$0.01)
   └── Returns: ["SD25", "SD60", "SD110", "SD150"]
        ↓
4. [NEW] USER PROMPT
   └── "Which models are on REIMAGINED?"
   └── User selects: SD60
        ↓
5. [NEW] UPDATE SYSTEMS
   └── systems.model_variant = 'SD60'
   └── systems.model_family = 'SD_series'
        ↓
6. [NEW] VISION ANALYSIS (~$1.40 for 84 pages)
   └── Identify figures, tables, model-specific content
   └── Get bounding boxes
   └── Tag each element with applies_to_models
        ↓
7. [NEW] FIGURE CROPPING
   └── Crop figures using Vision bounding boxes
   └── Store in Supabase with model metadata
        ↓
8. CHUNKING (modified)
   └── Same algorithm
   └── Add applies_to_models to each chunk
   └── Respect model section boundaries
        ↓
9. EMBEDDING (existing)
        ↓
10. PINECONE (modified metadata)
    └── Include applies_to_models in vector metadata
        ↓
11. DIP EXTRACTION (modified)
    └── Tag specs with applies_to_models
    └── Filter: only user's models + universal
        ↓
12. STORAGE (modified)
    └── Figures in Supabase Storage
    └── Figure metadata in doc_assets
    └── Enhanced chunk metadata
```

---

## Cost Estimates for New Pipeline

| Step | Cost per Document (84 pages) |
|------|------------------------------|
| LlamaParse | ~$0.05 (existing) |
| Model Detection (text LLM) | ~$0.01 |
| Vision Analysis | ~$1.40 |
| Figure Cropping | Free (local) |
| Embeddings | ~$0.10 |
| DIP Extraction | ~$0.20 |
| **Total** | **~$1.76 per document** |

For 81 documents: ~$143 total (one-time re-ingestion)

---

---

## Deep Dive: Family/Centroid Problem (In Progress)

### The Problem

When user asks "engine won't start", the answer might be in:
- Engine manual (4JH57) - obvious
- Saildrive manual (SD60) - "clutch must be in neutral"
- Controller manual (VC20) - error codes
- Isolator switch - power disconnected

**Current approach:** Hard filter by asset_uid → only searches one system's manual
**Problem:** Misses relevant cross-system content

### Initial Hypothesis

Static family/relationship tables might be overkill. What if semantic search alone can find cross-system content?

### Test Script Created

**File:** `python-sidecar/scripts/test_semantic_vs_filtered_search.py`

Tests three approaches:
1. **Pure semantic search** - No asset_uid filter, let embeddings find relevant content
2. **Hard filter** - Current approach, filter by asset_uid
3. **Analysis** - Compare what cross-system content would be missed

### Test Results (Preliminary)

**Query:** "engine won't start"

**Findings:**
- Semantic search found **15 chunks, ALL from engine manual**
- No saildrive, controller, or other system content surfaced
- Cross-system content did NOT naturally appear

**Data Quality Issue Discovered:**
- `asset_uid` field is "unknown" for all chunks in Pinecone
- This means filtering by asset_uid wouldn't work anyway
- Metadata not properly populated during ingestion

**Systems in Pinecone:**
- Yanmar - Port_Stbd_Engine
- Yanmar - Sail_drive
- Frigomar - airconditioners
- ZeroJet - ZeroJet 350
- (others)

### Current Status: PAUSED FOR /compact

**What we learned:**
1. Semantic search alone may not surface cross-system content
2. The content about "neutral position for starting" may not exist in saildrive chunks OR isn't semantically similar enough to "engine won't start"
3. Pinecone metadata has data quality issues (asset_uid = "unknown")

**Next steps to test:**
1. Search specifically for saildrive + "neutral" + "starting" content
2. Verify if cross-system content actually exists in the chunks
3. If content exists but doesn't surface, relationships may be needed
4. If content doesn't exist, it's a chunking/content issue, not a search issue

**Key Question:** Is the problem that:
- A) Cross-system content doesn't exist in the manuals?
- B) Content exists but isn't semantically similar to the query?
- C) Content exists and is similar, but something else is wrong?

### Alternative Approaches Considered

| Approach | Pros | Cons |
|----------|------|------|
| Static family relationships | Simple to implement | Too broad - includes irrelevant systems |
| Pure semantic search | No maintenance | May miss content if embeddings don't capture relationships |
| Query understanding first | Smart expansion | Adds LLM call before search |
| Soft boost instead of hard filter | Best of both worlds | More complex ranking |
| Two-stage retrieval | Find relevant systems dynamically | Slower, more API calls |

---

## Session 2: Deep Dive on Semantic Search & DIP (2026-01-12)

### Family/Centroid Testing - COMPLETED

**Test Query:** "engine won't start"

**Results - Top 100 Pinecone results by system:**

| System | Chunks | Best Score | Would Surface in Top 15? |
|--------|--------|------------|-------------------------|
| Yanmar Engine | 82 | **0.4678** | ✅ Yes |
| Yanmar Saildrive | 9 | 0.3600 | ❌ No |
| Victron Orion | 4 | 0.3471 | ❌ No |
| Blue Sea Isolator | 0 in top 100 | 0.1888 | ❌ Never |

**Key Finding:** Cross-system content EXISTS but scores too low to surface:
- Saildrive "neutral position" content: 0.36 (vs engine 0.47)
- Battery isolator content: 0.19 (invisible)

**Conclusion:** Semantic search alone CANNOT solve cross-system troubleshooting. Embeddings don't capture causal relationships.

---

### Surprising Discovery: Semantic Search IS Working

When we looked at the #1 result for "engine won't start", it contained:

> "3. Put remote control handle in NEUTRAL.
> **Note:** Safety equipment should make it impossible to start the engine in any other position than NEUTRAL.
> 4. Turn on the battery switch for engine and engine control system."

**The right content IS being returned!** The chunk with neutral position and battery switch requirements ranks #1.

**But the problem is:**
1. It's a **procedural** chunk ("How to Start") not a **diagnostic** chunk ("Why Won't It Start")
2. The chunk is 3,497 chars - critical info buried in larger context
3. Manual doesn't explicitly say "If not in neutral → won't start"

---

### Chunking Analysis

**Chunk sizes examined:**
- Starting procedure: 3,497 chars
- Troubleshooting chart: 6,706 chars

**Verdict:** Chunks are appropriately sized. The issue isn't chunking - it's that:
1. Manual content is procedural, not diagnostic
2. Troubleshooting table assumes basics were followed
3. No explicit cause→effect statements

---

### DIP Extraction Analysis

**Examined:** `python-sidecar/scripts/dip_extraction_cached.py`

**Current DIP extraction types:**

| Extraction | What It Captures | What It Misses |
|------------|------------------|----------------|
| `spec_suggestions` | Parameter = Value | No prerequisites/dependencies |
| `playbook_hints` | Procedures with steps | "If step skipped → failure" not captured |
| `intent_router` | Q&A pairs | "Why X fails" questions not extracted |
| `golden_tests` | Validation rules | Troubleshooting symptom→cause not extracted |

**Example of what's extracted vs what's needed:**

**Extracted (playbook_hints):**
```json
{
  "title": "Starting the Engine (B25,C35-TYPE)",
  "steps": ["Turn key to ON", "Wait for glow plug indicator", "Turn to START position", "Release when engine starts"],
  "preconditions": ["All safety checks completed"]
}
```

**Missing:** "Put in NEUTRAL" and "Turn on battery switch" steps!

**What SHOULD be extracted:**
```json
{
  "symptom": "Engine won't start",
  "possible_causes": [
    {"cause": "Gear not in neutral", "check": "Verify NEUTRAL position", "related_system": "saildrive"},
    {"cause": "Battery switch off", "check": "Turn on battery switch", "related_system": "electrical"}
  ]
}
```

---

### DIP Prompt Gaps Identified

**SPEC_PROMPT:** No prerequisites or "if X then Y" relationships

**GOLDEN_PROMPT:** Has `failure_indication` but framed as validation, not troubleshooting

**INTENT_PROMPT:** Examples are "How do I X?" not "Why won't X work?"

**PROCEDURES_PROMPT:** Has `preconditions` but doesn't ask "what if precondition fails?"

**Critical Gap:** No extraction of:
- Troubleshooting tables (Symptom → Cause → Fix)
- Prerequisite → failure mode mappings
- Cross-system dependencies

---

### Decision: New DIP Category for Troubleshooting

**Rationale for extract-upfront vs query-time reasoning:**

| Factor | Extract Upfront | Query-Time |
|--------|-----------------|------------|
| Cost | One-time per doc (~$0.10) | Every query (~$0.01-0.05) |
| Speed | Fast lookup | Slow reasoning |
| Quality control | DIP agent can review | No oversight |
| Consistency | Uniform extraction | Varies by query |

**Decision:** Create new DIP category `staging_troubleshooting`

**Why new category vs enhancing existing:**
1. Different structure - One symptom → multiple causes (array)
2. Cross-system linking - Need `related_system` field
3. Priority ordering - Check basics before internals
4. Symptom variations - Multiple phrasings of same problem

---

### Proposed Schema: `staging_troubleshooting`

```sql
CREATE TABLE staging_troubleshooting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id TEXT NOT NULL,
  asset_uid UUID REFERENCES systems(asset_uid),

  -- The symptom/problem
  symptom TEXT NOT NULL,
  symptom_variations TEXT[],
  symptom_category TEXT,  -- 'wont_start', 'overheating', 'noise', 'leak'

  -- The cause (one row per cause, multiple rows per symptom)
  cause TEXT NOT NULL,
  check_action TEXT,
  resolution TEXT,

  -- Source and context
  source_type TEXT,  -- 'procedure_prerequisite', 'troubleshooting_table', 'safety_warning'
  source_ref TEXT,   -- 'Starting procedure step 3, page 57'

  -- Cross-system linking (KEY FEATURE - solves family/centroid problem!)
  related_system_uid UUID REFERENCES systems(asset_uid),
  related_system_name TEXT,

  -- Ordering
  priority INTEGER,  -- 1 = check first (basics), higher = more complex

  -- Model applicability
  models TEXT[],

  -- Standard DIP fields
  status TEXT DEFAULT 'pending',
  manufacturer_norm TEXT,
  model_norm TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for symptom search
CREATE INDEX idx_troubleshooting_symptom ON staging_troubleshooting USING gin(to_tsvector('english', symptom));
CREATE INDEX idx_troubleshooting_variations ON staging_troubleshooting USING gin(symptom_variations);
```

---

### Proposed Extraction Prompt (TROUBLESHOOTING_PROMPT)

The new prompt needs to:

1. **Invert procedures** → "Start engine" becomes symptom "Engine won't start"
2. **Extract prerequisites as causes** → "Put in NEUTRAL" becomes "Gear not in neutral"
3. **Parse troubleshooting tables** → Already has symptom→cause format
4. **Identify cross-system references** → "neutral" relates to saildrive
5. **Add priority ordering** → Check simple things first

**Key extraction sources:**
- Procedure prerequisites → "If skipped, procedure fails"
- Troubleshooting tables → Direct symptom→cause mapping
- Safety warnings/notices → Implied consequences
- Error codes → Code → meaning → resolution

---

### How This Solves the Family/Centroid Problem

**Before:** Query "engine won't start" → only engine chunks returned

**After:**
1. Query matches symptom "Engine won't start" in `staging_troubleshooting`
2. Return causes with `related_system_uid` populated
3. Causes include: engine issues, saildrive (neutral), electrical (battery switch)
4. Chat can now say: "Check these in order: 1) Gear in neutral (saildrive), 2) Battery switch on, 3) Fuel valve open..."

**Cross-system linking is built into the extraction**, not inferred at query time.

---

### Action Items

1. **Create migration** for `staging_troubleshooting` table
2. **Write TROUBLESHOOTING_PROMPT** for DIP extraction
3. **Add extraction pass** to `dip_extraction_cached.py`
4. **Update DIP agent** to review troubleshooting entries
5. **Update chat synthesis** to query troubleshooting table for failure symptoms
6. **Re-run DIP extraction** on existing documents

---

## Idea: DIP Category for Family Groups (PAUSED)

### User Question

> "Could we create a DIP category for family groups?"

### Analysis

Manuals contain relationship information that we're not currently extracting:

| Source in Manual | Example | Relationship |
|------------------|---------|--------------|
| "See also" references | "For saildrive operation, see SD60 manual" | Engine → Saildrive |
| System requirements | "Requires VC20 controller" | Engine → Controller |
| Wiring diagrams | Shows battery switch → engine | Electrical → Engine |
| Installation sections | "Connect to Lynx distributor" | Quattro → Lynx |
| Troubleshooting | "Check saildrive neutral position" | Engine depends on Saildrive |

### Three Possible Approaches

**Option A: Extract Relationships (Edges)**
```sql
CREATE TABLE staging_system_relationships (
  id UUID PRIMARY KEY,
  doc_id TEXT,
  asset_uid UUID,
  related_system_name TEXT,  -- "SD60 saildrive"
  related_asset_uid UUID,    -- Matched to systems table
  relationship_type TEXT,    -- 'requires', 'controls', 'powered_by', 'connects_to'
  relationship_direction TEXT,
  source_ref TEXT,
  excerpt TEXT,
  status TEXT DEFAULT 'pending',
  ...
);
```

**Option B: Extract Family Groups (Clusters)**
```sql
CREATE TABLE staging_family_groups (
  id UUID PRIMARY KEY,
  doc_id TEXT,
  asset_uid UUID,
  family_name TEXT,          -- 'propulsion_port', 'main_electrical'
  family_type TEXT,          -- 'propulsion', 'electrical', 'plumbing', 'hvac'
  mentioned_systems TEXT[],  -- ['SD60 saildrive', 'VC20 controller']
  role_in_family TEXT,       -- 'primary', 'controller', 'power_source'
  ...
);
```

**Option C: Both (Relationships + Inferred Families)**
- Extract relationships first (edges)
- Infer families from the graph (clusters)
- Engine → Saildrive → Propeller = "propulsion" family

### How This Complements Troubleshooting

| DIP Category | What It Captures | Use Case |
|--------------|------------------|----------|
| `staging_troubleshooting` | Symptom → Cause with `related_system` | "Engine won't start" → check saildrive |
| `staging_system_relationships` | System → System connections | Build family graph |
| Combined | Query both | "Show me all systems related to engine + their failure modes" |

### Extraction Sources

The prompt would look for:
1. "See X manual" / "Refer to X"
2. "Connect to X" / "Requires X"
3. "Controlled by X" / "Controls X"
4. "Powered by X" / "Powers X"
5. Systems mentioned in wiring diagrams
6. Systems mentioned in troubleshooting sections

### Status: PAUSED

**Next Step:** Decide which approach (A, B, or C) before implementation. Consider whether relationships (edges) or family groups (clusters) are more useful for chat and troubleshooting use cases.

---

## Idea: Multi-Source System Discovery (NEW)

### The Problem

The systems table is incomplete. We might have:
- Systems on the boat not in the table
- Manuals for systems we don't have recorded
- Wrong model variants (generic names vs actual model numbers)

### The Idea

Use multiple sources to discover systems and find gaps:

```
┌─────────────────────────────────────────────────────────────┐
│                    SYSTEM DISCOVERY SOURCES                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. VIDEO OF BOAT          2. BALANCE USER MANUAL           │
│     - Nav station             - Builder's equipment list    │
│     - Engine bay              - Standard installations      │
│     - Kitchen/galley          - System descriptions         │
│     - Electrical panels                                     │
│                            3. BUILD EXCEL SPREADSHEET       │
│                               - Actual equipment ordered    │
│                               - Model numbers               │
│                               - Serial numbers              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                           ↓                                 │
│                   VISION / PARSING                          │
│                           ↓                                 │
│              DISCOVERED SYSTEMS LIST                        │
│                           ↓                                 │
│              COMPARE TO SYSTEMS TABLE                       │
│                           ↓                                 │
│     ┌─────────────┬──────────────┬─────────────────┐       │
│     │   FOUND     │   MISSING    │   UNCERTAIN     │       │
│     │ (in table)  │ (not in table)│ (fuzzy match)  │       │
│     └─────────────┴──────────────┴─────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### Source 1: Video of Boat

**Process:**
1. Record video of key areas (nav station, engine bay, galley, electrical panels)
2. Extract key frames (scene changes, pauses, clear shots)
3. Run Vision LLM on each frame
4. Detect: manufacturer logos, model numbers, serial numbers, equipment labels
5. Aggregate detections across all frames

**What Vision could detect:**

| Element | Example | Use |
|---------|---------|-----|
| Manufacturer logos | Victron, Yanmar, B&G | Match to manufacturer_norm |
| Model numbers | BMV-712, 4JH57, Zeus3 | Populate model_variant |
| Serial numbers | SN: 12345 | Asset tracking |
| Equipment labels | "Main Battery Switch" | System identification |
| Location context | Engine bay, nav station | Equipment location mapping |

**Challenges:**
- Lighting (engine bays are dark)
- Labels obscured, dirty, or at bad angles
- Smart frame extraction needed
- Fuzzy matching to systems table

### Source 2: Balance User Manual

**Process:**
1. Parse the generic Balance catamaran user manual
2. Extract all equipment/systems mentioned
3. Identify standard installations vs options
4. Compare against systems table

**What it contains:**
- Builder's standard equipment list
- System descriptions and locations
- Wiring/plumbing diagrams with equipment labels
- Maintenance schedules referencing specific equipment

### Source 3: Build Excel Spreadsheet

**Process:**
1. Parse the build spreadsheet (already have this data)
2. Extract actual equipment ordered/installed
3. Get exact model numbers (not generic names)
4. Compare against systems table

**What it contains:**
- Actual model numbers ordered (4JH57, not "Yanmar engine")
- Options selected
- Serial numbers (possibly)
- Installation dates

### Output: Systems Gap Report Page

Create an admin page showing:

```
┌─────────────────────────────────────────────────────────────┐
│  SYSTEM DISCOVERY - GAP REPORT                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  FOUND IN VIDEO / DOCS BUT NOT IN SYSTEMS TABLE:            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ⚠️  Victron BMV-712 (nav station video, frame 342)  │   │
│  │ ⚠️  Blue Sea 7700 (electrical panel video)          │   │
│  │ ⚠️  Whale Gulper 220 (Balance manual, p.45)         │   │
│  │     [Add to Systems] [Ignore] [Mark as Duplicate]   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  MODEL VARIANT UPDATES SUGGESTED:                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 📝 Yanmar Port_Stbd_Engine → 4JH57 (engine bay)     │   │
│  │ 📝 Victron smart_solar_mppt → 100/30 (video)        │   │
│  │     [Update] [Ignore]                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  UNCERTAIN MATCHES (needs review):                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ❓ "Dometic AC" - matches Dometic_Turbo? (60% conf) │   │
│  │     [Confirm Match] [Different System] [Ignore]     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### What This Solves

| Problem | Solution |
|---------|----------|
| Missing systems | Discover from video/docs, add to table |
| Wrong model_variant | See actual "4JH57" on nameplate |
| No location tracking | Know which panel/bay each system is in |
| Manual gaps | "We have X on boat but no manual uploaded" |
| Visual references | Photos of YOUR equipment for chat |

### Technical Approach

**Video Processing:**
```python
# Pseudocode
def process_boat_video(video_path):
    frames = extract_key_frames(video_path)  # Scene changes, clear shots

    discoveries = []
    for frame in frames:
        result = vision_llm.analyze(frame, prompt="""
            List all equipment visible in this image.
            For each, provide:
            - Manufacturer (if visible)
            - Model number (if visible)
            - Any serial numbers
            - Any text labels
            - Equipment type (pump, controller, battery, etc.)
            - Confidence level
        """)
        discoveries.extend(result.equipment)

    return deduplicate_and_aggregate(discoveries)
```

**Gap Detection:**
```python
def find_gaps(discoveries, systems_table):
    gaps = []
    updates = []
    uncertain = []

    for item in discoveries:
        match = fuzzy_match_to_systems(item, systems_table)

        if match.confidence > 0.9:
            if match.model_variant_differs:
                updates.append((item, match))
        elif match.confidence > 0.5:
            uncertain.append((item, match))
        else:
            gaps.append(item)

    return gaps, updates, uncertain
```

### Status: TO EXPLORE

**Next Steps:**
1. Test Vision LLM on a few boat photos/video frames
2. Parse Balance user manual for equipment list
3. Review build spreadsheet structure
4. Design the gap report page UI
5. Build the comparison/matching logic

---

## Existing Tool: Manual Hunter Agent

### Discovery

We already have a **Manual Hunter Agent** that searches for and downloads PDF manuals:

**Location:** `scripts/agents/manual-hunter.js`

**What it does:**
1. Queries systems from database (systems needing manuals)
2. Searches multiple sources via SerpAPI:
   - Google (`"{manufacturer} {model} manual filetype:pdf"`)
   - ManualsLib
   - Archive.org
3. Downloads PDFs (configurable limit)
4. Validates with LLM (GPT-4o-mini checks if PDF matches expected system)
5. Generates reports (JSON + Markdown)
6. Blacklist tracking (skips systems after N failed attempts)

**Key files:**
```
scripts/agents/
├── manual-hunter.js              # Main agent (822 lines)
├── manual-hunter-config.js       # Configuration
├── manual-hunter-strategies.js   # Search strategies (SerpAPI, etc.)
├── manual-hunter-python-parser.js # PDF text extraction
├── manual-validator.js           # Validation logic
└── README.md                     # Full documentation
```

### Connection to System Discovery

**Combined workflow:**

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: SYSTEM DISCOVERY                                  │
│                                                             │
│  Video of boat ──┐                                          │
│  Balance manual ─┼──→ Discovered Systems ──→ Gap Report     │
│  Build Excel ────┘                                          │
│                                                             │
│  Output: List of systems NOT in systems table               │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: ADD TO SYSTEMS TABLE                              │
│                                                             │
│  User reviews gap report                                    │
│  Clicks [Add to Systems] for each confirmed system          │
│  Systems table now has new entries                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3: AUTO-FIND MANUALS (Manual Hunter)                 │
│                                                             │
│  New systems flagged as needing manuals                     │
│  Manual Hunter queries for each:                            │
│    - SerpAPI search: "{manufacturer} {model} manual pdf"    │
│    - ManualsLib, Archive.org                                │
│  Downloads + validates PDFs                                 │
│  Auto-uploads to document system                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  PHASE 4: DIP EXTRACTION                                    │
│                                                             │
│  New manuals go through DIP pipeline                        │
│  Extract: specs, procedures, troubleshooting, relationships │
│  DIP agent reviews and approves                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Benefits of integration:**

| Step | Manual Process | Automated Process |
|------|----------------|-------------------|
| Find missing systems | Walk around boat, write down | Vision LLM on video |
| Add to systems table | Manual data entry | One-click from gap report |
| Find manuals | Google each one manually | Manual Hunter batch search |
| Upload manuals | Manual upload each | Auto-upload from Hunter |
| Extract DIP content | Manual trigger | Auto-triggered on upload |

**Double benefit:**
1. Populate systems table (complete inventory)
2. Get manuals for those systems (complete documentation)

### Manual Hunter Configuration

From `manual-hunter-config.js`:
```javascript
{
  maxPdfs: 40,           // Stop after 40 downloads
  batchSize: 5,          // Process 5 systems in parallel
  requestDelay: 2000,    // 2 seconds between batches
  searchTimeout: 30000,  // 30 second timeout per search
  maxSerpApiCalls: 100   // Limit API usage
}
```

### Running Manual Hunter

```bash
# Export systems needing manuals
node scripts/export-systems-needing-manuals.js

# Run the hunter
node scripts/agents/manual-hunter.js
```

Or via GitHub Actions workflow for unattended batch processing.

---

## Fresh Start Strategy: Purge Content, Keep Training

### The Decision

After extensive analysis, considering a **full content purge** while **preserving the DIP agent training foundation**.

### Why Fresh Start?

Building on broken foundation compounds errors:
- 78% of documents have multi-model problem
- Visual content (diagrams, tables) missing
- Systems table incomplete with wrong model variants
- DIP extraction missing troubleshooting category
- Playbook hints have incomplete steps (missing neutral, battery switch)
- Current DIP has ~7,000 items built on flawed extraction

### What Gets PURGED

| Table/System | Items | Reason |
|--------------|-------|--------|
| Documents (Supabase storage) | ~81 docs | Re-ingest with new pipeline |
| document_chunks | thousands | Re-chunk properly |
| Pinecone vectors (REIMAGINEDDOCS) | thousands | Re-embed with model tagging |
| staging_spec_suggestions | ~1,900 | Re-extract with new prompts |
| staging_playbook_hints | ~1,100 | Re-extract with new prompts |
| staging_intent_router | ~2,200 | Re-extract with new prompts |
| staging_golden_tests | ~1,700 | Re-extract with new prompts |
| maintenance_tasks | ? | Re-process |
| **Total DIP items** | **~7,000** | All gone |

### What Gets KEPT

| Table | Items | Why Keep |
|-------|-------|----------|
| agent_training_decisions | 385 | Patterns still valid - "reject compliance, approve operational specs" |
| agent_config | 1 | Learned criteria, thresholds, few-shot examples |

### Why Training Survives Content Purge

The training decisions capture **patterns**, not specific content:

```
Learned patterns (still valid):
├── "Reject: Compliance, regulatory, FCC, CE certifications"
├── "Approve: Operational specs, procedures, troubleshooting"
├── "Reject: Installation-only with no repair value"
├── "Approve: Repair-relevant even if categorized as installation"
└── "Reject: Too generic, not specific to actual system"
```

**How agent uses training after purge:**

```
1. New DIP extraction creates fresh staging_* items
2. Agent generates embedding for new item
3. Queries agent_training_decisions: "find similar past decisions"
4. Returns: "This looks like stuff Brad approved/rejected before"
5. Uses those 385 patterns to judge new content
6. New decisions added to training table (grows over time)
```

### Training Table Structure

```sql
agent_training_decisions:
  id                 -- UUID
  agent_type         -- 'dip'
  source_table       -- 'staging_spec_suggestions', etc.
  source_id          -- Original item ID (will be orphaned after purge)
  item_snapshot      -- JSONB of full item at decision time (PRESERVED)
  decision           -- 'approved' | 'rejected'
  reasoning          -- "Legitimate operational spec" (PRESERVED)
  embedding          -- pgvector for similarity search (PRESERVED)
  decision_source    -- 'human' | 'agent' | 'telegram'
  confidence         -- Agent confidence at time of decision
  is_weak_label      -- true for pre-filter decisions
```

**Key insight:** `item_snapshot` and `reasoning` contain everything needed. The `source_id` becomes orphaned but doesn't matter - the snapshot IS the training data.

### Incremental Training Needed After Fresh Start

| New Capability | Training Decisions Needed |
|----------------|---------------------------|
| `staging_troubleshooting` (new table) | ~20-30 new decisions |
| `staging_system_relationships` (new table) | ~10-20 new decisions |
| Multi-model filtering (if added) | ~10-20 new decisions |
| Existing patterns (specs, playbooks, etc.) | ❌ None - 385 still apply |

**Total new training:** ~50-70 decisions, NOT 385 from scratch.

### Fresh Start Sequence

```
Phase 1: BACKUP
├── Export agent_training_decisions to JSON
├── Export agent_config to JSON
└── Document current state

Phase 2: PURGE
├── Delete Pinecone namespace REIMAGINEDDOCS
├── Truncate document_chunks
├── Truncate staging_spec_suggestions
├── Truncate staging_playbook_hints
├── Truncate staging_intent_router
├── Truncate staging_golden_tests
├── Delete documents from Supabase storage
└── Truncate maintenance_tasks (if applicable)

Phase 3: RE-INGEST (with new pipeline)
├── Vision analysis for figures/tables
├── Multi-model detection per document
├── Model-variant tagging in metadata
├── Proper chunking with context preservation
└── Enhanced Pinecone metadata (linked_asset_uid, models[], etc.)

Phase 4: NEW DIP EXTRACTION
├── Enhanced prompts for existing 4 categories
├── NEW: Troubleshooting extraction (staging_troubleshooting)
├── NEW: System relationships extraction (if decided)
└── Run on all re-ingested documents

Phase 5: AGENT RESUMES
├── Agent uses preserved 385 training decisions
├── Evaluates new staging items against old patterns
├── Incremental training for new categories
└── Continue improving with Telegram feedback loop
```

### Risk Mitigation

**Risk:** Embeddings in training table encode OLD content format. After re-ingestion, similarity matching might degrade.

**Options:**
1. **Keep old embeddings** - Accept slightly lower similarity scores (patterns still work)
2. **Re-embed training decisions** - Update vectors while keeping reasoning (safer)

**Recommendation:** Start with option 1. If similarity scores drop significantly, run re-embedding migration.

### Cost Estimate for Fresh Start

| Step | Estimated Cost |
|------|----------------|
| Re-ingest 81 docs (LlamaParse) | ~$8 |
| Vision analysis (selective pages) | ~$50-100 |
| Re-embed all chunks (OpenAI) | ~$20 |
| New DIP extraction (Anthropic) | ~$15 |
| **Total** | **~$100-150** |

Plus human time for:
- ~50-70 new training decisions for new categories
- Review and validation of new pipeline

---

## Session Status (for /compact recovery)

**Date:** 2026-01-12
**Last Active Section:** Content Inventory ✅ COMPLETE

### Where We Are Now

**Completed:** Full content inventory of all storage locations
- ✅ Pinecone namespaces documented
- ✅ All Supabase tables categorized (~50 tables)
- ✅ Supabase storage paths identified
- ✅ Purge/Keep decisions documented

**Ready for next decision:** Review the "REVIEW" items in the Purge Summary and decide exact scope before executing.

### Key Decisions Made This Session

1. **New DIP category `staging_troubleshooting`** - Extract symptom→cause mappings with cross-system linking (solves family/centroid problem)

2. **Extract upfront, not query-time** - More scalable, one-time cost, DIP agent can review

3. **Family groups DIP category** - PAUSED, need to decide approach (edges vs clusters vs both)

4. **Multi-source system discovery** - Use video + Balance manual + Excel to find systems not in table, connects to Manual Hunter for auto-finding manuals

5. **Fresh start strategy** - PURGE processed content (chunks, vectors, staging tables), KEEP training foundation (385 decisions in agent_training_decisions)

6. **Keep source PDFs** - Don't delete actual manual files from Supabase storage, only purge processed data

7. **Content inventory** - ✅ Complete (see **96a Content Inventory for Fresh Start.md**)

8. **Schema changes** - ✅ Specified (see **96b Schema Changes - Complete Specification.md**)

### Next Steps

1. **Review "REVIEW" items** in Purge Summary and make final decisions
2. **Create purge script** or SQL commands for approved items
3. **Backup agent_training_decisions** before any changes
4. **Execute purge** in controlled sequence
5. **Create `staging_troubleshooting` table** migration
6. **Create `staging_system_relationships` table** migration (families via DIP)
7. **Update DIP extraction prompts** with troubleshooting + relationship extraction
8. **Add OEM columns to systems table** (oem_manufacturer, oem_model, oem_part_number)
9. **Build bulk system processing UI** for adding OEM info from photos
10. **Re-ingest documents** with new pipeline

---

## Session 3: Photo-Based Equipment Discovery (2026-01-13)

### Key Discovery: Photos >> Video for Equipment ID

Tested two approaches:
- **Video walkthrough**: Extracted frames every 3 seconds, ran Vision
- **Targeted photos**: Direct shots of nameplates and labels

**Results:**
| Method | Manufacturer ID | Model ID | Part Numbers |
|--------|-----------------|----------|--------------|
| Video frames | ~60% | ~30% | ~10% |
| Targeted photos | ~95% | ~85% | ~70% |

**Conclusion:** Photos are significantly more effective. Video good for discovery ("what's there"), photos for details.

### Photo Test Results

**Deck Hardware (IMG_3069-3074):**
- Harken 57 block
- Spinlock XTS clutch with CAM 0814 (8-14mm line)
- Note: Simple hardware (blocks, fairleads, clutches) don't need systems table entries - no manuals/maintenance needed

**Starboard Engine Bay (IMG_3075-3092):**
- Yanmar engine + saildrive
- Integrel ISP-002 controller (9000W, 48V, 170A, S/N: 02-00344)
- Victron SmartSolar MPPT 100|20
- Victron Galvanic Isolator VDI-64 A
- Blue Sea ML-RBS battery isolator
- Mastervolt AGM battery
- Racor dual fuel filter
- Autopilot ram with V55205 solenoid

### OEM Discovery: B&G → Hy-ProDrive

**Finding:** V55205 solenoid on autopilot ram is a Hy-ProDrive part number.

**Research revealed:** Hy-ProDrive (Hydraulic Projects Ltd, UK) is the OEM manufacturer for:
- B&G autopilot rams
- Raymarine autopilot rams
- Garmin autopilot rams

**Implication:**
- Systems table says "B&G T2 Ram 24V" (correct branded name)
- Actual manufacturer is Hy-ProDrive ML+40
- Spare parts available from Hy-ProDrive directly (cheaper)
- Service manual might be available from Hy-ProDrive

### Family Assignment: DIP-Extracted, Not Pre-Assigned

**Key decision:** System families/relationships should be EXTRACTED by DIP from manuals, not manually assigned beforehand.

**Why:**
- Manuals contain relationship info: "NAC-3 controls the T2 Ram"
- DIP extracts these as `staging_system_relationships`
- DIP agent reviews/approves relationships
- Families EMERGE from approved relationship graph

**Schema:**
```sql
CREATE TABLE staging_system_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id TEXT NOT NULL,
  source_system_uid UUID,           -- e.g., NAC-3
  target_system_uid UUID,           -- e.g., T2 Ram
  relationship_type TEXT,           -- 'controls', 'feedback', 'powers'
  relationship_text TEXT,           -- Original text from manual
  confidence NUMERIC,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### End-to-End Pipeline (Revised)

```
PHASE 1: MULTI-SOURCE DISCOVERY
├── Photos (targeted) ─────► Vision Analysis ─────┐
├── Video (walkthrough) ───► Frame Extraction ────┤
├── Balance Manual ────────► System List ─────────┼──► Gap Analysis
├── Excel Inventory ───────► Cross-reference ─────┤
└── Web Search ────────────► OEM Resolution ──────┘
                                    │
                                    ▼
PHASE 2: SYSTEMS TABLE UPDATE
├── Add missing equipment
├── Add OEM info (manufacturer, model, part number)
├── Add serial numbers from photos
└── NO family assignment (comes from DIP)
                                    │
                                    ▼
PHASE 3: MANUAL ACQUISITION
├── Manual Hunter searches by BOTH:
│   ├── Branded name (B&G T2 Ram)
│   └── OEM part number (Hy-ProDrive ML+40)
└── Download to storage
                                    │
                                    ▼
PHASE 4: DOCUMENT PROCESSING
├── LlamaParse (text)
├── Vision (figures)
├── Model detection (multi-model manuals)
└── Enhanced chunking
                                    │
                                    ▼
PHASE 5: DIP EXTRACTION (Enhanced)
├── staging_spec_suggestions
├── staging_playbook_hints
├── staging_intent_router
├── staging_golden_tests
├── staging_troubleshooting (NEW)
└── staging_system_relationships (NEW - families)
                                    │
                                    ▼
PHASE 6: DIP AGENT REVIEW
├── Uses 385 training decisions
├── Reviews ALL categories including relationships
├── Telegram escalation for uncertain
└── Families emerge from approved relationships
```

### UI Needed: Bulk System Processing

Current: Single system add/edit

Need: Bulk processing screen for:
- Queue of systems needing review
- Photo attachment to systems
- OEM info lookup/entry
- Gap indicators (no manual, no serial, etc.)
- NOT family assignment (that's DIP)

### Schema Changes Needed

```sql
-- Add to systems table
ALTER TABLE systems ADD COLUMN oem_manufacturer TEXT;
ALTER TABLE systems ADD COLUMN oem_model TEXT;
ALTER TABLE systems ADD COLUMN oem_part_number TEXT;
ALTER TABLE systems ADD COLUMN serial_number TEXT;

-- System photos
CREATE TABLE system_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_uid UUID REFERENCES systems(asset_uid),
  photo_path TEXT NOT NULL,
  photo_type TEXT,                    -- 'nameplate', 'installed', 'serial'
  extracted_text JSONB,               -- Vision extraction results
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- DIP-extracted relationships (families)
CREATE TABLE staging_system_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id TEXT NOT NULL,
  source_system_uid UUID,
  target_system_uid UUID,
  relationship_type TEXT,
  relationship_text TEXT,
  confidence NUMERIC,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Complete Content Inventory (2026-01-12)

**Pinecone Index: `reimaginedsv`**

| Namespace | Purpose | Purge? |
|-----------|---------|--------|
| `REIMAGINEDDOCS` | Document chunks (vectors) | ✅ PURGE |
| `MAINTENANCE_TASKS` | Maintenance agent vectors | ✅ PURGE |

**Supabase Tables - Document System:**

| Table | Purpose | Purge? |
|-------|---------|--------|
| `documents` | Document metadata | ⚠️ RESET (keep structure, purge rows) |
| `document_chunks` | Chunk text backup | ✅ PURGE |
| `doc_assets` | Figure/image references | ✅ PURGE |

**Supabase Tables - Production DIP (Approved Content):**

| Table | Purpose | Purge? |
|-------|---------|--------|
| `spec_suggestions` | Approved specs | ✅ PURGE |
| `golden_tests` | Approved validation rules | ✅ PURGE |
| `playbook_hints` | Approved procedures | ✅ PURGE |
| `intent_router` | Approved Q&A pairs | ✅ PURGE |
| `playbooks` | Structured playbooks | ✅ PURGE |
| `playbook_steps` | Playbook step details | ✅ PURGE |
| `spec_lexicon` | Spec term dictionary | Review |
| `knowledge_facts` | View (auto-rebuilds) | N/A |

**Supabase Tables - Staging DIP (Pending Review):**

| Table | Purpose | Purge? |
|-------|---------|--------|
| `staging_spec_suggestions` | Pending specs | ✅ PURGE |
| `staging_golden_tests` | Pending tests | ✅ PURGE |
| `staging_playbook_hints` | Pending procedures | ✅ PURGE |
| `staging_intent_router` | Pending Q&A | ✅ PURGE |
| `staging_systems` | Pending system entries | Review |
| `staging_instances` | Pending instances | Review |

**Supabase Tables - Declined DIP (Rejected):**

| Table | Purpose | Purge? |
|-------|---------|--------|
| `declined_spec_suggestions` | Rejected specs | ✅ PURGE |
| `declined_golden_tests` | Rejected tests | ✅ PURGE |
| `declined_playbook_hints` | Rejected procedures | ✅ PURGE |
| `declined_intent_router` | Rejected Q&A | ✅ PURGE |

**Supabase Tables - DIP Agent (KEEP!):**

| Table | Purpose | Purge? |
|-------|---------|--------|
| `agent_training_decisions` | 385 training decisions | ❌ KEEP |
| `agent_config` | Learned criteria, thresholds | ❌ KEEP |
| `agent_runs` | Run history | Review |
| `agent_run_items` | Run item details | Review |

**Supabase Tables - Maintenance Agent:**

| Table | Purpose | Purge? |
|-------|---------|--------|
| `maintenance_tasks_index` | Extracted tasks | ✅ PURGE |
| `maintenance_tasks_queue` | Queue for processing | ✅ PURGE |
| `user_tasks` | User-created tasks | ❌ KEEP (user data) |
| `pipeline_runs` | Pipeline run history | Review |
| `pipeline_processing_status` | Processing state | Review |
| `deduplication_reviews` | Dedup decisions | Review |
| `deduplication_analyses` | Dedup analysis | Review |
| `deduplication_pending_reviews` | Pending dedup | ✅ PURGE |
| `pinecone_search_results` | Search cache | ✅ PURGE |

**Supabase Tables - Chat System:**

| Table | Purpose | Purge? |
|-------|---------|--------|
| `chat_threads` | Conversation threads | ❌ KEEP (user data) |
| `chat_messages` | Messages | ❌ KEEP (user data) |
| `chat_sessions` | Sessions | ❌ KEEP (user data) |

**Supabase Tables - System Inventory:**

| Table | Purpose | Purge? |
|-------|---------|--------|
| `systems` | 119 equipment entries | ❌ KEEP (add model_variant) |
| `instances` | System instances | Review |

**Supabase Tables - User Features:**

| Table | Purpose | Purge? |
|-------|---------|--------|
| `supplies` | Inventory items | ❌ KEEP (user data) |
| `supply_categories` | Categories | ❌ KEEP |
| `supply_units` | Units of measure | ❌ KEEP |
| `trips` | Trip logs | ❌ KEEP (user data) |
| `anchor_watch_zones` | Anchor zones | ❌ KEEP (user data) |
| `anchorages` | Saved anchorages | ❌ KEEP (user data) |
| `season_recaps` | Season summaries | ❌ KEEP (user data) |

**Supabase Tables - Job Tracking:**

| Table | Purpose | Purge? |
|-------|---------|--------|
| `jobs` | Background jobs | Review |
| `merge_audit` | Merge history | Review |

**Supabase Tables - Testing:**

| Table | Purpose | Purge? |
|-------|---------|--------|
| `test_results` | Test run results | Optional |
| `test_analysis` | Test analysis | Optional |

**Supabase Storage - `documents` Bucket:**

| Path | Purpose | Purge? |
|------|---------|--------|
| `/manuals/{doc_id}/` | Original PDF files | ❌ KEEP |
| `/dip/{doc_id}/` | DIP extraction JSON | ✅ PURGE |
| `/page-screenshots/` | Page images | ✅ PURGE |
| `/supply-photos/` | Supply images | ❌ KEEP (user data) |

---

### Purge Summary

**DEFINITE PURGE:**
- Pinecone: Both namespaces (REIMAGINEDDOCS, MAINTENANCE_TASKS)
- All staging_* tables (except staging_systems - review first)
- All declined_* tables
- Production DIP tables (spec_suggestions, golden_tests, playbook_hints, intent_router, playbooks, playbook_steps)
- document_chunks, doc_assets
- maintenance_tasks_index, maintenance_tasks_queue
- deduplication_pending_reviews
- pinecone_search_results
- Storage: /dip/, /page-screenshots/

**DEFINITE KEEP:**
- agent_training_decisions (385 training decisions!)
- agent_config (learned criteria)
- systems (need to add model_variant)
- All user data: chat_*, trips, supplies, anchor_*, anchorages, season_recaps, user_tasks
- Storage: /manuals/ (source PDFs), /supply-photos/

**REVIEW:**
- documents table - keep structure, purge rows? Or keep foreign keys?
- agent_runs, agent_run_items - keep for debugging?
- pipeline_runs, pipeline_processing_status - keep for debugging?
- deduplication_reviews, deduplication_analyses - training data?
- jobs, merge_audit - history?
- staging_systems - any manual entries?
- instances - user data?

### What Was Accomplished (Session 1 - 2026-01-11):

1. ✅ Reviewed CLAUDE.md, .cursorrules, /docs thoroughly
2. ✅ Identified 5 core problems (multi-model, images, model variants, relationships, doc↔system complexity)
3. ✅ Tested Vision page analysis (Marco pump) - WORKS
4. ✅ Tested figure cropping - WORKS
5. ✅ Tested multi-model detection (Yanmar, Victron) - WORKS
6. ✅ Tested text-based model detection - WORKS ($0.01 vs $1.40)
7. ✅ Deep dive on current ingestion pipeline
8. ✅ Deep dive on systems table schema
9. ✅ Defined chunking strategy (chunk everything, filter at query)

### What Was Accomplished (Session 2 - 2026-01-12):

10. ✅ Completed family/centroid testing
11. ✅ Discovered semantic search IS working (right chunks returned)
12. ✅ Analyzed chunk content (procedural vs diagnostic gap)
13. ✅ Deep dive on DIP extraction prompts
14. ✅ Identified DIP prompt gaps (no troubleshooting extraction)
15. ✅ Analyzed existing DIP content for Yanmar
16. ✅ Decision: Create new DIP category `staging_troubleshooting`
17. ✅ Designed schema with cross-system linking
18. ✅ Documented idea: DIP category for family groups (PAUSED)
19. ✅ Documented idea: Multi-source system discovery (video + Balance + Excel)
20. ✅ Found existing Manual Hunter agent - documented connection
21. ✅ Reviewed DIP Agent docs (69, 70) - understood v3.0 margin-based logic
22. ✅ Discussed fresh start strategy - purge content, keep training
23. 📋 Documented fresh start sequence and cost estimates

### Test Scripts Created:

| Script | Purpose | Status |
|--------|---------|--------|
| `test_vision_page_analysis.py` | Claude Vision on page screenshots | ✅ Working |
| `test_figure_cropping.py` | Crop figures using bounding boxes | ✅ Working |
| `test_pdf_vision_analysis.py` | Full PDF → Vision analysis | ✅ Working |
| `test_semantic_vs_filtered_search.py` | Test semantic vs hard-filtered search | ✅ Complete |

### Key Files:

- **Working doc:** `/code updates/96 Document Foundation Crisis - Multi-Model Images and System Relationships.md`
- **Test images:** `python-sidecar/visual_extraction_work/vision_test_results/`
- **Cropped figures:** `python-sidecar/visual_extraction_work/vision_test_results/cropped/`

### Validated Approaches:

| Capability | Status | Cost |
|------------|--------|------|
| Vision identifies figures/tables | ✅ | ~$0.017/page |
| Vision detects multi-model content | ✅ | Included above |
| Bounding box cropping | ✅ | Free (local) |
| Text-based model detection | ✅ | ~$0.01/doc |
| Full re-ingestion estimate | Ready | ~$143 for 81 docs |

### Open Questions

1. **Vision LLM choice:** Claude Vision vs GPT-4V? Need to test both.
2. **Table handling:** Extract as structured data, as images, or both?
3. ~~**Family relationships:** Do we need them, or is better semantic search enough?~~ **RESOLVED:** Need explicit cross-system linking via `staging_troubleshooting`
4. **Pinecone metadata:** linked_asset_uid exists but categorization needs review
5. **Migration strategy:** Re-ingest everything or incremental update?
6. **DIP agent:** Pause auto-processing until data quality improves?
7. **NEW: Troubleshooting prompt:** How to get LLM to infer failure modes from procedures?
8. **NEW: Related system mapping:** How to identify "neutral" → saildrive automatically?

---

## Key Quotes from Conversation

> "Documents are what is supposed to make the chat specific to my boat, and not generic."

> "All of these problems. Answers in AI are confused... which sail drive do I have, which model of fridge, the DIP agent I am trying to build wants to auto approve content for wrong models, we are losing critical tables and images that are needed for chat and they are not there."

> "Family connections feels like a centroid problem."

> "The images are a big problem - re-review that doc and see the recommendation, they were actually total shit. Which was just capture the page."

> "Am I using the wrong tools, are we trying to do something that can't be done?"

**Answer:** Tools are fine. Architecture needs rework. This is absolutely achievable.

---

## Files Referenced

| File | Relevance |
|------|-----------|
| `/docs/**/*.md` | System documentation |
| `code updates/69 Autonomous DIP and Maintenance Review Agents.md` | DIP agent initial build |
| `code updates/70 DIP Agent v2 Production-Ready Autonomous Processing.md` | DIP agent v3.0 details |
| `code updates/65 Visual Extraction - Image Extraction from Documents.md` | Visual extraction (inadequate solution) |
| `code updates/71 Multi-Model Manual Problem Analysis.md` | Multi-model analysis results |
| `src/schemas/systems.schema.js` | Systems table schema |
| `src/repositories/systems.repository.js` | Systems database operations |

---

## Session Log

**Date:** 2026-01-11
**Duration:** Extended analysis session
**Participants:** User + Claude (Opus 4.5)

### Conversation Flow

1. User asked for deep review of project documentation
2. Claude reviewed CLAUDE.md, .cursorrules, /docs/**
3. User revealed "big problem" - documents are core but broken
4. Reviewed connected projects (docs 65, 69, 70, 71)
5. Identified cascade of problems from document foundation
6. Analyzed multi-model manual problem (78% of docs affected)
7. Analyzed visual extraction inadequacy
8. Analyzed missing model variants in systems table
9. Analyzed missing system relationships
10. Analyzed document↔system relationship complexity
11. Evaluated tool stack (tools fine, architecture broken)
12. Proposed solution architecture
13. Identified need for test scripts before full refactor
14. Created this working document

---

*This document will be updated as test scripts are built and results analyzed.*
