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
| `staging_system_relationships` | `source_system_uid`, `target_system_uid` | DELETE WHERE source = X OR target = X |
| `documents.oem_for_asset_uid` | `oem_for_asset_uid → systems(asset_uid)` | UPDATE SET NULL on other docs |
| `maintenance_agent_memory` | `asset_uid` | **Already handled** (FK fixed) |

**No FK but has `doc_id` column — delete explicitly:**

| Table | Note |
|-------|------|
| `ingest_timing` | New table (2026-02-06), no FK to documents yet |

---

## 4. Deletion Order

Given `doc_id`, look up `asset_uid` from `document_systems`.

```
Step  Table / Target                   Why this order
────  ──────────────────────────────   ─────────────────────────────────────
 0    Gather info                      Get asset_uid, preview counts
 1    Pinecone vectors                 External — orphans invisible, do first
 2    Supabase storage                 External — archive manuals/{docId}/*
 3    document_chunks                  NO CASCADE — blocks doc deletion
 4    ingest_timing                    No FK — explicit delete
 5    documents.last_job_id            SET NULL — clears FK to jobs
 6    jobs                             Now safe with FK cleared
 7    troubleshooting                  NO CASCADE — blocks system deletion
 8    staging_troubleshooting          NO CASCADE — blocks system deletion
 9    maintenance_tasks_queue          NO CASCADE — blocks system deletion
10    staging_system_relationships     NO CASCADE — blocks system deletion
11    documents.oem_for_asset_uid      SET NULL on OTHER docs referencing this system
12    Audit record                     INSERT into document_deletions before destroy
13    documents row                    CASCADE handles: doc_assets,
                                       document_referenced_systems, document_systems,
                                       spec_suggestions, playbook_hints, intent_router,
                                       golden_tests, staging_spec_suggestions,
                                       staging_playbook_hints, staging_intent_router,
                                       staging_golden_tests
14    systems row                      CASCADE handles: instances, centroid_members,
                                       boatos_tasks, system_hours_history,
                                       system_maintenance, system_photos,
                                       system_relationships, pipeline_processing_status,
                                       maintenance_tasks_index, task_completions
                                       SET NULL: supplies.system_asset_uid,
                                       user_tasks.asset_uid
```

---

## 5. Service Layer

**File:** `src/services/document-deletion.service.js`
**Class:** `DocumentDeletionService`

### 5.1 `getDeletionPreview(docId)`

**Currently counts:** chunks, jobs, staging DIP (4 tables), production DIP (4 tables), Pinecone, storage, system flags.

**Add counts for:**
- `ingest_timing` WHERE doc_id = X
- `troubleshooting` WHERE asset_uid = X OR related_system_uid = X
- `staging_troubleshooting` WHERE asset_uid = X OR related_system_uid = X
- `maintenance_tasks_queue` WHERE asset_uid = X
- `staging_system_relationships` WHERE source = X OR target = X
- `instances` WHERE asset_uid = X

**Storage:** Expand `getStorageInfo()` to list all paths under `manuals/{docId}/` recursively (`text/`, `vision/`, `llamaparse_raw.json`).

### 5.2 `deleteDocument(docId, options, deletedBy, reason)`

**Currently handles:** Steps 1–6, explicit DIP delete (redundant but safe since CASCADE covers it), system flag updates, audit, documents row.

**Missing — must add:**

| Step | What | Code needed |
|------|------|-------------|
| 4 | `ingest_timing` | `supabase.from('ingest_timing').delete().eq('doc_id', docId)` |
| 7 | `troubleshooting` | `.delete().or('asset_uid.eq.X,related_system_uid.eq.X')` |
| 8 | `staging_troubleshooting` | Same pattern |
| 9 | `maintenance_tasks_queue` | `.delete().eq('asset_uid', assetUid)` |
| 10 | `staging_system_relationships` | `.delete().or('source_system_uid.eq.X,target_system_uid.eq.X')` |
| 11 | `documents.oem_for_asset_uid` | `.update({ oem_for_asset_uid: null }).eq('oem_for_asset_uid', assetUid)` |
| 14 | `systems` row | `.delete().eq('asset_uid', assetUid)` — cascades instances + 9 other tables |

**Remove (now redundant):**
- System flag updates (colloquial_keywords, manual) — the system row is being deleted entirely
- Explicit DIP deletes — CASCADE from documents handles them (keep if you want audit counts)

### 5.3 `archiveStorage()`

**Current:** Top-level list of `manuals/{docId}/`; moves PDFs and `DIP/` only.

**Change to:**

1. Add helper: `listStorageRecursive(supabase, prefix)` — list all objects under `manuals/{docId}/` (handle `text/`, `vision/analysis/`, `vision/assets/`, `llamaparse_raw.json`).
2. Collect all file paths.
3. For each path: `move(sourcePath, destPath)` or `remove(paths)` for hard delete.

### 5.4 `countDipEntries()` / `deleteDipEntries()`

**Add:** `troubleshooting` and `staging_troubleshooting` to both count and delete methods.

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

---

## 8. No Changes Needed

- **Route** — Handles `docId` and passes options through.
- **Frontend** — Uses existing options; new steps are internal to service.
- **Pinecone** — Already handled via sidecar.
- **Audit** — `document_deletions` insert already exists.

---

## 9. File Summary

| File | Changes |
|------|---------|
| `src/services/document-deletion.service.js` | Add steps 4, 7–11, 14; fix storage recursion; add preview counts |
| `src/routes/admin/document-deletion.route.js` | Optional: extend schema for new toggle options |
| `src/public/documents.html` | Optional: extend UI for new preview counts |
| `docs/20-admin-tools/document-deletion-code-map.md` | This map |
