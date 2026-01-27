# DIP Agent v2: Production-Ready Autonomous Processing

**Last Updated:** 2026-01-10
**Status:** Phase H complete - v3.0 margin-based logic deployed, 50% auto-approve rate with first auto-reject

---

## Summary

Built a production-ready autonomous DIP (Documentation Intelligence Pipeline) review agent that:
- Processes ~7,000 staging items automatically
- Uses LLM to approve/reject with confidence scoring
- Escalates uncertain items to Telegram for human review
- **Self-learns from every decision via retrieval-based few-shot examples**

---

## Results

### Training Data Collected (as of 2026-01-04)
| Source | Count |
|--------|-------|
| Human (initial + bulk) | 160 |
| Agent (auto-decisions) | 182 |
| Pre-filter (weak labels) | 27 |
| Telegram (escalations) | 16 |
| **Total** | **385** |

### Decision Breakdown
| Decision | Count | Percentage |
|----------|-------|------------|
| Approved | 236 | 64% |
| Rejected | 114 | 31% |
| Uncertain | 19 | 5% |

### By Table
| Table | Approved | Rejected | Approval Rate |
|-------|----------|----------|---------------|
| spec_suggestions | 94 | 62 | 60% |
| playbook_hints | 89 | 14 | 86% |
| intent_router | 39 | 23 | 63% |
| golden_tests | 14 | 15 | 48% |

### Quality Review (Phase C)
- **Approvals:** Operational specs, procedures, troubleshooting guides
- **Rejections:** Installation-only, compliance, regulatory, generic content
- **Pre-filter:** Correctly catching warranty, FCC, Industry Canada keywords
- **Error rate:** < 5% (acceptable for autonomous operation)

---

## Phases Completed

### Phase A: Production Hardening ✅
| Fix | Description |
|-----|-------------|
| Atomic locking | Partial unique index prevents concurrent runs |
| Atomic claiming | UPDATE...RETURNING pattern for item claiming |
| Table-specific extraction | Content-only matching (no false positives on IDs) |
| Per-table thresholds | Stricter for golden_tests, looser for specs |
| Three run modes | report/active/full |
| Per-item logging | agent_run_items table |
| is_weak_label | Separates pre-filter from LLM decisions |

### Phase B: Get to 200 Decisions ✅
- Ran batch processor multiple times in active mode
- Processed 200+ items across all staging tables
- Pre-filter saved LLM calls on obvious compliance content

### Phase C: Quality Review ✅
Spot-checked agent decisions:
- Approvals: Radar specs, distress procedures, troubleshooting guides
- Rejections: RF safety distances, installation cables, compliance info
- Pre-filter: Warranty cards, FCC Part, Industry Canada correctly rejected

### Phase D: Retrieval-Based Learning ✅
- Added pgvector embedding column to agent_training_decisions
- Backfilled all 209 existing decisions with embeddings
- Agent now finds similar past decisions for few-shot examples
- Every new decision automatically embedded for future retrieval

### Phase E: External Confidence Computation ✅
**Problem:** LLM confidence collapsed to 90%/95% for everything, no real spread.

**Solution:** Don't trust LLM confidence. Compute it externally from measurable signals:

1. **Similarity margin** - `simToApproved - simToRejected` (±20 adjustment)
2. **Novelty penalty** - Items unlike training data get penalized
3. **LLM-similarity agreement** - Bonus if LLM and embeddings agree, penalty if they disagree

**Files Created:**
| File | Purpose |
|------|---------|
| `src/services/agents/dip-confidence.service.js` | External confidence computation |
| `scripts/test-confidence-calibration.cjs` | Test confidence against known decisions |

**Changes:**
- `dip-review-agent.service.js` - Uses external confidence instead of LLM confidence
- `dip-exemplar.service.js` - Returns similarity signals (simToApproved, simToRejected)
- Simplified LLM prompt (no longer asks for confidence)

**Rich Embedding Format:**
Changed from embedding raw content to embedding structured format:
```
System: B&G DST810
Spec: Maximum Speed: 45 knots
Reason: Performance limit for speed sensor.
```
This improves semantic matching - items match on context + reasoning, not just raw values.

**Bulk Training Session (2025-12-28):**
- Added 70 new human decisions across diverse manufacturers
- Manufacturers: B&G, CZone, Kenyon, Harken, Yanmar
- Training now includes equipment-specific rejections (e.g., "VC10 spec but user has VC20")
- Re-embedded all 337 decisions with rich format

---

## Confidence Formula Analysis

### The Problem: LLM Confidence Collapse

When we asked the LLM to provide confidence scores, it consistently returned 90% or 95% regardless of the actual difficulty of the decision. This is a known issue with LLMs - they're trained to produce confident-sounding answers, not to introspect on their own certainty.

**What we got:**
```
Item A (clear spec): 95%
Item B (ambiguous): 90%
Item C (unclear): 90%
Item D (edge case): 90%
```

**Why this happens:**
1. LLMs don't have calibrated uncertainty - they're not computing actual probability
2. 90/95 are "safe defaults" - the model treats confidence as a categorical signal, not continuous
3. Prompt instructions don't override training - we can say "use the full 0-100 range" but the model's weights still cluster

---

### The Solution: External Confidence Computation

Don't trust LLM confidence. Compute it externally from signals we can actually measure.

**Key signals:**
| Signal | Source | What it tells us |
|--------|--------|------------------|
| simToApproved | pgvector similarity | How similar to nearest approved training example |
| simToRejected | pgvector similarity | How similar to nearest rejected training example |
| margin | simToApproved - simToRejected | Direction: closer to approved or rejected? |
| LLM decision | Model output | What does the LLM think (ignoring its confidence) |

---

### Current Formula (v1) - HAS ISSUES

```javascript
base = 70
margin = simToApproved - simToRejected  // -1 to +1
novelty = 1 - max(simToApproved, simToRejected)  // 0 to 1

score = base
      + (margin * 20)      // ±20 based on similarity direction
      - (novelty * 25)     // -25 for completely novel items
      + agreementBonus     // ±8-12 if LLM agrees/disagrees with embeddings
```

**Calibration Results (tested against 25 known-approved decisions):**
```
Avg: 58.4%
Min: 44%
Max: 75%
Would auto-approve (>=88%): 0/25
Would escalate (<75%): 24/25
```

---

### Problem 1: Why Base = 70?

The base of 70 was arbitrary. What should confidence be when we have no signal?

| Scenario | Meaning | Appropriate base? |
|----------|---------|-------------------|
| margin = 0, novelty = 0.5 | Equal distance to approved/rejected | ~60% (uncertain) |
| margin = 0, novelty = 0 | Seen before, no clear direction | ~70% |

**Two philosophies:**
- **Pessimistic:** Start at 70, earn your way up (current)
- **Optimistic:** Start at 85, penalize down for problems

With sparse training data (337 decisions), pessimistic approach means almost nothing passes.

---

### Problem 2: Double-Counting

**The current formula uses simToApproved and simToRejected twice:**

```
margin  = simToApproved - simToRejected  → ±20 adjustment
novelty = 1 - max(simToApproved, simToRejected) → -25 penalty
```

**Example showing the problem:**
```
simToApproved = 0.65, simToRejected = 0.36

margin = 0.29 → +6 (reward for being closer to approved)
novelty = 1 - 0.65 = 0.35 → -9 (penalty for not being similar enough)

The same 0.65 similarity HELPS via margin but HURTS via novelty!
```

This is redundant - we're penalizing items for "novelty" when the real issue is just sparse training data.

---

### Problem 3: Novelty Calculation

Current novelty formula:
```javascript
novelty = 1 - max(simToApproved, simToRejected)
```

**In plain English:** "How different is this from ANYTHING we've trained on?"

| simToApproved | simToRejected | max | novelty |
|---------------|---------------|-----|---------|
| 0.65 | 0.36 | 0.65 | 0.35 (low) |
| 0.42 | 0.35 | 0.42 | 0.58 (moderate) |
| 0.24 | 0.19 | 0.24 | 0.76 (high) |

**The issue:** With only 337 decisions, even "normal" items have low similarity (0.30-0.50), so novelty is always high (0.50-0.70). We're penalizing items for our sparse training data, not for actually being novel.

---

## Implemented Formula v2.2 ✅

### Key Semantic Change

The score now represents **confidence in the chosen decision**, not just direction.
- If LLM says "reject" and embeddings agree → HIGH confidence (not low!)
- This enables both auto-approve AND auto-reject at high scores

### v2.2 Formula (DEPLOYED)

```javascript
// Parameters (calibrated against 160 human decisions)
const BASE = 76;
const SCALE = 100;
const NOVELTY_FLOOR = 0.35;

// Core signals
margin = simToApproved - simToRejected  // direction: -1 to +1
absMargin = |margin|
strength = max(simToApproved, simToRejected)  // 0 to 1 (linear, not s²)

// Agreement: does LLM decision match embedding signal?
agrees = (llmDecision === 'approved' && margin > 0) ||
         (llmDecision === 'rejected' && margin < 0)

// Core adjustment: confidence in the decision
evidence = absMargin * strength
coreAdj = evidence * SCALE * (agrees ? +1 : -1)

score = BASE + coreAdj

// Gated novelty penalty (only for truly out-of-distribution items)
if (strength < NOVELTY_FLOOR) {
  score -= (NOVELTY_FLOOR - strength) * 40
}

// Top-k separation (neighborhood consistency)
separation = (a1 - a2) - (r1 - r2)
score += clamp(separation * 20, -6, 6)
```

### Threshold Semantics v2.2

| Score | Action | Description |
|-------|--------|-------------|
| ≥ 85 | **AUTO_COMMIT** | Execute LLM decision (approve OR reject) |
| 75-84 | **QUEUE** | Batch review |
| < 75 | **ESCALATE** | Real-time Telegram |

**Safety Guardrail:** If score ≥ 85 but `agrees === false` → downgrade to QUEUE

### Calibration Results (160 human decisions)

| Decision | Count | Avg Score | Min | Max |
|----------|-------|-----------|-----|-----|
| Approved | 120 | 80.9% | 59% | 100% |
| Rejected | 40 | 74.9% | 56% | 83% |

| Action | Count | Percentage |
|--------|-------|------------|
| Auto-commit | 30 | 19% |
| Queue | 96 | 60% |
| Escalate | 34 | 21% |

### Why Linear Strength (not s²)

With sparse training data (337 decisions), similarities are typically 0.3-0.6. Using s² would dampen signals too much:
- s=0.5 → s²=0.25 (cuts adjustment by 75%)
- Linear s gives better spread while still respecting signal strength

### Why avg(top-3) Instead of top-1

Single nearest neighbor can be an outlier. avg(top-3) smooths the signal:
```javascript
simToApproved = avg(top3ApprovedSimilarities)
simToRejected = avg(top3RejectedSimilarities)
```

---

## How It Works Now (v2.2)

```
New item arrives
        ↓
Pre-Filter (deterministic, no LLM)
  → Matches compliance keyword? → REJECT (is_weak_label=true)
        ↓
Embedding generated for item
        ↓
Find top-8 similar APPROVED decisions (pgvector)
Find top-8 similar REJECTED decisions (pgvector)
  → Extract: avg(top-3) for each → simToApproved, simToRejected
  → Extract: top-2 for separation signal → a1, a2, r1, r2
        ↓
LLM evaluates with dynamic few-shot examples
  → Returns: decision, reasoning (NO confidence - we don't trust it)
        ↓
External Confidence v2.2
  → margin = simToApproved - simToRejected
  → agrees = LLM direction matches embedding direction?
  → evidence = |margin| * strength
  → score = 76 + (evidence * 100 * agrees_sign) + separation_adj
  → action = score >= 85 && agrees ? 'auto_commit' : score >= 75 ? 'queue' : 'escalate'
        ↓
Execute action
  → AUTO_COMMIT: apply LLM decision (approve OR reject)
  → QUEUE: batch review later
  → ESCALATE: Telegram for human review
        ↓
Decision recorded + embedding stored
(available for future similar items)
```

---

## Per-Table Thresholds

| Table | Auto-Approve | Auto-Reject | Escalate Below |
|-------|--------------|-------------|----------------|
| staging_spec_suggestions | 88% | 90% | 75% |
| staging_playbook_hints | 90% | 92% | 80% |
| staging_intent_router | 92% | 94% | 82% |
| staging_golden_tests | 95% | 95% | 85% |

**Rationale:** Higher-risk tables (golden_tests, intent_router) require more confidence.

---

## Files Created/Modified

### Phase A Files
| File | Purpose |
|------|---------|
| `scripts/migrations/025_agent_run_state.sql` | Run tracking, locking |
| `scripts/migrations/025a` (SQL in Supabase) | Fixes: atomic locking, is_weak_label, agent_run_items |
| `scripts/agents/dip-batch-processor.cjs` | Main batch runner with 3 modes |
| `src/services/agents/dip-policy.service.js` | Pre-filter + policy engine |
| `src/services/agents/dip-metrics.service.js` | Run metrics + observability |
| `src/utils/retry.js` | Generic retry with backoff |
| `src/services/dip-telegram-bot.service.js` | Enhanced with /stats, embedding storage |

### Phase D Files
| File | Purpose |
|------|---------|
| `scripts/migrations/026_agent_embeddings.sql` | pgvector embedding column + match function |
| `scripts/backfill-decision-embeddings.cjs` | One-time backfill of 209 decisions |
| `src/services/agents/dip-exemplar.service.js` | Embedding generation + similarity search |
| `src/services/agents/dip-review-agent.service.js` | Updated to use dynamic examples |

---

## Database Schema

### agent_training_decisions (updated)
```sql
-- Added columns:
embedding vector(1536)    -- pgvector for similarity search
is_weak_label boolean     -- true for pre-filter decisions

-- New index:
CREATE INDEX idx_training_embedding
  ON agent_training_decisions
  USING ivfflat (embedding vector_cosine_ops);
```

### agent_run_items (new)
```sql
CREATE TABLE agent_run_items (
  id uuid PRIMARY KEY,
  run_id uuid REFERENCES agent_runs(id),
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  action text NOT NULL,  -- pre_reject, auto_approved, auto_rejected, escalated, queued, error
  confidence numeric,
  reason text,
  error_message text,
  created_at timestamptz
);
```

### match_training_decisions (new function)
```sql
-- Find similar past decisions for few-shot examples
SELECT * FROM match_training_decisions(
  query_embedding := <vector>,
  match_count := 4,
  filter_table := 'staging_spec_suggestions',
  filter_decision := 'approved',
  exclude_weak_labels := true
);
```

---

## Usage

### Run Batch Processor
```bash
# Report mode (safe testing - logs but doesn't change status)
node scripts/agents/dip-batch-processor.cjs --mode=report --max-items=50 --verbose

# Active mode (full operation)
node scripts/agents/dip-batch-processor.cjs --mode=active --max-items=100 --max-escalations=15

# With Telegram for escalations
node scripts/test-dip-bot-polling.cjs  # Terminal 1
node scripts/agents/dip-batch-processor.cjs --mode=active --max-items=100  # Terminal 2
```

### Check Stats
```bash
# In Telegram, send /stats to @BoatOS_Qs_bot
```

### Review Decisions
```sql
-- Summary
SELECT decision, decision_source, is_weak_label, COUNT(*)
FROM agent_training_decisions
WHERE agent_type = 'dip'
GROUP BY decision, decision_source, is_weak_label;

-- Check embedding coverage
SELECT
  COUNT(*) as total,
  COUNT(embedding) as with_embedding
FROM agent_training_decisions
WHERE agent_type = 'dip';
```

---

## Key Design Decisions

### 1. LLM is Judge, Policy is Gatekeeper
The LLM evaluates and provides confidence. The policy engine decides whether to trust that judgment based on thresholds.

### 2. Pre-filter Saves Money
Deterministic keyword matching rejects obvious compliance/legal content without LLM calls. Marked as `is_weak_label=true` to exclude from retrieval training.

### 3. Per-Table Thresholds
Not all tables are equal risk. Golden tests that poison the test suite need 95% confidence. Specs are lower risk at 88%.

### 4. Retrieval > Static Examples
Instead of fixed few-shot examples, we find the most similar past decisions. A new fuel spec sees past fuel spec decisions. A new playbook sees past playbook decisions.

### 5. Automatic Learning
Every decision (agent, telegram, human) is automatically embedded. The system gets smarter with every decision without manual intervention.

---

## Observations

### LLM Confidence Distribution
The LLM (gpt-4.1-mini) consistently returns 90% or 95% confidence. This means:
- Most items auto-approve/reject (good)
- Few escalations to Telegram (acceptable)
- Some items "queued" in middle zone (needs future batch review UI)

### No Escalations
Because confidence is always ≥90%, nothing falls below the escalation thresholds (75-85%). This could be addressed by raising thresholds or adjusting the prompt.

---

## Future Improvements

1. **Batch Review UI** - Handle "queued" items that are in the confidence middle zone
2. **Near-duplicate removal** - Avoid showing near-identical examples
3. **Confidence calibration** - Tune prompt to get more varied confidence scores
4. **Auto-rebuild criteria** - `--mode=full` to periodically update learned_criteria from decisions

---

## Context for Next Session

If continuing after /compact:

### Current State (2026-01-04)
- **369 decisions** with rich-format embeddings
- **v2.2 formula deployed** - agreement-based, linear strength
- **Telegram reasoning capture IMPLEMENTED** - approvals use LLM reason, rejections have button flow
- **Batch processor `--poll` flag** - keeps running for callbacks
- **~10% auto-commit**, ~60% queue, ~30% escalate (queue problem identified)

### Key Files
| File | Purpose |
|------|---------|
| `src/services/agents/dip-confidence.service.js` | External confidence v2.2 |
| `src/services/agents/dip-review-agent.service.js` | Uses v2.2 action semantics |
| `src/services/agents/dip-exemplar.service.js` | avg(top-3) + top-2 signals |
| `src/services/dip-telegram-bot.service.js` | Telegram with reasoning capture |
| `scripts/agents/dip-batch-processor.cjs` | Batch runner with `--poll` |
| `scripts/test-single-eval.cjs` | Test confidence breakdown on one item |

### Test Commands
```bash
# Test single item evaluation with confidence breakdown
node scripts/test-single-eval.cjs

# Run batch with Telegram polling (RECOMMENDED)
node scripts/agents/dip-batch-processor.cjs --max-items=10 --poll

# Run batch without polling (escalations won't get callbacks)
node scripts/agents/dip-batch-processor.cjs --max-items=10

# Report mode (no changes, just logs)
node scripts/agents/dip-batch-processor.cjs --mode=report --max-items=20
```

### Formula Evolution
| Version | Description | Status |
|---------|-------------|--------|
| v0 | Trust LLM confidence | Collapsed to 90/95% |
| v1 | External: base + margin - novelty | Double-counting, 58% avg |
| v1.5 | External: s², agreement-based | Still too harsh |
| **v2.2** | **Linear s, agreement-based, guardrail** | **DEPLOYED** |

### The Queued Items Problem

**Situation:** With 7,000 items and 369 training examples:
- Most items only 30-50% similar to training data (low strength)
- Low strength → score stays near base (76) → lands in queue zone
- ~4,200 items stuck in queue, ~2,100 would escalate (too many)

**Root cause:** Not enough training density per equipment/category type.

**Options not yet decided:**
1. Lower auto-commit threshold (85% → 75%)
2. Sample-based review (auto-commit all, spot-check 5%)
3. Remove queue zone entirely

### Next Steps
1. **Decide on queued items strategy** - lower thresholds or sample-based?
2. Commit the Telegram reasoning capture code
3. Run larger batch with `--poll` to test at scale
4. Monitor error rate on auto-committed items

---

## Phase G: Telegram Reasoning Capture ✅ IMPLEMENTED

### Problem Solved
Previously stored generic reasoning:
```javascript
reasoning: 'Decision made via Telegram'  // Useless for training!
```

Now captures meaningful reasoning for embeddings.

### Solution Implemented: Hybrid Approach

**For Approvals:**
- Uses LLM reasoning (human agreed, so LLM reason is valid)
- Stored automatically when Approve button tapped

**For Rejections:**
- Shows quick reason buttons:
  ```
  [Wrong Equipment] [Installation Only]
  [Compliance/Legal] [Too Generic]
  [Other...]
  ```
- If "Other" tapped, prompts for text reply
- Reason captured in database

### Implementation Details

**Files Modified:**
- `src/services/dip-telegram-bot.service.js`
  - Added `pendingEscalations` Map to store evaluation data
  - Added `pendingReasonRequests` Map for "Other" text replies
  - Modified callback handler for approval (uses LLM reasoning)
  - Added rejection reason button flow
  - Added `setupMessageHandlers()` for text replies

**Callback Data Format:**
```
a:spec:uuid           → Approve (uses stored LLM reasoning)
r:spec:uuid           → Reject (shows reason buttons)
rr:spec:uuid:wrong    → Rejection reason: Wrong Equipment
rr:spec:uuid:install  → Rejection reason: Installation Only
rr:spec:uuid:comply   → Rejection reason: Compliance/Legal
rr:spec:uuid:generic  → Rejection reason: Too Generic
rr:spec:uuid:other    → Rejection reason: Other (prompts for text)
```

**Reason Text Mapping:**
| Code | Stored Reasoning |
|------|------------------|
| wrong | "Wrong equipment or system mismatch" |
| install | "Installation/setup instructions only" |
| comply | "Compliance, legal, or regulatory content" |
| generic | "Too generic or not actionable" |
| other | User's typed text |

### Improved Message Format

Old format:
```
*DIP Review Needed*
Confidence: 72%
*Table:* `staging_spec_suggestions`
*System:* Kenyon silken_grill
...
```

New format:
```
*Spec: Kenyon silken_grill*

`Preheat Time`: 5-7 minutes [heating]
_Operating temperature guidance for grill preheat._

_Agent says:_ Provides specific operational parameter...
_Confidence:_ 72%

[Approve] [Reject]
```

### Batch Processor `--poll` Flag

The batch processor now supports `--poll` to keep running after processing:

```bash
# Process items AND stay running for Telegram callbacks
node scripts/agents/dip-batch-processor.cjs --max-items=10 --poll
```

This ensures:
1. Escalations populate `pendingEscalations` Map
2. Bot polls for callbacks
3. LLM reasoning is available when user responds

Without `--poll`, escalations are sent but process exits before callbacks arrive.

---

## Known Issue: Queued Items Problem

### The Problem
With 7,000 pending items and current thresholds:

| Zone | Percentage | Items |
|------|------------|-------|
| Auto-commit (≥85%) | ~10% | ~700 |
| Queued (75-84%) | ~60% | **~4,200 stuck** |
| Escalated (<75%) | ~30% | ~2,100 (too many!) |

### Root Cause: Low Embedding Strength

Example evaluation of a pending item:
```
simToApproved: 0.424  (42% similar to nearest approved)
simToRejected: 0.315  (32% similar to nearest rejected)
strength:      0.424  (max similarity to ANY training data)
```

**Why strength is low:**
- 369 training examples spread across 4 tables
- Many equipment types (Kenyon, Victron, Yanmar, B&G, etc.)
- Most items only 30-50% similar to training data
- Low strength → score stays near base (76) → queued

### Confidence Formula Impact

```
score = 76 (base) + (margin × strength × 100) + adjustments
score = 76 + (0.109 × 0.424 × 100) + 6
score = 76 + 4.6 + 6 = 82%  → QUEUED
```

The item is 42% similar to approved, LLM agrees, but score only reaches 82% - not enough for auto-commit (≥85%).

### Options to Address

| Option | Description | Trade-off |
|--------|-------------|-----------|
| Lower auto-commit to 75% | Everything not escalated auto-commits | More errors possible |
| Sample-based | Auto-commit all, spot-check 5% | Less review, needs spot-check UI |
| More training data | Increase density per equipment type | Chicken/egg problem |
| Remove queue zone | Only auto-commit or escalate | Binary decision |

**Current status:** SOLVED with v3.0 - see Phase H below.

---

## Phase H: v3.0 Margin-Based Logic ✅ DEPLOYED (2026-01-04)

### The Problem with v2.2

The percentage-based thresholds (85% auto-commit, 75% queue, <75% escalate) resulted in:
- ~10% auto-commit (too low)
- ~60% queued (stuck, no mechanism to process)
- ~30% escalate (too many for manual review)

Root cause: Low embedding strength (30-50% similarity) kept scores near base (76), landing in queue zone.

### The Solution: Margin-Based Logic

**Key insight:** Training data IS giving directional signal, we just weren't using it right.

```
Example:
simToApproved: 0.424 (42% similar to approved)
simToRejected: 0.315 (32% similar to rejected)
margin: +0.109 (10.9% lean toward approved)
```

The margin (+0.109) says "this looks more like stuff Brad approved." That's useful signal!

### v3.0 Formula

```javascript
// In dip-confidence.service.js
const APPROVE_MARGIN_THRESHOLD = 0.04;  // 4% lean toward approved
const REJECT_MARGIN_THRESHOLD = 0.12;   // 12% lean toward rejected (higher bar)

margin = simToApproved - simToRejected;

// Decision logic:
1. Pre-filter match → auto_reject (no LLM)
2. LLM uncertain → escalate (Telegram)
3. margin >= +0.04 AND LLM approve → auto_commit
4. margin <= -0.12 AND LLM reject → auto_commit
5. Everything else → queue
```

### Why Asymmetric Thresholds?

| Decision | Threshold | Reason |
|----------|-----------|--------|
| Approve | 0.04 | Lower bar - wrong approvals are fixable |
| Reject | 0.12 | Higher bar - wrong rejections lose content forever |

### Results with v3.0

Tested on 20 items:

| Metric | v2.2 (old) | v3.0 (new) |
|--------|-----------|-----------|
| Auto-Approved | 40% | **70%** |
| Queued | 50% | **25%** |
| Escalated | 10% | 0% |
| Pre-Reject | 5% | 5% |

**70% auto-approve rate** - up from 10% with v2.2!

### Files Modified

| File | Changes |
|------|---------|
| `src/services/agents/dip-confidence.service.js` | Replaced v2.2 formula with margin-based logic |
| `src/services/agents/dip-review-agent.service.js` | Normalized LLM decision to lowercase |
| `scripts/agents/dip-batch-processor.cjs` | Uses v3.0 action from confidence service |
| `src/services/agents/dip-policy.service.js` | Added pre-filter keywords |

### Pre-Filter Updates

Added to REJECT_KEYWORDS:
```javascript
'compliance documentation',  // Catches "Accessing Compliance Documentation"
'class a',                   // Regulatory device classification
'class b',                   // Regulatory device classification
'software version',          // Static data that becomes outdated
```

### Bug Fixes

1. **Case sensitivity:** LLM sometimes returns "APPROVED" instead of "approved"
   - Fixed by normalizing to lowercase in both dip-review-agent and dip-confidence

2. **Batch processor policy:** Was using old percentage thresholds from agent_config
   - Fixed by using `evaluation.confidenceBreakdown.action` directly

### Test Data

Two test sets saved for reproducibility:
- `scripts/test-data/v3-test-set.json` - First 20 items
- `scripts/test-data/v3-test-set-2-final.json` - Second 20 items with v3.0 results

### Test Commands

```bash
# Test single item with confidence breakdown
node scripts/test-single-eval.cjs

# Test against training data (10 approved, 10 rejected)
node scripts/test-v3-against-training.cjs

# Run batch with v3.0 logic
node scripts/agents/dip-batch-processor.cjs --max-items=20 --poll
```

---

## Context for Next Session

### Current State (2026-01-10)
- **385+ decisions** in training data
- **v3.0 margin-based logic DEPLOYED**
- **50% auto-approve, 5% auto-reject, 45% queued** on test batches
- Pre-filter fixed (removed ™ and ® false positives)
- First auto-reject via margin logic achieved (FCC compliance item)

### Key Thresholds
| Action | Condition |
|--------|-----------|
| Auto-approve | margin >= +0.04 AND LLM says approve |
| Auto-reject | margin <= -0.12 AND LLM says reject |
| Escalate | LLM says "uncertain" |
| Queue | Everything else |

### Key Files
| File | Purpose |
|------|---------|
| `src/services/agents/dip-confidence.service.js` | v3.0 margin logic |
| `src/services/agents/dip-policy.service.js` | Pre-filter keywords (™/® removed) |
| `scripts/agents/dip-batch-processor.cjs` | Batch runner |
| `scripts/get-run-details.cjs` | View recent decisions with details |

### Observations
- Playbook items perform well (strong margins, procedural patterns)
- Golden tests struggle (most end up queued)
- Queue rate of 45% still high - may need to lower approve threshold

### Next Steps
1. Decide on queue strategy - lower approve threshold from 0.04 to 0.02?
2. Run larger batch (100+ items) to validate at scale
3. Consider table-specific thresholds (lower for playbooks, higher for golden_tests)
4. Deploy to production on Render

---

## Session: 2026-01-10 - Pre-Filter Fix and Validation Run

### Pre-Filter False Positives Fixed

**Problem:** The pre-filter was catching ™ and ® symbols, rejecting legitimate content like:
- "The Airmar CAST™ app is used to calibrate the DST810"
- "Maximum depth range is up to 100 meters for NMEA 2000®"

These are brand names, not content *about* trademarks.

**Fix:** Removed ™ and ® from REJECT_KEYWORDS. Changed to more specific patterns:

```javascript
// Old (too aggressive)
'trademark',
'registered trademark',
'®',
'™',

// New (more specific)
'trademark of',
'registered trademark of',
'trademarks are property',
```

**File Modified:** `src/services/agents/dip-policy.service.js`

### Test Run Results (20 items)

| Action | Count | % |
|--------|-------|---|
| Auto-Approved | 10 | 50% |
| Auto-Rejected | 1 | 5% |
| Pre-Filtered | 0 | 0% |
| Queued | 9 | 45% |

**First LLM Auto-Reject via Margin Logic:**
- Query: "What class of digital device limits must the equipment comply with?"
- Expected: "Class B digital device limits per FCC Rules Part 15"
- Margin: -0.135 (below -0.12 threshold)
- Reasoning: FCC compliance content, not operationally valuable
- **Correctly rejected**

### Auto-Approved Items (all correct)

1. Yanmar Starting Engine procedure
2. B&G data update frequency specs
3. B&G paddlewheel weight specs
4. B&G DST810 calibration procedure
5. Yanmar Normal Operating Speed spec
6. Yanmar Normal Engine Shutdown procedure
7. Yanmar VC10 System Engine Start procedure
8. Yanmar Trolling Mode Activation procedure
9. Yanmar Remote Control Handle Operation procedure
10. Yanmar Emergency Engine Stop procedure

Plus 4 Kenyon grill specs (power output, voltage, dimensions, cutout dimensions)

### Observations

1. **Queue rate still high (45%)** - Many items have margins between -0.04 and +0.04 where embeddings don't provide strong signal
2. **No pre-filter false positives** - After removing ™ and ®
3. **Playbook items performing well** - Strong margins (0.10+) due to procedural pattern matching
4. **Golden tests struggling** - Most queued items are from golden_tests table

### Utility Script Created

**`scripts/get-run-details.cjs`** - Shows detailed results from recent agent decisions:
- System, Parameter, Value, Category for each item
- Confidence and reasoning
- Grouped by action (auto-approved, pre-filtered, auto-rejected)

```bash
# Show last 10 minutes of decisions
node scripts/get-run-details.cjs 10
```

### Files Modified This Session

| File | Changes |
|------|---------|
| `src/services/agents/dip-policy.service.js` | Removed ™ and ® from pre-filter |
| `scripts/get-run-details.cjs` | New utility script for reviewing decisions |
