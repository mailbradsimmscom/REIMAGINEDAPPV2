# To-Do List

**Last Updated:** 2025-10-17

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





