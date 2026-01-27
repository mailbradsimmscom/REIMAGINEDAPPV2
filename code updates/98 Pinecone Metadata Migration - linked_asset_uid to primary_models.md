# 98 Pinecone Metadata Migration - linked_asset_uid to primary_models

**Date:** 2026-01-17
**Status:** Planning
**Parent Document:** 97 Document-First Architecture

---

## Executive Summary

Comprehensive inventory of all code that uses `linked_asset_uid` or `asset_uid` for Pinecone filtering. This must be migrated to the new `primary_models[]` array approach.

---

## Current State: Two Field Names (Inconsistent!)

**Problem Discovered:** The codebase uses TWO different field names inconsistently:

| Field | Where Used | What It Does |
|-------|------------|--------------|
| `linked_asset_uid` | Python chunker, maintenance-agent | Stored in Pinecone metadata |
| `asset_uid` | pinecone-rag.service.js | Used in filter (but might not match!) |

**The bug:** `pinecone-rag.service.js` filters by `asset_uid` but the actual Pinecone metadata field is `linked_asset_uid`. These may not be matching!

---

## Comprehensive Code Inventory

### 1. PYTHON-SIDECAR (Creates Pinecone Metadata)

#### `python-sidecar/app/chunking/models.py` (Line 70-71)
**Type:** Model Definition
**Current:**
```python
# Asset linking (for DIP system)
linked_asset_uid: Optional[str] = None
linked_system_name: Optional[str] = None
```
**Change to:**
```python
# Model filtering (NEW)
primary_models: List[str] = field(default_factory=list)
referenced_systems: List[str] = field(default_factory=list)
is_universal: bool = False

# DEPRECATED - remove after migration
# linked_asset_uid: Optional[str] = None
# linked_system_name: Optional[str] = None
```

---

#### `python-sidecar/app/chunking/chunker.py` (Line 165-166)
**Type:** Metadata Population
**Current:**
```python
# Asset linking
linked_asset_uid=metadata.get('asset_uid'),
linked_system_name=metadata.get('system_name')
```
**Change to:**
```python
# Model filtering (NEW)
primary_models=metadata.get('primary_models', []),
referenced_systems=metadata.get('referenced_systems', []),
is_universal=metadata.get('is_universal', False)
```

---

#### `python-sidecar/scripts/test_semantic_vs_filtered_search.py` (Lines 119, 141, 197, 200, 203, 205, 208, 210, 214)
**Type:** Test Script
**Impact:** Test script - update to use new fields for testing
**Current:**
```python
asset_uid = metadata.get("linked_asset_uid", "").lower()
filter_dict={"linked_asset_uid": filter_uid}
```
**Change to:**
```python
primary_models = metadata.get("primary_models", [])
filter_dict={"primary_models": {"$in": user_models}}
```

---

### 2. MAIN APP - SRC/SERVICES

#### `src/services/pinecone-rag.service.js` (Lines 87-89, 111, 161)
**Type:** Pinecone Query Filter
**Current:**
```javascript
const assetUids = equipmentContext.map(eq => eq.asset_uid).filter(Boolean);
if (assetUids.length > 0) {
  filter.asset_uid = { $in: assetUids };
}
// ...
asset_uid: match.metadata?.asset_uid || null,
// ...
const filter = { asset_uid: assetUid };
```
**Change to:**
```javascript
// Get user's model names from their systems
const userModels = equipmentContext.map(eq => eq.model_norm).filter(Boolean);
if (userModels.length > 0) {
  filter.$or = [
    { primary_models: { $in: userModels } },
    { is_universal: { $eq: true } }
  ];
}
// ...
primary_models: match.metadata?.primary_models || [],
// ...
const filter = {
  $or: [
    { primary_models: { $in: [modelName] } },
    { is_universal: { $eq: true } }
  ]
};
```

---

#### `src/services/funnel/funnel.service.js` (Lines 452-453)
**Type:** Extract asset UIDs from results
**Current:**
```javascript
allData.forEach(row => {
  if (row.metadata?.linked_asset_uid) {
    assetUids.add(row.metadata.linked_asset_uid);
  }
});
```
**Change to:**
```javascript
allData.forEach(row => {
  if (row.metadata?.primary_models?.length) {
    row.metadata.primary_models.forEach(m => models.add(m));
  }
});
```

---

#### `src/services/supplies/ai-analysis.service.js` (Lines 453-456)
**Type:** Filter chunks by asset
**Current:**
```javascript
const assetUid = metadata.linked_asset_uid;

if (!assetUid) {
  continue; // Skip chunks without linked_asset_uid
}
```
**Change to:**
```javascript
const primaryModels = metadata.primary_models || [];

if (primaryModels.length === 0 && !metadata.is_universal) {
  continue; // Skip chunks without model tagging
}
```

---

#### `src/public/pinecone-admin.html` (Line 508-509)
**Type:** UI Display
**Current:**
```html
<span class="metadata-label">Linked Asset UID:</span>
<span class="metadata-value">${chunk.metadata.linked_asset_uid || 'N/A'}</span>
```
**Change to:**
```html
<span class="metadata-label">Primary Models:</span>
<span class="metadata-value">${(chunk.metadata.primary_models || []).join(', ') || 'N/A'}</span>
<span class="metadata-label">Referenced Systems:</span>
<span class="metadata-value">${(chunk.metadata.referenced_systems || []).join(', ') || 'N/A'}</span>
<span class="metadata-label">Universal:</span>
<span class="metadata-value">${chunk.metadata.is_universal ? 'Yes' : 'No'}</span>
```

---

### 3. MAINTENANCE-AGENT

#### `maintenance-agent/src/repositories/pinecone.repository.js` (Lines 150, 180)
**Type:** Pinecone Query Filter
**Current:**
```javascript
const filter = assetUid ? { 'linked_asset_uid': { $eq: assetUid } } : {};
```
**Change to:**
```javascript
const filter = modelName ? {
  $or: [
    { 'primary_models': { $in: [modelName] } },
    { 'is_universal': { $eq: true } }
  ]
} : {};
```

---

#### `maintenance-agent/src/services/step-executors/step1-generic-search.js` (Line 103)
**Type:** Pinecone Query Filter
**Current:**
```javascript
filter: { 'linked_asset_uid': { $eq: assetUid } },
```
**Change to:**
```javascript
filter: {
  $or: [
    { 'primary_models': { $in: userModels } },
    { 'is_universal': { $eq: true } }
  ]
},
```

---

#### `maintenance-agent/src/services/step-executors/step2-llm-search.js` (Line 140)
**Type:** Pinecone Query Filter
**Current:**
```javascript
filter: { 'linked_asset_uid': { $eq: assetUid } },
```
**Change to:**
```javascript
filter: {
  $or: [
    { 'primary_models': { $in: userModels } },
    { 'is_universal': { $eq: true } }
  ]
},
```

---

#### `maintenance-agent/scripts/` (Multiple test scripts)
**Type:** Test Scripts
**Files:**
- `debug-pinecone-filter.js` (lines 38, 60)
- `test-step-executors.js` (line 124)
- `capture-pinecone-scores.js` (line 126)
- `LLM_powered_vector_search.js` (line 91)

**Current:** All use `{ 'linked_asset_uid': { $eq: assetUid } }`
**Change to:** Use new `primary_models` filter pattern

---

## Summary: Files to Change

### Critical (Production Code)

| File | Lines | Type | Priority |
|------|-------|------|----------|
| `python-sidecar/app/chunking/models.py` | 70-71 | Model definition | 🔴 HIGH |
| `python-sidecar/app/chunking/chunker.py` | 165-166 | Metadata creation | 🔴 HIGH |
| `src/services/pinecone-rag.service.js` | 87-89, 111, 161 | Query filter | 🔴 HIGH |
| `src/services/funnel/funnel.service.js` | 452-453 | Result processing | 🟡 MEDIUM |
| `src/services/supplies/ai-analysis.service.js` | 453-456 | Chunk filtering | 🟡 MEDIUM |
| `src/public/pinecone-admin.html` | 508-509 | UI display | 🟢 LOW |

### Maintenance Agent (Separate Codebase)

| File | Lines | Type | Priority |
|------|-------|------|----------|
| `maintenance-agent/src/repositories/pinecone.repository.js` | 150, 180 | Query filter | 🔴 HIGH |
| `maintenance-agent/src/services/step-executors/step1-generic-search.js` | 103 | Query filter | 🔴 HIGH |
| `maintenance-agent/src/services/step-executors/step2-llm-search.js` | 140 | Query filter | 🔴 HIGH |

### Test Scripts (Update After Production)

| File | Priority |
|------|----------|
| `python-sidecar/scripts/test_semantic_vs_filtered_search.py` | 🟢 LOW |
| `maintenance-agent/scripts/debug-pinecone-filter.js` | 🟢 LOW |
| `maintenance-agent/scripts/test-step-executors.js` | 🟢 LOW |
| `maintenance-agent/scripts/capture-pinecone-scores.js` | 🟢 LOW |
| `maintenance-agent/scripts/LLM_powered_vector_search.js` | 🟢 LOW |

---

## Migration Strategy

### Phase 1: Add New Fields (Backwards Compatible)

1. Update `ChunkMetadata` model to include new fields
2. Update chunker to populate new fields
3. Keep `linked_asset_uid` temporarily
4. New chunks have BOTH old and new fields

### Phase 2: Update Query Logic

1. Update all query filters to use new fields
2. Add fallback: if new fields missing, try old field
3. Test with existing + new chunks

### Phase 3: Backfill Existing Vectors

Option A: Re-process all documents
- Delete existing vectors
- Re-upload with new chunking
- Clean but requires reprocessing

Option B: Use Pinecone update API
- Update metadata on existing vectors
- Faster but need to determine primary_models for each chunk

### Phase 4: Remove Old Fields

1. Remove `linked_asset_uid` from model
2. Remove fallback logic from queries
3. Clean up test scripts

---

## New Filter Pattern

**Before (UUID-based):**
```javascript
filter: { 'linked_asset_uid': { $eq: 'uuid-123' } }
```

**After (Model-based):**
```javascript
filter: {
  $or: [
    { 'primary_models': { $in: ['4JH57', 'VC20', 'SD60'] } },
    { 'is_universal': { $eq: true } }
  ]
}
```

---

## Questions to Resolve

1. **How to get user's models for query?**
   - Query systems table by user
   - Extract `model_norm` values
   - Pass to Pinecone filter

2. **What about existing vectors?**
   - Need migration plan
   - Either re-process or update metadata

3. **Maintenance agent changes?**
   - Separate repo, separate deployment
   - Coordinate timing

---

## Related Documents

- 97 Document-First Architecture (parent)
- `scripts/test-pinecone-metadata-v2.py` (test script for new structure)
