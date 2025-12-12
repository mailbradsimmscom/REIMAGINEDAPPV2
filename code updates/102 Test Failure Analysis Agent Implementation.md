# Test Failure Analysis Agent - Implementation Summary

**Date:** 2025-12-12
**Commit:** `f8f1ca1`
**Status:** Deployed, ready for testing

## Overview

Built an AI-powered agent that analyzes test failures after CI runs. The agent:
1. Fetches failures from Supabase
2. Computes deterministic classification from history
3. Uses Claude to investigate code and propose fixes
4. Tests hypotheses in isolated git worktree sandbox
5. Reports structured findings to dashboard

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  GitHub Actions CI                                          │
│  ├── nightly-sweep.yml (quick QA, no AI)                   │
│  ├── nightly-sweep-full.yml (QA + AI analysis)             │
│  └── analyze-failures.yml (AI analysis only)               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Python Analysis Agent (python-sidecar/app/analysis/)      │
│  ├── agent.py - Main orchestration loop                    │
│  ├── models.py - Pydantic models for LLM I/O               │
│  ├── worktree.py - Git worktree sandbox                    │
│  ├── file_reader.py - File/git operations                  │
│  ├── history_checker.py - Supabase queries + classification│
│  ├── llm_analyzer.py - Claude integration                  │
│  └── test_runner.py - Run tests in sandbox                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Supabase                                                   │
│  ├── test_results (existing) - Raw test results            │
│  └── test_analysis (new) - AI analysis results             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend (src/public/test-results.html)                   │
│  └── AI Analysis card with expandable hypotheses           │
└─────────────────────────────────────────────────────────────┘
```

## Files Created

### Database
- `sql/test_analysis_table.sql` - Schema with classification, root_cause_type, hypotheses

### Python Analysis Module (`python-sidecar/app/analysis/`)
| File | Purpose | Lines |
|------|---------|-------|
| `__init__.py` | Module exports | 30 |
| `models.py` | Pydantic models for structured LLM I/O | 120 |
| `worktree.py` | Git worktree sandbox manager | 90 |
| `file_reader.py` | File reading, git history, diffs | 150 |
| `history_checker.py` | Supabase queries + deterministic classification | 180 |
| `llm_analyzer.py` | Claude integration with guardrails | 160 |
| `test_runner.py` | Run individual tests in sandbox | 120 |
| `agent.py` | Main 5-phase orchestration loop | 250 |

### CLI
- `scripts/analyze-failures.py` - Entry point with `--run-id`, `--latest`, `--dry-run` flags

### API Layer (per .cursorrules: routes → services)
- `src/schemas/test-analysis.schema.js` - Zod validation schemas
- `src/services/test-analysis.service.js` - Business logic + Supabase queries
- `src/routes/admin/test-analysis.route.js` - Thin route handler

### CI Workflows
| Workflow | File | Trigger | Duration |
|----------|------|---------|----------|
| Nightly Sweep | `nightly-sweep.yml` | Scheduled 3am + manual | ~30 min |
| Nightly Sweep + AI Fix | `nightly-sweep-full.yml` | Manual only | ~45 min |
| Analyze Failures | `analyze-failures.yml` | Manual only | ~15 min |

### Modified Files
- `scripts/upload-test-results.js` - Outputs run_id to GITHUB_OUTPUT
- `src/routes/admin/index.js` - Mount test-analysis router
- `src/public/test-results.html` - AI Analysis card with accordions

## Key Design Decisions

### 1. Deterministic Classification
Classification is computed from history, NOT by LLM:
- `always_passes` - All recent runs passed (shouldn't be failing)
- `always_fails` - All recent runs failed (chronic issue)
- `flaky` - Mix of pass/fail (>20% each way)
- `recent_regression` - Was passing, now failing
- `new_failure` - First time seen

### 2. Git Worktree Sandbox
All code modifications happen in an isolated git worktree:
```python
with agent_worktree(repo_root) as sandbox:
    apply_patch(sandbox, diff)
    run_test(sandbox, test_file)
    # Automatically cleaned up on exit
```
- Main checkout is NEVER modified
- UUID namespacing prevents collision
- Force cleanup even on errors

### 3. File Whitelist
Only allows modifications to:
- `src/`
- `tests/`

Never touches: `.env`, `.github/`, `sql/`, config files

### 4. Structured LLM I/O
Uses Pydantic models for type-safe Claude responses:
```python
class LlmHypothesis(BaseModel):
    hypothesis: str
    change_type: Literal["code_change", "test_change", "config_change", "no_change"]
    target_files: list[str]
    proposed_diff: Optional[str]
    confidence: Literal["low", "medium", "high"]
    tests_to_run: list[str]
```

### 5. Three Workflows for Flexibility
- **Quick iteration**: Use `nightly-sweep.yml` (no AI wait)
- **Deep analysis**: Use `nightly-sweep-full.yml` (includes AI)
- **Re-analyze**: Use `analyze-failures.yml` (no re-run tests)

## Agent Workflow (5 Phases)

```
Phase 1: Parse & Understand (1-2 min)
  └─ Fetch failures from Supabase, read test files

Phase 2: Compare & Contextualize (2-3 min)
  └─ Query history, compute classification deterministically

Phase 3: Investigate Code (3-5 min)
  └─ Read related code, git history, ask Claude for analysis

Phase 4: Test Hypotheses (5-8 min, max 3 attempts)
  └─ Apply patches in sandbox, run tests, record results

Phase 5: Report (1 min)
  └─ Store to Supabase, flag for human review if unresolved
```

## Guardrails

| Guardrail | Value |
|-----------|-------|
| Total timeout | 15 minutes |
| Per-hypothesis timeout | 2 minutes |
| Max failures | 10 |
| Max hypotheses per failure | 3 |
| Max diff lines | 50 |
| File whitelist | `src/`, `tests/` only |

## Database Schema

```sql
CREATE TABLE test_analysis (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  failure_key TEXT NOT NULL,           -- "category:test_name"
  classification TEXT,                  -- deterministic from history
  root_cause_type TEXT,                 -- code_logic, test_bug, env_config, external_service
  investigation JSONB,
  hypotheses_tested JSONB,
  recommendation JSONB,
  analysis_duration_ms INTEGER,
  resolved BOOLEAN DEFAULT false,
  human_review_needed BOOLEAN DEFAULT false,
  model_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(run_id, failure_key)
);
```

## Usage

```bash
# Quick QA (scheduled 3am EST, or manual trigger)
# No AI - just tests with fix_hint explanations

# Full QA + AI Fix (manual from GitHub Actions)
# Runs tests, then AI analyzes and proposes fixes

# Just re-analyze latest failures
python scripts/analyze-failures.py --latest

# Analyze specific run
python scripts/analyze-failures.py --run-id <uuid>

# Dry run (test plumbing, no LLM)
python scripts/analyze-failures.py --latest --dry-run
```

## Frontend Display

The test-results.html page shows an "AI Analysis" card when analysis exists:
- Summary stats: Analyzed / Resolved / Need Review
- Per-failure cards with:
  - Classification badge (flaky, regression, etc.)
  - Root cause badge (test_bug, code_logic, etc.)
  - Status badge (Resolved / Needs Review)
  - Recommendation description
  - Expandable "What the agent tried" accordion

## Cost Estimate

- Claude Sonnet: ~$3/1M input, ~$15/1M output tokens
- Per failure: ~3-5K input, ~1K output = ~$0.02-0.03
- 10 failures max = ~$0.30 per run
- Monthly (30 runs): ~$9.00

## Testing

To test the agent:

1. **Dry run** (no LLM, no DB writes):
   ```bash
   python scripts/analyze-failures.py --latest --dry-run
   ```

2. **Full run** (requires failures in Supabase):
   ```bash
   python scripts/analyze-failures.py --latest
   ```

3. **CI workflow** (from GitHub Actions UI):
   - Trigger "Analyze Failures" workflow
   - Or trigger "Nightly Sweep + AI Fix" workflow

Note: Latest run has 0 failures (pacing fix worked), so agent will report "No failures analyzed" until a real failure occurs.

## Related Files

- Plan document: `code updates/101 Test Failure Analysis Agent Plan.md`
- Pacing fix: commit `bc559ab` (added 2s delays between chat requests)
