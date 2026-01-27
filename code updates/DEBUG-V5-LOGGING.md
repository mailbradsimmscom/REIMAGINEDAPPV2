# DEBUG-V5 Logging Tracker

**Purpose:** Track all temporary debug logging added during v5 pipeline development
**Removal:** `grep -r "\[DEBUG-V5\]" src/ python-sidecar/` then remove all matches

---

## Active Debug Logging

| File | Line(s) | Description | Added |
|------|---------|-------------|-------|
| `src/services/document.service.js` | 476-483 | processJob model_detection stage entry | 2026-01-15 |
| `src/services/document.service.js` | 488-489 | Calling detectModels | 2026-01-15 |
| `src/services/document.service.js` | 493-497 | detectModels returned | 2026-01-15 |
| `src/services/document.service.js` | 542-548 | TEMPORARY STOP log | 2026-01-15 |
| `src/services/document.service.js` | 849-855 | detectModels ENTRY | 2026-01-15 |
| `src/services/document.service.js` | 878-884 | Parse response details | 2026-01-15 |
| `src/services/document.service.js` | 893-898 | Text extraction result | 2026-01-15 |
| `src/services/document.service.js` | 931-935 | detect-models response | 2026-01-15 |

---

## Temporary Code Blocks

| File | Line(s) | Description | Added |
|------|---------|-------------|-------|
| `src/services/document.service.js` | 540-559 | TEMPORARY STOP after model detection | 2026-01-14 |

---

## How to Remove

```bash
# Find all debug logging
grep -rn "\[DEBUG-V5\]" src/ python-sidecar/

# Find temporary stops
grep -rn "TEMPORARY STOP" src/

# After v5 validated, remove all matches manually
```

---

## Test Scripts (can delete after validation)

| Script | Purpose |
|--------|---------|
| `scripts/test-model-detection.cjs` | Isolated model detection test |
| `scripts/reset-test-upload.cjs` | Clear test data between runs |

