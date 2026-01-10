# Code Update #75: Manual Not Processed → Task Creation

**Date:** 2026-01-10
**Status:** ✅ Implemented - Needs Testing
**Branch:** Stable-v4-Working
**Commit:** `eb1d9063` - Add task creation for unprocessed manuals

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

**Example:** User asks "What model of freezer do I have?" - Vitrifrigo IS in systems, but manual was never processed.

---

## Solution

Replicate the pattern from #72 (equipment not found):
- Check document status after equipment is found
- Create task if document exists but not processed
- **Continue to Python** - no early return, no message changes
- Non-blocking: errors don't break the flow

---

## Files Modified

| File | Change |
|------|--------|
| `src/repositories/user-tasks.repository.js` | Added `checkDocumentStatus(assetUid)` |
| `src/services/chat-proxy.service.js` | Added check loop at lines 797-820 |

---

## Implementation Details

### 1. New Function: `checkDocumentStatus(assetUid)`

Location: `src/repositories/user-tasks.repository.js`

```javascript
export async function checkDocumentStatus(assetUid) {
  const supabase = await checkSupabaseAvailability();

  const { data, error } = await supabase
    .from('documents')
    .select('id, chunk_count')
    .eq('asset_uid', assetUid)
    .limit(1)
    .single();

  if (error || !data) return { hasDoc: false, isProcessed: false };

  return {
    hasDoc: true,
    isProcessed: data.chunk_count > 0
  };
}
```

### 2. Check Loop in Chat Flow

Location: `src/services/chat-proxy.service.js` (lines 797-820)

Inserted after `nodeTiming.equipment_context_update_ms` and before STEP 7 (Python call):

```javascript
// Check for unprocessed manuals - create task if needed (non-blocking)
for (const equipment of currentEquipmentSearch) {
  try {
    const docStatus = await userTasksRepository.checkDocumentStatus(equipment.asset_uid);
    if (docStatus.hasDoc && !docStatus.isProcessed) {
      const exists = await userTasksRepository.hasExistingTask(equipment.model);
      if (!exists) {
        await userTasksRepository.createUserTask({
          description: `Process manual for "${equipment.manufacturer} ${equipment.model}"`,
          asset_uid: equipment.asset_uid,
          due_date: new Date().toISOString(),
          created_by: 'chat_suggestion',
          priority: 'normal'
        });
      }
    }
  } catch (err) {
    requestLogger.warn('Failed to check document status', { error: err.message });
  }
}
```

---

## Data Flow

```
User: "What model of freezer do I have?"
  │
  ▼
chat-proxy.service.js
  │ LLM extracts: ["freezer", "vitrifrigo"]
  │ Search inventory → FOUND (Vitrifrigo fridge_freezer)
  │ Build systemsContext
  │
  ├─► For each equipment in currentEquipmentSearch:
  │     │
  │     ├─► checkDocumentStatus(asset_uid)
  │     │     └─► hasDoc: true, isProcessed: false (chunk_count = 0)
  │     │
  │     ├─► hasExistingTask("fridge_freezer") → false
  │     │
  │     └─► createUserTask("Process manual for Vitrifrigo fridge_freezer")
  │
  ▼ Continue to Python (no early return)
  │
Python Sidecar
  │ DIP search → empty (no data)
  │ Pinecone search → empty (no chunks)
  │
  ├─► Synthesis: "I found Vitrifrigo in your inventory but don't have technical data..."
  ├─► Perplexity: General knowledge about Vitrifrigo freezers
  │
  ▼
User sees response + new task appears in maintenance todo list
```

---

## Differences from Failed #74

| #74 (Failed) | #75 (This Implementation) |
|--------------|---------------------------|
| Tried to prepend message to response | No message changes |
| Modified streaming generator | No streaming changes |
| Used early return | No early return |
| Broke production | Non-blocking side effect only |

**Key principle:** Just add the task as a side effect, then let everything continue normally.

---

## Post-Compact Verification Tests

Run these tests after `/compact` to verify the feature works:

### Test 1: Verify checkDocumentStatus Function

```bash
# Find an asset with unprocessed manual (chunk_count = 0)
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  const { data } = await supabase
    .from('documents')
    .select('asset_uid, filename, chunk_count')
    .eq('chunk_count', 0)
    .limit(5);
  console.log('Unprocessed documents:', data);
})();
"
```

### Test 2: Verify Task Creation (Direct)

```bash
# Test the repository function directly
node -e "
import('./src/repositories/user-tasks.repository.js').then(async (repo) => {
  // Replace with actual asset_uid from Test 1
  const status = await repo.checkDocumentStatus('YOUR_ASSET_UID');
  console.log('Document status:', status);
});
"
```

### Test 3: End-to-End Chat Test

1. Find equipment with unprocessed manual:
   ```sql
   SELECT s.manufacturer, s.model, s.asset_uid, d.chunk_count
   FROM systems s
   JOIN documents d ON d.asset_uid = s.asset_uid
   WHERE d.chunk_count = 0;
   ```

2. Ask about that equipment in chat:
   ```
   "Tell me about my [equipment name]"
   ```

3. Verify:
   - [ ] Response arrives (no error)
   - [ ] Synthesis mentions equipment
   - [ ] Perplexity provides general info
   - [ ] Check `user_tasks` table for new task with `created_by='chat_suggestion'`

### Test 4: Duplicate Prevention

1. Ask the same question twice
2. Verify only ONE task created (not duplicated)

```sql
SELECT * FROM user_tasks
WHERE created_by = 'chat_suggestion'
ORDER BY created_at DESC
LIMIT 10;
```

### Test 5: Check Node Logs

Look for these log messages after a chat request:

**Success case:**
```
Created task for unprocessed manual
  equipment: "Vitrifrigo fridge_freezer"
  asset_uid: "xxx"
```

**Skip case (already exists):**
No log (silently skipped)

**Error case:**
```
Failed to check document status
  error: "..."
```

---

## Troubleshooting

### Task not created?

1. **Check equipment was found:**
   - Look for `currentEquipmentSearch` in logs
   - If empty, equipment extraction failed

2. **Check document exists:**
   - Query: `SELECT * FROM documents WHERE asset_uid = 'xxx'`
   - If no row, no document uploaded yet

3. **Check chunk_count:**
   - If chunk_count > 0, document IS processed (no task needed)

4. **Check for existing task:**
   - Query: `SELECT * FROM user_tasks WHERE description ILIKE '%equipment_name%'`
   - If exists, duplicate prevention worked

5. **Check Supabase connection:**
   - Look for `checkDocumentStatus failed` in logs

---

## Related Documents

- `/code updates/72 Equipment Not Found Fix and User Task Creation.md` - Original pattern
- `/code updates/74 Failed Manual Not Processed Feature - REVERTED.md` - What NOT to do
- `/docs/10-user-features/chat.md` - Chat feature documentation
- `/docs/10-user-features/maintenance.md` - Task system documentation

---

## Rollback

To revert this feature:

```bash
git revert eb1d9063
```

Or manually:
1. Remove `checkDocumentStatus` from `user-tasks.repository.js`
2. Remove lines 797-820 from `chat-proxy.service.js`

The feature is isolated - removal won't affect other functionality.
