# 96d Single System Validation Approach

**Date:** 2026-01-14
**Parent Document:** 96 Document Foundation Crisis
**Status:** ACTIVE - Working through validation

---

## Approach

Instead of migrating all 119 systems and re-ingesting all 81 documents at once, we validate the entire v5 pipeline with **one system** (Yanmar 4JH57). This catches schema issues, UI bugs, and pipeline problems before they multiply across the full dataset.

**Test System:** Yanmar 4JH57 (twin diesel engines)
- 1 system row
- 2 instances (Port E25782, Stbd E25787)
- Multi-model manual (covers 4JH45, 4JH57, 4JH80, 4JH110)

**Why this system:**
- Representative of multi-model manual problem (the core issue)
- Has multiple instances (tests instance tracking)
- Well-documented equipment with clear specs
- Rich troubleshooting content in manual
- Relationships to other systems (saildrive, controls, alternator)

---

## Current State (2026-01-14 - Updated)

| Component | Status | Notes |
|-----------|--------|-------|
| systems table | 1 row | Yanmar 4JH57, **v5 FKs + _norm columns populated** |
| instances table | 2 rows | Port (E25782), Stbd (E25787) |
| ref_manufacturers | 51 rows | Seeded, includes "Yanmar" |
| ref_product_types | 45 rows | Seeded, includes "Engine" |
| ref_system_categories | 9 rows | Seeded, includes "Propulsion" |
| ref_subsystem_categories | 54 rows | Seeded |
| centroids | 15 rows | Seeded, includes "Engine Starting" |
| documents | 0 rows | Purged, ready for re-ingest |
| Pinecone | 0 vectors | Purged |
| Backup | Safe | systems_old (119), instances_old (161) |
| **upload.html** | **Updated** | v5 UI with inline status + interaction area |

### Test System Current Values
```
manufacturer_norm: "Yanmar"     (+ manufacturer_id FK)
system_norm: "Propulsion"       (+ system_category_id FK)
subsystem_norm: "Engines"       (+ subsystem_category_id FK)
model_norm: "4JH57"
```

---

## Validation Steps

### Step 1: Link Test System to Reference Tables ✅ DONE

**Goal:** Populate the new FK columns on the Yanmar 4JH57 system row.

**What was done:**
- `manufacturer_id` → ref_manufacturers "Yanmar" ✅
- `product_type_id` → ref_product_types "Engine" ✅
- `system_category_id` → ref_system_categories "Propulsion" ✅
- `subsystem_category_id` → ref_subsystem_categories "Engines" ✅
- Synced `_norm` columns from FKs for backward compatibility ✅

**Current test system:**
```
manufacturer_norm: "Yanmar"
system_norm: "Propulsion"
subsystem_norm: "Engines"
model_norm: "4JH57"
```

**Completed:** 2026-01-14

---

### Step 2: Admin UI - Reference Table Dropdowns ✅ DONE

**Goal:** Update System Management UI to use dropdowns populated from reference tables instead of free-text fields.

**What was done:**
- `src/public/systems.html` already has v5 dropdowns implemented
- Manufacturer dropdown → `/api/system-management/ref/manufacturers`
- Product Type dropdown → `/api/system-management/ref/product-types`
- System Category dropdown → `/api/system-management/ref/categories`
- Subsystem dropdown → `/api/system-management/ref/subcategories` (filtered)

**Save logic syncs both FK and _norm:**
```javascript
manufacturer_id: manufacturerId || null,
manufacturer_norm: manufacturerNorm,  // looked up from refManufacturers
```

**API endpoints working:**
- `GET /api/system-management/ref/manufacturers` ✅
- `GET /api/system-management/ref/product-types` ✅
- `GET /api/system-management/ref/categories` ✅
- `GET /api/system-management/ref/subcategories` ✅

**Completed:** Previously (before 2026-01-14)

---

### Step 2.5: Upload Page v5 UI ✅ DONE

**Goal:** Update upload.html with inline progress tracking and interaction area for v5 pipeline.

**What was done:**
- Replaced popup progress tracker with inline status section
- Added interaction area for prompts/questions/completion metrics
- Updated STAGES array: 10 → 14 stages
- New stages (placeholders until backend built):
  - `model_detection`, `model_selection`, `vision_analysis`, `figure_cropping`

**Files modified:**
- `src/public/upload.html` (~400 lines changed)

**Completed:** 2026-01-14

---

### Step 3: Build v5 Pipeline Stages ← CURRENT

**Goal:** Build the backend stages to support the new v5 pipeline.

**Detailed plan:** See **96e v5 Pipeline Integration Plan.md**
**Testing progress:** See **96f Model Detection Testing.md**

**Pipeline Order (UPDATED 2026-01-15):**
```
1. uploading
2. verifying
3. parsing          ← LlamaParse FIRST (moved up)
4. model_detection  ← uses parsed output (no separate OCR)
5. model_selection  ← blocking step
6. vision_analysis
7. figure_cropping
8-14. chunking, embedding, indexing, colloquial, dip, storing, completed
```

**Status:** BROKEN ❌ - LlamaParse refactor failed
- [x] Model detection endpoint (`POST /v1/detect-models`)
- [x] Model selection frontend UI
- [x] Model selection backend endpoint
- [x] Database migration (038_jobs_v5_columns.sql)
- [x] Pipeline integration in document.service.js
- [x] Test reset script (scripts/reset-test-upload.cjs)
- [x] **Model detection validated with Yanmar PDF** ✅ (2026-01-15)
- [x] Reorder pipeline: parsing before model_detection - **BROKE IT**
- [x] Remove pdfplumber/OCR code - **BROKE IT**
- [ ] **REVERT TO WORKING CODE** ← NEXT SESSION

**What happened:** Attempted to use LlamaParse instead of pdfplumber/OCR. Failed with "fetch failed". Original approach worked fine (just slow).

**Next session:** See `96f Model Detection Testing.md` for revert instructions.

**Stages to build (in order):**
1. ~~Model Detection~~ ✅ (endpoint works)
2. ~~Model Selection~~ ✅ (UI + backend works)
3. **Pipeline reorder** ← CURRENT
4. Vision Analysis - `POST /v1/vision/analyze-pages` (Python sidecar)
5. Figure Cropping - `POST /v1/vision/crop-figures` (Python sidecar)
6. Modified Chunking - Add `applies_to_models` to chunk metadata
7. Modified Embedding - Add model metadata to Pinecone vectors
8. Modified DIP - Add `applies_to_models` to extractions

---

### Step 4: Re-ingest Yanmar Manual

**Goal:** Upload and process the Yanmar 4JH series manual with new v5 pipeline.

**Manual:** Yanmar 4JH Common Rail Series Operation Manual
- Covers: 4JH45, 4JH57, 4JH80, 4JH110
- Source: Should be in backup storage `/manuals/`

**New document fields to populate:**
- `models_covered`: ["4JH45", "4JH57", "4JH80", "4JH110"]
- `is_multi_model`: true
- `is_oem_manual`: false
- `vision_processed`: false (initially)
- `page_count`: (from PDF)
- `figure_count`: (after vision pass)

**Processing steps:**
1. Upload PDF to storage
2. Create document row with new fields
3. Chunk document
4. Embed chunks with model tagging in metadata
5. Store in Pinecone

**Validation:**
- Document row exists with models_covered populated
- Chunks in document_chunks table
- Vectors in Pinecone with model metadata
- Can search and get Yanmar-specific results

**Done when:** Manual is searchable with model-aware results.

---

### Step 4: Vision Processing for Figures

**Goal:** Extract figures/diagrams from Yanmar manual using Vision LLM.

**What to extract:**
- Wiring diagrams
- Exploded parts views
- System schematics
- Control panel layouts
- Troubleshooting flowcharts

**New tables/fields used:**
- `documents.vision_processed` → true
- `documents.vision_processed_at` → timestamp
- `documents.figure_count` → count of extracted figures
- `doc_assets` table (if keeping) or new storage approach

**Validation:**
- Figures extracted and stored
- Can retrieve figures when asking about specific topics
- Figure references appear in chat responses

**Done when:** Can ask "show me the Yanmar wiring diagram" and get relevant images.

---

### Step 5: DIP Extraction - Troubleshooting

**Goal:** Extract troubleshooting content into new staging_troubleshooting table.

**What to extract:**
- Symptom: "Engine won't start"
- Cause: "Battery isolator off"
- Resolution: "Turn battery isolator to ON"
- Related system: Battery Isolator (cross-system link)
- Models: ["4JH45", "4JH57", "4JH80", "4JH110"]

**Key feature:** Cross-system linking
- Troubleshooting steps often reference OTHER systems
- "Check battery isolator" links to Battery Isolator system
- "Check fuel filter" links to Racor filter system
- This builds the relationship graph

**Validation:**
- staging_troubleshooting has rows for Yanmar
- Cross-system references captured (even if target systems don't exist yet)
- Model applicability captured

**Done when:** Troubleshooting table populated, ready for DIP agent review.

---

### Step 6: DIP Extraction - System Relationships

**Goal:** Extract system relationships into staging_system_relationships.

**Relationships to capture for Yanmar engine:**
- Engine `requires` Battery (for starting)
- Engine `requires` Fuel System
- Engine `powers` Alternator
- Engine `connects_to` Saildrive
- Engine `monitored_by` Engine Display
- Engine `controlled_by` Engine Control Panel

**Note:** Target systems may not exist yet. Capture as text references, resolve to FKs later when systems are added.

**Validation:**
- staging_system_relationships has rows
- Relationship types are meaningful
- Can query "what does the engine connect to?"

**Done when:** Relationship staging table populated.

---

### Step 7: DIP Agent Review

**Goal:** Run DIP agent on new staging tables for Yanmar content.

**Tables to process:**
- staging_troubleshooting → troubleshooting (approved)
- staging_system_relationships → system_relationships (approved)

**Training data available:**
- 436 existing decisions in agent_training_decisions
- May need ~20-30 new decisions for troubleshooting category
- May need ~10-20 new decisions for relationships category

**Validation:**
- Agent can process new staging items
- Approve/reject flow works
- Approved items move to production tables

**Done when:** Production troubleshooting and relationship tables have approved Yanmar content.

---

### Step 8: Centroid Membership

**Goal:** Add Yanmar 4JH57 to relevant centroids.

**Centroids for engine:**
- "Engine Starting (Port)" - for port engine instance
- "Engine Starting (Stbd)" - for stbd engine instance
- "Charging (Underway)" - alternator connection
- "Propulsion" - primary function

**Table:** centroid_members
- Links system (or instance?) to centroid

**Question to resolve:** Do centroids link to systems or instances?
- For twin engines, probably need instance-level membership
- Port engine in "Engine Starting (Port)" centroid
- Stbd engine in "Engine Starting (Stbd)" centroid

**Validation:**
- Can query "what systems are involved in starting the port engine?"
- Returns Yanmar 4JH57 (Port instance) plus related systems

**Done when:** Centroid membership populated and queryable.

---

### Step 9: Chat Integration

**Goal:** Verify chat uses new v5 data correctly.

**Test queries:**
1. "What are the specs for my Yanmar engine?"
   - Should return 4JH57-specific specs, not generic 4JH series

2. "How do I start the port engine?"
   - Should use centroid to find related systems
   - Should include troubleshooting prereqs

3. "Show me the Yanmar wiring diagram"
   - Should return extracted figure

4. "What systems are connected to my engine?"
   - Should use relationship graph

**Validation:**
- Responses are model-specific (4JH57, not 4JH80)
- Cross-system relationships used in context
- Figures returned when relevant

**Done when:** Chat handles all test queries correctly.

---

### Step 10: Add Related Systems

**Goal:** Add systems that relate to the engine to test relationship graph.

**Systems to add (minimal set):**
1. SD60 Saildrive (x2 - Port/Stbd)
2. Battery Isolator
3. Racor Fuel Filter
4. Engine Control Panel

**For each:**
- Create system with proper FK references
- Create instances if multiple
- Resolve pending relationships from Step 6
- Add to relevant centroids

**Validation:**
- Relationship graph connects engine to related systems
- Centroid queries return full system families
- Chat uses expanded context

**Done when:** Can trace full dependency chain from engine.

---

## Success Criteria

The single-system validation is complete when:

1. **Data integrity** - Yanmar system properly linked to all reference tables
2. **UI works** - Can CRUD systems with new dropdowns
3. **Document pipeline** - Manual ingested with model tagging
4. **Vision extraction** - Figures extracted and retrievable
5. **DIP extraction** - Troubleshooting and relationships in staging
6. **DIP agent** - Can review and approve new categories
7. **Centroids** - Engine in appropriate operational groupings
8. **Relationships** - Graph connects engine to related systems
9. **Chat quality** - Responses use new structured data correctly

---

## After Validation: Scale Up

Once the single system validates the pipeline:

1. **Restore remaining systems** from systems_old
   - Map to new FK structure
   - Populate reference table links

2. **Re-ingest all 81 documents**
   - ~$150 estimated cost (vision + embeddings + DIP)
   - Tag with models_covered
   - Extract figures with vision

3. **Run DIP extraction on all docs**
   - Populate troubleshooting for all systems
   - Build complete relationship graph

4. **Train DIP agent on new categories**
   - ~50-100 new training decisions

5. **Populate all centroid memberships**
   - Either manual or LLM-assisted

---

## Resolved Decisions

### FK + _norm Column Pattern

**Decision:** Keep BOTH the new FK columns AND the old `_norm` text columns.

**Rationale:** 39 files depend on `manufacturer_norm`, `system_norm`, `subsystem_norm` having text values. Rather than refactor all of them, we keep both in sync:

| FK Column | _norm Column | Value |
|-----------|--------------|-------|
| `manufacturer_id` | `manufacturer_norm` | "Yanmar" |
| `system_category_id` | `system_norm` | "Propulsion" |
| `subsystem_category_id` | `subsystem_norm` | "Engines" |

**Sync approach:** When creating/updating systems, populate BOTH:
```sql
UPDATE systems s
SET
  manufacturer_norm = rm.name,
  system_norm = rsc.name,
  subsystem_norm = rsub.name
FROM ref_manufacturers rm, ref_system_categories rsc, ref_subsystem_categories rsub
WHERE s.manufacturer_id = rm.id
  AND s.system_category_id = rsc.id
  AND s.subsystem_category_id = rsub.id;
```

**Future:** Can refactor to use JOINs and drop `_norm` columns later. Not blocking.

---

## Open Questions

1. **Centroid membership granularity** - System level or instance level?
2. **Relationship target resolution** - How to handle references to systems that don't exist yet?
3. **Vision extraction storage** - doc_assets table or new approach?
4. **Model tagging in chunks** - Metadata field name? Array or single value?

---

## Files to Track Changes

As we work through validation, track files modified:

| Step | Files Changed |
|------|---------------|
| 1 | (SQL only - UPDATE systems SET...) |
| 2 | (Already done - systems.html) |
| 2.5 | `src/public/upload.html` |
| 3.1 | `python-sidecar/app/routes/model_detection.py` (NEW) |
| 3.2 | `src/routes/document/model-selection.route.js` (NEW) |
| 3.3 | `python-sidecar/app/routes/vision_analysis.py` (NEW) |
| 3.4 | `python-sidecar/app/routes/figure_cropping.py` (NEW) |
| 3.5 | `python-sidecar/app/chunking/chunker.py` (MODIFY) |
| 3.6 | `python-sidecar/app/chunking/embeddings.py` (MODIFY) |
| 3.7 | `python-sidecar/scripts/dip_extraction_cached.py` (MODIFY) |
| 3.* | `src/services/document.service.js` (MODIFY - orchestrator) |
| 3.* | `python-sidecar/app/main.py` (MODIFY - register routes) |

---

## Related Documents

- **96** - Problem definition and analysis (Document Foundation Crisis)
- **96a** - Content inventory and purge decisions
- **96b** - Schema changes specification
- **96c** - Migration execution plan and progress tracking
- **96e** - v5 Pipeline Integration Plan (detailed build steps)

---

*This document tracks the single-system validation approach. Update as we complete each step.*
