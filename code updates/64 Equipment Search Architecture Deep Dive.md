# Code Update #64: Equipment Search Architecture Deep Dive

**Date:** 2025-12-14 (Updated 2025-12-24)
**Status:** IMPLEMENTED - Score Accumulation + Parallelization Complete, Chunk Ranking Bottleneck Identified
**Branch:** Stable-v4-Working

---

## Executive Summary

This session conducted a deep architectural analysis of the equipment search system. We identified the root cause of why equipment ranking is broken (keyword splitting + deduplication = wrong equipment found) and implemented a comprehensive fix.

**Key Finding:** We were paying LLM latency (~1.5s) but throwing away the correct results due to broken deduplication logic. The fix required proper score accumulation.

**Result:** Marco pump now ranks #1 with combinedRank ~3.0 (was #10 with rank 0.669). Q2 anchor boost working correctly.

**Remaining Issue:** Response time is ~48s, needs optimization.

---

## Completed This Session

### 1. Synthesis Prompt Fix (DEPLOYED)

**File:** `python-sidecar/app/chat/config/system_prompts.py`

**Change:** Updated `SYNTHESIS_INSTRUCTIONS` to allow world knowledge instead of restricting LLM to only document content.

**Before:**
```python
CRITICAL DATA USAGE RULES:
1. You MUST use the technical data provided...
2. DO NOT say "I don't have information" if technical data is provided
3. DO NOT use general knowledge for specifications when DIP data is available
...
```

**After:**
```python
RESPONSE STRATEGY:
You are an expert marine technician with deep knowledge of boat systems. The user has provided their equipment inventory - this is GROUND TRUTH for what they own. Combine your expertise with the technical data provided.

KNOWLEDGE HIERARCHY:
1. EQUIPMENT IDENTITY: Manufacturer/model from EQUIPMENT IN USER'S INVENTORY is absolute truth - never change it
2. SPECIFICATIONS: When DIP data or documents provide specs, use those exact values
3. PROCEDURES: If documents contain procedures, extract them verbatim. If not, provide guidance based on your knowledge of this equipment type
4. TROUBLESHOOTING: Combine document knowledge with your expertise about common issues

YOUR EXPERTISE:
- You have extensive training about marine equipment - Marco pumps, Victron systems, Schenker watermakers, etc.
- USE this knowledge, but always contextualize to the user's specific equipment
- When using general knowledge, briefly note it: "Based on standard Marco pump service procedures..."
```

**Result:** System now provides procedural guidance using world knowledge, grounded in user's specific equipment context.

### 2. Perplexity API Key (FIXED)

**Issue:** 401 Unauthorized - account ran out of credits
**Fix:** User topped up Perplexity account
**Status:** Working

---

## The Equipment Search Problem - Full Analysis

### Test Query Used

```
"i need to change the smart sensor on my marco pump, how should i go about this?"
```

### What Should Happen

1. System identifies "marco pump" as the equipment
2. Finds Marco self_priming_transfer_pump in inventory
3. Provides answer grounded in user's Marco pump

### What Actually Happens

1. Keyword search splits query into individual words
2. "smart" matches Victron Smart products (rank 0.827)
3. "marco" matches Marco equipment (rank 0.787)
4. Victron ranks HIGHER and becomes primary equipment
5. Answer is grounded in wrong equipment

---

## Root Cause Analysis

### The Keyword Splitting Architecture

**File:** `src/services/chat-proxy.service.js` (lines 148-172)

```javascript
// Search each keyword separately to avoid multi-word queries returning 0 results
const searchQuery = extractKeywords(query) || query;
const keywords = searchQuery.split(/\s+/).filter(w => w.length > 2);

// Search each keyword and combine results, deduplicating by asset_uid
const seenAssetUids = new Set();
let queryKeywordResults = [];

for (const keyword of keywords.slice(0, 5)) { // Limit to first 5 keywords
  const results = await systemsRepository.searchSystems(keyword, { limit: 5 });
  for (const result of results) {
    if (!seenAssetUids.has(result.asset_uid)) {
      seenAssetUids.add(result.asset_uid);
      queryKeywordResults.push(result);
    }
  }
}

// Sort by rank (highest first) and limit to top 10
queryKeywordResults = queryKeywordResults
  .sort((a, b) => (b.rank || 0) - (a.rank || 0))
  .slice(0, 10);
```

### Keywords Extracted from Test Query

After `extractKeywords()` and filtering (length > 2):
```
['change', 'smart', 'sensor', 'marco', 'pump,']
```

First 5 searched (limit in code):
```
['change', 'smart', 'sensor', 'marco', 'pump,']
```

### Search Results Per Keyword

| Keyword | Top Match | Rank |
|---------|-----------|------|
| change | Yanmar engine | 0.000 |
| smart | Victron lynx_smart_bms_500 | **0.827** |
| sensor | B&G WS310 | 0.777 |
| marco | Marco control_panel | 0.787 |
| pump, | Pan World magnetic_pump | 0.837 |

### Final Sorted Results

| Position | Equipment | Rank | From Keyword |
|----------|-----------|------|--------------|
| 1 | Victron lynx_smart_bms_500 | 0.827 | "smart" |
| 2 | Victron smart_solar_mppt | 0.827 | "smart" |
| 3 | Pan World magnetic_driven_pump | 0.837 | "pump," |
| 4 | Marco control_panel | 0.787 | "marco" |
| 5 | B&G WS310 | 0.777 | "sensor" |
| ... | ... | ... | ... |
| 8 | Marco self_priming_transfer_pump | 0.669 | "marco" |

**The actual Marco pump the user wants is position 8.**

---

## The LLM Extraction - It Works Correctly!

**File:** `src/services/equipment-extraction.service.js`

The LLM extraction correctly identifies equipment as phrases:

```json
{
  "equipment": [
    {"name": "smart sensor", "confidence": 0.85},
    {"name": "marco pump", "confidence": 0.90}
  ]
}
```

### LLM Search Results

| Phrase | Search Results | Rank |
|--------|---------------|------|
| "smart sensor" | (no results) | - |
| "marco pump" | Marco control_panel | **1.0** |
| "marco pump" | Marco self_priming_transfer_pump | **1.0** |

**The LLM gets the RIGHT answer with rank 1.0!**

---

## The Deduplication Bug

**The Problem:** Deduplication happens at EACH step, preventing score accumulation.

### Current Flow

```
Keyword "marco" search:
  → Marco self_priming_transfer_pump (0.669) → ADDED to seenAssetUids

Keyword "pump" search:
  → Marco self_priming_transfer_pump (0.835) → SKIPPED (already in seenAssetUids)

LLM "marco pump" search:
  → Marco self_priming_transfer_pump (1.0) → SKIPPED (already in seenAssetUids)
```

**Result:** Marco pump only gets credit for 0.669 (first match), not the combined score.

### What Score Should Be (if we summed)

| Equipment | Keyword Scores | LLM Score | Combined |
|-----------|---------------|-----------|----------|
| Marco pump | 0.669 + 0.835 | 1.0 | **2.504** |
| Victron BMS | 0.827 | - | **0.827** |

**Marco pump should win decisively with combined score 2.504 vs 0.827**

---

## The Latency Insight

**Key Finding:** We're ALREADY paying the LLM latency.

```
Timeline:
Keyword search:  |--150ms--|
LLM extraction:  |-------1500ms-------|
                                      ^ Total = 1500ms anyway
```

Both run in parallel. We pay 1.5s but throw away the LLM's correct results due to dedup bug.

**The fix adds ZERO latency - just uses what we're already paying for.**

---

## Two Code Paths

### Path 1: Parallel (New Threads)

**Condition:** `should_infer = false` (no existing equipment context)

**Flow:**
1. Keyword search runs (finds wrong ranking)
2. LLM extraction runs (finds correct phrases)
3. Results merged with dedup (LLM results thrown away)

**Problem:** Dedup prevents score accumulation

### Path 2: Inference (Existing Threads)

**Condition:** `should_infer = true` (has equipment context from previous queries)

**Determined by:** `src/services/equipment-relationship-inference.service.js` line 410:
```javascript
should_infer: previousEquipment.length > 0
```

**Flow:**
1. Keyword search runs
2. Inference LLM analyzes: NEW equipment or referring to PREVIOUS?
3. If NEW: falls back to keyword results (broken ranking)
4. NO LLM extraction runs for phrase-based search

**Problem:** No phrase-based LLM extraction at all

---

## Equipment Context Persistence

### Storage Location

**File:** `src/services/chat-proxy.service.js` (lines 626-632)

```javascript
// STEP 6: Update equipment context blob
if (systemsContext.length > 0) {
  await chatRepository.updateChatThread(threadId, {
    equipment_context: systemsContext
  });
}
```

### What's Stored

```json
{
  "rank": 0.827456,
  "model": "lynx_smart_bms_500",
  "manufacturer": "Victron",
  "source": "current",
  "asset_uid": "27ae3e55-fc52-7fb0-439d-7907543fe5b2",
  "llm_confidence": null,
  "llm_role": null
}
```

### Why Storage is Correct

Follow-up queries often don't mention equipment:

```
Query 1: "How do I change the smart sensor on my marco pump?"
  → Equipment: Marco pump (explicit)
  → Save to context

Query 2: "What tools do I need?"
  → Equipment: (none mentioned - follow-up)
  → Use Marco pump from context

Query 3: "Is it waterproof?"
  → Equipment: (none mentioned - drilling down)
  → Use Marco pump from context
```

**Storage is needed.** The problem is storing WRONG equipment from Query 1.

---

## Equipment Families / Centroids (Future Enhancement)

### The Problem

```
Thread context: Marco pump discussion
Query: "how does this impact the control box?"
  → Search "control box"
  → Finds: Harken control box (0.85), Marco control box (0.78)
  → Without family awareness: picks Harken (WRONG!)
  → With family awareness: picks Marco control box (CORRECT)
```

### What's Needed

1. **Equipment families** - Marco pump + Marco control box = same family
2. **Context-aware ranking** - bias toward equipment family in conversation
3. **Manufacturer coherence** - don't mix Harken into Marco conversation

This is beyond the immediate fix but important for follow-up queries that add related equipment.

---

## The Fix Plan (Updated 2025-12-14 Session 2)

### Understanding Q2 Context Persistence

**Key Discovery:** `existingEquipmentContext` stores ALL equipment from Q1 (up to 20 items), including garbage.

After Q1 "marco pump sensor":
```
existingEquipmentContext contains:
- Marco pump (2.504 after fix) ✅
- Victron BMS (0.827) ❌ garbage
- Pan World pump (0.837) ❌ garbage
- B&G sensor (0.777) ❌ garbage
...up to 20 items
```

**How it's sorted:** `conversation-context.service.js` lines 294-300:
```javascript
return allEquipment.sort((a, b) => {
  if (a.source !== b.source) {
    return a.source === 'conversation_history' ? 1 : -1;  // current first
  }
  return (b.weight || b.rank || 0) - (a.weight || a.rank || 0);  // then by rank
});
```
Current query equipment first, then by rank. So `existingEquipmentContext[0]` = highest ranked from Q1.

**Problem:** If Q1 ranking is broken, garbage might be first. After Q1 fix, correct equipment is first.

---

### The Anchor Boost Strategy (Q2+)

**Problem Statement:**
- Q2 comes in, `existingEquipmentContext` has Marco pump (correct) + garbage
- We can't boost ALL existing equipment (boosts garbage too)
- We can't filter by score threshold (not always clear-cut)

**Solution:** Add +1.0 to ONLY the top item in `existingEquipmentContext`

When `previousEquipment.length > 0` (Q2+):
1. Take `existingEquipmentContext[0]` (highest ranked from Q1)
2. Add +1.0 to its score (anchor boost)
3. Run keyword + LLM search for any new equipment (with score accumulation)
4. Merge together - anchored primary stays on top

**Example:**
```
Q1: "marco pump sensor" → Marco pump ranked #1, stored first
Q2: "what about the control box?"

existingEquipmentContext[0] = Marco pump (rank 2.504)
After anchor boost: Marco pump (rank 3.504)

New search for "control box":
- Marco control box: 0.9
- Harken control box: 0.85

Final ranking:
1. Marco pump: 3.504 (anchored primary)
2. Marco control box: 0.9 (new, related)
3. Harken control box: 0.85 (new, unrelated)
```

**Why +1.0?** Large enough to protect primary, but a strongly mentioned NEW equipment (score ~2.5+) could still become focus if user explicitly changes topic.

---

### Fix Interdependence

**Critical:** Q1 fix MUST come before Q2 anchor boost works correctly.

```
Q1 fix (score accumulation) → Marco pump ranks #1 → stored first
                                    ↓
Q2 anchor boost → boosts existingEquipmentContext[0] → Marco pump protected
```

If Q1 is still broken, `existingEquipmentContext[0]` might be Victron, and we'd anchor the WRONG equipment.

---

## Detailed Implementation Plan

### Change 1: Score Accumulation in Keyword Search
**File:** `src/services/chat-proxy.service.js`
**Location:** Lines 159-167

```javascript
// BEFORE (broken):
for (const keyword of keywords.slice(0, 5)) {
  const results = await systemsRepository.searchSystems(keyword, { limit: 5 });
  for (const result of results) {
    if (!seenAssetUids.has(result.asset_uid)) {
      seenAssetUids.add(result.asset_uid);
      queryKeywordResults.push(result);
    }
    // ❌ Duplicates ignored
  }
}

// AFTER (fixed):
for (const keyword of keywords.slice(0, 5)) {
  const results = await systemsRepository.searchSystems(keyword, { limit: 5 });
  for (const result of results) {
    if (!seenAssetUids.has(result.asset_uid)) {
      seenAssetUids.add(result.asset_uid);
      queryKeywordResults.push({...result, combinedRank: result.rank || 0});
    } else {
      // ✅ Add score to existing
      const existing = queryKeywordResults.find(e => e.asset_uid === result.asset_uid);
      if (existing) {
        existing.combinedRank = (existing.combinedRank || 0) + (result.rank || 0);
      }
    }
  }
}
```

---

### Change 2: Initialize combinedRank When Adding Keyword Results to allEquipment
**File:** `src/services/chat-proxy.service.js`
**Location:** Lines 360-370

```javascript
// BEFORE:
for (const eq of keywordResults) {
  if (!seenAssetUids.has(eq.asset_uid)) {
    seenAssetUids.add(eq.asset_uid);
    allEquipment.push({
      ...eq,
      search_source: 'keyword'
    });
  }
}

// AFTER:
for (const eq of keywordResults) {
  if (!seenAssetUids.has(eq.asset_uid)) {
    seenAssetUids.add(eq.asset_uid);
    allEquipment.push({
      ...eq,
      combinedRank: eq.combinedRank || eq.rank || 0,  // ✅ Preserve accumulated score
      search_source: 'keyword'
    });
  }
}
```

---

### Change 3: Score Accumulation in LLM Merge + Weight LLM Higher
**File:** `src/services/chat-proxy.service.js`
**Location:** Lines 414-428

```javascript
// BEFORE:
for (const result of results) {
  if (!seenAssetUids.has(result.asset_uid)) {
    seenAssetUids.add(result.asset_uid);
    allEquipment.push({
      ...result,
      search_source: 'llm',
      llm_confidence: eq.confidence,
      llm_role: eq.role
    });
    newCount++;
  } else {
    dupCount++;  // ❌ Just counts
  }
}

// AFTER:
const LLM_WEIGHT = 1.5;  // LLM phrases are more accurate

for (const result of results) {
  const weightedRank = (result.rank || 0) * LLM_WEIGHT;

  if (!seenAssetUids.has(result.asset_uid)) {
    seenAssetUids.add(result.asset_uid);
    allEquipment.push({
      ...result,
      combinedRank: weightedRank,
      search_source: 'llm',
      llm_confidence: eq.confidence,
      llm_role: eq.role
    });
    newCount++;
  } else {
    // ✅ Add weighted score to existing
    const existing = allEquipment.find(e => e.asset_uid === result.asset_uid);
    if (existing) {
      existing.combinedRank = (existing.combinedRank || existing.rank || 0) + weightedRank;
    }
    dupCount++;
  }
}
```

---

### Change 4: Re-sort by combinedRank After Merge
**File:** `src/services/chat-proxy.service.js`
**Location:** After line 480 (after `currentEquipmentSearch = allEquipment;`)

```javascript
// ADD after line 480:
currentEquipmentSearch = allEquipment
  .sort((a, b) => (b.combinedRank || b.rank || 0) - (a.combinedRank || a.rank || 0));
```

---

### Change 5: Anchor Boost in Inference Path
**File:** `src/services/chat-proxy.service.js`
**Location:** Lines 181-193 (inside `if (referenceCheck.should_infer)`)

```javascript
// ADD at start of inference block:
if (referenceCheck.should_infer) {
  // ✅ Anchor boost: top existing equipment gets +1.0
  if (existingEquipmentContext.length > 0) {
    existingEquipmentContext[0].combinedRank =
      (existingEquipmentContext[0].rank || 0) + 1.0;
  }

  // ... existing inference code ...
}
```

---

### Change 6: Run LLM Extraction in Inference Path When NEW Equipment Detected
**File:** `src/services/chat-proxy.service.js`
**Location:** Inside inference path, after inference LLM returns "NEW equipment"

When `inferenceResult.inference === 'new_equipment'` (or however it signals new equipment):
- DON'T just use keyword results
- Run LLM extraction (same as parallel path)
- Apply score accumulation
- Merge with existing context (preserving anchor boost)

**Note:** Need to examine exact inference result format to implement this correctly.

---

### Future Enhancement: Equipment Families

**Goal:** Context-aware ranking based on equipment relationships

**Components needed:**
1. Equipment family/centroid data structure
2. Boost search results that match conversation's equipment family
3. Manufacturer coherence checks

---

## Files Involved

| File | Lines | Purpose |
|------|-------|---------|
| `src/services/chat-proxy.service.js` | 148-172 | Keyword splitting logic |
| `src/services/chat-proxy.service.js` | 181-282 | Inference path |
| `src/services/chat-proxy.service.js` | 284-525 | Parallel path with LLM extraction |
| `src/services/chat-proxy.service.js` | 360-428 | **MERGE LOGIC - FIX HERE** |
| `src/services/chat-proxy.service.js` | 626-632 | Equipment context persistence |
| `src/services/equipment-extraction.service.js` | - | LLM extraction (works correctly) |
| `src/services/equipment-relationship-inference.service.js` | 75-169 | Inference service |
| `src/services/conversation-context.service.js` | 275-301 | Equipment context merging |

---

## History: Why Keyword Splitting Was Added

### Original Problem (Doc #9)

PostgreSQL `plainto_tsquery` uses AND logic:
- "marco pump clicking" → needs ALL words to match
- "clicking" not in record → 0 results

### Solution: Split and Search Each Word

Search each keyword separately, combine results.

### Side Effect Discovered (Doc #999)

"nemesis lock screen" → "lock" matches deck_filler with higher rank than nemesis.

Same issue as "smart" matching Victron higher than "marco" matching Marco.

**Status in Doc #999:** "Identified" - NOT FIXED

---

## TODO List

### Completed (2025-12-14 Session 3)
- [x] Fix synthesis prompt to allow world knowledge
- [x] Fix Perplexity API key
- [x] Identify root cause: keyword splitting + dedup = wrong ranking
- [x] Confirm we're already paying LLM latency (no additional cost for fix)
- [x] Confirm equipment storage is correct (needed for follow-ups)
- [x] Analyze both code paths (parallel and inference)
- [x] Understand Q2 context persistence (existingEquipmentContext stores all, sorted by rank)
- [x] Design anchor boost strategy for Q2+
- [x] Document fix interdependence (Q1 must work before Q2 anchor works)
- [x] **Change 1:** Score accumulation in keyword search (lines 159-173)
- [x] **Change 2:** Initialize combinedRank when adding to allEquipment (lines 443-454)
- [x] **Change 3:** Score accumulation in LLM merge + LLM_WEIGHT=1.5 (lines 506-537)
- [x] **Change 4:** Re-sort by combinedRank after merge (lines 496-498)
- [x] **Change 5:** Anchor boost +1.0 to top item in inference path (lines 187-202)
- [x] **Change 6:** Run LLM extraction in inference path when NEW equipment detected (lines 229-287)
- [x] **Bug Fix:** combinedRank wasn't being saved to equipment_context (lines 697, 710)
- [x] **Bug Fix:** conversation-context.service.js sort used rank instead of combinedRank (line 299)
- [x] **Bug Fix:** Logger was truncating metadata - fixed formatHumanLog (lines 65-85)

### Verified Working
- Marco pump ranks #1 with combinedRank ~3.0 (keyword 1.504 + LLM 1.5 = 3.004)
- Marco control panel ranks #2 with combinedRank ~3.06
- Q2 anchor boost applies +1.0 to top existing equipment
- Score accumulation visible in logs: `📈 [SCORE_BOOST] Marco: 1.504 + 1.500 = 3.004`

### Timing Optimization: COMPLETED (2025-12-24 Session)

**Problem:** Response time was ~55 seconds - way too slow!

**Root Cause Found:** Keyword searches and LLM extraction were running SERIALLY instead of in parallel.

**Fix Applied:**
1. Changed keyword search loop from serial `for...await` to `Promise.all()` (all 5 searches run simultaneously)
2. Started LLM extraction at same time as keyword searches
3. LLM extraction promise awaited later when needed

**Result:** ~55s → ~22s average (50% improvement)

### Current Timing (After Parallelization)

**Real User Query Benchmarks (7 queries from production):**

| Metric | Time |
|--------|------|
| **First Response (synthesis)** | 18,501ms avg |
| **Total Complete** | 19,742ms avg |

**Step-by-Step Breakdown:**

| Step | Avg Time | Description |
|------|----------|-------------|
| equipment_search | 2,344ms | Parallel keyword searches (5 keywords) |
| equipment_extraction | 1,305ms | LLM extraction (runs in parallel with keywords) |
| Classification | 3,283ms | Python LLM call |
| Pinecone | 1,186ms | Vector search |
| **Chunk Ranking** | **3,363ms** | LLM re-ranks chunks - BOTTLENECK |
| Synthesis | 6,701ms | OpenAI generates response |
| Perplexity | 6,447ms | Web search (parallel with synthesis) |

### Remaining Bottleneck: Chunk Ranking

The `rank_chunks()` function in Python makes an LLM call to re-rank Pinecone results. This adds 3-6 seconds and **blocks synthesis from starting**.

**Evidence:**
- When chunk ranking = 0ms: First response at ~11-14s
- When chunk ranking = 5s: First response at ~22-27s

**Location:** `python-sidecar/app/chat/services/llm_service.py` line 234

**Question:** Why re-rank chunks that Pinecone already ranked by semantic similarity?

### Next Steps:
1. [ ] Consider removing chunk ranking (use Pinecone scores directly)
2. [ ] Remove debug logging before production (`KEYWORD_ADD`, `SCORE_BOOST`)

### Future Enhancement
- [ ] Equipment families/centroids data structure
- [ ] Context-aware ranking (bias toward conversation's equipment family)
- [ ] Manufacturer coherence checks

---

## Test Cases for Validation

### Test 1: Initial Query Ranking
```
Query: "i need to change the smart sensor on my marco pump"
Expected: Marco self_priming_transfer_pump ranked #1
Current: Victron ranked #1, Marco at #8
```

### Test 2: Score Accumulation
```
Marco pump should have combined score:
- keyword "marco": 0.669
- keyword "pump": 0.835
- LLM "marco pump": 1.0
- Total: 2.504 (beats Victron's 0.827)
```

### Test 3: Follow-up Query
```
Query 1: "marco pump sensor" → Marco pump found and stored
Query 2: "what tools do I need?" → Should use Marco pump from context
```

### Test 4: Equipment Family (Future)
```
Context: Marco pump discussion
Query: "how about the control box?"
Expected: Marco control box (same family)
Not: Harken control box (different family)
```

---

## Key Code Snippets for Reference

### Keyword Extraction (line 152-153)
```javascript
const searchQuery = extractKeywords(query) || query;
const keywords = searchQuery.split(/\s+/).filter(w => w.length > 2);
```

### LLM Extraction Result Format
```json
{
  "equipment": [
    {"name": "smart sensor", "confidence": 0.85, "role": "equipment"},
    {"name": "marco pump", "confidence": 0.90, "role": "equipment"}
  ]
}
```

### Equipment Context Blob Format
```json
{
  "rank": 0.827456,
  "model": "lynx_smart_bms_500",
  "manufacturer": "Victron",
  "source": "current",
  "asset_uid": "...",
  "llm_confidence": null,
  "llm_role": null
}
```

### should_infer Logic (line 410 in equipment-relationship-inference.service.js)
```javascript
should_infer: previousEquipment.length > 0
```

---

## Next Session Checklist

### Score Accumulation: COMPLETE ✅
All 6 changes implemented and verified working:
- Marco pump ranks #1 with combinedRank ~3.0
- Q2 anchor boost working
- Score accumulation visible in logs

### Parallelization: COMPLETE ✅ (2025-12-24)
- Keyword searches now run in parallel via `Promise.all()`
- LLM extraction starts at same time as keyword searches
- Result: ~55s → ~22s (50% improvement)

**Files Changed:**
| File | Changes |
|------|---------|
| `src/services/chat-proxy.service.js` | Score accumulation, anchor boost, LLM in inference path, save combinedRank, **parallel keyword searches**, **parallel LLM extraction** |
| `src/services/conversation-context.service.js` | Sort by combinedRank |
| `src/utils/logger.js` | Fixed metadata truncation |

**Debug Logging Added (remove before production):**
- `🔑 [KEYWORD_ADD]` - logs each keyword result with rank/combinedRank
- `📈 [SCORE_BOOST]` - logs when LLM adds to existing equipment score

### Next Priority: Chunk Ranking Bottleneck

**Current Problem:** First response at ~18s, should be <10s

**Root Cause:** `rank_chunks()` in Python makes an LLM call (3-6s) to re-rank Pinecone results. This blocks synthesis from starting.

**Evidence from real user queries:**
- When chunk ranking = 0ms: First response at ~11-14s
- When chunk ranking = 5s: First response at ~22-27s

**Proposed Fix:** Remove chunk ranking - trust Pinecone's semantic similarity scores.

**Location:** `python-sidecar/app/chat/services/llm_service.py` line 234

### Streaming Status: WORKING ✅
SSE streaming is working correctly:
- `synthesis` event arrives with full response
- `perplexity` event arrives with web search content
- `done` event arrives with timing metrics

**NOT character streaming** - this is event-based SSE, not OpenAI token streaming.

### Real User Query Benchmarks (7 queries)

| Query | First Response | Chunk Ranking |
|-------|---------------|---------------|
| electronic pressure control heads | 22.5s | 5,118ms |
| control heads on Marco pumps | 27.1s | 4,585ms |
| impeller on yanmar engines | 23.5s | 5,339ms |
| VHF distress signal | **11.5s** | **0ms** |
| smartsheet charge time | 15.1s | 2,765ms |
| max RPM for 4JH57 | 15.5s | 5,735ms |
| rig tension catamaran | **14.4s** | **0ms** |

**Pattern:** Queries with 0ms chunk ranking are 2x faster.

---

**Last Updated:** 2025-12-24
**Status:** Score accumulation + Parallelization COMPLETE, Chunk ranking bottleneck IDENTIFIED
