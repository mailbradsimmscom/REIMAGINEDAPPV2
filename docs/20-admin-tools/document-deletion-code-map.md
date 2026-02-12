# Document Deletion – Code Map

**Assumption:** You have `docId` and want to delete all data associated with that document **and its system**.
**Last Updated:** 2026-02-07
**Source of truth:** Live schema dump `scripts/migrations/actual/2026-02-04_tables/`

---

## 1. Entry Points

| Entry | File | Flow |
|-------|------|------|
| **Documents page** | `src/public/documents.html` | User clicks delete → `showDeleteModal(docId)` → fetch preview → `executeDelete()` → `DELETE /admin/api/documents/{docId}` |
| **Direct API** | — | `GET /admin/api/documents/:docId/deletion-preview` or `DELETE /admin/api/documents/:docId` |

---

## 2. Route Layer

**File:** `src/routes/admin/document-deletion.route.js`
**Mount:** `src/routes/admin/index.js` → `router.use('', documentDeletionRouter)` → full path `/admin/api/...`

| Method | Path | Handler |
|--------|------|---------|
| GET | `/documents/:docId/deletion-preview` | Returns `deletionService.getDeletionPreview(docId)` |
| DELETE | `/documents/:docId` | Validates body (deletionOptions, confirmation, reason), calls `deletionService.deleteDocument(docId, deletionOptions, deletedBy, reason)` |

---

## 3. FK Constraint Map

### 3.1 What CASCADE-deletes when `documents` row is deleted

These have `doc_id → documents(doc_id) ON DELETE CASCADE` — **no explicit delete needed**:

| Table | Rows (approx) |
|-------|---------------|
| `doc_assets` | 282 |
| `document_referenced_systems` | 27 |
| `document_systems` | 3 |
| `spec_suggestions` | 108 |
| `playbook_hints` | 69 |
| `intent_router` | 111 |
| `golden_tests` | 79 |
| `staging_spec_suggestions` | 0 |
| `staging_playbook_hints` | 0 |
| `staging_intent_router` | 0 |
| `staging_golden_tests` | 0 |

### 3.2 What CASCADE-deletes when `systems` row is deleted

These have `asset_uid → systems(asset_uid) ON DELETE CASCADE`:

| Table |
|-------|
| `instances` |
| `centroid_members` |
| `boatos_tasks` |
| `system_hours_history` |
| `system_maintenance` |
| `system_photos` |
| `system_relationships` |
| `pipeline_processing_status` |
| `maintenance_tasks_index` |
| `task_completions` |

### 3.3 What SET NULLs when `systems` row is deleted

These have `ON DELETE SET NULL` — rows stay, `asset_uid` becomes null:

| Table | Note |
|-------|------|
| `spec_suggestions` | Already gone via doc cascade if same doc |
| `playbook_hints` | Already gone via doc cascade if same doc |
| `staging_spec_suggestions` | Already gone via doc cascade if same doc |
| `supplies` | Spare parts stay, lose system link |
| `user_tasks` | Tasks stay, lose system link |

### 3.4 What BLOCKS deletion (NO CASCADE / NO ACTION) — must delete explicitly

**Blocks `documents` deletion:**

| Table | FK | Action needed |
|-------|-----|---------------|
| `document_chunks` | `doc_id → documents(doc_id)` NO ACTION | DELETE WHERE doc_id = X |

**Blocks `systems` deletion:**

| Table | FK Column(s) | Action needed |
|-------|-------------|---------------|
| `troubleshooting` | `asset_uid`, `related_system_uid` | DELETE WHERE asset_uid = X OR related_system_uid = X |
| `staging_troubleshooting` | `asset_uid`, `related_system_uid` | DELETE WHERE asset_uid = X OR related_system_uid = X |
| `maintenance_tasks_queue` | `asset_uid` | DELETE WHERE asset_uid = X |
| `staging_system_relationships` | `source_system_uid`, `target_system_uid` | DELETE WHERE source_system_uid = X OR target_system_uid = X |
| `documents.oem_for_asset_uid` | `oem_for_asset_uid → systems(asset_uid)` | UPDATE SET NULL on other docs |
| `maintenance_agent_memory` | `asset_uid` | **Already handled** (FK fixed) |

**Has FK but NO CASCADE — blocks `documents` deletion:**

| Table | FK | Action needed |
|-------|-----|---------------|
| `ingest_timing` | `doc_id → documents(doc_id)` NO CASCADE | DELETE WHERE doc_id = X |

---

## 4. Deletion Order

Given `doc_id`:
- **asset_uid source:** Use `documents.asset_uid` first. Fall back to `document_systems` (by doc_id) only if `documents.asset_uid` is null.
- **If asset_uid is null:** Set `shouldDeleteSystem = false` and skip steps 7–14.

```
Step  Table / Target                   Why this order
────  ──────────────────────────────   ─────────────────────────────────────
 0    Gather info                      Get asset_uid (from documents.asset_uid,
                                       fallback document_systems). Preview counts.
                                       docCount = COUNT(DISTINCT doc_id)
                                       FROM document_systems WHERE asset_uid = X.
                                       shouldDeleteSystem = (docCount === 1)
                                       (docCount === 0 → false; no link to verify)
                                       (asset_uid is null → false; skip system steps)
 1    Pinecone vectors                 External — orphans invisible, do first
 2    Supabase storage                 External — archive manuals/{docId}/*
 3    document_chunks                  NO CASCADE — blocks doc deletion
 4    ingest_timing                    NO CASCADE — blocks doc deletion
 5    documents.last_job_id            SET NULL — clears FK to jobs
 6    jobs                             Now safe with FK cleared

      ── Steps 7–11 only if shouldDeleteSystem ──

 7    troubleshooting                  NO CASCADE — blocks system deletion
                                       DELETE WHERE asset_uid = X
                                       OR related_system_uid = X
 8    staging_troubleshooting          NO CASCADE — blocks system deletion
                                       DELETE WHERE asset_uid = X
                                       OR related_system_uid = X
 9    maintenance_tasks_queue          NO CASCADE — blocks system deletion
                                       First: UPDATE SET canonical_task_id = NULL,
                                       duplicate_of = NULL WHERE asset_uid = X
                                       (clears self-referencing FKs).
                                       Then: DELETE WHERE asset_uid = X
10    staging_system_relationships     NO CASCADE — blocks system deletion
                                       DELETE WHERE source_system_uid = X
                                       OR target_system_uid = X
11    documents.oem_for_asset_uid      SET NULL on OTHER docs WHERE
                                       oem_for_asset_uid = X

      ── Resume unconditionally ──

12    Audit record                     INSERT into document_deletions before destroy
13    documents row                    CASCADE handles: doc_assets,
                                       document_referenced_systems, document_systems,
                                       spec_suggestions, playbook_hints, intent_router,
                                       golden_tests, staging_spec_suggestions,
                                       staging_playbook_hints, staging_intent_router,
                                       staging_golden_tests

      ── Step 14 only if shouldDeleteSystem ──

14    systems row                      CASCADE handles: instances, centroid_members,
                                       boatos_tasks, system_hours_history,
                                       system_maintenance, system_photos,
                                       system_relationships, pipeline_processing_status,
                                       maintenance_tasks_index, task_completions
                                       SET NULL: supplies.system_asset_uid,
                                       user_tasks.asset_uid
```

---

## 5. Service Layer — IMPLEMENTED

**File:** `src/services/document-deletion.service.js`
**Class:** `DocumentDeletionService`
**Status:** ✅ All steps implemented (2026-02-07)

### 5.1 `getDeletionPreview(docId)`

**Counts (all implemented):** chunks, jobs, ingest_timing, staging DIP (5 tables incl. troubleshooting), production DIP (5 tables incl. troubleshooting), Pinecone, storage, system flags, shouldDeleteSystem, documentSystemsCount.

**When shouldDeleteSystem is true, also counts:** troubleshooting, staging_troubleshooting, maintenance_tasks_queue, staging_system_relationships, instances.

### 5.2 `deleteDocument(docId, options, deletedBy, reason)`

**Handles all steps:**

| Step | What | Status |
|------|------|--------|
| 0 | `shouldDeleteSystem` check via `document_systems` count | ✅ |
| 3 | Storage archive | ✅ (existing) |
| 4 | Delete `document_chunks` | ✅ (existing) |
| 4b | Delete `ingest_timing` WHERE doc_id | ✅ |
| 5 | Clear `last_job_id`, delete `jobs` | ✅ (existing) |
| 6 | Delete Pinecone vectors | ✅ (existing) |
| 7 | Delete staging DIP + `staging_troubleshooting` | ✅ |
| 8 | Delete production DIP + `troubleshooting` | ✅ |
| 9 | `maintenance_tasks_queue` — null self-refs then delete | ✅ (conditional on shouldDeleteSystem) |
| 10 | `staging_system_relationships` — delete | ✅ (conditional on shouldDeleteSystem) |
| 11 | `documents.oem_for_asset_uid` — SET NULL on other docs | ✅ (conditional on shouldDeleteSystem) |
| 12 | System flag updates (colloquial, manual) | ✅ (only when NOT deleting system) |
| 13 | Save audit record | ✅ (existing, enhanced with system deletion info) |
| 14 | Delete documents row | ✅ (existing) |
| 15 | Delete systems row (CASCADE) | ✅ (conditional on shouldDeleteSystem) |

### 5.3 `countDipEntries()` / `deleteDipEntries()`

**Includes:** specs, procedures, qa, golden, troubleshooting (staging_troubleshooting or troubleshooting based on env).

---

## 6. Dependencies

| Dependency | Usage |
|------------|--------|
| `getSupabaseClient()` | `src/repositories/supabaseClient.js` |
| `getEnv()` | `src/config/env.js` — `PINECONE_NAMESPACE`, `PYTHON_SIDECAR_URL` |
| Python sidecar | `/v1/pinecone/search` and `/v1/pinecone/delete` for vectors |

---

## 7. Edge Cases

| Case | Resolution |
|------|------------|
| **System shared by multiple documents** | Check `document_systems` count for asset_uid before deleting system. If other docs reference it, only delete the document, not the system. |
| **Supplies linked to system** | `supplies.system_asset_uid` SET NULL on system delete — spare parts stay, lose system link. Show count in preview. |
| **User tasks linked to system** | `user_tasks.asset_uid` SET NULL — tasks stay, lose system link. Show count in preview. |
| **Troubleshooting references another system** | `related_system_uid` on troubleshooting rows. Deleting WHERE related_system_uid = X removes troubleshooting entries that reference this system from OTHER systems. Preview should show this count separately. |
| **documents.oem_for_asset_uid** | Other documents that list this system as their OEM. NULL it out, don't block. |
| **asset_uid is null** | Document has no linked system. Set `shouldDeleteSystem = false`, skip steps 7–14. Only delete document-level data (steps 1–6, 12–13). |
| **docCount === 0** | No `document_systems` rows for this asset_uid (orphaned system or data inconsistency). Treat as `shouldDeleteSystem = false` — don't delete a system we can't verify ownership of. |

---

## 8. Implementation Notes

- **Route** — No changes needed. Handles `docId` and passes options through. New steps are internal to the service.
- **Frontend** — Updated to display new preview counts (ingest_timing, troubleshooting, system deletion status).
- **Pinecone** — Already handled via sidecar.
- **Audit** — Enhanced with `should_delete_system`, `system_deletion_counts`, `system_deleted`, `system_asset_uid` fields.
- **System deletion** — Automatic when `documents_table` option is true and this is the only document linked to the system. No new UI toggles.

---

## 9. File Summary

| File | Changes |
|------|---------|
| `src/services/document-deletion.service.js` | ✅ Added steps 4b, 7-11, 14-15; added troubleshooting to DIP count/delete; added shouldDeleteSystem logic; added preview counts |
| `src/routes/admin/document-deletion.route.js` | No changes needed |
| `src/public/documents.html` | ✅ Added system deletion status display, ingest_timing/troubleshooting counts |
| `docs/20-admin-tools/document-deletion-code-map.md` | ✅ Updated to reflect implementation |
