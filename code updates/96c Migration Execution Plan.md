# 96c Migration Execution Plan

## 🚨 CURRENT STATUS (2026-01-14)

**PHASE 2 (FRESH START) COMPLETE ✅ - NOW VALIDATING WITH SINGLE SYSTEM**

See **96d Single System Validation Approach.md** for current work.

### What's Done:
- Phase 0: Backup ✅
- Phase 4: Purge ✅
- Phase 1: Schema Changes ✅
- Phase 2: Fresh Start ✅

### Current Database State:

**Reference Tables (seeded):**
| Table | Rows |
|-------|------|
| ref_manufacturers | 51 |
| ref_product_types | 45 |
| ref_system_categories | 9 |
| ref_subsystem_categories | 54 |
| centroids | 15 |

**Test System:**
| Table | Rows | Content |
|-------|------|---------|
| systems | 1 | Yanmar 4JH57 |
| instances | 2 | Port (E25782), Stbd (E25787) |

**Backup Tables:**
| Table | Rows |
|-------|------|
| systems_old | 119 |
| instances_old | 161 |

**Purged Tables (all 0 rows):**
- documents, document_chunks
- All staging_* DIP tables
- All production DIP tables (spec_suggestions, golden_tests, etc.)
- maintenance_tasks_index, pipeline_runs, etc.

**Preserved Data:**
| Table | Rows | Notes |
|-------|------|-------|
| agent_training_decisions | 436 | DIP training data |
| agent_config | 2 | Learned criteria |
| deduplication_reviews | 60 | Dedup training data |
| spec_lexicon | 4 | Unit definitions |
| All user tables | varies | chat, supplies, trips, etc. |

**Storage:**
- `/manuals/*` - Source PDFs preserved
- `/supply-photos/*` - User photos preserved
- `/anchorage-photos/*` - User photos preserved
- `/dip/*` - Purged
- `/page-screenshots/*` - Purged

**Pinecone:**
- REIMAGINEDDOCS namespace: 0 vectors (purged)
- MAINTENANCE_TASKS namespace: 0 vectors (purged)

### CURRENT PHASE: Single System Validation

Working through the v5 pipeline with Yanmar 4JH57 as test case.
See **96d** for step-by-step validation approach.

**Progress:**
- [x] Step 1: Link test system to reference tables ✅
- [x] Step 2: Admin UI - reference table dropdowns ✅ (already implemented)
- [x] Step 2.5: Upload page v5 UI ✅ (inline status, interaction area)
- [ ] **Step 3: Build v5 pipeline stages** ← CURRENT
- [ ] Step 4: Re-ingest Yanmar manual with v5 pipeline
- [ ] Step 5: DIP extraction - troubleshooting
- [ ] Step 6: DIP extraction - relationships
- [ ] Step 7: DIP agent review
- [ ] Step 8: Centroid membership
- [ ] Step 9: Chat integration testing
- [ ] Step 10: Add related systems

### Step 3: Build v5 Pipeline Stages

See **96e v5 Pipeline Integration Plan.md** for detailed implementation plan.

**New pipeline stages to build (in order):**
1. Model Detection - Python sidecar endpoint
2. Model Selection - Blocking UI interaction
3. Vision Analysis - Python sidecar endpoint
4. Figure Cropping - Python sidecar endpoint
5. Modified Chunking - Add model tags
6. Modified Embedding - Add model metadata
7. Modified DIP - Add applies_to_models

---

## Overview

This document tracks the execution of the v4 → v5 migration (Document Foundation Crisis fix).

**Related Documents:**
- 96 - Problem definition and analysis
- 96a - Content inventory and purge decisions
- 96b - Schema changes specification

**Backup Checkpoint:** `v4-pre-migration`
- Git tag: `v4-pre-migration` (pushed to origin)
- JSON exports: `~/backups/boatos-v4-pre-migration/` (19 tables, 1,892 rows)
- Storage files: 543 files (561 MB)
- Full pg_dump: TablePlus export

---

## Migration Phases

### PHASE 0: BACKUP ✅ COMPLETE
- [x] Git tag created and pushed
- [x] Critical tables exported to JSON
- [x] Storage files downloaded (manuals, supply-photos, anchorage-photos)
- [x] Full pg_dump via TablePlus

---

### PHASE 1: SCHEMA CHANGES (Additive, Low Risk)
**Status:** ✅ COMPLETE (2025-01-14)

#### 1.1 Reference Tables
| Table | Status | Notes |
|-------|--------|-------|
| `ref_manufacturers` | ✅ | With synonyms, is_oem flag |
| `ref_product_types` | ✅ | Universal product taxonomy (~45 types) |
| `ref_system_categories` | ✅ | 9 categories (Propulsion, Electrical, etc.) |
| `ref_subsystem_categories` | ✅ | Nested under system categories (~50) |

#### 1.2 Systems Table Additions
| Column | Status | Notes |
|--------|--------|-------|
| `manufacturer_id` | ✅ | FK to ref_manufacturers |
| `product_type_id` | ✅ | FK to ref_product_types |
| `system_category_id` | ✅ | FK to ref_system_categories |
| `subsystem_category_id` | ✅ | FK to ref_subsystem_categories |
| `oem_manufacturer_id` | ✅ | FK for OEM tracking (B&G → Hy-ProDrive) |
| `oem_model` | ✅ | OEM model identifier |
| `oem_part_number` | ✅ | OEM part number |
| `serial_number` | ✅ | For single-instance systems |
| `model_synonyms` | ✅ | Array of model name variants |

#### 1.3 New DIP Tables
| Table | Status | Notes |
|-------|--------|-------|
| `staging_troubleshooting` | ✅ | New DIP extraction category |
| `troubleshooting` | ✅ | Production approved troubleshooting |
| `staging_system_relationships` | ✅ | DIP-extracted relationships |
| `system_relationships` | ✅ | Production relationships |
| `centroids` | ✅ | Operational groupings (15 defined) |
| `centroid_members` | ✅ | Junction table |

#### 1.4 Documents Table Additions
| Column | Status | Notes |
|--------|--------|-------|
| `models_covered` | ✅ | Array of model_norms this doc covers |
| `is_oem_manual` | ✅ | Boolean flag |
| `oem_for_asset_uid` | ✅ | Links OEM manual to parent system |
| `is_multi_model` | ✅ | Boolean flag |
| `vision_processed` | ✅ | Vision LLM processing flag |
| `vision_processed_at` | ✅ | Timestamp |
| `page_count` | ✅ | Total pages |
| `figure_count` | ✅ | Extracted figures count |

#### 1.5 Photos Table
| Table | Status | Notes |
|-------|--------|-------|
| `system_photos` | ✅ | Equipment discovery photos with Vision fields |

#### 1.6 Seed Data
| Data | Status | Notes |
|------|--------|-------|
| Manufacturer synonyms | ✅ | ~25 manufacturers with variants |
| Product type synonyms | ✅ | ~45 product types |
| System category synonyms | ✅ | 9 categories |
| Subsystem categories | ✅ | ~50 subsystems |
| Centroid definitions | ✅ | 15 operational centroids |

#### 1.7 Migration Scripts
| Script | Status |
|--------|--------|
| `029_reference_tables.sql` | ✅ |
| `030_systems_table_updates.sql` | ✅ |
| `031_system_photos.sql` | ✅ |
| `032_staging_troubleshooting.sql` | ✅ |
| `033_staging_relationships.sql` | ✅ |
| `034_documents_updates.sql` | ✅ |
| `035_centroids.sql` | ✅ |
| `036_seed_reference_data.sql` | ✅ |

---

### PHASE 2: STAGING DATA REVIEW
**Status:** NOT STARTED

#### 2.1 staging_systems Review (31 items not in production)
| Item | Decision | Notes |
|------|----------|-------|
| TBD | | |

#### 2.2 staging_instances Review (145 items not in production)
| Item | Decision | Notes |
|------|----------|-------|
| TBD | | |

---

### PHASE 3: DATA MIGRATION
**Status:** NOT STARTED

#### 3.1 Populate Reference Tables
- [ ] Extract unique manufacturers from systems.manufacturer_norm
- [ ] Map to ref_manufacturers with synonyms
- [ ] Assign product_type_id to 119 systems (manual/LLM assist)
- [ ] Assign system_category_id based on system_norm

#### 3.2 Migrate Staging Data
- [ ] Migrate approved staging_systems to systems
- [ ] Migrate approved staging_instances to instances (with serials)

#### 3.3 Fix model_norm Values
| Current Value | New Value | Status |
|---------------|-----------|--------|
| `Port_Stbd_Engine` | `4JH57` | ⬜ |
| Other bad values | TBD | ⬜ |

---

### PHASE 4: CONTENT PURGE
**Status:** NOT STARTED

**⚠️ IRREVERSIBLE - Verify backups before proceeding**

#### 4.1 Pinecone
| Namespace | Vectors | Status |
|-----------|---------|--------|
| REIMAGINEDDOCS | ~2,377 | ⬜ |
| MAINTENANCE | ~417 | ⬜ |

#### 4.2 Supabase Storage
| Path | Status | Notes |
|------|--------|-------|
| `/dip/*` | ⬜ | DIP extraction JSON files |
| `/page-screenshots/*` | ⬜ | Document screenshots |
| Keep: `/manuals/*` | N/A | Source PDFs |
| Keep: `/supply-photos/*` | N/A | User photos |
| Keep: `/anchorage-photos/*` | N/A | User photos |

#### 4.3 Database Tables (TRUNCATE)
| Table | Rows | Status |
|-------|------|--------|
| `documents` | ~81 | ⬜ |
| `document_chunks` | ~2,800 | ⬜ |
| `staging_spec_suggestions` | ~1,953 | ⬜ |
| `staging_playbook_hints` | ~1,132 | ⬜ |
| `staging_intent_router` | ~2,230 | ⬜ |
| `staging_golden_tests` | ~1,745 | ⬜ |
| `spec_suggestions` | ~12 | ⬜ |
| `playbook_hints` | ~29 | ⬜ |
| `intent_router` | ~15 | ⬜ |
| `golden_tests` | ~15 | ⬜ |
| `maintenance_tasks_index` | TBD | ⬜ |
| `maintenance_tasks_queue` | TBD | ⬜ |
| `deduplication_pending_reviews` | TBD | ⬜ |
| `deduplication_analyses` | 5 | ⬜ |
| `pinecone_search_results` | TBD | ⬜ |
| `pipeline_runs` | TBD | ⬜ |
| `pipeline_processing_status` | TBD | ⬜ |
| `agent_runs` | TBD | ⬜ |
| `jobs` | 24 | ⬜ |
| `merge_audit` | 0 | ⬜ |
| `staging_systems` | 142 | ⬜ (after migration) |
| `staging_instances` | 306 | ⬜ (after migration) |

#### 4.4 DO NOT TOUCH
- `agent_training_decisions` (385 rows)
- `agent_config` (learned criteria)
- `deduplication_reviews` (60 rows)
- `spec_lexicon` (4 rows)
- `systems` (119 rows)
- `instances` (161 rows)
- All user tables (chat, supplies, trips, etc.)

---

### PHASE 5: PIPELINE UPDATES
**Status:** NOT STARTED

#### 5.1 DIP Extraction Updates
- [ ] Add TROUBLESHOOTING_PROMPT
- [ ] Add RELATIONSHIP_PROMPT
- [ ] Update extraction to populate new staging tables

#### 5.2 Chunking Updates
- [ ] Add model tagging during chunking
- [ ] Add `applies_to_models` metadata

#### 5.3 Vision Integration
- [ ] Integrate Claude Vision for figure extraction
- [ ] Extract equipment from manual images

---

### PHASE 6: RE-INGESTION
**Status:** NOT STARTED

**Estimated Cost:** ~$150

| Step | Cost | Status |
|------|------|--------|
| Vision pass (81 docs) | ~$68 | ⬜ |
| Embeddings | ~$20 | ⬜ |
| DIP extraction | ~$15 | ⬜ |
| Misc/buffer | ~$47 | ⬜ |

---

### PHASE 7: TRAINING
**Status:** NOT STARTED

#### 7.1 New DIP Categories
| Category | Decisions Needed | Status |
|----------|------------------|--------|
| staging_troubleshooting | ~20-30 | ⬜ |
| staging_system_relationships | ~10-20 | ⬜ |

---

## Execution Log

| Date | Phase | Action | Result |
|------|-------|--------|--------|
| 2025-01-13 | 0 | Git tag created | ✅ v4-pre-migration |
| 2025-01-13 | 0 | JSON exports | ✅ 19 tables, 1,892 rows |
| 2025-01-13 | 0 | Storage backup | ✅ 543 files, 561 MB |
| 2025-01-13 | 0 | pg_dump via TablePlus | ✅ Complete |
| 2025-01-13 | 4 | Pinecone REIMAGINEDDOCS purged | ✅ 2,377 vectors deleted |
| 2025-01-13 | 4 | Storage DIP files purged | ✅ 324 files deleted |
| 2025-01-13 | 4 | Database tables purged | ✅ ~10,329 rows deleted |
| 2025-01-13 | 4 | deduplication_reviews restored | ✅ 60 rows (FK cascade had deleted) |
| 2025-01-13 | 4 | agent_runs/agent_run_items purged | ✅ FK issue resolved |
| 2025-01-14 | 1 | Reference tables created | ✅ 4 tables (manufacturers, product_types, categories, subsystems) |
| 2025-01-14 | 1 | Systems table updated | ✅ 9 new columns added |
| 2025-01-14 | 1 | New DIP tables created | ✅ troubleshooting, relationships, centroids |
| 2025-01-14 | 1 | Documents table updated | ✅ 8 new columns added |
| 2025-01-14 | 1 | system_photos table created | ✅ For equipment discovery |
| 2025-01-14 | 1 | Seed data loaded | ✅ Manufacturers, product types, categories, centroids with synonyms |
| 2025-01-14 | 1 | Helper functions created | ✅ get_related_systems, get_system_family, get_centroid_systems, find_centroid_by_query |
| 2026-01-14 | 2 | Test system _norm cols synced | ✅ manufacturer_norm, system_norm, subsystem_norm populated from FKs |
| 2026-01-14 | 2.5 | Upload page v5 UI | ✅ Inline status section, interaction area, 14-stage pipeline |
| | | | |

---

## Rollback Procedure

If something goes wrong:

1. **Git:** `git checkout v4-pre-migration`
2. **Database:** Restore from pg_dump via TablePlus
3. **Storage:** Re-upload from `~/backups/boatos-v4-pre-migration/storage/`
4. **Pinecone:** Will need to re-embed (same as fresh start)

---

## Notes

_Add notes during migration here_
