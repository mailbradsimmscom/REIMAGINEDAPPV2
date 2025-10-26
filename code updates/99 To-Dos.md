# To-Do List

**Last Updated:** 2025-10-26 (Major update with deprecated code analysis)

---

## Pending Tasks

### 1. Remove Legacy Regex DIP Extraction

**File:** `python-sidecar/app/dip_processor.py`
**Lines:** 911-913

**Description:**
Remove the legacy regex-based DIP extraction calls that are no longer used:
- `extract_entities()`
- `extract_spec_hints()`
- `extract_golden_tests()`

These were replaced by Anthropic LLM-based extraction. The code still runs but the output is orphaned (saved to files without `_an` suffix that are never ingested).

**Impact:** Cleanup only - removes dead code that doesn't affect functionality.

---

## MAJOR CLEANUP: Deprecated & Stale Code

**Added:** 2025-10-26
**Estimated Lines to Remove:** ~3,000+

### 2. DEPRECATED FILES - Safe to Delete

#### 2.1 Deprecated Services (Node.js)
These services have been replaced by Python sidecar and now only throw errors:

- [ ] `/src/services/enhanced-chat.service.js` - Replaced by Python sidecar (throws errors)
- [ ] `/src/services/enhanced-chat.service.js.backup` - Old 46KB backup file
- [ ] `/src/services/chat-orchestrator.service.js` - Replaced by Python sidecar
- [ ] `/src/services/langgraph-chat.service.js` - Replaced by Python sidecar
- [ ] `/src/services/chat-completion.service.js` - Claims to replace Python LangGraph

#### 2.2 Deprecated Routes
- [ ] `/src/routes/chat/dip.route.js.deprecated` - DIP route no longer used

#### 2.3 Deprecated Frontend Pages
- [ ] `/src/public/deprecated-fuzzy-dashboard.html`
- [ ] `/src/public/deprecated-simple-playbooks.html`
- [ ] `/src/public/deprecated-testing-progress.html`
- [ ] `/src/public/deprecated-playbooks.html`
- [ ] `/src/public/deprecated-intent-router.html`
- [ ] `/src/public/deprecated-suggestions.html`
- [ ] `/src/public/admin.htm.deprecated`

#### 2.4 Old Backup Files
- [ ] `/maintenance-agent/index.js.old`
- [ ] `/python-sidecar/app/dip_processor.py.backup`
- [ ] `/backup/` - Entire backup folder including:
  - `/backup/steps-3-5-removal/dip.ingest.service.js.backup`
  - `/backup/steps-3-5-removal/ingestion.schema.js.backup`
  - `/backup/steps-3-5-removal/dip.service.js.backup`
  - `/backup/steps-3-5-removal/dip.route.js.backup`
  - `/backup/steps-3-5-removal/dip.generation.service.js.backup`
  - `/backup/steps-3-5-removal/document.service.js.backup`
  - `/backup/steps-3-5-removal/dip-cleaner.route.js.backup`
  - `/backup/steps-3-5-removal/job.processor.js.backup`

#### 2.5 Legacy Folders
- [ ] `/deprecated/` - Entire deprecated folder structure
- [ ] `/deprecated/src-old/` - Old source files
- [ ] `/.baseline/legacy-routes.txt` - Legacy route documentation

---

### 3. DISABLED CODE - Should Be Removed

#### 3.1 Python Response Scoring (DISABLED)
**File:** `/python-sidecar/app/chat/workflows/chat_workflow_sequential.py`

- [ ] Lines 163-169: Commented out Step 4 execution
```python
# ===== STEP 4: Response Scoring ===== DISABLED
# step_start = datetime.now()
# state = await self._score_response(state)
# step_duration = (datetime.now() - step_start).total_seconds() * 1000
# chat_debug.timing('score_response', step_duration, {
#     'confidence': state.get('response_score', {}).get('confidence', 'unknown')
# })
```

- [ ] Lines 591-640: `_score_response()` function that returns immediately
```python
async def _score_response(self, state: Dict[str, Any]) -> Dict[str, Any]:
    """
    Score response quality and confidence
    INTELLIGENCE: LLM-powered quality metrics
    DISABLED: Too slow for production use
    """
    # SCORING DISABLED - skip entirely
    return state

    # ... 40 lines of unused code below ...
```

**Reason:** "Too slow for production use"

---

### 4. UNUSED CODE PATHS

#### 4.1 Legacy Page-Based Chunking
**File:** `/python-sidecar/app/main.py`

- [ ] Lines 377-414: Old page-based chunking path (only when `USE_SEMANTIC_CHUNKING=false`)
```python
else:
    # OLD PAGE-BASED CHUNKING PATH (existing code)
    logger.info(f"Using LEGACY page-based chunking for {file.filename}")
    # ... 37 lines of legacy code ...
```

Since `USE_SEMANTIC_CHUNKING=true` in production, this code path is never executed.

---

### 5. STALE REFERENCES

#### 5.1 LangGraph References
Despite LangGraph being removed, references still exist:

- [ ] Multiple "replaced by Python-sidecar LangGraph" comments in deprecated services
- [ ] `/langgraph_migration_and_pinecone_fix.md` - Migration documentation
- [ ] `/python-chat-service/README.md` - Still mentions LangGraph framework

#### 5.2 Worker References
- [ ] `/src/services/logs.service.js:267` - Lists 'worker' as a service but no implementation exists
```javascript
services: ['node-web', 'python-sidecar', 'worker'],
```

#### 5.3 DIP Navigation
- [ ] `/src/public/partials/nav.html` - Still has DIP button with no route
```html
<button class="tab-btn" onclick="window.location.hash = '#/dip'" id="tab-dip">DIP</button>
```

---

### 6. TODO ITEMS IN CODE

- [ ] `/src/app.js:22` - Production domain placeholder
```javascript
? ['https://your-production-domain.com']  // TODO: Update with actual production domain before deploying
```

---

### 7. SERVICES NEVER IMPORTED

These services exist but analysis shows they're never imported anywhere:

- [ ] Verify and remove if unused:
  - `enhanced-chat.service.js` (non-backup)
  - `chat-orchestrator.service.js`
  - `langgraph-chat.service.js`
  - `chat-completion.service.js`

---

### 8. REDUNDANT FALLBACK CODE

Multiple fallback implementations that may be unnecessary:

- [ ] Review fallback patterns in:
  - `equipment-relationship-inference.service.js:162`
  - `enhanced-chat.service.js.backup` (multiple fallback responses)
  - Various "graceful fallback" implementations

---

## RECOMMENDED CLEANUP SEQUENCE

### Phase 1: Safe Deletions (No Risk)
1. Delete all `.deprecated` files
2. Delete `/deprecated/` folder
3. Delete `/backup/` folder
4. Delete `.backup` files
5. Delete deprecated HTML pages

**Estimated Impact:** ~1,500 lines removed

### Phase 2: Code Removal (Test Required)
1. Remove Python Step 4 scoring code
2. Remove legacy page-based chunking
3. Remove deprecated service files
4. Remove worker references

**Estimated Impact:** ~1,000 lines removed

### Phase 3: Documentation & Reference Updates
1. Update READMEs to remove LangGraph mentions
2. Update production domain TODO
3. Remove DIP button from navigation
4. Clean up import statements

**Estimated Impact:** ~500 lines removed

---

## TESTING CHECKLIST AFTER CLEANUP

- [ ] Document upload still works
- [ ] Chat processing still functions
- [ ] Admin dashboard loads properly
- [ ] Log viewer works
- [ ] No broken imports
- [ ] No 404 errors in browser console
- [ ] Python sidecar starts without errors

---

## BENEFITS OF CLEANUP

1. **Reduced Confusion:** No more wondering which implementation is current
2. **Smaller Bundle:** Less code to load and maintain
3. **Clearer Architecture:** Easier to understand the actual flow
4. **Faster Development:** Less code to search through
5. **Reduced Tech Debt:** Remove ~3,000 lines of unused code

---

## Notes

- All deprecated services currently throw errors saying they're deprecated
- The system is using semantic chunking, so page-based chunking is dead code
- Response scoring was disabled for being "too slow for production"
- LangGraph was completely removed but documentation still references it
- Many services were split from `enhanced-chat.service.js` but the original remains

**Priority:** Start with Phase 1 (safe deletions) as these require no testing and provide immediate cleanup benefits.