# 78 Partial Match Bug - Equipment Search and Hallucination

**Date:** 2026-01-14
**Status:** CLOSED - Example was invalid
**Severity:** ~~High~~ N/A - Example used simple hardware, not a system

---

## Update (2026-01-14)

The original example (Harken fairlead) is **not a valid use case**. Fairleads are simple deck hardware - they don't belong in the systems table and don't need manuals. The correct response is:

> "Fairleads are simple hardware. The max line diameter for a Harken 12mm bullseye fairlead is 12mm - it's in the product name."

**What belongs in systems table:** Equipment with manuals, maintenance procedures, troubleshooting (engines, electronics, pumps, etc.)

**What doesn't:** Simple hardware (fairleads, blocks, clutches, shackles, rope)

See **96b Schema Changes** for full criteria.

---

## Original Problem Summary (for reference)

The underlying bug pattern is still valid for REAL systems:

When a user asks about equipment that doesn't exist in the database, the system returns partial matches (same manufacturer, different product) and treats them as success. This causes:

1. **No task created** - System thinks it found the equipment
2. **LLM hallucinates** - Fabricates answers using wrong product context
3. **Follow-ups fail** - Wrong equipment context pollutes subsequent questions

---

## ~~Detailed Example: Harken Fairlead Query~~ (Invalid - fairleads aren't systems)

### User's First Question

**Query:** "harken 12 fairleads max line diameter?"

**~~What should happen:~~** *(This was wrong)*
- ~~System searches for Harken fairleads~~
- ~~No fairleads exist in database~~
- ~~Create task: "Add Harken 12 fairlead to systems inventory"~~
- ~~Response: "I don't have Harken fairlead documentation. Would you like me to search the web?"~~

**What ACTUALLY should happen:**
- System recognizes this is simple hardware, not a tracked system
- Response: "Fairleads are simple deck hardware. The 12mm refers to the max line diameter."

**What actually happened (the bug):**
- System searched for "harken 12 fairlead"
- Keyword search matched on "Harken" manufacturer
- Returned: Harken snatch block (score 0.30), Harken footblock (score 0.19)
- `currentEquipmentSearch.length > 0` → task creation SKIPPED
- LLM fabricated answer: "For Harken, a '12' fairlead refers to the Ø12 mm bullseye fairlead, and the maximum line diameter is 12 mm."
- This answer was completely made up - no fairlead docs exist

### Thread Equipment Context (Stored)

```json
[
  { "manufacturer": "Peplink", "model": "ap_one_ax", "rank": 0.82 },
  { "manufacturer": "Peplink", "model": "sim_projector", "rank": 0.61 },
  { "manufacturer": "Harken", "model": "winch_60_3_stea_24v_h_motor", "rank": 0.06 }
]
```

No fairleads. Peplink WiFi equipment ranked highest (from unrelated context pollution).

### User's Follow-up Question

**Query:** "what is the one size up?"

**What should happen:**
- System uses conversation context to understand this refers to Harken fairleads
- Searches for next size fairlead
- If not found, says so

**What actually happened:**
- Classification step received only: `user_query="what is the one size up?"` + `systems_context=[Peplink, Harken winch]`
- Classification has NO conversation history - doesn't know this is about fairleads
- Extracted keywords: `["size"]` (generic, useless)
- Retrieval: `sources: []` (empty - nothing matched)
- LLM saw Peplink in context, returned WiFi router specs
- Response: "Peplink AP One AX is a Wi-Fi 6 access point with 4x4 MU-MIMO..."

---

## Root Cause Analysis

### Issue 1: Partial Match Treated as Success

**Location:** `src/services/chat-proxy.service.js` lines 589-637

```javascript
if (currentEquipmentSearch.length === 0) {
  // Only creates task when ZERO results
  if (llmExtraction.equipment && llmExtraction.equipment.length > 0) {
    await userTasksRepository.createUserTask({...});
  }
}
```

The condition `currentEquipmentSearch.length === 0` means ANY search results (even wrong ones) skip task creation.

**The gap:** No validation that search results match what user asked for.

- LLM extracted: "Harken 12 fairlead"
- Search returned: "Harken snatch block"
- System saw: `results.length > 0` → "success!"
- Should have: Compared "fairlead" vs "snatch block" → no match → create task

### Issue 2: Classification is Context-Blind

**Location:** `python-sidecar/app/chat/workflows/chat_workflow_sequential.py` lines 575-578

```python
classification = await self.llm_service.classify_query(
    user_query=state["user_query"],
    systems_context=state["systems_context"]
    # ❌ MISSING: conversation_summary
)
```

The classification step receives the current query and equipment context, but NOT conversation history. For follow-up questions like "what is the one size up?", classification has no idea what "the one" refers to.

**Note:** `conversation_summary` IS available in `state["conversation_summary"]` but is not passed to classification. It's only used later in synthesis.

### Issue 3: Equipment Context Pollution

The thread's `equipment_context` blob stored completely wrong equipment (Peplink WiFi) because:

1. First query's search returned partial matches
2. Those matches were stored as the thread's equipment context
3. Follow-up queries inherit this polluted context

---

## Harken Equipment Actually in Database

```
- analogic_switch
- 50_2sta (winch)
- 46_2stea (winch)
- 32mm_big_boat_cb_traveler_car
- high_load_snatch_block
- black_magic_footblock
- dual_function_control_box
- 50_2stea_24v_horizontal (winch)
- winch_60_3_stea_24v_h_motor
```

**NO FAIRLEADS** - This is correct, the manual was never uploaded.

---

## When Tasks ARE Created (Current Logic)

Tasks are created in only two scenarios:

### Scenario 1: Zero Search Results
**Location:** Lines 589-633

- Keyword search returns NOTHING
- LLM extracted equipment names from query
- → Task: "Add [equipment] to systems inventory"

### Scenario 2: Unprocessed Manual
**Location:** Lines 797-829

- Equipment found in systems table
- Equipment has manual uploaded (`hasDoc = true`)
- Manual not processed (`isProcessed = false`)
- → Task: "Process manual for [manufacturer] [model]"

**Missing scenario:** "Manufacturer exists but specific product doesn't" - no task created.

---

## Proposed Solutions

### Option 1: Compare Extracted vs Found

Compare LLM-extracted equipment names against search result model names.

```javascript
// Pseudo-code
const extracted = llmExtraction.equipment.map(e => e.name.toLowerCase());
const found = currentEquipmentSearch.map(e => e.model.toLowerCase());

for (const name of extracted) {
  const matched = found.some(f => f.includes(name) || name.includes(f));
  if (!matched) {
    // Create task for this missing product
  }
}
```

**Pros:** Direct solution to the problem
**Cons:** String matching is fuzzy, might miss legitimate matches or create false positives

### Option 2: Confidence Threshold

Reject search results below a confidence score.

```javascript
const validResults = currentEquipmentSearch.filter(eq => eq.rank >= 0.5);
if (validResults.length === 0) {
  // Treat as "not found"
}
```

**Pros:** Simple to implement
**Cons:** Hard to pick the right threshold, might reject valid low-confidence matches

### Option 3: LLM Validation

Ask LLM to validate if search results match the query.

```javascript
const validation = await llm.validate({
  query: "harken 12 fairlead",
  results: ["Harken snatch block", "Harken footblock"]
});
// validation.match = false → create task
```

**Pros:** Most accurate
**Cons:** Extra LLM call = latency + cost

### Option 4: Transparent Response

Change synthesis to be honest about what was found vs requested.

```
System: "I don't have Harken fairlead documentation.
I have docs for: snatch block, footblock, winches.
Would you like info on those, or should I search the web?"
```

**Pros:** Best UX, no hallucination
**Cons:** Requires Python-side synthesis prompt changes

### Option 5: Pass Conversation Context to Classification

Fix the follow-up problem by passing `conversation_summary` to classification.

```python
classification = await self.llm_service.classify_query(
    user_query=state["user_query"],
    systems_context=state["systems_context"],
    conversation_summary=state["conversation_summary"]  # Add this
)
```

**Pros:** Fixes follow-up context loss
**Cons:** Only fixes part of the problem (not the initial partial match issue)

---

## Recommended Approach

Start with **Option 2 + Option 4**:

1. **Confidence threshold** - Quick win, reject obviously bad matches (score < 0.4)
2. **Transparent response** - Change synthesis to acknowledge when docs don't exist for the specific product asked about

Then consider **Option 5** for follow-up context.

**Option 1** (compare extracted vs found) is the most complete fix but needs careful implementation to avoid string matching issues.

---

## Files Involved

| File | Role |
|------|------|
| `src/services/chat-proxy.service.js` | Equipment search, task creation logic |
| `python-sidecar/app/chat/workflows/chat_workflow_sequential.py` | Classification, retrieval, synthesis |
| `python-sidecar/app/chat/services/llm_service.py` | `classify_query()` function |
| `python-sidecar/app/chat/config/system_prompts.py` | Prompt templates |
| `src/repositories/user-tasks.repository.js` | Task creation |

---

## Test Cases for Fix

1. **Query for non-existent product** - "Harken 12 fairlead" → should create task
2. **Query for existing product** - "Harken snatch block" → should NOT create task
3. **Follow-up question** - "what is the one size up?" → should use conversation context
4. **Partial manufacturer match** - "Harken pump" (no Harken pumps exist) → should create task
5. **Low confidence match** - Score 0.2 match → should treat as not found

---

## Related Issues

- Conversation context not passed to classification (separate but related)
- Equipment context pollution across thread messages
- LLM hallucination when docs don't exist

---

## Next Steps

1. Decide on approach (threshold vs comparison vs transparent response)
2. Implement fix
3. Add test cases
4. Monitor task creation rate and hallucination reduction
