# Session 24: Pinecone Deduplication Implementation and Multi-Pass Testing

**Date:** 2025-10-20
**Duration:** ~6 hours
**Status:** ⚠️ In Progress - Deduplication working but needs refinement

---

## 🎯 Session Goals

Continuing from Session 23, implement and test Pinecone-based semantic deduplication for maintenance tasks to replace the word-overlap approach.

**Target:** Deduplicate 68 extracted maintenance tasks using embeddings + Pinecone vector search

---

## 📊 Executive Summary

### What We Accomplished
- ✅ Fixed database schema (added `confidence` column with default 0.2)
- ✅ Implemented Pinecone embedding-based deduplication service
- ✅ Created comprehensive multi-pass testing framework with full audit logging
- ✅ Discovered and fixed critical bugs in task type filtering and frequency normalization
- ✅ Proved deduplication works: **60 unique tasks, 8 duplicates** (11.8% reduction)

### Critical Discovery
**The deduplication is TOO CONSERVATIVE** - only finding 8 duplicates out of 68 tasks when manual analysis shows there should be ~15-20 duplicates.

**Root Cause:** Strict compound logic requires BOTH high similarity (≥80%) AND matching frequency (within 10%). Tasks with different frequency types (e.g., "50 hours" vs "condition_based") never match, even at 95%+ similarity.

---

## 🏗️ Architecture Implementation

### Files Created

#### 1. **Production Service: `src/services/task-embedding.service.js`** (424 lines)
Core deduplication logic using OpenAI embeddings + Pinecone.

**Key Functions:**
```javascript
// Classify task into types (fluid_check, filter_replacement, etc.)
export function classifyTaskType(description)

// Normalize all frequencies to hours for comparison
export function normalizeFrequencyToHours(task)

// Check if two frequencies are similar (10% tolerance)
export function areFrequenciesSimilar(freq1Hours, freq2Hours)

// Generate OpenAI embedding for task description
export async function generateTaskEmbedding(description)

// Find similar tasks in Pinecone MAINTENANCE_TASKS namespace
export async function findSimilarTasks(embedding, task, options = {})

// Main deduplication logic: check if task is duplicate
export async function checkForDuplicates(task, embedding, options = {})

// Add task to Pinecone with metadata
export async function addTaskToPinecone(task, embedding)

// Merge duplicate into primary task
export async function mergeDuplicateTask(primaryTaskId, duplicateTask, similarity)

// Batch process tasks with deduplication
export async function processTasks(tasks, options = {})
```

**Deduplication Decision Logic:**
```javascript
// Current thresholds:
autoMergeThreshold: 0.92      // ≥92% similarity + freq match → auto-merge
reviewThreshold: 0.85          // ≥85% similarity → flag for review
compoundReviewThreshold: 0.80  // ≥80% similarity + freq match → flag for review

// Decision tree:
if (similarity >= 0.92 && frequenciesMatch) {
  return 'auto_merge';  // High confidence duplicate
}

if (similarity >= 0.85 || (similarity >= 0.80 && frequenciesMatch)) {
  return 'review_required';  // Moderate confidence - needs human review
}

return 'insert';  // Unique task
```

#### 2. **Pinecone Repository Extensions: `src/repositories/pinecone.repository.js`**
Added MAINTENANCE_TASKS namespace methods (lines 180-336):

```javascript
// Query tasks for similarity search
async queryTasks(queryVector, filter = {}, topK = 5)

// Upsert (insert/update) task
async upsertTask(taskId, embedding, metadata)

// Update metadata without re-embedding
async updateTaskMetadata(taskId, metadata)

// Get task by ID
async getTaskById(taskId)

// Delete task
async deleteTask(taskId)

// Get namespace statistics
async getTasksNamespaceStats()
```

#### 3. **Import Script: `scripts/import-extracted-tasks.js`** (200 lines)
Rewritten to use Pinecone deduplication instead of MD5 hashing.

**Flow:**
1. Load tasks from `extracted_tasks_2025-10-19.json`
2. For each task:
   - Classify task type
   - Generate embedding
   - Query Pinecone for duplicates
   - Write to Supabase + Pinecone (if unique) or flag for review

#### 4. **Multi-Pass Test Script: `scripts/test-multipass-deduplication.js`** (370 lines)
Comprehensive testing framework with audit logging.

**What It Does:**
- **Pass 1:** Process all 68 tasks, insert unique ones to Pinecone
- **Pass 2:** Re-check duplicates to test convergence
- **Full audit trail:** JSON log of every decision
- **Duplicate groups:** Shows which tasks matched which

**Sample Output:**
```
PASS 1 RESULTS:
  Inserted: 60
  Duplicates: 8

PASS 2 RESULTS:
  Now unique: 0
  Still duplicates: 8
  Status changes: 0

✅ CONVERGED: No status changes in Pass 2
```

#### 5. **Utility Scripts:**
- `scripts/analyze-deduplication.js` - Dry-run in-memory simulation
- `scripts/diagnose-missed-duplicates.js` - Debug why duplicates weren't found
- `scripts/test-single-match.js` - Test individual task pair matching
- `scripts/check-pinecone-index.js` - Verify Pinecone configuration
- `scripts/clear-pinecone-namespace.js` - Clean MAINTENANCE_TASKS namespace

---

## 🐛 Critical Bugs Discovered and Fixed

### Bug 1: Task Type Filter Blocking Matches
**Issue:** Pinecone queries filtered by `asset_uid` AND `task_type`, but task type classification is AI-based and inconsistent.

**Example:**
- "Clean cooling water" → Sometimes "condition_based", sometimes "cleaning"
- Same description gets different types, so they never match!

**Impact:** Prevented ~50% of duplicates from being found

**Fix:** Removed `task_type` from Pinecone query filter
```javascript
// BEFORE (broken):
const filter = {
  asset_uid: { $eq: task.asset_uid },
  task_type: { $eq: task.task_type }  // ❌ AI-assigned, inconsistent
};

// AFTER (fixed):
const filter = {
  asset_uid: { $eq: task.asset_uid }  // ✅ Only objective filter
};
// task_type still used in decision logic, just not as a query filter
```

**Files Changed:**
- `src/services/task-embedding.service.js:140-147`
- `scripts/test-multipass-deduplication.js:35-40`

---

### Bug 2: Task Type Required in Compound Logic
**Issue:** Even after removing from query filter, task type was still REQUIRED in the compound matching logic.

```javascript
// BEFORE (broken):
const taskTypeMatches = task.task_type &&
                        task.task_type !== 'unknown' &&
                        task.task_type === bestMatch.metadata.task_type;

const compoundMatch = bestMatch.score >= 0.80 &&
                      frequenciesMatch &&
                      taskTypeMatches;  // ❌ Fails if type is null/unknown

// Tasks with null task_type never matched, even at 98% similarity!
```

**Impact:** "Inspect and replace anode" tasks had 98% similarity but were inserted as separate because task_type was null

**Fix:** Removed task type from compound logic entirely
```javascript
// AFTER (fixed):
const compoundMatch = bestMatch.score >= 0.80 && frequenciesMatch;
// Only checks similarity + frequency
```

**Files Changed:**
- `src/services/task-embedding.service.js:213-243`
- `scripts/test-multipass-deduplication.js:69-73`

---

### Bug 3: Condition-Based Frequency Returns Null
**Issue:** `normalizeFrequencyToHours()` checked if `frequency_value === null` BEFORE handling `condition_based` type.

```javascript
// BEFORE (broken):
export function normalizeFrequencyToHours(task) {
  if (!task.frequency_type || task.frequency_value === null) {
    return null;  // ❌ Returns null for condition_based (which has null value)
  }

  switch (task.frequency_type) {
    case 'condition_based':
      return 999999;  // Never reached!
    // ...
  }
}
```

**Impact:** All condition_based tasks (anode, cooling water, lubrication) had `null` frequency, so `areFrequenciesSimilar(null, null)` returned `false`.

**Result:** **5 duplicates missed!**

**Fix:** Handle `condition_based` FIRST, before null check
```javascript
// AFTER (fixed):
export function normalizeFrequencyToHours(task) {
  if (!task.frequency_type) {
    return null;
  }

  // Handle condition_based FIRST (frequency_value is null for these)
  if (task.frequency_type === 'condition_based') {
    return 999999;  // ✅ Special value for condition-based
  }

  // For all other types, frequency_value is required
  if (task.frequency_value === null) {
    return null;
  }

  switch (task.frequency_type) {
    case 'hours': return task.frequency_value;
    case 'days': return task.frequency_value * 24;
    case 'months': return task.frequency_value * 30 * 24;
    case 'years': return task.frequency_value * 365 * 24;
    default: return null;
  }
}
```

**Files Changed:**
- `src/services/task-embedding.service.js:50-77`

**Test Verification:**
```
BEFORE FIX:
  Frequency: condition_based, null
  Normalized: null hours ❌
  Frequency match: false

AFTER FIX:
  Frequency: condition_based, null
  Normalized: 999999 hours ✅
  Frequency match: true
```

---

### Bug 4: Pinecone Metadata Null Values
**Issue:** Pinecone doesn't allow `null` in metadata. Tasks with `frequency_hours: null` failed to insert.

**Impact:** 29 out of 68 tasks failed during first test run

**Fix:** Use `-1` as sentinel value for unknown/null frequencies
```javascript
const metadata = {
  task_id: taskId,
  description: task.description.substring(0, 500),
  asset_uid: task.asset_uid,
  system_name: task.system_name,
  frequency_hours: frequencyHours !== null ? frequencyHours : -1,  // ✅ Use -1 for unknown
  frequency_type: task.frequency_type || 'unknown',
  frequency_value: task.frequency_value !== null ? task.frequency_value : -1,
  // ...
};
```

**Files Changed:**
- `src/services/task-embedding.service.js:282-306`
- `scripts/test-multipass-deduplication.js:171-188, 265-276`

---

## 📈 Test Results

### Final Test Run (After All Fixes)

**Command:**
```bash
node scripts/clear-pinecone-namespace.js
node scripts/test-multipass-deduplication.js
```

**Results:**
```
PASS 1:
  Inserted: 60
  Duplicates: 8

PASS 2:
  New inserts: 0
  Still duplicates: 8
  Status changes: 0

FINAL SUMMARY:
  Total tasks: 68
  Unique tasks: 60 (88.2%)
  Duplicates: 8 (11.8%)

✅ CONVERGED: No status changes in Pass 2
```

**8 Duplicates Found:**
1. ✅ Inspect and replace anode (2 tasks, 98% similarity, condition_based)
2. ✅ Check oil level (2 tasks, 83.4% similarity, 50 hours)
3. ✅ Clean cooling water suction hole (2 tasks, condition_based)
4. ✅ Lubricate propeller shaft (2 tasks, condition_based)
5. ✅ Replace flexible mount (2 tasks, 84% similarity, 7 years)
6. ✅ Check Marine Gear oil level (2 tasks, 80.2% similarity, 1 day)
7. ✅ Replace fuel filter (2 tasks, condition_based)

**Audit Log Saved:** `test-results-1760985767037.json`

---

## ⚠️ Current Problems

### Problem 1: Too Conservative - Missing Obvious Duplicates

**Manual Analysis Found These Duplicates:**

**Group: "Change lubricating oil"** (NOT CAUGHT)
- Task 1: "Change lubricating oil for the first time" - 50 hours
- Task 8: "Change lubricating oil for the first time" - condition_based
- Task 34: "Change lubricating oil for the first time" - 1 month

**Expected:** 95%+ similarity
**Why not caught:** Frequencies don't match (50 hours ≠ condition_based ≠ 1 month)

**Group: "Replace Engine/Marine Gear oil filter"** (NOT CAUGHT)
- Task 55: "Replace the Engine oil filter element" - 50 hours
- Task 56: "Replace the Marine Gear oil filter element" - 50 hours
- Task 58: "Changing the Engine Oil and Replacing the Engine Oil Filter Element" - condition_based
- Task 59: "Changing the Marine Gear Oil and Replacing Marine Gear Oil Filter Element" - condition_based

**Expected:** Should cluster into 2 groups (Engine vs Marine Gear)
**Why not caught:** Different frequencies OR different descriptions (Engine vs Marine Gear)

---

### Problem 2: Frequency Matching is Too Strict

**Current Logic:**
```javascript
// 10% tolerance
const diff = Math.abs(freq1Hours - freq2Hours);
const avg = (freq1Hours + freq2Hours) / 2;
return diff / avg <= 0.1;  // Must be within 10%
```

**Issues:**
1. **50 hours vs 55 hours** = 10% difference → **FAIL** (just barely)
2. **50 hours vs 1 month (720 hours)** = 1340% difference → **FAIL**
3. **Different frequency types never match**, even if semantically identical

**Example:**
- "Change oil every 50 hours"
- "Change oil every 2 months" (1440 hours)
- Same task, different frequencies from different manuals → treated as separate

---

## 🔍 Diagnostic Analysis

### What We Learned from `diagnose-missed-duplicates.js`

**Pattern Analysis:**
- **"oil"**: 14 tasks (should cluster into ~7-8 groups)
- **"check"**: 19 tasks (should cluster into ~10-12 groups)
- **"replace"**: 16 tasks (should cluster into ~8-10 groups)
- **"inspect"**: 12 tasks (should cluster into ~6-8 groups)
- **"clean"**: 7 tasks (should cluster into ~3-4 groups)
- **"filter"**: 6 tasks (should cluster into ~3 groups)

**Current clustering:** 60 unique tasks
**Expected clustering:** 40-50 unique tasks (based on manual pattern analysis)

**Conclusion:** We're missing ~10-20 duplicates due to frequency strictness

---

## 🎛️ Configuration & Thresholds

### Current Settings

**Similarity Thresholds:**
```javascript
autoMergeThreshold: 0.92      // 92% similarity + freq match → auto-merge
reviewThreshold: 0.85          // 85% similarity → flag for review
compoundReviewThreshold: 0.80  // 80% similarity + freq match → flag for review
```

**Frequency Tolerance:**
```javascript
tolerance: 10%  // Frequencies must be within 10% of each other
```

**Pinecone Query:**
```javascript
filter: { asset_uid: { $eq: task.asset_uid } }  // Same system only
topK: 5  // Return top 5 most similar tasks
```

**Embedding Model:**
```javascript
model: 'text-embedding-3-large'
dimensions: 3072
```

**Pinecone Index:**
```
Metric: cosine
Dimensions: 3072
Type: Serverless
Cloud: AWS us-east-1
```

---

## 📋 Database Schema Changes

**Table:** `maintenance_tasks_queue`

**Columns Added:**
```sql
-- Pinecone integration
pinecone_task_id TEXT
embedding_generated BOOLEAN DEFAULT false

-- Deduplication tracking
merge_count INTEGER DEFAULT 0
canonical_task_id UUID REFERENCES maintenance_tasks_queue(id)

-- Duplicate review workflow
duplicate_of UUID REFERENCES maintenance_tasks_queue(id)
similarity_score DECIMAL(4,3)
duplicate_status TEXT DEFAULT 'not_checked'  -- 'unique' | 'needs_review' | 'duplicate'

-- Task classification
task_type TEXT  -- fluid_check, filter_replacement, etc.
task_category TEXT  -- maintenance, inspection, etc.
```

**Columns Renamed:**
```sql
task_description → description
confidence_score → confidence (default 0.2)
```

**Indexes Created:**
```sql
CREATE INDEX idx_tasks_pinecone_id ON maintenance_tasks_queue(pinecone_task_id);
CREATE INDEX idx_tasks_canonical ON maintenance_tasks_queue(canonical_task_id);
CREATE INDEX idx_tasks_duplicate_status ON maintenance_tasks_queue(duplicate_status);
CREATE INDEX idx_tasks_type ON maintenance_tasks_queue(task_type);
CREATE INDEX idx_tasks_embedding_gen ON maintenance_tasks_queue(embedding_generated);
```

---

## 🚀 Next Steps (CRITICAL - Must Do Before Moving Forward)

### Immediate Priorities

#### 1. **Fix Frequency Matching Logic** ⚠️ BLOCKING
The current 10% tolerance is too strict and blocks obvious duplicates.

**Recommended Approach:**
```javascript
// Option A: Tiered frequency tolerance based on similarity
if (similarity >= 0.90) {
  // High similarity → ignore frequency differences
  return 'review_required';
}

if (similarity >= 0.80 && frequenciesMatch) {
  // Moderate similarity → require frequency match
  return 'review_required';
}

// Option B: Wider tolerance for different frequency types
function areFrequenciesSimilar(freq1, freq2) {
  // ... existing logic ...

  // Special case: Different frequency types but both reasonable
  // e.g., 50 hours vs 1 month (720 hours) = same order of magnitude
  const ratio = Math.max(freq1, freq2) / Math.min(freq1, freq2);
  if (ratio <= 20) {  // Within 20x of each other
    return true;  // Consider them "similar enough" for review
  }

  return false;
}
```

**Action Items:**
- [ ] Decide on frequency matching strategy (discuss with user)
- [ ] Update `areFrequenciesSimilar()` function
- [ ] Update `checkForDuplicates()` decision logic
- [ ] Re-run multi-pass test
- [ ] Target: 15-25 duplicates found (20-35% reduction)

---

#### 2. **Build Duplicate Review UI**
Currently, suspected duplicates are flagged in the database but there's no UI to review them.

**Required Features:**
- View tasks flagged with `duplicate_status = 'needs_review'`
- Side-by-side comparison:
  - Task descriptions
  - Frequencies
  - Systems
  - Similarity scores
  - Source documents
- Actions:
  - **Merge** → Set `canonical_task_id`, `duplicate_status = 'duplicate'`
  - **Keep Separate** → Set `duplicate_status = 'unique'`

**API Endpoints Needed:**
```javascript
GET  /admin/api/maintenance/duplicates
     // Returns tasks needing review

POST /admin/api/maintenance/duplicates/:id/merge
     // Confirm duplicate, link to canonical task

POST /admin/api/maintenance/duplicates/:id/keep-separate
     // Mark as unique despite similarity
```

**Files to Create:**
- `src/routes/admin/maintenance.route.js` (extend existing with duplicate endpoints)
- `src/public/maintenance-review.html` (add "Duplicates" tab)
- `src/public/js/maintenance-review.js` (add duplicate review UI)

---

#### 3. **Integrate with Extraction Service**
Currently, deduplication only works in test scripts. Need to integrate with production extraction.

**File to Update:** `src/services/extraction.service.js`

**Changes Needed:**
```javascript
import { taskEmbeddingService } from './task-embedding.service.js';

// After extracting tasks from PDFs:
const extractedTasks = await extractTasksFromChunks(chunks);

// Add deduplication:
const results = await taskEmbeddingService.processTasks(extractedTasks, {
  autoMerge: false,  // Don't auto-merge, flag for review
  dryRun: false      // Actually write to DB + Pinecone
});

// Log results:
logger.info('Extraction complete', {
  extracted: extractedTasks.length,
  unique: results.inserted,
  duplicates: results.needsReview,
  autoMerged: results.autoMerged
});
```

---

#### 4. **Test with Larger Dataset**
Currently tested with 68 tasks. Need to validate with more data.

**Action Items:**
- [ ] Extract tasks from additional chunks (0.40+ relevance → ~100 more tasks)
- [ ] Run multi-pass deduplication test
- [ ] Analyze convergence and accuracy
- [ ] Adjust thresholds if needed

---

### Secondary Priorities

#### 5. **Optimize OpenAI Rate Limiting**
Currently hitting 50 embeddings/minute limit, causing 2-3 minute delays.

**Options:**
- Request higher rate limit from OpenAI
- Batch embedding requests (OpenAI supports up to 2048 inputs per call)
- Cache embeddings for identical descriptions

**File:** `src/repositories/openai.repository.js`

---

#### 6. **Add Metrics & Monitoring**
Track deduplication performance over time.

**Metrics to Track:**
- Duplicate rate per extraction run
- Similarity score distribution
- Frequency match rate
- Auto-merge vs review-required ratio
- User decisions (merge vs keep separate)

---

#### 7. **Consider Multi-Pass Deduplication in Production**
Test showed Pass 2 found no new duplicates, but this was with only 68 tasks.

**Question:** With 200+ tasks, would Pass 2 find transitive duplicates?

**Action:** Test with larger dataset first

---

## 📚 Key Learnings

### 1. AI-Assigned Metadata is Unreliable
Task type classification is subjective and inconsistent. Same description can get different types depending on subtle wording differences. **Never use AI-assigned values as hard filters.**

**Lesson:** Use AI metadata as **signals** (helps make decisions), not **gates** (blocks matches).

---

### 2. Compound Logic Needs Flexibility
Requiring ALL conditions (similarity + frequency + type) is too strict. **At least one should be optional.**

**Better approach:**
- High similarity (≥90%) → Don't require frequency match
- Moderate similarity (80-89%) → Require frequency match
- Low similarity (<80%) → Reject

---

### 3. Edge Case Handling is Critical
The `condition_based` frequency bug blocked 5 duplicates (62% of found duplicates!). **Always test edge cases:**
- Null values
- Special types (condition_based)
- Different frequency units
- Empty strings

---

### 4. Multi-Pass Testing Reveals Bugs
In-memory simulation worked fine (found 9 duplicates), but real Pinecone test found only 2-3. **Always test with real infrastructure:**
- Indexing delays
- Metadata limitations
- Query filtering behavior

---

### 5. Audit Logging is Essential
Without full audit trail (`test-results-*.json`), we couldn't have diagnosed bugs. **Always log:**
- Every decision made
- Input values
- Intermediate calculations
- Final outcomes

---

## 🗂️ File Inventory

### Production Code (maintenance-agent/)

**Services:**
- `src/services/task-embedding.service.js` (424 lines) - Core deduplication logic
- `src/services/task-deduplication-wordoverlap-reference.js` (archived) - Old word-overlap approach

**Repositories:**
- `src/repositories/pinecone.repository.js` (lines 180-336) - MAINTENANCE_TASKS namespace methods
- `src/repositories/openai.repository.js` (unchanged) - Embedding generation

**Scripts:**
- `scripts/import-extracted-tasks.js` (200 lines) - Production import with deduplication
- `scripts/test-multipass-deduplication.js` (370 lines) - Multi-pass testing framework
- `scripts/analyze-deduplication.js` (300 lines) - Dry-run in-memory simulation
- `scripts/diagnose-missed-duplicates.js` (130 lines) - Debug missed duplicates
- `scripts/test-single-match.js` (80 lines) - Test individual task pairs
- `scripts/check-pinecone-index.js` (40 lines) - Verify Pinecone config
- `scripts/clear-pinecone-namespace.js` (20 lines) - Clean namespace

### Main App (REIMAGINEDAPPV2/)

**Routes:**
- `src/routes/admin/maintenance.route.js` (220 lines) - Task review API
- `src/routes/admin/index.js` (modified) - Registered maintenance routes

**Frontend:**
- `src/public/maintenance-review.html` (436 lines) - Review UI
- `src/public/js/maintenance-review.js` (350 lines) - Frontend logic

### Documentation
- `/code updates/23 Maintenance Review UI and Pinecone Deduplication Architecture.md` (Session 23)
- `/code updates/24 Pinecone Deduplication Implementation and Multi-Pass Testing.md` (This document)

---

## 🧪 How to Test

### Run Full Multi-Pass Test

```bash
cd /Users/brad/code/REIMAGINEDAPPV2/maintenance-agent

# Clear Pinecone namespace
node scripts/clear-pinecone-namespace.js

# Run multi-pass test
node scripts/test-multipass-deduplication.js

# Check results
ls -lt test-results-*.json | head -1 | xargs cat | jq '{total: .totalTasks, unique: .finalStats.uniqueTasks, duplicates: .finalStats.duplicates}'
```

### Test Single Task Match

```bash
node scripts/test-single-match.js
```

Shows embedding similarity and frequency comparison for anode tasks.

### Dry-Run Analysis (In-Memory)

```bash
node scripts/analyze-deduplication.js
```

Simulates deduplication without writing to Pinecone (faster for testing).

### Check Pinecone Health

```bash
node scripts/check-pinecone-index.js
```

Verifies index configuration and namespace vector counts.

---

## 💾 Data Files

**Task Data:**
- `extracted_tasks_2025-10-19.json` (68 tasks from Session 22)

**Test Results:**
- `test-results-1760983938224.json` (First run - task_type filter bug)
- `test-results-1760984020550.json` (Second run - still had bugs)
- `test-results-1760984583429.json` (Third run - filter removed, frequency bug)
- `test-results-1760984994215.json` (Fourth run - frequency still broken)
- `test-results-1760985767037.json` (Final run - all fixes applied) ✅

**Audit Log Schema:**
```json
{
  "testStarted": "2025-10-20T...",
  "threshold": 0.80,
  "totalTasks": 68,
  "passes": [
    {
      "passNumber": 1,
      "tasksProcessed": 68,
      "inserted": 60,
      "duplicates": 8,
      "decisions": [
        {
          "taskIndex": 4,
          "description": "...",
          "system": "Stbd Sail Drive",
          "frequency": "null condition_based",
          "taskType": "parts_replacement",
          "action": "insert",
          "pineconeId": "task-4-1760985987946",
          "result": "inserted"
        }
      ]
    }
  ],
  "finalStats": {
    "uniqueTasks": 60,
    "duplicates": 8,
    "reductionPercent": "11.8"
  },
  "testCompleted": "2025-10-20T..."
}
```

---

## 🎓 Technical Deep Dive

### Embedding Generation

**Model:** OpenAI `text-embedding-3-large`
**Dimensions:** 3072
**Input:** Task description text only (no metadata)

```javascript
const response = await openai.embeddings.create({
  model: 'text-embedding-3-large',
  input: "Check oil level and top up if necessary",
  dimensions: 3072
});

// Returns: [0.023, -0.145, 0.891, ...] (3072 numbers)
```

**Cost:** $0.00013 per 1K tokens (~$0.000013 per task)

**Rate Limit:** 50 requests/minute (free tier)

---

### Similarity Calculation

**Method:** Cosine similarity (Pinecone default)

```javascript
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

**Range:** 0.0 to 1.0 (0% to 100% similarity)

**Observed Results:**
- Identical text: 98-100%
- Nearly identical ("boat lifting" vs "lifting the boat"): 95-98%
- Same task, different wording: 80-90%
- Related tasks: 60-80%
- Unrelated tasks: <60%

---

### Frequency Normalization

All frequencies converted to hours for comparison:

| Frequency Type | Formula | Example |
|---------------|---------|---------|
| hours | value | 50 hours → 50 |
| days | value × 24 | 1 day → 24 |
| months | value × 30 × 24 | 1 month → 720 |
| years | value × 365 × 24 | 1 year → 8760 |
| condition_based | 999999 | "during boat lifting" → 999999 |

**Tolerance:** 10% of average
```javascript
const diff = Math.abs(freq1 - freq2);
const avg = (freq1 + freq2) / 2;
return diff / avg <= 0.1;
```

**Examples:**
- 50 hours vs 55 hours: (5 / 52.5) = 9.5% ✅ MATCH
- 50 hours vs 56 hours: (6 / 53) = 11.3% ❌ NO MATCH
- 1 day vs 1.1 days: (2.4 / 25.2) = 9.5% ✅ MATCH
- condition_based vs condition_based: EXACT ✅ MATCH

---

## 🚨 Known Issues

### Issue 1: Frequency Matching Too Strict
**Priority:** HIGH ⚠️

Many obvious duplicates have different frequencies from different manuals. Current 10% tolerance is too strict.

**Impact:** Missing ~10-15 duplicates

**Solution:** See Next Steps #1

---

### Issue 2: No Multi-System Deduplication
**Priority:** MEDIUM

Currently only searches within same `asset_uid` (same boat system). Some tasks apply to multiple systems.

**Example:**
- "Check oil level" appears in Port Engine, Stbd Engine, Port Sail Drive, Stbd Sail Drive
- These are legitimately separate tasks (different systems)
- BUT they share the same task logic

**Question:** Should we have "task templates" that span systems?

**Solution:** TBD - needs discussion

---

### Issue 3: No Deduplication Across Boats
**Priority:** LOW

Each boat has separate tasks. No way to share maintenance schedules across boats with same equipment.

**Example:**
- Boat A has "Yanmar 57hp Engine" with maintenance schedule
- Boat B also has "Yanmar 57hp Engine"
- Currently, we extract tasks separately for each

**Potential:** Use equipment model as deduplication key, not asset_uid

**Solution:** Future enhancement

---

### Issue 4: OpenAI Rate Limit Delays
**Priority:** LOW

50 embeddings/minute limit causes 2-3 minute delays for 68 tasks.

**Impact:** Slow testing cycles

**Solution:** Batch requests or request rate limit increase

---

## 🔗 Dependencies

**Node Packages:**
- `@pinecone-database/pinecone` (v2.0.0+)
- `openai` (v4.0.0+)
- `@supabase/supabase-js`

**External Services:**
- **OpenAI:** Embedding generation (text-embedding-3-large)
- **Pinecone:** Vector storage and similarity search (Serverless, AWS us-east-1)
- **Supabase:** PostgreSQL database (source of truth)

**Pinecone Index:**
- Name: `reimaginedsv`
- Namespaces: `REIMAGINEDDOCS` (document chunks), `MAINTENANCE_TASKS` (extracted tasks)
- Metric: cosine
- Dimensions: 3072

---

## 📞 Session Context for Next Time

### Where We Left Off
- Deduplication is working but too conservative
- Found 8 duplicates out of 68 tasks (should be ~15-25)
- Root cause: Frequency matching too strict (10% tolerance)
- Need to decide on relaxed frequency logic

### Questions to Answer
1. **How should we handle different frequency types?**
   - Same task, different frequencies (50 hours vs 1 month)
   - Should they match? At what similarity threshold?

2. **Should we remove frequency requirement for very high similarity?**
   - If 95% similar, ignore frequency differences?

3. **What's the target duplicate rate?**
   - Currently: 11.8% (8/68)
   - Expected: 20-35% (15-25/68)

### Immediate Next Action
**Discuss and implement frequency matching strategy**, then re-run multi-pass test.

---

## 🏁 Success Criteria (For Next Session)

- [ ] Frequency matching logic updated
- [ ] Multi-pass test finds 15-25 duplicates (not 8)
- [ ] Duplicate review UI built and functional
- [ ] Production import script tested with deduplication enabled
- [ ] Extract and deduplicate larger dataset (200+ tasks)
- [ ] Document final thresholds and parameters

---

**End of Session 24 Documentation**
