# Code Update #75: Manual Not Processed → Task Creation

**Date:** 2026-01-10
**Status:** ✅ Implemented & Tested
**Branch:** Stable-v4-Working
**Commits:**
- `eb1d9063` - Initial implementation
- `85100ffe` - Add systemDetails lookup for manufacturer/model
- `1569274e` - Fix checkDocumentStatus query (id → chunk_count)
- `333593e4` - Run checks in parallel (Promise.all)

---

## Problem Statement

When a user asks about equipment that:
1. IS in the systems table ✅
2. HAS a document in the documents table ✅
3. BUT the document has NOT been processed (chunk_count = 0) ❌

The user gets:
- Empty synthesis (no technical data from DIP/Pinecone)
- Only Perplexity response (web search results)
- **No explanation** of why there's no data
- **No task created** to process the manual

**Example:** User asks "Tell me about my Yanmar sail drive" - Yanmar IS in systems, document IS downloaded, but manual was never chunked into Pinecone.

---

## Solution

Replicate the pattern from #72 (equipment not found):
- Check document status for ALL equipment in search results
- Create task if document exists but not processed
- **Continue to Python** - no early return, no message changes
- Non-blocking: errors don't break the flow
- **Parallel execution** to minimize latency impact

---

## Files Modified

| File | Change |
|------|--------|
| `src/repositories/user-tasks.repository.js` | Added `checkDocumentStatus(assetUid)` |
| `src/services/chat-proxy.service.js` | Added parallel check at lines 797-830 |

---

## Implementation Details

### 1. Function: `checkDocumentStatus(assetUid)`

Location: `src/repositories/user-tasks.repository.js`

```javascript
export async function checkDocumentStatus(assetUid) {
  try {
    const supabase = await checkSupabaseAvailability();

    const { data, error } = await supabase
      .from('documents')
      .select('chunk_count')  // Note: 'id' column doesn't exist, use 'chunk_count' only
      .eq('asset_uid', assetUid)
      .limit(1)
      .single();

    if (error || !data) return { hasDoc: false, isProcessed: false };

    return {
      hasDoc: true,
      isProcessed: data.chunk_count > 0
    };
  } catch (err) {
    requestLogger.warn('checkDocumentStatus failed', { error: err.message });
    return { hasDoc: false, isProcessed: false };
  }
}
```

### 2. Parallel Check in Chat Flow

Location: `src/services/chat-proxy.service.js` (lines 797-830)

Inserted after `nodeTiming.equipment_context_update_ms` and before STEP 7 (Python call):

```javascript
// Check for unprocessed manuals - create task if needed (non-blocking, parallel)
await Promise.all(currentEquipmentSearch.map(async (equipment) => {
  try {
    const docStatus = await userTasksRepository.checkDocumentStatus(equipment.asset_uid);
    if (docStatus.hasDoc && !docStatus.isProcessed) {
      // Look up full system details (search_systems RPC only returns asset_uid + rank)
      const systemDetails = await systemsRepository.getSystemByAssetUid(equipment.asset_uid);
      if (!systemDetails) {
        requestLogger.warn('System not found for unprocessed manual check', {
          asset_uid: equipment.asset_uid
        });
        return;
      }

      const exists = await userTasksRepository.hasExistingTask(systemDetails.model_norm);
      if (!exists) {
        await userTasksRepository.createUserTask({
          description: `Process manual for "${systemDetails.manufacturer_norm} ${systemDetails.model_norm}"`,
          asset_uid: equipment.asset_uid,
          due_date: new Date().toISOString(),
          created_by: 'chat_suggestion',
          priority: 'normal'
        });
        requestLogger.info('Created task for unprocessed manual', {
          equipment: `${systemDetails.manufacturer_norm} ${systemDetails.model_norm}`,
          asset_uid: equipment.asset_uid
        });
      }
    }
  } catch (err) {
    requestLogger.warn('Failed to check document status', { error: err.message });
  }
}));
```

---

## Key Implementation Notes

### Why `systemsRepository.getSystemByAssetUid()`?

The `search_systems` RPC only returns `{ asset_uid, rank }`. It does NOT return `manufacturer` or `model`. We must look up the full system details to get `manufacturer_norm` and `model_norm` for the task description.

### Why `Promise.all` instead of sequential loop?

With 10 equipment items, sequential DB calls would add 500-2000ms latency. Parallel execution reduces this to ~50-200ms (single call latency).

### Why `chunk_count` not `id, chunk_count`?

The `documents` table doesn't have an `id` column - it uses `doc_id`. Querying for `id` caused a silent failure that returned `{ hasDoc: false }` for everything.

---

## Data Flow

```
User: "Tell me about my Yanmar sail drive"
  │
  ▼
chat-proxy.service.js
  │ Search inventory → FOUND (10 related equipment items)
  │ Build systemsContext
  │
  ├─► Promise.all: For each equipment (IN PARALLEL):
  │     │
  │     ├─► checkDocumentStatus(asset_uid)
  │     │     └─► hasDoc: true/false, isProcessed: true/false
  │     │
  │     ├─► If hasDoc && !isProcessed:
  │     │     ├─► getSystemByAssetUid() → get manufacturer_norm, model_norm
  │     │     ├─► hasExistingTask(model_norm) → duplicate check
  │     │     └─► createUserTask() if no duplicate
  │     │
  │     └─► Tasks created for ALL equipment with unprocessed manuals
  │
  ▼ Continue to Python (no early return)
  │
Python Sidecar → Synthesis + Perplexity
  │
  ▼
User sees response + new tasks appear in maintenance todo list
```

---

## Behavior

- **Creates tasks for ALL related equipment** with unprocessed manuals, not just the one asked about
- **Silent operation** - no message to user about task creation
- **Duplicate prevention** - checks `hasExistingTask()` before creating
- **Non-blocking** - errors caught and logged, don't break chat flow

---

## Test Cases

### Test Equipment (systems with downloaded but unprocessed manuals)

| Equipment | asset_uid |
|-----------|-----------|
| Yanmar Sail_drive | `4dbf0c41-a3ac-4993-b5d4-b591a6365c72` |
| B&G zeus_s_16_mfd | `e4739797-4204-fe58-4abf-1867b0fd57ff` |
| Fortress fx_37 | `603ed86f-0d7a-4ee9-a681-d3a97b600764` |

### Verify Tasks Created

```sql
SELECT * FROM user_tasks
WHERE created_by = 'chat_suggestion'
ORDER BY created_at DESC
LIMIT 10;
```

### Expected Log Output

```
Created task for unprocessed manual
  equipment: "Yanmar Sail_drive"
  asset_uid: "4dbf0c41-a3ac-4993-b5d4-b591a6365c72"
```

---

## Bugs Fixed During Implementation

| Bug | Cause | Fix |
|-----|-------|-----|
| Tasks not created | Query used non-existent `id` column | Changed to `chunk_count` only |
| Task description "undefined undefined" | `search_systems` RPC doesn't return manufacturer/model | Added `getSystemByAssetUid()` lookup |
| Slow chat response | Sequential DB calls for 10 items | Changed to `Promise.all` parallel |
| Log shows "undefined" for equipment | Logging `manufacturer` instead of `manufacturer_norm` | Fixed log fields |

---

## Related Documents

- `/code updates/72 Equipment Not Found Fix and User Task Creation.md` - Original pattern
- `/docs/10-user-features/chat.md` - Chat feature documentation
- `/docs/10-user-features/maintenance.md` - Task system documentation

---

## Rollback

To revert this feature:

```bash
git revert 333593e4 1569274e 85100ffe eb1d9063
```

Or manually:
1. Remove `checkDocumentStatus` from `user-tasks.repository.js`
2. Remove Promise.all block from `chat-proxy.service.js`

The feature is isolated - removal won't affect other functionality.
