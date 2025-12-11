# Test Failure Analysis Agent - Implementation Plan

**Last Updated:** 2025-12-11
**Status:** Planning complete, ready to implement

## Current State

### Already Done (This Session)
1. **Pacing fix committed** (commit `bc559ab`) - Added 2s delays between chat requests in:
   - `tests/integration/golden-rules-validation.test.js`
   - `tests/integration/spec-bias-telemetry.test.js`
   - This fixes the intermittent 503 errors from rate limiting
2. **Plan documented** - This file saved to `code updates/101 Test Failure Analysis Agent Plan.md`

### Next Steps
1. Create database schema (`sql/test_analysis_table.sql`)
2. Create Python analysis module foundation (`__init__.py`, `models.py`, `worktree.py`)
3. Build "hello world" stub to prove plumbing (no LLM yet)
4. Then add Claude integration

### Key Context/Decisions Made
- **Why git worktree?** Hard isolation - main checkout never touched, no risk of dirty state
- **Why classification is deterministic?** LLM shouldn't invent patterns - compute from history, pass as fact
- **Why 10 failures max?** Balance between coverage and CI time (15 min limit)
- **Why `continue-on-error: true`?** Agent failures shouldn't break nightly sweep

---

## Overview

Build an AI-powered agent that runs in GitHub Actions after tests complete. The agent will:
1. Analyze test failures using Claude (Anthropic)
2. Read code files directly from the CI filesystem
3. Compare with historical test data to detect patterns
4. Form and test hypotheses by running individual tests in a sandbox
5. Report findings with recommendations

## Core Intent (Explicit Permissions)

**The agent IS allowed to:**
- Modify code on the CI runner (in sandbox only)
- Run specific tests to validate hypotheses

**The agent is NEVER allowed to:**
- Commit or push
- Leave the "real" checkout dirty
- Modify anything outside the safe sandbox

**Mechanism:** All code edits & test runs happen in a **git worktree sandbox**, not in the main checkout.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | Python | Anthropic SDK already installed, better async support |
| LLM | Claude (Anthropic) primary | Better code reasoning |
| Execution | GitHub Actions step | Has full repo access, runs after tests |
| Code Access | Direct filesystem | CI runner has repo checked out |
| Test Execution | Yes - in git worktree sandbox | Validate hypotheses safely |
| Isolation | Git worktree | Hard isolation - main checkout never touched |

## Guardrails

- **Time limit**: 15 minutes total, 2 minutes per hypothesis test
- **Iteration limit**: Max 3 hypotheses per failure, max 10 failures per run
- **Sandbox**: All modifications in git worktree, never main checkout
- **File whitelist**: Only modify files under `src/`, `tests/` - never `sql/`, `.github/`, env files
- **Diff size limit**: Small patches only (<= 50 lines)
- **Human escalation**: Flag when unresolved after all attempts

## Files to Create

### 1. Database Schema
**`sql/test_analysis_table.sql`**
```sql
-- Ensure UUID extension exists
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE test_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES test_results(run_id) ON DELETE CASCADE,
  failure_key TEXT NOT NULL,           -- "category:test_name"
  classification TEXT,                  -- 'flaky', 'regression', 'always_fails', 'new_failure'
  root_cause_type TEXT,                 -- 'code_logic', 'test_bug', 'env_config', 'external_service'
  investigation JSONB,                  -- files examined, git history, pattern
  hypotheses_tested JSONB,              -- array of attempts with results
  recommendation JSONB,                 -- type, description, files, confidence
  analysis_duration_ms INTEGER,
  resolved BOOLEAN DEFAULT false,
  human_review_needed BOOLEAN DEFAULT false,
  model_used TEXT,                      -- e.g. 'claude-sonnet-4-20250514'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(run_id, failure_key)
);

CREATE INDEX idx_test_analysis_run_id ON test_analysis(run_id);
CREATE INDEX idx_test_analysis_failure_key ON test_analysis(failure_key);
CREATE INDEX idx_test_analysis_created_at ON test_analysis(created_at DESC);
CREATE INDEX idx_test_analysis_classification ON test_analysis(classification);

-- Retention: delete analysis older than 30 days (run via cron/scheduled function)
-- DELETE FROM test_analysis WHERE created_at < NOW() - INTERVAL '30 days';
```

**Key additions:**
- `classification` - Computed deterministically from history, NOT by LLM
- `root_cause_type` - For dashboard filtering and queries
- `model_used` - Track which Claude model for debugging prompt changes
- Foreign key to `test_results` with CASCADE delete
- Indexes for common query patterns
- Retention note for cleanup

### 2. Python Analysis Module
**`python-sidecar/app/analysis/`**
```
__init__.py
models.py          # Pydantic models for structured output AND LLM I/O
worktree.py        # Git worktree sandbox manager (new)
file_reader.py     # Read files, git history, git diff
llm_analyzer.py    # Claude integration for code analysis
test_runner.py     # Run individual tests, apply diffs in sandbox
history_checker.py # Query Supabase for historical patterns + classification
agent.py           # Main agent loop orchestrating the analysis
```

### 2a. Git Worktree Sandbox Helper
**`python-sidecar/app/analysis/worktree.py`**
```python
from contextlib import contextmanager
from pathlib import Path
import shutil
import subprocess
import uuid

class WorktreeError(Exception):
    """Raised when worktree operations fail."""
    pass

def _run(cmd, cwd: Path):
    result = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True)
    if result.returncode != 0:
        raise WorktreeError(f"Command failed: {' '.join(cmd)}\n{result.stderr}")
    return result

@contextmanager
def agent_worktree(main_repo_root: Path):
    """Create isolated worktree for agent to modify safely."""
    # Verify we're in a git repo
    git_dir = main_repo_root / ".git"
    if not git_dir.exists():
        raise WorktreeError(
            f"Not a git repository: {main_repo_root}. "
            "Agent must be run from inside a git repo root (after actions/checkout)."
        )

    worktrees_dir = main_repo_root / ".agent-worktrees"
    worktrees_dir.mkdir(exist_ok=True)
    worktree_path = worktrees_dir / f"run-{uuid.uuid4().hex}"

    try:
        # Create worktree at current HEAD
        _run(["git", "worktree", "add", str(worktree_path), "HEAD"], cwd=main_repo_root)
        yield worktree_path
    finally:
        # Remove worktree; nuke dir as fallback
        try:
            _run(["git", "worktree", "remove", "--force", str(worktree_path)], cwd=main_repo_root)
        except Exception:
            shutil.rmtree(worktree_path, ignore_errors=True)
```

**Key details:**
- Clear error if not in git repo (must run after `actions/checkout`)
- UUID namespacing prevents collision in parallel runs
- All modules receive `sandbox_path` - no sneaky `Path.cwd()` calls

### 2b. Strict Pydantic Models for LLM I/O
**Key models in `models.py`:**
```python
class LlmHypothesis(BaseModel):
    hypothesis: str
    change_type: Literal["code_change", "test_change", "config_change", "no_change"]
    target_files: List[str]
    proposed_diff: Optional[str]  # unified diff
    confidence: Literal["low", "medium", "high"]
    tests_to_run: List[str]       # specific test paths

class HistoricalPattern(BaseModel):
    window_size: int              # e.g. 10 - how many runs we looked at
    total_runs: int
    total_passes: int
    total_failures: int
    last_pass_run_id: Optional[str]
    last_fail_run_id: Optional[str]
    first_failure_after_commit: Optional[str]
    classification: Literal["always_passes", "always_fails", "flaky", "recent_regression", "new_failure"]

class TestRunResult(BaseModel):
    """Structured result from running a single test."""
    status: Literal["PASSED", "FAILED_ASSERTION", "TIMED_OUT", "INFRA_ERROR"]
    exit_code: int
    timed_out: bool
    stdout: str  # truncated
    stderr: str  # truncated
    duration_ms: int
```

**Important:**
- Classification is computed deterministically from history, then passed as a FACT to Claude
- `window_size` records how classification was computed (for future rule changes)
- Test results distinguish assertion failures vs timeouts vs infra errors

### 3. CLI Entry Point
**`scripts/analyze-failures.py`**

**Arguments:**
- `--run-id` (required) - UUID of test run to analyze
- `--max-failures` (default 10) - Limit failures to analyze
- `--max-hypotheses` (default 3) - Limit hypotheses per failure
- `--dry-run` - Skip LLM and patching, test plumbing only

**Steps:**
1. Fetch failures for `run_id` from Supabase
2. Create worktree sandbox via `agent_worktree`
3. Run agent with `repo_root` set to sandbox path
4. Write `test_analysis` rows back to Supabase
5. Print concise summary to stdout

### 4. API Route
**`src/routes/admin/test-analysis.route.js`**

`GET /admin/api/test-analysis/:runId`

**Response structure:**
```json
{
  "success": true,
  "data": {
    "byFailureKey": {
      "integration:Test Name": { ...TestAnalysisRecord }
    },
    "summary": {
      "total": 5,
      "resolved": 2,
      "human_review_needed": 1,
      "by_classification": { "flaky": 2, "regression": 1, "new_failure": 2 },
      "by_root_cause": { "test_bug": 1, "code_logic": 2, "external_service": 2 }
    }
  }
}
```

### 5. Frontend Update
**`src/public/test-results.html`**

**AI Analysis Results card showing:**
- `classification` chip (flaky / regression / always-fails / new)
- `root_cause_type` chip (test_bug / code_logic / external_service / env_config)
- Short `recommendation.description` summary
- Status badge: `resolved` or `needs human review`

**Expandable details:**
- Accordion "What the agent tried" listing `hypotheses_tested`:
  - Hypothesis description
  - Files touched (or proposed)
  - Test result (PASSED/FAILED/NOT_RUN)
  - Confidence level

This makes the agent's behavior transparent and builds trust.

## Files to Modify

### 1. Upload Script
**`scripts/upload-test-results.js`**
- Output run_id to GITHUB_OUTPUT for downstream step:
```javascript
// At end of uploadResults()
const output = process.env.GITHUB_OUTPUT;
if (output) {
  fs.appendFileSync(output, `run_id=${runId}\n`);
}
console.log(`run_id=${runId}`);
```

### 2. CI Workflow
**`.github/workflows/nightly-sweep.yml`**
```yaml
- name: Upload test results to Supabase
  id: upload-results
  run: node scripts/upload-test-results.js
  env:
    # ... existing env vars

- name: Analyze test failures
  if: always()
  continue-on-error: true  # Don't fail workflow if agent fails
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
  run: python scripts/analyze-failures.py --run-id "${{ steps.upload-results.outputs.run_id }}"
  timeout-minutes: 15
```

### 3. Admin Routes Index
**`src/routes/admin/index.js`**
- Mount test-analysis router

## Agent Workflow (5 Phases)

```
Phase 1: Parse & Understand (1-2 min)
  - Fetch failures from Supabase
  - Read test file to understand what it tests
  - Extract the specific assertion that failed

Phase 2: Compare & Contextualize (2-3 min)
  - Get historical results for this test (last N runs)
  - COMPUTE classification deterministically:
    - "always_passes" -> all recent runs passed (test shouldn't be failing)
    - "always_fails" -> all recent runs failed (chronic issue)
    - "flaky" -> mix of pass/fail (intermittent)
    - "recent_regression" -> was passing, now failing
    - "new_failure" -> first time seen
  - Find breaking commit if regression

Phase 3: Investigate Code (3-5 min)
  - Read test file and app code it exercises
  - Review git diff for recent commits
  - Pass classification as FACT to Claude
  - Ask Claude: "Given this [classification] pattern, what are likely causes?"

Phase 4: Test Hypotheses (5-8 min, max 3 attempts)
  - Claude generates structured LlmHypothesis with:
    - change_type, target_files, proposed_diff, confidence, tests_to_run
  - Validate against whitelist (only src/, tests/)
  - Apply diff in sandbox worktree
  - Run JUST the failing test
  - Record pass/fail
  - If passed, stop. If failed, try next.

Phase 5: Report (1 min)
  - Store structured analysis to Supabase
  - Include classification + root_cause_type
  - Flag for human review if unresolved
```

## Implementation Order

### Phase 1: Foundation (2-3 hrs)
1. Create `sql/test_analysis_table.sql` and run migration
2. Create `python-sidecar/app/analysis/__init__.py`
3. Create `python-sidecar/app/analysis/models.py` with Pydantic models
4. Create `python-sidecar/app/analysis/worktree.py` - sandbox helper

### Phase 2: Core Agent (3-4 hrs)
5. Create `file_reader.py` - filesystem and git operations
6. Create `history_checker.py` - Supabase queries + classification logic
7. Create `llm_analyzer.py` - Claude prompts for analysis (strict I/O models)
8. Create `test_runner.py` - run tests, apply diffs in sandbox
9. Create `agent.py` - main orchestration loop

### Phase 3: CLI & Integration (2-3 hrs)
10. Create `scripts/analyze-failures.py` - CLI entry point
11. Modify `scripts/upload-test-results.js` - output run_id
12. Modify `.github/workflows/nightly-sweep.yml` - add analysis step

### Phase 4: API & Frontend (2-3 hrs)
13. Create `src/routes/admin/test-analysis.route.js`
14. Mount in `src/routes/admin/index.js`
15. Update `src/public/test-results.html` to display analysis

### Phase 5: Testing (1-2 hrs)
16. Test locally with `--dry-run`
17. Test in CI with manual workflow trigger
18. Verify frontend display

## Output Structure

```json
{
  "failure_key": "integration:Technical Accuracy: outcome",
  "classification": "recent_regression",
  "root_cause_type": "test_bug",
  "investigation": {
    "files_examined": ["tests/integration/golden-rules-validation.test.js"],
    "git_commits_reviewed": ["84bc78f", "40a99c2"],
    "pattern_observed": "Passed 4 runs ago, started failing after commit 40a99c2"
  },
  "hypotheses_tested": [
    {
      "hypothesis": "Rate limiting - too many requests without pacing",
      "change_type": "test_change",
      "target_files": ["tests/integration/golden-rules-validation.test.js"],
      "proposed_diff": "...",
      "test_result": "PASSED",
      "confidence": "high"
    }
  ],
  "recommendation": {
    "type": "code_change",
    "description": "Add request pacing to prevent rate limiting",
    "files": ["tests/integration/golden-rules-validation.test.js"],
    "confidence": "high"
  },
  "resolved": true,
  "human_review_needed": false
}
```

## Cost Estimate

- Claude Sonnet: ~$3/1M input, ~$15/1M output tokens
- Per failure: ~3-5K input, ~1K output = ~$0.02-0.03
- 10 failures max = ~$0.30 per nightly run
- Monthly (30 runs): ~$9.00

## Environment Variables Needed

```yaml
ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}  # Add to GitHub secrets
SUPABASE_URL: ${{ secrets.SUPABASE_URL }}            # Already exists
SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}  # Already exists
```

## Security Guardrails

- **Never send to Claude:** env values, secrets, API keys
- **Only send:** test names, bodies, stack traces, small code snippets (N lines around failure)
- **File whitelist:** Only modify `src/`, `tests/` - never `sql/`, `.github/`, `.env`, etc.

## Test Runner Details

**Per-test invocation:**
```bash
# Node.js
node --test path/to/file.test.js -t "test name"

# Playwright
npx playwright test path/to/file.spec.js --grep "test name"

# Python
python -m pytest path/to/test.py -k "test_name"
```

**Environment for test runs:**
```python
env = {
    **os.environ,
    "NODE_ENV": "test",
    "SKIP_EXTERNAL": "1",  # Don't hit real OpenAI/Pinecone during hypothesis testing
}
```

**Result interpretation:**
- `PASSED` - exit 0, no timeout
- `FAILED_ASSERTION` - non-zero exit, no timeout
- `TIMED_OUT` - killed after 2 min
- `INFRA_ERROR` - runner blew up (can't find file, syntax error, etc.)

## LLM Prompt Guardrails

**Baked into prompt:**
1. Tell Claude it's working in a temporary sandbox, no changes are permanent
2. Only propose diffs for files starting with `src/` or `tests/`
3. Never propose changes to config, migrations, CI workflows

**Enforced in Python:**
1. Reject any `target_files` outside whitelist before considering diff
2. Parse diff, count lines, reject if > 50 lines
3. Log rejected hypotheses with reason

**Traceability:**
- Store `model_used` in DB (e.g. `claude-sonnet-4-20250514`)
- Store classification in both column AND `investigation` JSONB
- Optional: store trimmed prompt/response for debugging weird calls

## Success Criteria

1. Agent runs after nightly sweep completes
2. Analyzes up to 10 failures within 15 minutes
3. Computes classification deterministically (not LLM-generated)
4. Tests hypotheses in isolated git worktree sandbox
5. Main checkout is NEVER modified
6. Stores structured results in Supabase with classification + root_cause_type
7. Dashboard displays analysis with clear chips and status badges
8. Flags unresolved failures for human review

## Phasing (v1 vs v2)

### v1 (Current Plan)
- Phases 1-3 + 5: Parse, classify, investigate, report
- Hypothesis testing with small diffs in sandbox
- Whitelisted files only
- Structured LLM output via Pydantic models

### v2 (Future)
- Let Claude propose larger unified diffs
- More sophisticated test isolation
- Cross-test dependency analysis
- Flakiness confidence scoring based on historical variance

## Implementation Strategy: Hello World First

Before wiring Claude, prove the plumbing works end-to-end:

1. **Create schema + models + worktree.py**
2. **Stubbed agent.py that:**
   - Creates worktree sandbox
   - Fetches a couple of fake failures
   - Writes dummy `test_analysis` row to Supabase
3. **Wire CI workflow step**
4. **Verify:** sandbox created, row written, sandbox cleaned up

This proves Supabase + CI + sandbox integration with zero LLM calls.
Then add Claude.
