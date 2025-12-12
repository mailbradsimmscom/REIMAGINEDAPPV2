# Known Upgrades

Tracking future improvements identified during development.

---

## 1. Equipment Keyword Search - Prefix/Synonym Boosting

**Status:** Identified
**Priority:** Medium
**Date Identified:** 2025-12-10

### Problem

When users search for equipment using natural language like "for my nemesis how do I lock the screen", the keyword search extracts individual words (`nemesis`, `lock`, `screen`) and searches each separately. The results are then sorted by rank.

The issue: generic action words like "lock" can match equipment names (e.g., `quick_lock_deck_filler`) with a higher rank than the actual equipment the user is asking about.

**Example:**

| Keyword | Match | Rank |
|---------|-------|------|
| `nemesis` | B&G nemesis_9 | 0.760 |
| `lock` | Osculati quick_lock_deck_filler | **0.827** |
| `screen` | B&G triton_display | 0.608 |

After sorting by rank, the deck filler (irrelevant) outranks the Nemesis 9 (what the user wants).

### Current Workaround

Users can include the full model name (e.g., "nemesis 9" instead of "nemesis") to get correct results.

### Proposed Solution

Boost rank for results where the keyword matches the **beginning** of the model name (prefix match) or appears in the **synonyms** field.

**Option A - Prefix Match Boost:**
```
"nemesis" → "nemesis_9" starts with "nemesis"? YES → boost rank 1.5x
"lock" → "quick_lock_deck_filler" starts with "lock"? NO → no boost
```

**Option B - Synonym Match Boost:**
The `systems` table has `synonyms_fts` containing variations like "Nemesis 9", "NEMESIS", "nemesis", "B&G Nemesis". If the user's keyword appears in synonyms, apply a rank boost.

**Option C - First Keyword Priority:**
Since users typically phrase questions as "for my [equipment] how do I [action]", prioritize results from the first keyword over later keywords.

### Files Involved

- `src/services/chat-proxy.service.js` (lines 148-172) - keyword search logic
- `src/repositories/systems.repository.js` - `searchSystems()` function
- Supabase RPC `search_systems` - may need to return `model_norm` and `synonyms_fts` for boosting

### Test Case

Query: `for my nemesis how do I lock the screen`
Expected: Should find B&G nemesis_9 and return Pinecone docs for screen lock procedure
Actual (before fix): Falls back to Perplexity web search because deck filler outranks nemesis

---

## 2. Comprehensive Test Coverage Expansion

**Status:** Planned
**Priority:** High
**Date Identified:** 2025-12-12

### Problem

Current test coverage has significant gaps across all three codebases:

| Codebase | Current State | Gap |
|----------|--------------|-----|
| **Main App** | 55+ test files, good integration/e2e | Weak unit tests - 41/47 services untested |
| **Maintenance-Agent** | **0 automated tests** | Critical - handles autonomous data modification |
| **Python Sidecar** | 9 test files, decent structure | Major gaps in LLM service, Pinecone, DIP retriever |

### Key Risks

1. **Maintenance-Agent Pipeline** - 6-step orchestration modifies database autonomously with zero test coverage
2. **Deduplication Logic** - Similarity thresholds (65%, 85%) untested, could delete valid tasks
3. **Node↔Python Integration** - Data flow issues (like missing `node_timing`, `detailed_metrics`) not caught
4. **LLM Service** - Classification and synthesis logic completely untested

### Proposed Solution

Target **80%+ coverage** across all three codebases with focus on:

#### Phase 1: Test Infrastructure Setup

**Maintenance-Agent (Create from Scratch):**
```
maintenance-agent/
├── package.json          # Add: "test": "node --test tests/**/*.test.js"
└── tests/
    ├── helpers/
    │   ├── setup.js      # Test setup, env mocking
    │   └── fixtures.js   # Shared test data
    ├── unit/
    └── integration/
```

**Python Sidecar:**
- Move root `test-*.py` files into `tests/` directory
- Add `pytest.ini` with coverage config

#### Phase 2: Critical Path Tests

**Main App (Node.js):**
| File | Purpose |
|------|---------|
| `tests/unit/services/chat-orchestrator.test.js` | Context building, equipment flow |
| `tests/unit/services/equipment-extraction.test.js` | Equipment parsing |
| `tests/unit/middleware/error.test.js` | Global error handler |
| `tests/integration/sidecar-live.test.js` | Live Node↔Python calls |

**Maintenance-Agent:**
| File | Purpose |
|------|---------|
| `tests/unit/pipeline-orchestrator.test.js` | 6-step orchestration |
| `tests/unit/deduplication.service.test.js` | Similarity algorithms |
| `tests/unit/step-executors/*.test.js` | Each step executor |
| `tests/integration/admin-routes.test.js` | API contracts |

**Python Sidecar:**
| File | Purpose |
|------|---------|
| `tests/unit/test_llm_service.py` | Classification, synthesis |
| `tests/unit/test_pinecone_client.py` | Vector operations |
| `tests/unit/test_dip_retriever.py` | DIP table queries |
| `tests/integration/test_api_endpoints.py` | All /v1/* routes |

#### Phase 3: Full Maintenance-Agent Coverage

All services need tests:
- `pipeline-orchestrator.service.js` - Core 6-step logic
- `deduplication.service.js` - Similarity detection
- `extraction.service.js` - Manual extraction
- `discovery.service.js` - Real-world search
- `task-embedding.service.js` - Vector embeddings
- `task-approval.service.js` - Approval workflow
- `boatos-tasks.service.js` - Task management
- `weather-*.service.js` - Weather services
- All step executors (step1 through step6)

All routes need contract tests:
- `pipeline.route.js`
- `system-maintenance.route.js`
- `boatos-tasks.route.js`
- `maintenance-tasks.route.js`
- `user-tasks.route.js`
- `dedup-review.route.js`
- `weather.route.js`

Background jobs:
- `system-processor.job.js`
- `scheduler.job.js`

### Estimated Effort

| Codebase | New Test Files | Lines |
|----------|---------------|-------|
| Main App | 15-20 files | ~2,500 |
| Maintenance-Agent | 12-15 files | ~2,000 |
| Python Sidecar | 8-10 files | ~1,500 |
| **Total** | **35-45 files** | **~6,000 lines** |

### CI/CD Updates Needed

1. Add maintenance-agent test job to `.github/workflows/test.yml`
2. Add live sidecar integration tests (requires both services running)
3. Add `pytest.ini` coverage config to Python sidecar

### Success Criteria

- Main App: 80%+ line coverage
- Maintenance-Agent: 80%+ line coverage (up from 0%)
- Python Sidecar: 80%+ line coverage
- All critical paths have happy-path + error tests
- Live integration tests between Node↔Python pass
- CI runs all tests on every PR
