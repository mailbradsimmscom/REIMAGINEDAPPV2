# Code Update #19: Equipment Extraction Fix and Confidence Score Tracing

**Date:** 2025-10-10
**Duration:** ~2 hours
**Status:** Extraction Fixed, Python Delivery Issue Discovered

---

## Executive Summary

Session focused on fixing equipment extraction for inventory-type queries like "tell me the models of harken winches I have?" which were returning 0 equipment. Successfully improved the LLM extraction prompt to handle these patterns, verified confidence scores are flowing through Node.js, but discovered that Python is receiving empty `systems_context` despite Node.js finding and processing the equipment correctly.

**Key Achievements:**
1. ✅ Fixed LLM extraction for "models of X" and "types of Y" query patterns
2. ✅ Verified confidence score preservation from Session 3 (Code Update #18) is working
3. ❌ Discovered critical bug: Python receives empty systems_context for some queries

---

## Problem Discovery

### User Query
```
"tell me the models of harken winches I have?"
```

### System Response (Incorrect)
```
"It looks like your current inventory shows no Harken winches registered or listed."
```

### Investigation Results

#### 1. Keyword Search Issue
- Query: "tell me the models of harken winches I have?"
- Keywords extracted: "models harken winches"
- Search results: **0 systems found**
- Root cause: `plainto_tsquery` requires ALL words to match
  - "harken" alone → 10 results ✅
  - "winches" alone → 6 results ✅
  - "harken winches" → 5 results ✅
  - "models harken winches" → 0 results ❌
- The word "models" doesn't appear in any Harken system records

#### 2. LLM Extraction Issue
Initial test revealed the LLM extraction was returning empty array:
```javascript
Query: "tell me the models of harken winches I have?"
Result: { "equipment": [] }  // ❌ Empty!
```

The phrase "models of" made the LLM interpret this as asking for information ABOUT equipment types rather than extracting the equipment name itself.

---

## Solution Part 1: Improved LLM Extraction Prompt

### Original Prompt Opening
```
You are a marine expert looking at a colloquial sentence and trying to extract the systems.
As you know the marine environment is complex because states and conditions can also be
equipment, such as GPS which is a thing and a system, or wind sensor which is a state but
also there is a wind sensor. You need to be crafty and careful to parse apart a sentence
and pull from it what could be the systems.
```

### Enhanced Prompt (Lines 5-6 of equipment-extraction.service.js)
```
You are a marine expert looking at a colloquial sentence and trying to extract the systems.
As you know the marine environment is complex because states and conditions can also be
equipment, such as GPS which is a thing and a system, or wind sensor which is a state but
also there is a wind sensor. You need to be crafty and careful to parse apart a sentence
and pull from it what could be the systems. The questions will be all over the place as
this is the lead in from a chat application. the goal is to find the marine item in the
sentence and surface it - from trouble shooting, to general inqury, to asking about what
equipment or supplies we have, to random questions, we need to be on our toes and find
that marine item. Returning a few options is not a bad thing as this response flows into
query our systems and supplies tables.
```

### Key Improvements
1. **"questions will be all over the place"** - handles varied phrasings
2. **"from troubleshooting, to general inquiry, to asking about what equipment or supplies we have"** - explicitly covers inventory queries
3. **"find the marine item in the sentence and surface it"** - clear directive
4. **"this response flows into query our systems and supplies tables"** - clarifies purpose

### Added Examples (Lines 38-46)
```javascript
Query: "tell me the models of harken winches I have?"
[
  {"name": "harken winches", "confidence": 0.9, "role": "equipment"}
]

Query: "what types of anchors do I have"
[
  {"name": "anchors", "confidence": 0.9, "role": "equipment"}
]
```

### Testing Results
After improvements:
- "tell me the models of harken winches I have?" → extracts "harken winches" ✅
- "what types of anchors do I have" → extracts "anchors" ✅
- "my harken winches" → extracts "harken winches" ✅

---

## Solution Part 2: Confidence Score Flow Verification

### Traced Flow from Code Update #18 Session 3

#### Node.js Side - WORKING ✅
1. **LLM Extraction**
   - Extracts "harken winches" with confidence: 0.9, role: "equipment"

2. **System Search**
   - Searches for "harken winches" in systems table
   - Finds 5 Harken winch models:
     ```
     1. Harken 60_3_stea_winch
     2. Harken winch_60_3_stea_24v_h_motor
     3. Harken 50_2sta
     4. Harken 46_2stea
     5. Harken 50_2stea_24v_horizontal
     ```

3. **Confidence Preservation** (chat-proxy.service.js)
   - Lines 318-319: Adds `llm_confidence` and `llm_role` to equipment
   - Lines 466-467: Preserves confidence when using cached equipment
   - Lines 498-499: Adds confidence to systemsContext (main path)
   - Lines 516-517: Adds confidence to systemsContext (fallback path)
   - Line 523: Always updates database (not just for new equipment)

4. **Console Output Shows Success**
   ```
   🔍 CONFIDENCE SCORES FOR ALL EQUIPMENT:
     1. Harken 60_3_stea_winch
        confidence: 0.9, role: equipment, source: current
     2. Harken winch_60_3_stea_24v_h_motor
        confidence: 0.9, role: equipment, source: current
     [... all 5 with confidence scores ...]
   ```

5. **Database Update**
   - JSONB `equipment_context` column updated with all confidence scores

#### Python Side - NOT RECEIVING DATA ❌

Python logs show:
```python
classification content: {
  'primary_equipment_index': None,
  'reasoning': 'No equipment context provided'
}
```

This indicates `systems_context` array was **empty** when received by Python.

---

## Critical Discovery: Systems Context Not Reaching Python

### The Disconnect
1. Node.js successfully:
   - Finds 5 Harken winches
   - Adds confidence scores
   - Updates database
   - Logs show `systemsContext` has 5 items

2. Python receives:
   - Empty `systems_context` array
   - Generates response: "no Harken winches registered"

### Code Flow Analysis

**chat-proxy.service.js Line 577-579:**
```javascript
const pythonResult = await processChatWorkflow({
  query,
  systemsContext,  // <-- Should have 5 Harken systems
  threadId,
  // ...
});
```

**python-sidecar.client.js Line 35-37:**
```javascript
const requestBody = {
  query,
  systems_context: systemsContext,  // <-- Passed through
  // ...
};
```

**Python logs:**
```
'No equipment context provided'  // <-- Received empty array
```

### Hypothesis
The `systemsContext` variable might be getting cleared or reassigned between:
- Building it (lines 489-519)
- Sending to Python (line 579)

---

## Testing Evidence

### First Query (Found Equipment)
```
Node.js: Found 5 Harken winches
Console: Shows all 5 with confidence scores
Database: Updated with 5 equipment
Source: "current"
```

### Second Query (Cached)
```
Node.js: Using cached equipment
Console: Shows all 5 with confidence scores
Database: Already has equipment
Source: "cached_fallback"
```

Both queries show equipment in Node.js logs but Python receives nothing.

---

## Files Modified

### 1. `/src/services/equipment-extraction.service.js`
- **Lines 5-6**: Enhanced prompt to handle inventory queries
- **Lines 38-46**: Added two examples for "models of" and "types of" patterns

---

## Next Steps

### Immediate Priority - Debug Python Delivery
1. **Add logging at line 579** to verify systemsContext contents immediately before Python call
2. **Add logging in python-sidecar.client.js** to verify what's actually sent in request body
3. **Check for any early returns** between building systemsContext and calling Python
4. **Verify no async timing issues** clearing the array

### Potential Issues to Investigate
1. **Scoping issue**: Is systemsContext being shadowed or reassigned?
2. **Async timing**: Is there a race condition?
3. **Serialization**: Are certain equipment properties causing JSON.stringify to fail?
4. **Size limit**: Is there a payload size restriction?

### Recommended Debug Code (No Changes Made Yet)
```javascript
// Add before line 577 in chat-proxy.service.js
requestLogger.info('🚀 About to call Python with:', {
  systemsContextLength: systemsContext.length,
  systemsContextSample: systemsContext.slice(0, 2),
  systemsContextKeys: systemsContext.length > 0 ? Object.keys(systemsContext[0]) : []
});

// Add in python-sidecar.client.js after line 35
console.log('📤 Sending to Python:', {
  systems_context_length: requestBody.systems_context?.length,
  first_system: requestBody.systems_context?.[0]
});
```

---

## Key Learnings

### 1. Query Pattern Recognition
The phrase "models of X" or "types of Y" requires special handling in extraction prompts. Users asking about their inventory use these patterns frequently.

### 2. Prompt Engineering Impact
Small additions to prompts can have dramatic effects:
- Adding "asking about what equipment or supplies we have" fixed the extraction
- Examples are crucial for edge cases

### 3. End-to-End Validation Critical
Even when individual components work (extraction ✅, search ✅, confidence ✅), the full pipeline can fail at handoff points.

### 4. Confidence Score Implementation Works
The Session 3 work from Code Update #18 is functioning correctly:
- Scores are extracted
- Preserved through caching
- Saved to database
- The issue is downstream delivery

---

## Session Outcome

### Successes ✅
1. Fixed LLM extraction for inventory-type queries
2. Confirmed confidence score preservation is working
3. Identified exact point of failure (Python handoff)

### Still Broken ❌
1. Python receives empty systems_context for Harken query
2. User gets "no winches found" despite 5 being found

### Ready for Next Session
With the extraction fixed and the issue isolated to the Node→Python handoff, the next session can focus specifically on debugging why `systemsContext` isn't reaching Python.

---

**Session Duration:** ~2 hours
**Lines Changed:** 6 (prompt enhancement + 2 examples)
**Issue Status:** Partially resolved (extraction fixed, delivery broken)