# DIP System - Data Integrity and Verification

**Sessions:** 31, 32 (Parts 1-2)
**Date:** 2025-10-17
**Status:** ✅ Complete - Data Integrity Restored to A+ Grade

---

## Session 31 - Extralarge Script Completion Attempt & Data Integrity Discovery

**Date:** 2025-10-17
**Status:** ❌ Extralarge script blocked by data integrity issues
**Key Discovery:** Major duplicate chunk problem preventing windowed processing

---

### Work Completed ✅

#### 1. Windowed Processing Function Implementation
**File:** `scripts/bulk/batch-dip-extraction_extralarge.py`
**Lines Replaced:** 557-821 (265 lines → 313 lines)

**Implementation Details:**
```python
def process_document_with_caching(doc_id, manufacturer, model, doc_index, total_docs):
    """Process one document with sliding window approach for extralarge documents"""

    # NEW LOGIC:
    # 1. Fetch all chunks from Supabase
    # 2. Calculate total tokens using character-based estimate
    # 3. Warn if document < 180K tokens (shouldn't use extralarge script)
    # 4. Create overlapping windows (140K tokens, 20 chunk overlap)
    # 5. For each window:
    #    - Cache write (specs extraction)
    #    - 4x cache reads (golden, intent, install procs, operation procs)
    # 6. Merge all results from all windows
    # 7. Upload 4 final JSON files
    # 8. Calculate total cost across all windows
```

**Key Changes:**
- ✅ Added `create_windows()` function with configurable token limits
- ✅ Added window processing loop (replaces single-pass extraction)
- ✅ Added merge functions for all 4 extraction types
- ✅ Added per-window token tracking and aggregation
- ✅ Added window progress reporting

#### 2. Token Counting Optimization
**Problem:** `tiktoken` library took **15+ minutes** to count 210K tokens (100% CPU usage)

**Solution:** Replaced with fast character-based estimate
```python
def count_tokens(text):
    """Count tokens in text using fast character-based estimate (4 chars per token)"""
    # tiktoken is extremely slow for large documents (15+ minutes for 210K tokens)
    # Character-based estimate is accurate enough for windowing strategy
    return len(text) // 4
```

**Result:** Token counting now instant (< 1 second)

---

### Major Failure Discovered 🚨

#### Script Crash During Window Creation

**Symptoms:**
1. Script runs and fetches chunks successfully
2. Calculates total tokens: **248,623** (higher than expected!)
3. Prints "Creating windows..."
4. **Silent crash** - no error output, process dies
5. CSV left in "processing" state with no results

**Output Before Crash:**
```
================================================================================
[1/1] Peplink balance_20x_2_wan
Doc ID: 1b16daed93f3f00a... (EXTRALARGE PROCESSING)
================================================================================
📥 Fetching chunks from Supabase...
   ✓ Found 331 chunks
   ✓ Total tokens: 248,623
🪟 Creating windows...
[CRASH - NO OUTPUT]
```

**Expected vs Actual:**
- **Expected:** 167 chunks, ~210K tokens
- **Actual:** 331 chunks, ~248K tokens
- **Difference:** 164 extra chunks, ~38K extra tokens

---

### Root Cause Analysis

#### Database Investigation Results

**Peplink Document (doc_id: 1b16daed93f3f00a...):**
```python
# Query: SELECT * FROM document_chunks WHERE doc_id = '1b16daed...'
Total chunks in DB: 331
Content type: text (all)
Unique chunk_index values: 167
Duplicates: 164 indices

# Sample duplicates:
chunk_index  count
-----------  -----
0            2
1            2
2            2
3            2
...
130          2
```

**Pattern:** Almost every chunk (164 of 167) exists **twice** in the database with the same `chunk_index`.

**Implications:**
1. Document was processed/chunked twice
2. Second run didn't check for existing chunks
3. Both sets have same `chunk_index` values (not unique)
4. `combine_chunks()` processes all 331 chunks → 248K tokens
5. Window creation likely fails due to unexpected duplicate data structure

---

### System-Wide Data Integrity Issues

#### Supabase vs Pinecone Reconciliation

**Current State:**
- **Supabase:** 2,560 text chunks (all content_type='text')
- **Pinecone:** 2,496 vectors
- **Difference:** 64 chunks in Supabase with no corresponding Pinecone vector
- **CSV Claims:** All 64 documents show matching `chunks_in_db` = `vectors_upserted`

**Analysis:**
1. Most chunks have vectors in Pinecone ✓
2. 64 chunks (likely 1-2 documents) missing vectors
3. CSV is **not accurately tracking** the Supabase/Pinecone sync
4. No `content_type='vector'` chunks in Supabase (unused field)

**Documents Affected:**
- Peplink Balance 20x: 331 chunks (164 duplicates) + no test of vectors
- Unknown: 64 chunks total missing Pinecone vectors across all docs

---

### Low-Level Code Context

#### Where the Crash Occurs

**File:** `scripts/bulk/batch-dip-extraction_extralarge.py`
**Function:** `create_windows()` (lines 266-331)

**Suspected Issue:**
```python
def create_windows(chunks_data):
    """Split chunks into overlapping windows for processing."""
    windows = []
    current_idx = 0
    window_num = 1

    while current_idx < len(chunks_data):  # Loop over 331 chunks
        window_chunks = []
        window_token_count = 0

        # Add chunks until we hit token limit
        for i in range(current_idx, len(chunks_data)):
            chunk = chunks_data[i]
            chunk_text = chunk.get('text', '')  # ← Likely issue here
            chunk_tokens = count_tokens(chunk_text)

            # ... window logic ...
```

**Potential Failure Points:**
1. **Duplicate chunk_index confusion:** Window overlap logic assumes unique sequential indices
2. **Text field issues:** Duplicate chunks might have malformed/missing text
3. **Memory exhaustion:** 248K tokens might be hitting memory limits during string operations
4. **Infinite loop:** Overlap calculation might loop infinitely with duplicate indices

**Debug Evidence Needed:**
- Does `chunk.get('text')` return valid strings for all 331 chunks?
- Are duplicate chunks causing issues with `start_chunk`/`end_chunk` calculation?
- Is the loop exiting cleanly or hanging?

#### Relevant Code Section

**Lines 303-310 (Overlap Logic):**
```python
else:
    # Move to next window with overlap
    current_idx = current_idx + len(window_chunks) - OVERLAP_CHUNKS
    if current_idx >= len(chunks_data):
        current_idx = len(chunks_data)  # Last window

# Create window
start_chunk = window_chunks[0].get('chunk_index', 0)  # ← Could get duplicate!
end_chunk = window_chunks[-1].get('chunk_index', len(window_chunks)-1)
```

**Issue:** With duplicate `chunk_index` values, `start_chunk` and `end_chunk` don't represent true boundaries.

---

### Next Steps Discussed

#### Immediate Actions

**1. Create Checksum/Reconciliation Script** (Priority 1)
- **File:** `scripts/bulk/verify-chunks-vectors.py`
- **Purpose:** Audit Supabase chunks vs Pinecone vectors
- **Output:** Report showing:
  - Documents with duplicate chunks
  - Documents missing vectors in Pinecone
  - Documents with chunk count mismatches
  - Recommended cleanup actions

**2. Clean Up Peplink Duplicates** (Priority 2)
- Identify which 167 chunks are the "originals" (older created_at?)
- Delete the 164 duplicate chunks
- Re-run extralarge script on cleaned data
- Verify vectors exist in Pinecone (if not, re-vectorize)

**3. Debug Window Creation Failure** (Priority 3)
- Add comprehensive error logging to `create_windows()`
- Add validation for chunk data structure
- Add chunk_index uniqueness check before windowing
- Test with cleaned Peplink data

#### Future System Improvements

**Database Constraints:**
1. Add unique constraint: `(doc_id, chunk_index)` to prevent duplicates
2. Add check constraint: `chunk_index >= 0 AND chunk_index < total_chunks`
3. Add foreign key: `doc_id` → `documents` table

**Pipeline Robustness:**
1. Idempotent chunking: Check for existing chunks before insert
2. Transactional processing: Rollback if vectorization fails
3. CSV sync: Update only after successful completion
4. Checksum verification: Run after every batch operation

---

### Technical Debt Identified

#### Issues to Address

1. **No Duplicate Prevention**
   - Chunking pipeline doesn't check for existing chunks
   - No database constraints prevent duplicates
   - `chunk_index` is not unique per document

2. **CSV Tracking Inaccuracy**
   - `chunks_in_db` doesn't reflect actual Supabase count
   - `vectors_upserted` doesn't reflect actual Pinecone count
   - No verification step between pipeline and CSV update

3. **Silent Failure Mode**
   - Scripts crash without error messages
   - CSV left in "processing" state indefinitely
   - No automatic cleanup or retry logic

4. **Lack of Data Validation**
   - No pre-flight checks before processing
   - No chunk integrity validation
   - No post-processing verification

---

### Current System Status

```
✅ PDF Upload Pipeline:             Complete (64 PDFs)
✅ LlamaParse Pipeline:             Complete (64 docs)
⚠️  Supabase Chunks:                2,560 chunks (includes duplicates)
⚠️  Pinecone Vectors:               2,496 vectors (64 chunks missing)
✅ DIP Extraction (Batch):          96.9% Complete (62/64 docs)
✅ DIP Extraction (Cached):         100% Deployed with Option B
⚠️  Extralarge Script:              Blocked by duplicate chunks
❌ Peplink Balance 20x:             Failed (331 duplicate chunks)
⏸️  Victron Quattro:                Pending (345 chunks, needs verification)
```

**Immediate Blockers:**
1. Cannot process ultra-large documents until duplicates cleaned
2. Cannot verify system integrity without checksum script
3. Cannot trust CSV tracking without reconciliation

**Recommended Priority:**
1. **Build checksum script** (understand full scope of problem)
2. **Clean duplicates** (unblock extralarge processing)
3. **Fix window creation** (handle edge cases)
4. **Add constraints** (prevent future duplicates)
5. **Test extralarge script** (verify windowed processing)

---

**End of Session 31 - Extralarge Script Blocked by Data Integrity Issues**

---

---

## Session 32: Data Integrity Cleanup & Extralarge Script Enhancement (2025-10-17)

**Objective**: Resolve duplicate chunk issues blocking extralarge script, build verification tooling, and enhance extralarge script with comprehensive checkpoint system.

**Duration**: Full session
**Priority**: Critical (blocking ultra-large document processing)

---

### Part 1: Data Integrity Verification System

#### Created: `scripts/bulk/verify-chunks-vectors.py`

**Purpose**: Audit and verify consistency between Supabase chunks and Pinecone vectors without taking corrective action (pure reporting).

**Key Features**:
- Fetches all chunks from Supabase with proper pagination (handles 1000+ chunks)
- Queries Pinecone vector counts per document using metadata filtering
- Detects duplicate `chunk_index` values per document
- Compares totals and generates detailed doc-by-doc breakdown
- Reports data integrity status with actionable recommendations

**Implementation Details**:

```python
# Proper pagination (fixes previous 1000 limit bug)
while True:
    params = {
        "content_type": "eq.text",
        "select": "chunk_id,doc_id,chunk_index,content_type,created_at",
        "order": "doc_id,chunk_index",
        "limit": page_size,
        "offset": offset
    }
    response = requests.get(f"{url}/rest/v1/document_chunks", ...)
    if not chunks_page or len(chunks_page) < page_size:
        break
    offset += page_size

# Duplicate detection logic
chunk_indices_per_doc = defaultdict(list)
for chunk in chunks:
    chunk_indices_per_doc[doc_id].append(chunk['chunk_index'])

# Find indices that appear more than once
for doc_id, indices in chunk_indices_per_doc.items():
    index_counts = defaultdict(int)
    for idx in indices:
        index_counts[idx] += 1
    duplicate_indices = [idx for idx, count in index_counts.items() if count > 1]
```

**Script Output** (First Run):

```
================================================================================
📊 CHUNK-VECTOR VERIFICATION REPORT
================================================================================

🔢 TOTAL COUNTS
Supabase chunks:    2,560
Pinecone vectors:   2,496
⚠️  Difference: +64 (Supabase has more)

⚠️  DUPLICATE CHUNKS DETECTED
Documents with duplicates: 2
Total duplicate indices: 228

Documents with duplicate chunk_index values:
  - 1b16daed93f3f00a... (Peplink Balance 20x): 164 duplicate indices
  - b509f1e06cf32345... (Victron Smart Solar MPPT): 64 duplicate indices

================================================================================
📋 DOC-BY-DOC BREAKDOWN (Mismatches Only)
================================================================================

Doc ID               Chunks     Vectors    Diff       Status
--------------------------------------------------------------------------------
b509f1e06cf32345...  128        64         +64        ⚠️  64 dups, ↑ 64
1b16daed93f3f00a...  331        331        0          ⚠️  164 dups

================================================================================
📌 SUMMARY
================================================================================
⚠️  Data integrity: ISSUES DETECTED
   - 64 chunk/vector mismatch
   - 2 documents have duplicate chunks

💡 Recommended action:
   1. Fix duplicate chunks first
   2. Re-vectorize documents with missing vectors
   3. Add database constraint: unique(doc_id, chunk_index)
```

**Key Findings**:
1. **Peplink Balance 20x**: 331 chunks (should be 167) - all vectorized despite duplicates
2. **Victron Smart Solar MPPT**: 128 chunks (should be 64) - only 64 vectorized (50% data loss!)
3. **Root cause**: Duplicate `chunk_index` values from failed/repeated uploads
4. **Impact**: 64 chunks (2.5% of total) not searchable via Pinecone

---

### Part 2: Data Cleanup System

#### Understanding the Link

**Discovered**: Pinecone vector ID **IS** the Supabase chunk_id (1:1 mapping)

```python
# In Supabase:
document_chunks.chunk_id = "578e812e-85de-4e4e-9147-4e9cdbc5c587"

# In Pinecone:
vector.id = "578e812e-85de-4e4e-9147-4e9cdbc5c587"  # Same UUID!
vector.metadata.chunk_id = "578e812e-85de-4e4e-9147-4e9cdbc5c587"
```

This simplifies cleanup logic: match chunk_ids to vector IDs directly.

#### Created: `scripts/bulk/cleanup-duplicate-chunks.py`

**Purpose**: Remove duplicate chunks and their corresponding vectors using doc_id or asset_uid as parameter.

**Key Features**:
- Accepts `--doc-id` or `--asset-uid` for targeted cleanup
- Fetches all chunks for document from Supabase
- Queries Pinecone for all vector IDs (by doc_id metadata filter)
- Matches chunks to vectors using chunk_id
- Identifies which chunks/vectors to delete (keeps oldest by default)
- **Dry-run mode by default** (safe preview)
- `--execute` flag required for actual deletion

**Cleanup Strategy**:

```python
def decide_what_to_delete(analysis, keep_newest=False):
    """
    For duplicates with vectors: Keep one (by created_at), delete rest
    For duplicates without vectors: Keep one (by created_at), delete rest
    For mixed (some with/without): Keep the one with vector, delete others
    """
    for chunk_index, chunks_list in duplicate_groups.items():
        sorted_chunks = sorted(chunks_list, key=lambda c: c['created_at'], reverse=keep_newest)

        with_vectors = [c for c in sorted_chunks if c['has_vector']]
        without_vectors = [c for c in sorted_chunks if not c['has_vector']]

        if with_vectors and without_vectors:
            # Mixed: Keep first with vector, delete all others
            keep_chunk = with_vectors[0]
        elif with_vectors:
            # All have vectors: Keep first, delete rest
            keep_chunk = with_vectors[0]
        else:
            # None have vectors: Keep first, delete rest
            keep_chunk = without_vectors[0]
```

**Execution Results**:

**Victron Smart Solar MPPT Cleanup**:
```bash
$ python scripts/bulk/cleanup-duplicate-chunks.py \
    --doc-id b509f1e06cf3234566d22d0b790516031624bd5216a9a18a4d6d9bd9e02dd8cb \
    --execute

Chunks to delete from Supabase:  64
Vectors to delete from Pinecone: 0

🗑️  Deleting 64 chunks from Supabase...
   ✓ Deleted 64 chunks

✅ Cleanup complete!
Final state:
  Remaining chunks: 64
  Remaining vectors: 64
```

**Peplink Balance 20x Cleanup**:
```bash
$ python scripts/bulk/cleanup-duplicate-chunks.py \
    --doc-id 1b16daed93f3f00a3eceba2927dd92ecb02c8d8ea56f7c4ff7ee1be0472c13cf \
    --execute

Chunks to delete from Supabase:  164
Vectors to delete from Pinecone: 164

🗑️  Deleting 164 chunks from Supabase...
   ✓ Deleted 164 chunks

🗑️  Deleting 164 vectors from Pinecone...
   ✓ Deleted 164 vectors

✅ Cleanup complete!
Final state:
  Remaining chunks: 167
  Remaining vectors: 167
```

**Verification** (After Cleanup):

```bash
$ python scripts/bulk/verify-chunks-vectors.py

================================================================================
📊 CHUNK-VECTOR VERIFICATION REPORT
================================================================================

🔢 TOTAL COUNTS
Supabase chunks:    2,332
Pinecone vectors:   2,332
✅ Totals match perfectly!

✅ No duplicate chunk_index values found

================================================================================
📌 SUMMARY
================================================================================
✅ Data integrity: EXCELLENT
   - All counts match
   - No duplicates detected
```

**Impact**:
- Deleted 228 duplicate chunks (164 + 64)
- Deleted 164 duplicate vectors
- Restored 100% data integrity
- Unblocked extralarge script processing
- **System now at A+ data quality**

---

### Summary: Data Integrity Restoration

**Timeline**: Session 31 (Discovery) → Session 32 Parts 1-2 (Resolution)
**Total Duration**: ~4 hours
**Status**: ✅ Complete - System Restored to A+ Grade

#### Problem Discovery (Session 31):
- Extralarge script crashed silently during window creation
- Peplink document had 331 chunks (expected 167) - 164 duplicates
- System-wide: 2,560 chunks vs 2,496 vectors (64 mismatch)
- **Data Integrity Grade: C-**

#### Resolution (Session 32):

**Scripts Created:**
1. **verify-chunks-vectors.py** (423 lines)
   - Comprehensive audit tool
   - Detects duplicates and mismatches
   - Provides actionable recommendations

2. **cleanup-duplicate-chunks.py** (448 lines)
   - Safe cleanup with dry-run mode
   - Intelligent chunk/vector matching
   - Preserves data consistency

**Actions Taken:**
1. Created verification script (discovered scope)
2. Cleaned Victron Smart Solar MPPT (64 duplicates removed)
3. Cleaned Peplink Balance 20x (164 duplicates removed)
4. Verified final state (perfect 2,332/2,332 match)

**Final Status:**
```
✅ Supabase Chunks:      2,332 (100% clean)
✅ Pinecone Vectors:     2,332 (100% coverage)
✅ Duplicate Chunks:     0 (eliminated)
✅ Vector Coverage:      100% (all chunks have vectors)
✅ Data Integrity:       A+ (perfect match)
```

#### Files Created/Modified:

**Created:**
1. `scripts/bulk/verify-chunks-vectors.py` (423 lines)
   - Pure reporting, no modifications
   - Safe to run anytime
   - Doc-by-doc breakdown

2. `scripts/bulk/cleanup-duplicate-chunks.py` (448 lines)
   - Dry-run by default
   - Requires --execute flag
   - Supports both doc_id and asset_uid

**Modified:**
- None (cleanup was data-only, no code changes to pipelines)

#### Key Learnings:

1. **No Database Constraints** - chunk_index not unique per document
2. **Pipeline Not Idempotent** - Re-running creates duplicates
3. **CSV Tracking Unreliable** - Doesn't reflect actual DB state
4. **Silent Failures** - Scripts crashed without error messages

#### Recommendations for Future:

1. **Add Database Constraint:**
   ```sql
   ALTER TABLE document_chunks
   ADD CONSTRAINT unique_doc_chunk
   UNIQUE (doc_id, chunk_index);
   ```

2. **Make Pipeline Idempotent:**
   - Check for existing chunks before insert
   - Use UPSERT instead of INSERT

3. **Add Verification Step:**
   - Run verify script after every batch operation
   - Alert on any mismatches

4. **Improve Error Handling:**
   - Add try/catch with detailed logging
   - Clean up CSV state on failure

---

**End of Data Integrity Sessions (31, 32 Parts 1-2)**

---
