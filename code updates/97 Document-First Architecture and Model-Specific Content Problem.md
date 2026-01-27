# 97 Document-First Architecture and Model-Specific Content Problem

**Date:** 2026-01-16 (Updated 2026-01-20)
**Status:** BLOCKED - Canonical naming problem must be solved first
**Parent Documents:** 96 series (partially superseded)
**Previous Session Context:** `/Users/brad/Desktop/context.rtf`

---

## Executive Summary

The 96 series documents designed a comprehensive v5 pipeline for handling multi-model manuals, vision analysis, and system relationships. However, a fundamental assumption was wrong:

**Old assumption:** System exists first → upload document → attach to system
**New realization:** Document should CREATE systems → user validates → systems exist

This document captures the corrected architecture, what remains valid from 96 series, and the **SOLVED** approach to model-specific content: DIP extraction with `applies_to_models` tagging and inclusion/exclusion logic.

### Critical Blocker (2026-01-20)

**The Referenced Systems Naming Problem:** Before implementing any tagging (Pinecone, DIP, Vision), we MUST solve canonical naming. If we tag content with `referenced_systems: ["VC20"]` but the system is later created as `model_norm: "VC 20"`, all tags become orphaned. See "The Referenced Systems Naming Problem (CRITICAL)" section below.

---

## The Discovery

### What Triggered This

While testing model detection with the Yanmar 4JH manual:

1. **15K characters is not enough** - Model references are scattered throughout the 391K char document
2. **Regex won't work** - Need semantic understanding (VC10/VC20/VC30 are Vessel Control Systems, not sail drives)
3. **The upload flow is backwards** - Users might not know what model they have; the manual knows

### The Fundamental Shift

| Old Model (96 series) | New Model (97) |
|----------------------|----------------|
| User creates system entry first | Document creates system entries |
| Upload requires selecting manufacturer/model | Upload is just "here's a PDF" |
| Model detection checks "which known models?" | Model detection PROPOSES new systems |
| Systems table is INPUT to upload | Systems table is OUTPUT of upload |
| 1:1 document↔system relationship | Many-to-many relationship |

### Real-World Examples

**Example 1: User has Yanmar 4JH57**
- User might not know it's specifically a "4JH57" vs "4JH80"
- They upload the manual they have
- LLM extracts: "This manual covers 3JH40, 4JH45, 4JH57, 4JH80, 4JH110"
- User sees: "Which of these do you have?" → selects 4JH57
- System created with correct model

**Example 2: User uploads Cyclops Marine manual**
- Manual covers 5+ different load sensor products
- User selects which ones they have installed
- Creates multiple system entries from one document

**Example 3: User has no manual**
- Some equipment has no PDF (simple hardware, lost manual)
- Keep systems.html for manual entry
- Flag these as `source='manual_entry'`

---

## What Remains Valid from 96 Series

### Schema Work (96b) - KEEP

| Item | Status | Notes |
|------|--------|-------|
| Reference tables (ref_manufacturers, ref_product_types, etc.) | ✅ Valid | Normalization is good |
| Synonym system | ✅ Valid | Query expansion needed |
| system_photos table | ✅ Valid | Photo-based discovery |
| staging_troubleshooting table | ✅ Valid | DIP extraction target |
| staging_system_relationships table | ✅ Valid | Relationship extraction |
| system_relationships table | ✅ Valid | Approved relationships |

### Pipeline Concepts (96e) - KEEP WITH MODIFICATIONS

| Stage | Status | Notes |
|-------|--------|-------|
| LlamaParse for parsing | ✅ Valid | Returns ~400K char markdown |
| Store markdown for reprocessing | ✅ Valid | Supabase Storage |
| Vision analysis for figures | ✅ Valid | Claude Vision tested |
| Figure cropping | ✅ Valid | PIL/Pillow tested |
| DIP extraction | ✅ Valid | Needs model tags |

### Model Detection Approach (96g) - MODIFY

| Item | Old | New |
|------|-----|-----|
| Input size | First 15K chars | FULL markdown (~400K chars) |
| LLM model | gpt-4.1-mini | gpt-4.1-mini (still valid, ~$0.015/doc) |
| Output | models_detected[] | primary_models[] + referenced_products[] |
| Purpose | Detect models | PROPOSE system entries |

---

## What's Superseded from 96 Series

### Wrong Assumptions

1. **96e Stage 4 (Model Detection)** - Said use "first ~15K chars" - WRONG
2. **96f (Model Detection Testing)** - Attempted pdfplumber/OCR approach - WRONG (use LlamaParse)
3. **documents.asset_uid** - Single FK assumes 1:1 - WRONG (need many-to-many)

### pdfplumber is NOT Approved

From context.rtf session: pdfplumber was tested but is NOT the path forward. LlamaParse already handles OCR and returns clean markdown. Don't add pdfplumber complexity.

---

## New Architecture Design

### Database Changes

#### 1. New Junction Table: document_systems

Replaces the 1:1 `documents.asset_uid` relationship.

```sql
CREATE TABLE document_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  asset_uid UUID NOT NULL REFERENCES systems(asset_uid) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT true,  -- Is this doc the PRIMARY manual for this system?
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(doc_id, asset_uid)
);

CREATE INDEX idx_document_systems_doc ON document_systems(doc_id);
CREATE INDEX idx_document_systems_asset ON document_systems(asset_uid);
```

**Examples:**

| doc_id | asset_uid | is_primary | Explanation |
|--------|-----------|------------|-------------|
| yanmar-4jh.pdf | 4jh57-uuid | true | Manual is FOR this engine |
| yanmar-4jh.pdf | vc20-uuid | false | Manual REFERENCES this controller |
| zerojet-install.pdf | zerojet-uuid | true | Installation guide |
| zerojet-user.pdf | zerojet-uuid | true | User manual |
| zerojet-service.pdf | zerojet-uuid | true | Service manual |
| cyclops-marine.pdf | sensor-1-uuid | true | Covers multiple products |
| cyclops-marine.pdf | sensor-2-uuid | true | Covers multiple products |

#### 2. Systems Table Addition

```sql
ALTER TABLE systems ADD COLUMN source TEXT DEFAULT 'document';
-- Values: 'document' | 'manual_entry'
-- 'document' = created via document upload flow
-- 'manual_entry' = created via systems.html (no manual)
```

#### 3. Documents Table - Deprecate asset_uid

```sql
-- After junction table is working:
-- 1. Migrate existing asset_uid relationships to document_systems
-- 2. Drop the column (or keep nullable for backwards compat during transition)
ALTER TABLE documents DROP COLUMN asset_uid;
```

### Pinecone Metadata Changes

**Old metadata:**
```json
{
  "chunk_id": "abc123",
  "doc_id": "xyz",
  "asset_uid": "engine-yanmar",
  "text": "...",
  "section_title": "Specifications"
}
```

**New metadata:**
```json
{
  "chunk_id": "abc123",
  "doc_id": "xyz",
  "text": "...",
  "section_title": "Specifications",
  "primary_models": ["4JH57"],
  "referenced_systems": ["VC20", "KM35"],
  "is_universal": false
}
```

**Why two arrays?**

- `primary_models`: What this chunk is authoritatively ABOUT
- `referenced_systems`: What other systems are MENTIONED

**Query behavior:**
1. Search `primary_models` first → authoritative content
2. Also search `referenced_systems` → supplementary content
3. Weight primary higher than referenced

**Example:**

Yanmar manual chunk: "To connect the VC20 to your 4JH57, wire terminals A and B..."

```json
{
  "primary_models": ["4JH57"],
  "referenced_systems": ["VC20"]
}
```

This chunk surfaces for:
- User asking about 4JH57 wiring (primary match)
- User asking about VC20 connections (referenced match, lower weight)

### Two Entry Paths

| Path | Entry Point | Flow | Result |
|------|-------------|------|--------|
| **Document-first** | onboarding.html | Upload PDF → LLM extracts → user validates → confirm | System(s) created with source='document' |
| **Manual entry** | systems.html | User fills form manually | System created with source='manual_entry' |

Both populate the same systems table. The `source` column distinguishes them.

---

## The Document-First Flow (Detailed)

### Step 1: Upload PDF

**UI:** onboarding.html (new) or modified upload.html

- User drops/selects PDF file
- Optional: Select manufacturer from dropdown (ref_manufacturers)
  - If manufacturer not in list, option to add new
- No model selection required at this point

### Step 2: Parse with LlamaParse

- PDF → LlamaParse → ~400K char markdown
- Store markdown to Supabase Storage: `/markdown/{doc_id}/parsed.md`
- This enables reprocessing without re-parsing

### Step 3: Model Detection (Full Document)

**Endpoint:** `POST /v1/detect-models`

**Input:**
```json
{
  "markdown": "<full 400K char markdown>",
  "doc_id": "uuid",
  "filename": "Yanmar_4JH_Manual.pdf"
}
```

**Prompt to gpt-4.1-mini:**
```
Analyze this technical manual and identify:

1. PRIMARY PRODUCTS: What specific product model(s) is this manual FOR?
   - List exact model numbers (e.g., "4JH57", "Zeus 3S")
   - These are the main subjects of the manual

2. REFERENCED PRODUCTS: What other products are mentioned but not the main subject?
   - Compatible accessories, related systems, integration partners
   - Products mentioned in compatibility sections, wiring diagrams, etc.

3. MANUFACTURER: Who makes the primary products?

4. PRODUCT CATEGORY: What type of products are these? (Engine, Chartplotter, etc.)

Return JSON:
{
  "manufacturer": "Yanmar",
  "product_category": "Marine Diesel Engine",
  "primary_models": ["3JH40", "4JH45", "4JH57", "4JH80", "4JH110"],
  "is_multi_model": true,
  "referenced_products": [
    {"model": "VC10", "type": "Vessel Control System", "manufacturer": "Yanmar"},
    {"model": "VC20", "type": "Vessel Control System", "manufacturer": "Yanmar"},
    {"model": "VC30", "type": "Vessel Control System", "manufacturer": "Yanmar"},
    {"model": "KM35", "type": "Marine Gear", "manufacturer": "Yanmar"}
  ]
}
```

**Cost:** ~$0.015 per document (full Yanmar manual ~100K tokens)

### Step 4: Approval Screen

**UI shows pre-filled form:**

```
DOCUMENT: Yanmar_4JH_Manual.pdf
MANUFACTURER: Yanmar (editable dropdown)
CATEGORY: Marine Diesel Engine (editable)

PRIMARY MODELS DETECTED:
This manual is FOR these models. Which do you have?
[ ] 3JH40
[x] 4JH45
[x] 4JH57  ← pre-checked if matches user input
[ ] 4JH80
[ ] 4JH110

REFERENCED PRODUCTS:
This manual mentions these other products. Which do you have?
[ ] VC10 (Vessel Control System)
[x] VC20 (Vessel Control System)
[ ] VC30 (Vessel Control System)
[ ] KM35 (Marine Gear)

FOR EACH SELECTED SYSTEM, COMPLETE:
┌─────────────────────────────────────────┐
│ 4JH57 - Marine Diesel Engine            │
│ Serial Number: [____________]           │
│ Location: [Port Engine ▼]               │
│ Install Date: [__________]              │
│ Notes: [________________________]       │
└─────────────────────────────────────────┘
```

### Step 5: User Confirms

- User reviews/edits extracted data
- Adds serial numbers, locations (boat-specific data LLM can't know)
- Clicks "Confirm"

### Step 6: Systems Created + Document Linked

**For each selected primary model:**
```sql
INSERT INTO systems (manufacturer_id, model_norm, serial_number, source, ...)
VALUES (..., '4JH57', 'ABC123', 'document', ...);

INSERT INTO document_systems (doc_id, asset_uid, is_primary)
VALUES ('yanmar-doc-id', 'new-4jh57-uuid', true);
```

**For each selected referenced product:**
```sql
INSERT INTO systems (manufacturer_id, model_norm, source, ...)
VALUES (..., 'VC20', 'document', ...);

INSERT INTO document_systems (doc_id, asset_uid, is_primary)
VALUES ('yanmar-doc-id', 'new-vc20-uuid', false);
```

### Step 7: Continue Pipeline

- Chunking (with model tags - see unsolved problem below)
- Embedding to Pinecone
- Vision analysis
- DIP extraction

---

## The Model-Specific Content Problem (SOLVED)

### The Core Issue

**Yanmar specs table in manual:**

| Model | Oil Capacity | HP |
|-------|-------------|-----|
| 4JH45 | 3.8L | 45 |
| 4JH57 | 4.2L | 57 |
| 4JH80 | 5.1L | 80 |

**Current chunking:** This table becomes ONE chunk with all models mixed.

**User asks:** "What's my oil capacity?"

**Bad answer:** Returns chunk with all values, LLM might pick wrong one (5.1L instead of 4.2L).

**Required behavior:** User with 4JH57 should ONLY see 4.2L. Never see 4JH80 data. Period.

### Solution: Three-Layer Approach

The expensive "tag every chunk with LLM" approach is unnecessary. Instead:

| Content Type | Solution | How | Cost |
|--------------|----------|-----|------|
| **Specs/Parameters** | DIP with model tagging | Enhance DIP extraction to capture `applies_to_model` | Already running |
| **Prose/Procedures** | Section-level inheritance | ONE LLM call maps sections → models, chunks inherit | ~$0.01/doc |
| **Query safety** | Hard Pinecone filter | `primary_models CONTAINS 'user_model'` | Free (metadata filter) |

### Layer 1: DIP Extracts Model Specificity

DIP already extracts structured data to `staging_spec_suggestions`. Enhance the extraction prompt:

**Current DIP output:**
```json
{
  "parameter": "Oil Capacity",
  "value": "4.2L",
  "unit": "liters"
}
```

**Enhanced DIP output:**
```json
{
  "parameter": "Oil Capacity",
  "value": "4.2L",
  "unit": "liters",
  "applies_to_models": ["4JH57"],
  "source_table": "Specifications Table 2.1"
}
```

**Database change:**
```sql
ALTER TABLE staging_spec_suggestions ADD COLUMN applies_to_models TEXT[];
```

**Query path:**
- "What's my oil capacity?"
- → Detect spec question
- → SQL: `SELECT value FROM staging_spec_suggestions WHERE '4JH57' = ANY(applies_to_models) AND parameter ILIKE '%oil capacity%'`
- → Return 4.2L with 100% accuracy

### Layer 2: Section-Level Model Tagging (ONE LLM Call)

Instead of per-chunk analysis, ONE call to analyze document structure:

**Input:** Full markdown (or table of contents + section headers)

**Prompt:**
```
Analyze this manual's structure. For each major section, identify which models it applies to.

Return JSON:
{
  "sections": [
    {"title": "Safety Information", "page_range": "1-20", "applies_to": ["all"]},
    {"title": "4-Cylinder Specifications", "page_range": "21-35", "applies_to": ["4JH45", "4JH57"]},
    {"title": "6-Cylinder Specifications", "page_range": "36-50", "applies_to": ["4JH80", "4JH110"]},
    {"title": "Maintenance Procedures", "page_range": "51-100", "applies_to": ["all"]}
  ]
}
```

**Chunking behavior:**
- Chunk on page 25 → inherits `applies_to: ["4JH45", "4JH57"]`
- Chunk on page 75 → inherits `applies_to: ["all"]`

**Cost:** One gpt-4.1-mini call (~$0.01) per document

### Layer 3: Hard Filter on Pinecone Queries

Belt-and-suspenders safety. When querying Pinecone:

```python
# Current query (no model filter)
results = pinecone.query(
    vector=embedding,
    top_k=10,
    include_metadata=True
)

# Enhanced query (hard model filter)
results = pinecone.query(
    vector=embedding,
    top_k=10,
    include_metadata=True,
    filter={
        "$or": [
            {"primary_models": {"$in": ["4JH57"]}},
            {"is_universal": True}
        ]
    }
)
```

Even if section tagging missed something, the query filter catches it.

### Layer 4: Vision Extraction for Diagrams/Tables

**The Gap:** DIP only sees what LlamaParse converted to text. Visual content is lost:

| Content | LlamaParse → Markdown | DIP Sees It? |
|---------|----------------------|--------------|
| Prose | ✅ Converted | ✅ Yes |
| Simple tables | ✅ Usually converts | ✅ Usually |
| Complex tables | ⚠️ Often mangled | ⚠️ Maybe |
| Diagrams with specs | ❌ Image lost | ❌ No |
| Exploded views | ❌ Lost | ❌ No |
| Wiring diagrams | ❌ Lost | ❌ No |

**Solution:** Claude Vision analyzes page screenshots to extract:
- Specs embedded in diagrams
- Part numbers from exploded views
- Values from wiring diagrams
- Table data that didn't parse correctly

**Implementation:**
```python
# For each page with figures (detected during parsing)
response = claude.messages.create(
    model="claude-sonnet-4-20250514",
    messages=[{
        "role": "user",
        "content": [
            {"type": "image", "source": {"type": "base64", "data": page_image_base64}},
            {"type": "text", "text": """
                Extract any specifications, part numbers, or technical values from this page.
                For each value, indicate which model(s) it applies to if specified.
                Return JSON: {"extractions": [{"parameter": "", "value": "", "applies_to_models": [], "source": "diagram/table/text"}]}
            """}
        ]
    }]
)
```

**Cost:** ~$0.017 per page, only run on pages with figures/diagrams (not every page)

**Storage:** Vision extractions go to `staging_vision_extractions` table, then merge with DIP data after approval.

---

### Complete Four-Layer Solution

| Layer | Content Type | Solution | Cost |
|-------|--------------|----------|------|
| 1 | **Text specs** | DIP with model tagging | Already running |
| 2 | **Prose/procedures** | Section-level inheritance | ~$0.01/doc |
| 3 | **Query safety** | Pinecone hard filter | Free |
| 4 | **Visual content** | Vision extraction | ~$0.017/page with figures |

### Why This Works

1. **Text specs are 100% accurate** - DIP extracts to database with model column, SQL lookup is exact
2. **Visual specs are captured** - Vision extracts what LlamaParse missed from diagrams/tables
3. **Prose is good enough** - Section-level tagging covers 90%+ of cases for procedures/descriptions
4. **Filter catches stragglers** - Any wrong-model content that slipped through is filtered at query time
5. **Cost is reasonable** - No per-chunk LLM calls, vision only on pages with figures

---

## The Referenced Systems Naming Problem (CRITICAL)

**Date Added:** 2026-01-20
**Status:** Problem identified, solution designed, NOT IMPLEMENTED

### The Problem

When processing the 4JH57 engine manual:
1. We TAG content with `referenced_systems: ["VC20"]` (Pinecone, DIP, Vision)
2. Later, user uploads the VC20's actual manual
3. Model detection extracts "VC 20" (with space) from that document
4. System created as `model_norm: "VC 20"`

**Result:** All the "VC20" tags don't match the "VC 20" system. Data is orphaned. Queries fail.

### Why This Is Critical

We're building a tagging system across:
- Pinecone chunks: `referenced_systems: ["VC20", "SD60"]`
- DIP extractions: `applies_to_models` fields
- Vision analysis: `referenced_systems` in figures/tables

If these tags don't match actual system names, the entire relationship system breaks. Thousands of tags become useless.

### The Solution: Canonical Name Registry

**Core principle:** First occurrence (reference OR primary) sets the canonical name.

#### Scenario A: Referenced Before Primary Upload

```
1. 4JH manual uploaded
2. Model detection finds references to "VC20", "SD60"
3. Tags created: referenced_systems: ["VC20", "SD60"]
4. "VC20" and "SD60" added to canonical registry

... later ...

5. VC20 manual uploaded
6. Model detection extracts "VC 20" from document
7. System checks canonical registry: "VC 20" ≈ "VC20"? YES
8. System created with model_norm: "VC20" (matches existing tags)
9. All existing tags automatically link ✅
```

#### Scenario B: Primary Upload First (No Prior References)

```
1. Brand new product manual uploaded (e.g., "Whale Gulper 220")
2. No prior references exist in system
3. Model detection extracts "Whale Gulper 220"
4. Normalize: "WHALE_GULPER_220" or similar
5. System created with this canonical name
6. Name added to registry
7. Future references must match to THIS canonical
```

### Implementation Approach

#### 1. Canonical Names Table

```sql
CREATE TABLE ref_canonical_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL UNIQUE,      -- "VC20" (the standard)
  manufacturer_id UUID REFERENCES ref_manufacturers(id),
  first_seen_in TEXT,                       -- doc_id where first encountered
  first_seen_as TEXT,                       -- "referenced" | "primary"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ref_model_synonyms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL REFERENCES ref_canonical_models(canonical_name),
  synonym TEXT NOT NULL,                    -- "VC 20", "VC-20", "Vessel Control 20"
  UNIQUE(synonym)
);
```

#### 2. Normalization Rules

For fuzzy matching "VC 20" to "VC20":
- Remove spaces, hyphens, underscores
- Lowercase comparison
- "vc20" == "vc20" ✅

```javascript
function normalizeForMatch(name) {
  return name.toLowerCase().replace(/[\s\-_]/g, '');
}
// "VC 20" → "vc20"
// "VC-20" → "vc20"
// "VC20"  → "vc20"
```

#### 3. Matching Flow During Model Detection

```
Input: Model detection extracts "VC 20" from new document

1. Normalize: "VC 20" → "vc20"
2. Query: SELECT canonical_name FROM ref_canonical_models
          WHERE normalize(canonical_name) = 'vc20'
          OR EXISTS (SELECT 1 FROM ref_model_synonyms
                     WHERE normalize(synonym) = 'vc20')
3. If found: Use existing canonical_name
4. If not found: Create new canonical entry with normalized name
```

#### 4. Tagging Flow (When Creating References)

When 4JH manual references "VC20":
1. Check if canonical exists for "vc20"
2. If yes: Use canonical_name in tag
3. If no: Create canonical entry, use that name in tag

**All tags use canonical names, never raw extracted names.**

### What This Fixes

| Problem | Before | After |
|---------|--------|-------|
| Tag/System mismatch | "VC20" tags, "VC 20" system | Both use "VC20" |
| Orphaned references | Can't link | All link via canonical |
| Duplicate systems | "VC20" and "VC 20" both created | Single canonical system |
| Query failures | No match | Exact match |

### Integration Points

| Component | Change Needed |
|-----------|---------------|
| Model detection (`/v1/detect-models`) | Check canonical registry before returning names |
| Reference tagging (Pinecone, DIP, Vision) | Always use canonical names |
| System creation (`document-ingest.route.js`) | Lookup/create canonical before creating system |
| Synonym expansion | Query synonyms table for user searches |

### Open Questions

1. **Who sets the canonical format?**
   - First occurrence wins, OR
   - Prefer primary manual naming over reference naming?

2. **Manufacturer scoping?**
   - "VC20" unique globally, or per-manufacturer?
   - Yanmar VC20 vs hypothetical other brand's VC20?

3. **Manual override?**
   - Admin UI to merge/rename canonicals?
   - Handle mistakes in early references?

---

## Experiments Run (from context.rtf and 96 series)

### Experiment 1: LlamaParse Output Analysis

**Files created:**
- `/python-sidecar/llamaparse_output/0AJHC-EN001F-Sep.2025-0_JH-CR_OPM_20250917_markdown.md` (Yanmar)
- `/python-sidecar/llamaparse_output/Zeus3S_OM_EN_005_w_markdown.md` (Zeus 3S)

**Findings:**
- Yanmar: 391,285 chars (~98K tokens), 230 pages
- Zeus 3S: 342,866 chars (~86K tokens), 167 pages
- LlamaParse returns ONE big markdown file
- Model references scattered throughout (not just in first 15K)

### Experiment 2: 15K Char Model Detection - FAILED

**Test:** Use first 15K chars to detect models

**Result:** Missed many model references. User proved:
- VC10/VC20/VC30 mentioned later in document
- Context needed to understand what models mean
- "15K chars will not work" - direct quote from user

### Experiment 3: Regex Model Detection - FAILED

**Test:** Use regex to find model numbers

**Result:** Can't distinguish:
- Primary models vs referenced products
- Model numbers vs part numbers
- VC10 (Vessel Control) vs some other VC10

"Regex will not work" - needs semantic understanding

### Experiment 4: Full Markdown to gpt-4.1-mini - SUCCESS

**Test:** Send entire 391K char Yanmar markdown to gpt-4.1-mini

**Result:**
- Successfully identified: 3JH40, 4JH45, 4JH57, 4JH80, 4JH110 as primary
- Successfully identified: VC10, VC20, VC30, KM35 as referenced
- Cost: ~$0.015 per document
- Acceptable for production use

### Experiment 5: Vision Analysis - SUCCESS (from 96 series)

**Test:** Claude Vision analyzing page screenshots

**Result:**
- Successfully identified figures, diagrams, tables
- Could determine model applicability from visual context
- Cost: ~$0.017 per page
- Validated in `test_vision_page_analysis.py`

---

## Current Code State

### Baseline

Code is at `v4-pre-migration` tag - stable, working LlamaParse integration.

**Do NOT use:**
- pdfplumber (not approved)
- Any code from failed 96f refactor attempts

### Key Files

| File | Status | Notes |
|------|--------|-------|
| `src/services/document.service.js` | Working | Main orchestrator, needs v5 stages added |
| `python-sidecar/app/routes/parse.py` | Working | LlamaParse wrapper |
| `python-sidecar/app/main.py` | Working | Has `/v1/detect-models` endpoint (needs update for full markdown) |
| `src/public/upload.html` | Working | Has model selection UI built |

### Test Reset

```bash
# Nuke all test data between runs
node scripts/reset-test-upload.cjs --all
```

Clears: jobs, documents, document_chunks, staging_* tables, Pinecone vectors, storage

### Python Environment

```bash
# Python venv is at .venv (not venv)
cd python-sidecar
source .venv/bin/activate
python -m app.main
```

---

## Open Questions

1. ~~**DIP prompt enhancement** - How to modify DIP extraction prompt to capture `applies_to_models`?~~
   - ✅ SOLVED - See "DIP Extraction Testing" section. Add `applies_to_models` field + inclusion/exclusion rules.

2. **Section detection accuracy** - How well does one LLM call capture document structure?
   - Test with Yanmar manual (has clear sections per model group)
   - Test with Zeus 3S (more integrated structure)
   - Note: May not be needed if DIP extraction handles model tagging sufficiently

3. ~~**Universal content handling** - Content that truly applies to all models~~
   - ✅ SOLVED - Use `applies_to_models: ["all"]` for universal content

4. **Query routing** - When to use SQL vs Pinecone?
   - Spec questions → SQL first (staging tables with `applies_to_models` filter)
   - Procedure questions → Pinecone with filter
   - Classification already exists, just need routing logic

5. **UI for approval screen**
   - New page (onboarding.html) or modify upload.html?
   - Mobile-friendly?

6. **Vision extraction integration** - How to merge vision-extracted specs with DIP-extracted specs?
   - Same `staging_spec_suggestions` table?
   - Different source_type field?

---

## Proposed Next Steps

### Phase 0: Canonical Naming (MUST DO FIRST) ⚠️

**Without this, all tagging work is worthless.**

1. **Create `ref_canonical_models` table** - Stores canonical names
2. **Create `ref_model_synonyms` table** - Maps variations to canonical
3. **Build normalization function** - `normalizeForMatch()` in JS and Python
4. **Update model detection** - Check canonical registry, return canonical names
5. **Update reference tagging** - All tags use canonical names only
6. **Test with "VC20" vs "VC 20"** - Verify matching works

### Phase 1: Foundation ✅ MOSTLY DONE

1. ~~**Create document_systems junction table**~~ ✅ Migration 039
2. ~~**Add systems.source column**~~ ✅ Migration 039
3. ~~**Update model detection endpoint**~~ ✅ `/v1/detect-models` exists
4. ~~**Build approval screen UI**~~ ✅ `/ingest` page working

**Remaining:** Fix referenced systems creation (don't create system records for non-primary)

### Phase 2: Document-First Flow ✅ PARTIALLY DONE

5. ~~**Implement document-first upload flow**~~ ✅ Working
6. ~~**Test with Yanmar manual**~~ ✅ Created 4JH57 system
7. **Fix referenced products handling** - Don't create systems, just store references

### Phase 3: DIP Production Integration ✅ VALIDATED

8. ~~Prototype structured spec extraction~~ → ✅ Tested, works with model tagging
9. **Update production DIP prompts** - Add `applies_to_models` + exclusion logic
10. ~~**Add `applies_to_models` column**~~ ✅ Migration 039
11. ~~**Create `staging_troubleshooting` table**~~ ✅ Migration 039
12. **Update DIP extraction script** (`dip_extraction_cached.py`) with new prompts

### Phase 4: Vision Extraction

13. **Implement Vision extraction** for diagrams/complex tables
14. **Merge vision extractions** with DIP extractions

### Phase 5: Query Integration

15. **Update Pinecone metadata** schema with `primary_models`, `referenced_systems`
16. **Implement query routing** (spec questions → SQL with model filter, others → vector)
17. **Add hard filter** on Pinecone queries by user's models
18. **Test end-to-end** - verify correct model content returned

---

## DIP Extraction Testing with Model Tagging (2026-01-16)

### Test Setup

**Test Document:** Yanmar 4JH CR Manual (391,285 chars via LlamaParse)
**User's Systems:** 4JH57 (engine), VC20 (vessel control), SD60 (saildrive)
**Model:** claude-sonnet-4-20250514

### Key Innovation: Inclusion/Exclusion Logic

The breakthrough was adding explicit inclusion/exclusion rules to DIP prompts:

```
INCLUDE content that is:
1. SPECIFIC to user's systems (4JH57, VC20, SD60)
2. GENERAL content that applies to ALL models

EXCLUDE content SPECIFIC to systems user does NOT have:
- VC10, VC30 (user has VC20)
- KM35, KM4, KMH4A marine gears (user has SD60 saildrive)
- 3JH40, 4JH45, 4JH80, 4JH110 (user has 4JH57)
- B25/C35 instrument panel (user has VC20)
```

This dramatically improved relevance - no more VC10/VC30 procedures when user has VC20.

### Test Results: All 5 DIP Types Validated

| DIP Type | Extractions | Model Tagging | Exclusion Logic | Quality |
|----------|-------------|---------------|-----------------|---------|
| Specifications | 50 | ✅ Accurate | ✅ Working | Excellent |
| Intent Router | 46 | ✅ Accurate | ✅ Working | Excellent |
| Golden Rules | 41 | ✅ Accurate | ✅ Working | Excellent |
| Procedures | 29 | ✅ Accurate | ✅ Working | Excellent |
| **Troubleshooting** | 18 (58 cause chains) | ✅ Accurate | ✅ Working | **NEW - Excellent** |

### Detailed Results by DIP Type

#### 1. Specifications
- 50 specs extracted with `applies_to_models` field
- Model-specific values correctly split (e.g., 4JH57 oil capacity vs 4JH80)
- Power ratings correctly tagged as model-specific
- SD60 saildrive specs captured separately

**Example output:**
```json
{
  "parameter": "Continuous power",
  "value": "38.1 kW (51.8 hp metric) / 2907 min-1",
  "applies_to_models": ["4JH57"],
  "confidence": 0.95
}
```

#### 2. Intent Router
- 46 Q&A pairs extracted
- Model-specific answers correctly tagged
- VC20 E-key questions correctly excluded VC10

**Example output:**
```json
{
  "question": "How much engine oil does the 4JH57 hold?",
  "answer": "Total: 5.0 L at rake angle 7°, or 5.5 L at rake angle 0°",
  "applies_to_models": ["4JH57"]
}
```

#### 3. Golden Rules
- 41 validation rules extracted
- Thresholds correctly attributed to models
- SD60 seal warning rule captured

**Example output:**
```json
{
  "query": "Engine oil capacity at 7° rake angle for 4JH45/4JH57",
  "expected_value": "Total: 5.0 L (5.28 qt)",
  "applies_to_models": ["4JH45", "4JH57"]
}
```

#### 4. Procedures (v2 with exclusions)
- 29 procedures (down from 31 in v1)
- VC10/VC30/B25/C35 procedures correctly excluded
- VC20 now properly tagged (8 procedures)
- SD60 now properly tagged (2 procedures)

**V1 vs V2 comparison:**
| Metric | V1 (no exclusions) | V2 (with exclusions) |
|--------|---------------------|----------------------|
| Total | 31 | 29 |
| VC20 tagged | 0 | 8 |
| SD60 tagged | 0 | 2 |
| Leakage | VC10, VC30, B25/C35 included | ✅ None |

#### 5. Troubleshooting (NEW DIP Type)
- 18 symptom entries
- 58 total symptom→cause→fix chains
- Multiple causes per symptom (diagnostic tree)
- Symptom variations for NLP matching

**Different from Golden Rules:**
| Aspect | Golden Rules | Troubleshooting |
|--------|--------------|-----------------|
| Format | 1 check → 1 expected | 1 symptom → N causes → N fixes |
| Purpose | Verify correct operation | Diagnose problems |
| Example | "Oil pressure should be 0.28-0.54 MPa" | "Engine won't start" → 6 possible causes |

**Example output:**
```json
{
  "symptom": "Engine does not start or starts with difficulty",
  "symptom_variations": ["won't start", "no start", "starter not working"],
  "possible_causes": [
    {"cause": "Incomplete priming of fuel system", "likelihood": "common", "fix": "Carry out sufficient priming"},
    {"cause": "Fuel level in fuel tank is low", "likelihood": "common", "fix": "Add fuel"},
    {"cause": "Clogged fuel inlet filter", "likelihood": "common", "fix": "Replace filter"},
    ...
  ],
  "applies_to_models": ["4JH57", "VC20", "SD60"]
}
```

### Test Scripts Created

| Script | Purpose |
|--------|---------|
| `scripts/test-dip-model-tagging.py` | Specs with model tagging |
| `scripts/test-dip-intent-router-models.py` | Intent router with model tagging |
| `scripts/test-dip-golden-rules-models.py` | Golden rules with model tagging |
| `scripts/test-dip-procedures-models.py` | Procedures v1 (no exclusions) |
| `scripts/test-dip-procedures-models-v2.py` | Procedures v2 (with exclusions) |
| `scripts/test-dip-troubleshooting-models.py` | Troubleshooting (new DIP type) |

Results saved to: `scripts/test-data/dip-*-results.json`

### Schema Changes Required

#### staging_spec_suggestions
```sql
ALTER TABLE staging_spec_suggestions ADD COLUMN applies_to_models TEXT[];
```

#### staging_intent_router
```sql
ALTER TABLE staging_intent_router ADD COLUMN applies_to_models TEXT[];
```

#### staging_golden_tests
```sql
ALTER TABLE staging_golden_tests ADD COLUMN applies_to_models TEXT[];
```

#### staging_playbook_hints (procedures)
```sql
ALTER TABLE staging_playbook_hints ADD COLUMN applies_to_models TEXT[];
```

#### NEW: staging_troubleshooting
```sql
CREATE TABLE staging_troubleshooting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id TEXT NOT NULL,
  symptom TEXT NOT NULL,
  symptom_variations TEXT[],
  possible_causes JSONB NOT NULL,  -- Array of {cause, likelihood, fix, fix_steps}
  applies_to_models TEXT[],
  source_type TEXT,  -- 'troubleshooting_table', 'warning_section', 'procedure_note', 'error_code'
  page TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_troubleshooting_symptom ON staging_troubleshooting
  USING gin(to_tsvector('english', symptom));
CREATE INDEX idx_troubleshooting_models ON staging_troubleshooting
  USING gin(applies_to_models);
```

### Key Insights

1. **Model tagging works across all DIP types** - Same `applies_to_models` pattern works for specs, Q&A, rules, procedures, and troubleshooting

2. **Exclusion logic is critical** - Without it, users get VC10/VC30 content when they have VC20. With it, 100% relevance.

3. **Troubleshooting is different from Golden Rules** - Worth keeping as separate DIP type for diagnostic use cases

4. **DIP sees text, not images** - Still need Vision extraction for diagrams/complex tables (see Layer 4 above)

5. **Cost is acceptable** - ~$0.10-0.15 per document for all 5 DIP extractions with claude-sonnet

---

## Summary

The 96 series identified real problems (multi-model manuals, visual content, system relationships) and proposed valid solutions for many of them. However, the fundamental flow assumption was wrong.

**Key insight:** Documents are the source of truth. Let them create systems, not the other way around.

**Model-specific content problem: SOLVED** - DIP extraction with `applies_to_models` tagging + inclusion/exclusion logic provides accurate, relevant extractions. Validated across all 5 DIP types.

**Remaining work:**
1. Update production DIP prompts with model tagging + exclusion logic
2. Add `applies_to_models` column to all staging tables
3. Create `staging_troubleshooting` table
4. Implement Vision extraction for diagrams (Layer 4)
5. Update query routing to filter by user's models

---

## DIP Process: Current vs New

### Current DIP Process (Being Replaced)

```
┌─────────────────────────────────────────────────────────────────┐
│ CURRENT FLOW (WRONG ORDER)                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User uploads PDF                                            │
│           ↓                                                     │
│  2. LlamaParse → markdown                                       │
│           ↓                                                     │
│  3. Chunking                                                    │
│           ↓                                                     │
│  4. DIP Extraction (extracts ALL models, no filtering)          │
│           ↓                                                     │
│  5. → staging_* tables (status='pending')                       │
│           ↓                                                     │
│  6. Admin/Agent reviews each item                               │
│           ↓                                                     │
│  7. Approved items → production tables                          │
│           ↓                                                     │
│  8. Chat queries production tables                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

PROBLEMS:
- DIP extracts content for ALL models (4JH45, 4JH57, 4JH80, etc.)
- User gets VC10/VC30 procedures when they have VC20
- Requires manual review to filter irrelevant content
- Staging tables add complexity and delay
```

### New DIP Process (Document-First with Model Filtering)

```
┌─────────────────────────────────────────────────────────────────┐
│ NEW FLOW (CORRECT ORDER)                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User uploads PDF                                            │
│           ↓                                                     │
│  2. LlamaParse → markdown (~400K chars)                         │
│           ↓                                                     │
│  3. Model Detection (gpt-4.1-mini, full markdown)               │
│           ↓                                                     │
│  4. → Approval Screen (onboarding.html)                         │
│     "Which of these models do you have?"                        │
│     [x] 4JH57  [ ] 4JH45  [ ] 4JH80  [ ] 4JH110                 │
│     User adds: serial number, location, install date            │
│           ↓                                                     │
│  5. User clicks CONFIRM                                         │
│           ↓                                                     │
│  6. Systems created in systems table                            │
│           ↓                                                     │
│  7. DIP Extraction WITH inclusion/exclusion logic               │
│     - INCLUDE: 4JH57, VC20, SD60 (user's systems)              │
│     - EXCLUDE: 4JH45, 4JH80, VC10, VC30, KM35 (not user's)     │
│           ↓                                                     │
│  8. → PRODUCTION tables directly (no staging)                   │
│     - spec_suggestions                                          │
│     - playbook_hints                                            │
│     - golden_tests                                              │
│     - intent_router                                             │
│     - troubleshooting                                           │
│           ↓                                                     │
│  9. Chunking with model tags → Pinecone                         │
│           ↓                                                     │
│  10. Chat queries production tables + Pinecone                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

WHY THIS WORKS:
- Model approval IS the quality gate (replaces staging review)
- DIP only extracts content for user's specific systems
- Inclusion/exclusion logic validated across all 5 DIP types
- No wasted extraction of irrelevant content
- No manual review needed - content is pre-filtered
```

### Key Changes Summary

| Aspect | Current | New |
|--------|---------|-----|
| DIP runs | Before model selection | AFTER user approves models |
| DIP input | All models in document | Only user's selected models |
| DIP output | staging_* tables | Production tables directly |
| Quality gate | Admin/Agent review | User model selection |
| Staging tables | Required | NOT USED for DIP |
| Review workflow | Per-item approval | None needed |

### What Happens to Staging Tables?

**Keep but don't use for DIP:**
- `staging_*` tables remain in database (no migration to drop)
- New DIP flow writes directly to production tables
- Old staging data can be cleaned up later
- Staging could be used for other future workflows

### Code Changes Required

| File | Change |
|------|--------|
| `dip_extraction_cached.py` | Accept `user_systems` parameter, add inclusion/exclusion to prompts |
| `dip.ingest.service.js` | Write to production tables instead of staging |
| `document.service.js` | Call DIP AFTER model approval, pass user's systems |
| `job-status.route.js` | Trigger DIP after user confirms models |
| Admin approval routes | No longer needed for DIP (keep for other uses) |

### DIP Extraction Prompt Template (All 5 Types)

```
USER'S ACTUAL SYSTEMS (extract content for these):
- {model_1} ({type_1})
- {model_2} ({type_2})
- {model_3} ({type_3})

INCLUDE content that is:
1. SPECIFIC to user's systems listed above
2. GENERAL content that applies to ALL models

EXCLUDE content SPECIFIC to systems user does NOT have:
- {excluded_model_1} (user has {user_model_1} instead)
- {excluded_model_2} (user has {user_model_2} instead)
- ...

[Rest of extraction prompt for specific DIP type]
```

### Production Tables (DIP writes directly here)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `spec_suggestions` | Technical specifications | parameter, value, units, applies_to_models |
| `playbook_hints` | Procedures | title, steps[], category, applies_to_models |
| `golden_tests` | Validation rules | query, expected, applies_to_models |
| `intent_router` | Q&A routing | question, answer, applies_to_models |
| `troubleshooting` | Diagnostic chains | symptom, possible_causes[], applies_to_models |

---

## Pinecone Changes: Current vs New

### Current Pinecone Metadata (Problem)

```json
{
  "chunk_id": "abc123",
  "doc_id": "xyz",
  "document_id": "xyz",
  "filename": "Yanmar_4JH_Manual.pdf",
  "manufacturer": "Yanmar",
  "model": "4JH57",
  "linked_asset_uid": "uuid-here",
  "text": "...",
  "section_title": "Specifications",
  "section_hierarchy": ["Chapter 2", "Specifications"],
  "chunk_index": 42,
  "page": 25,
  "token_count": 450,
  "has_tables": true,
  "chunk_strategy_version": "semantic_v2"
}
```

**Problems:**
1. `model` is single string - doesn't handle multi-model manuals
2. No way to tag chunks as "universal" (safety content applies to all)
3. No distinction between "this chunk is FOR model X" vs "mentions model Y"
4. **Query filtering is NOT enforced** - only used for score boosting
5. User with 4JH57 can still see 4JH80-specific content in results

### Current Query Behavior (Problem)

```javascript
// pinecone.service.js - current behavior
// NO hard filter applied - just score boost!
if (metadata.model?.toLowerCase().includes(contextModel)) {
  relevanceScore += 0.2;  // Only a boost, not a filter
}
```

Results: User asks "oil capacity" → gets chunks for ALL models → LLM might pick wrong value.

### New Pinecone Metadata (Solution)

```json
{
  "chunk_id": "abc123",
  "doc_id": "xyz",
  "document_id": "xyz",
  "filename": "Yanmar_4JH_Manual.pdf",
  "manufacturer": "Yanmar",
  "text": "...",
  "section_title": "Specifications",
  "section_hierarchy": ["Chapter 2", "Specifications"],
  "chunk_index": 42,
  "page": 25,
  "token_count": 450,
  "has_tables": true,
  "chunk_strategy_version": "semantic_v2",

  "primary_models": ["4JH57"],
  "referenced_systems": ["VC20", "SD60"],
  "is_universal": false
}
```

**New fields:**

| Field | Type | Purpose | Example |
|-------|------|---------|---------|
| `primary_models` | string[] | What this chunk is authoritatively ABOUT | `["4JH57"]` |
| `referenced_systems` | string[] | Other systems mentioned in chunk | `["VC20", "KM35"]` |
| `is_universal` | boolean | Safety/general content for ALL models | `true` for safety warnings |

**Drop:** `model` (single string) - replaced by `primary_models` array

### New Query Behavior (Solution)

```javascript
// NEW: Hard filter on Pinecone queries
const userModels = ["4JH57", "VC20", "SD60"];  // From user's systems table

const filter = {
  "$or": [
    { "primary_models": { "$in": userModels } },
    { "is_universal": { "$eq": true } }
  ]
};

const results = await pinecone.query({
  vector: queryEmbedding,
  topK: 20,
  filter: filter,  // HARD FILTER - wrong models never returned
  includeMetadata: true
});
```

**Result:** User with 4JH57 ONLY sees:
- Chunks where `primary_models` includes "4JH57"
- Chunks where `is_universal` is true (safety content)
- NEVER sees 4JH80-specific content

### How Chunks Get Tagged

**Option A: Section-level inheritance (one LLM call)**
```
1. Parse document structure
2. ONE gpt-4.1-mini call to map sections → models:
   - "Chapter 2: 4-Cylinder Specs" → ["4JH45", "4JH57"]
   - "Chapter 3: 6-Cylinder Specs" → ["4JH80", "4JH110"]
   - "Chapter 1: Safety" → is_universal: true
3. Chunks inherit from their section
```

**Option B: Per-chunk tagging (more accurate, more expensive)**
```
1. For each chunk, quick LLM call:
   - "What models does this chunk apply to?"
   - Return: primary_models[], is_universal
2. ~$0.001 per chunk, ~500 chunks = ~$0.50/doc
```

**Option C: Hybrid (recommended)**
```
1. Section-level mapping for most content
2. Per-chunk override for spec tables (where model mixing is common)
3. DIP extraction handles structured data (already has applies_to_models)
4. Prose chunks use section inheritance
```

### Migration Path

**Phase 1: Add new fields (backwards compatible)**
- Add `primary_models`, `referenced_systems`, `is_universal` to metadata
- Keep `model` field temporarily for existing queries
- New chunks get both old and new fields

**Phase 2: Update query logic**
- Add hard filter using new fields
- Fall back to old `model` field if new fields missing
- Score boost becomes secondary (filter is primary)

**Phase 3: Backfill existing vectors**
- Re-process existing documents with new chunking
- Or use Pinecone update API to add metadata to existing vectors

**Phase 4: Remove old field**
- Drop `model` single-string field
- All queries use new array fields

### Code Changes Required

| File | Change |
|------|--------|
| `python-sidecar/app/chunking/models.py` | Add `primary_models`, `referenced_systems`, `is_universal` to ChunkMetadata |
| `python-sidecar/app/main.py` | Pass user's models to chunking, apply section-level tagging |
| `src/services/pinecone.service.js` | Add hard filter using new metadata fields |
| `src/services/pinecone-retrieval.service.js` | Pass user's systems to query filter |
| `src/services/pinecone-rag.service.js` | Update filter logic for new fields |

### Query Flow (New)

```
User: "What's my oil capacity?"
         ↓
Chat service gets user's systems: [4JH57, VC20, SD60]
         ↓
Build Pinecone filter:
  { "$or": [
      { "primary_models": { "$in": ["4JH57", "VC20", "SD60"] } },
      { "is_universal": true }
  ]}
         ↓
Pinecone query with HARD FILTER
         ↓
Only chunks for user's models returned
         ↓
LLM sees ONLY 4JH57 oil capacity (4.2L)
         ↓
Correct answer every time
```

---

## Post-Compact Recovery Guide (Updated 2026-01-20)

**Read this FIRST after /compact to continue.**

---

### ⚠️ CRITICAL BLOCKER (2026-01-20)

**DO NOT proceed with tagging (Pinecone, DIP, Vision) until canonical naming is solved.**

**The Problem:** If we tag content with `referenced_systems: ["VC20"]` but the system is later created as `model_norm: "VC 20"`, all tags become orphaned. Queries fail. Data is useless.

**The Solution:** Canonical name registry where first occurrence (reference OR primary) sets the standard name. See "The Referenced Systems Naming Problem (CRITICAL)" section.

**Must implement:**
1. `ref_canonical_models` table
2. `ref_model_synonyms` table
3. Normalization/fuzzy matching logic
4. Update model detection to use canonical names

---

### COMPLETED (2026-01-17)

#### ✅ Migration 039 EXECUTED
File: `scripts/migrations/039_document_first_architecture.sql`

**What was created:**
1. `document_systems` junction table (many-to-many doc↔system)
2. `applies_to_models TEXT[]` column on ALL DIP tables:
   - spec_suggestions, playbook_hints, golden_tests, intent_router, troubleshooting
   - All staging_* tables too
3. `systems.source` column ('document' | 'manual_entry' | 'imported' | 'api')
4. `systems.detected_from_doc_id` column
5. `troubleshooting.possible_causes JSONB` column
6. `filter_by_user_models()` helper function
7. `search_troubleshooting_causes()` helper function
8. GIN indexes on all applies_to_models columns

#### ✅ DIP Testing Validated
All 5 DIP types work with model tagging + inclusion/exclusion:
- Test scripts: `scripts/test-dip-*-models*.py`
- Results: `scripts/test-data/dip-*-results.json`

#### ✅ Pinecone Migration Inventory
Doc 98 lists all 14 files that need `linked_asset_uid` → `primary_models[]` changes.
**DO THIS LAST** - after pipeline works.

---

### NEXT STEPS (In Order)

#### Step 0: Canonical Naming (MUST DO FIRST) ⚠️

**Purpose:** Ensure all model references use consistent names that will match systems

**Tasks:**
1. Create `ref_canonical_models` table
2. Create `ref_model_synonyms` table
3. Build `normalizeForMatch()` function (JS + Python)
4. Update `/v1/detect-models` to check canonical registry
5. Test with "VC20" vs "VC 20" variations

**Without this, ALL tagging work is useless.**

#### ~~Step 1: Build onboarding.html (Approval Screen)~~ ✅ DONE

Now at `/ingest` page (`src/public/document-ingest.html`)

#### ~~Step 2: Add /v1/detect-models endpoint~~ ✅ DONE

Exists in `python-sidecar/app/main.py`

#### ~~Step 3: Document-first flow~~ ✅ PARTIALLY DONE

**Working:** Upload → Parse → Detect → Approve → Create systems
**Needs fix:** Don't create system records for referenced products

#### Step 4: Fix referenced systems handling

**Problem:** Currently creates SYSTEM RECORDS for VC20/SD60 from 4JH manual
**Fix:** Only store reference, don't create system until its primary manual uploaded

#### Step 5: Update DIP prompts
**File:** `python-sidecar/scripts/dip_extraction_cached.py`

Add to ALL 5 prompts:
```
USER'S SYSTEMS: {user_models}
INCLUDE: Content for user's systems + general content
EXCLUDE: Content specific to systems user does NOT have
```

#### Step 6: DIP writes to PRODUCTION (not staging)
**File:** `src/services/dip.ingest.service.js`

Change target tables from `staging_*` to production tables.
Model approval IS the quality gate - no staging review needed.

#### Step 7 (LAST): Pinecone metadata migration
**File:** See doc 98 for full inventory
- Change `linked_asset_uid` → `primary_models[]`
- Add `referenced_systems[]`, `is_universal`
- Update query filters

---

### KEY ARCHITECTURE DECISIONS

1. **Document creates systems** - not the other way around
2. **DIP runs AFTER model approval** - has user's systems for filtering
3. **No staging tables for DIP** - goes direct to production
4. **Model approval = quality gate** - replaces staging review
5. **Pinecone filter by model names** - not UUIDs
6. **Canonical names first** - All tags use canonical names, first occurrence sets standard

---

### FILES REFERENCE

| File | Status | Purpose |
|------|--------|---------|
| `scripts/migrations/039_document_first_architecture.sql` | ✅ DONE | Database changes |
| `scripts/migrations/040_cleanup_unused_columns.sql` | ✅ DONE | Schema cleanup |
| `scripts/migrations/041_canonical_models.sql` | ⚠️ TODO | Canonical naming tables (BLOCKER) |
| `code updates/97*.md` | ✅ Current | Main design doc |
| `code updates/98*.md` | ✅ Done | Pinecone migration inventory |
| `code updates/99*.md` | ✅ Done | Document-first implementation |
| `code updates/100*.md` | ✅ Done | Vision analysis schema update |
| `scripts/test-dip-*-models*.py` | ✅ Done | DIP test scripts |
| `python-sidecar/scripts/test_vision_page_analysis.py` | ✅ Done | Vision analysis test |
| `python-sidecar/scripts/test_pdf_vision_analysis.py` | ✅ Done | PDF vision analysis |
| `python-sidecar/scripts/test_figure_cropping.py` | ✅ Done | Figure cropping test |
| `src/public/document-ingest.html` | ✅ DONE | Approval screen (/ingest) |
| `src/routes/admin/document-ingest.route.js` | ⚠️ NEEDS FIX | Don't create systems for referenced products |
| `python-sidecar/app/main.py` | ⚠️ NEEDS UPDATE | Check canonical registry in detect-models |
| `src/services/document.service.js` | ⏳ TODO | Add vision stages |
| `python-sidecar/scripts/dip_extraction_cached.py` | ⏳ TODO | Add model filtering |
| `python-sidecar/app/routes/vision_analysis.py` | ⏳ TODO | Vision endpoint |
| `python-sidecar/app/routes/figure_cropping.py` | ⏳ TODO | Cropping endpoint |

---

### TELL POST-COMPACT SESSION

```
⚠️ CRITICAL: Read "The Referenced Systems Naming Problem (CRITICAL)" section FIRST.

DO NOT proceed with any tagging work until canonical naming is solved.

Read docs 97, 99, 100 in order:
- /code updates/97 Document-First Architecture and Model-Specific Content Problem.md
- /code updates/99 Document-First Implementation and Schema Cleanup.md
- /code updates/100 Vision Analysis Schema Update and Pipeline Status.md

Status:
- Migration 039 is DONE (database ready)
- Migration 040 is DONE (schema cleanup)
- /ingest page with model detection is DONE
- Vision analysis test scripts exist (see doc 100)
- Vision schema updated with referenced_systems field

⚠️ BLOCKER - Must solve FIRST:
- Canonical naming problem (see doc 97 "Referenced Systems Naming Problem")
- If we tag "VC20" but system is created as "VC 20", all tags are orphaned

Remaining (after canonical naming solved):
- Fix referenced systems handling (don't create system records for non-primary)
- Vision analysis integration (stages 6-7)
- Modified chunking/embedding with model tags (stages 8-9)
- DIP with model filtering (stage 12)
- LAST: Pinecone metadata migration (doc 98)
```

---

*This document supersedes portions of 96d, 96e, 96f, 96g related to flow direction and model detection. Schema work from 96b remains valid.*

---

### VISION ANALYSIS (Stage 6-7) - Test Scripts

**DO NOT SKIP THIS SECTION** - Vision analysis test scripts exist and have been validated.

#### Test Scripts Location

| Script | Purpose |
|--------|---------|
| `python-sidecar/scripts/test_vision_page_analysis.py` | Single page analysis with Claude Vision |
| `python-sidecar/scripts/test_pdf_vision_analysis.py` | Multi-page PDF analysis |
| `python-sidecar/scripts/test_figure_cropping.py` | Crop figures using bboxes |

#### Test Results

```
python-sidecar/visual_extraction_work/vision_test_results/
├── yanmar_sail_drive/        # Saildrive manual analysis
├── victron_smart_solar_mppt/ # MPPT manual analysis
└── cropped/                  # Figure cropping results
```

#### Schema Updated (2026-01-19)

Vision analysis now extracts BOTH:
- `applies_to_models` - Which PRIMARY models this content applies to
- `referenced_systems` - OTHER equipment shown (e.g., saildrive in engine manual)

See **doc 100** for full details on this update.

#### Usage

```bash
cd python-sidecar
source venv/bin/activate

# Test single page
python scripts/test_vision_page_analysis.py --image /path/to/page.jpg

# Test PDF (with model context)
python scripts/test_pdf_vision_analysis.py \
  --pdf /path/to/manual.pdf \
  --pages 1-10 \
  --models "4JH45,4JH57,4JH80,4JH110"
```

#### Integration Status

Vision analysis is **TESTED but NOT INTEGRATED** into the pipeline. Needs:
1. Create `POST /v1/vision/analyze-pages` endpoint
2. Create `POST /v1/vision/crop-figures` endpoint
3. Wire into `document.service.js` stages 6-7
