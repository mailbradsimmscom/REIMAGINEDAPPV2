# 69 Autonomous DIP and Maintenance Review Agents

**Date:** 2025-12-26
**Last Updated:** 2026-01-04
**Status:** ✅ COMPLETE - v3.0 margin-based logic deployed
**Priority:** High - Core feature for scaling review process

> **Note:** This doc covers the initial build. See **Document 70** for v3.0 margin-based logic, confidence formula evolution, and current operational details.

---

## Overview

Building two autonomous agents that learn from user decisions to review and process:
1. **DIP Agent** - Reviews DIP staging tables (specs, procedures, Q&A, troubleshooting) - **BUILT**
2. **Maintenance Agent** - Reviews maintenance_tasks_index (Phase 2, after DIP)

The agents learn from chat-based training where the user approves/rejects items and explains why. Once enough training data is collected (~50 decisions), the agent can run autonomously with Telegram escalation for uncertain cases.

---

## Current Status (2026-01-04)

### ALL PHASES COMPLETE ✅

| Phase | Status |
|-------|--------|
| Database tables | ✅ Created + pgvector embeddings |
| Training data | ✅ 385 decisions (was 50 initially) |
| LLM evaluation | ✅ Working with v3.0 margin-based logic |
| Telegram escalation | ✅ Working with reasoning capture |
| Batch processor | ✅ Working with `--poll` flag + v3.0 logic |
| Retrieval-based learning | ✅ Embeddings for all decisions |

### Training Data Growth
| Phase | Decisions |
|-------|-----------|
| Initial (chat training) | 50 |
| Bulk training session | +70 |
| Agent auto-decisions | +166 |
| Telegram callbacks | +16 |
| Pre-filter (weak labels) | +27 |
| v3.0 test batch (2026-01-04) | +16 |
| **Total** | **385** |

### v3.0 Margin-Based Logic (2026-01-04)
Replaced percentage-based confidence with margin-based:
- **Approve:** margin >= +0.04 AND LLM agrees
- **Reject:** margin <= -0.12 AND LLM agrees
- **Escalate:** LLM says "uncertain"
- **Queue:** everything else

See **Document 70** for detailed architecture, confidence formula, and operational procedures.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: Training (Chat-based) ✅ COMPLETE                     │
│  - 50 decisions collected via chat                              │
│  - 37 approved, 13 rejected                                     │
│  - Reasoning captured for each decision                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 2: Pattern Extraction ✅ COMPLETE                        │
│  - Criteria extracted from reasoning                            │
│  - 8 few-shot approval examples                                 │
│  - 8 few-shot rejection examples                                │
│  - Stored in agent_config.learned_criteria                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 3: Autonomous Agent ✅ BUILT                             │
│  - src/services/agents/dip-review-agent.service.js              │
│  - Uses oaiJson for LLM evaluation                              │
│  - High confidence (>0.90) → auto-process                       │
│  - Low confidence (<0.80) → Telegram escalation                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Telegram Escalation ✅ BUILT (SEPARATE BOT)                    │
│  - src/services/dip-telegram-bot.service.js                     │
│  - Bot: @BoatOS_Qs_bot (separate from anchor watch)             │
│  - Sends items with Approve/Reject buttons                      │
│  - Callback handler records decisions back to training          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Training Data Summary

### 50 Decisions Collected

**By Table:**
| Table | Decisions |
|-------|-----------|
| staging_spec_suggestions | 15 |
| staging_playbook_hints | 13 |
| staging_intent_router | 11 |
| staging_golden_tests | 11 |

**By Decision:**
- Approved: 37 (74%)
- Rejected: 13 (26%)

### Learned Rejection Criteria

From the 13 rejections, the agent learned to reject:

1. **Compliance/Regulatory content** - CE, UKCA, FCC certifications, legal disclaimers
2. **Installation-only content** - Tools needed, installation procedures (unless useful for repairs)
3. **Warranty/administrative** - How to find warranty cards, legal documents
4. **Zero-value obvious info** - "English is the official language"
5. **Outdated static data** - Specific firmware versions that change with updates
6. **Too generic content** - Not specific to the actual system

### Learned Approval Criteria

From the 37 approvals, the agent learned to approve:

1. **Legitimate specs** - Current draw, dimensions, capacity, pressure limits
2. **Operational procedures** - How to configure, calibrate, winterize, maintain
3. **Troubleshooting info** - Failure indications, expected values, test methods
4. **Repair-relevant specs** - Pipe sizes, cable lengths, connector types (even if "installation" category)
5. **Safety procedures** - Pre-start checklists, storage/restart procedures
6. **Practical Q&A** - Questions an owner might actually ask

---

## Database Schema

### Tables Created (Migration 024)

**`agent_training_decisions`** - Stores every decision with reasoning
```sql
CREATE TABLE agent_training_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type text NOT NULL,           -- 'dip' or 'maintenance'
  source_table text NOT NULL,         -- e.g., 'staging_spec_suggestions'
  source_id uuid NOT NULL,            -- ID of the item reviewed
  item_snapshot jsonb NOT NULL,       -- Full item data at decision time
  decision text NOT NULL,             -- 'approved' | 'rejected'
  reasoning text,                     -- User's explanation
  decision_source text DEFAULT 'human', -- 'human' | 'agent' | 'telegram'
  confidence numeric,                 -- Agent confidence (null for human)
  created_at timestamptz DEFAULT now()
);
```

**`agent_config`** - Agent state and learned criteria
```sql
CREATE TABLE agent_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type text UNIQUE NOT NULL,
  total_decisions integer DEFAULT 0,
  min_decisions_to_activate integer DEFAULT 50,
  is_active boolean DEFAULT false,
  auto_approve_threshold numeric DEFAULT 0.85,
  auto_reject_threshold numeric DEFAULT 0.85,
  escalate_below numeric DEFAULT 0.70,
  learned_criteria jsonb,             -- Extracted rules/patterns
  example_approvals jsonb,            -- Few-shot examples
  example_rejections jsonb,           -- Few-shot examples
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

---

## Key Files Created This Session

| File | Status | Purpose |
|------|--------|---------|
| `scripts/migrations/024_agent_training_tables.sql` | ✅ Created & Run | DB schema |
| `scripts/run-migration-024.cjs` | ✅ Created | Verify tables exist |
| `scripts/record-training-decision.cjs` | ✅ Created | Store decisions from chat |
| `scripts/get-pending-dip-item.cjs` | ✅ Created | Fetch items for training |
| `scripts/build-agent-criteria.cjs` | ✅ Created | Extract criteria from training |
| `scripts/test-dip-agent.cjs` | ✅ Created | Test escalation to Telegram |
| `scripts/test-dip-bot-polling.cjs` | ✅ Created | Test callback handler |
| `src/services/agents/dip-review-agent.service.js` | ✅ Created | Core evaluation logic |
| `src/services/dip-telegram-bot.service.js` | ✅ Created | Telegram bot with callbacks |

### Files Modified

| File | Change |
|------|--------|
| `src/config/env.js` | Added `TELEGRAM_DIP_BOT_TOKEN`, `TELEGRAM_DIP_CHAT_ID` |
| `src/start.js` | Added DIP bot startup/shutdown |
| `.env` | Added DIP bot credentials |

---

## Environment Variables Added

```bash
# DIP Review Bot (separate from Anchor Watch)
TELEGRAM_DIP_BOT_TOKEN=8530126939:AAFiPH4RLN2gQWaNebaUKZcIot22iqT-Ylo
TELEGRAM_DIP_CHAT_ID=1382446578
```

**Why separate bot?**
- Anchor Watch = Safety alerts (urgent)
- DIP Review = Training decisions (can wait)
- Can mute DIP bot without missing anchor alerts

---

## Agent Service Details

### `src/services/agents/dip-review-agent.service.js`

**Key Functions:**

```javascript
// Evaluate a single item using LLM + few-shot examples
export async function evaluateItem(item, sourceTable)
// Returns: { decision, confidence, reasoning, matchedCriteria }

// Process item through full workflow
export async function processItem(item, sourceTable)
// Returns: { action: 'auto_approved'|'auto_rejected'|'escalate'|'queued', evaluation }

// Get pending items for batch processing
export async function getPendingItems(limit = 10)
// Returns: Array of { table, item }

// Get agent statistics
export async function getAgentStats()
```

**Confidence Thresholds (Conservative for v1):**
- Auto-approve: >= 0.90 confidence
- Auto-reject: >= 0.90 confidence
- Escalate to Telegram: < 0.80 confidence
- Queue for batch: 0.80-0.90 confidence

---

## Telegram Bot Details

### `src/services/dip-telegram-bot.service.js`

**Commands:**
- `/start` - Welcome message
- `/stats` - Show agent statistics
- `/help` - Show help

**Callback Handling:**
- Parses callback data: `approve:table_name:item_id` or `reject:table_name:item_id`
- Records decision to `agent_training_decisions` with `decision_source: 'telegram'`
- Updates source item status
- Increments `total_decisions` in `agent_config`
- Updates message to show decision was made

**Escalation Format:**
```
*DIP Review Needed*
Confidence: 65%

*Table:* `staging_spec_suggestions`

*System:* Yanmar Port_Stbd_Engine
*Parameter:* Engine Type
*Value:* Common Rail Series
*Category:* Performance

*Agent Reasoning:*
Legitimate specification of the engine

[Approve] [Reject]
```

---

## Testing the Agent

### Step 1: Test Telegram Escalation

```bash
# Send a test item to Telegram
node scripts/test-dip-agent.cjs
```

This will:
1. Fetch a pending item
2. Send it to Telegram with Approve/Reject buttons
3. You can tap a button to test (but callback won't be received yet)

### Step 2: Start Bot Polling

```bash
# In a separate terminal, start the bot to receive callbacks
node scripts/test-dip-bot-polling.cjs
```

Now when you tap buttons in Telegram:
1. Bot receives the callback
2. Records decision to database
3. Updates item status
4. Updates message to show decision

### Step 3: Check Stats

In Telegram, send `/stats` to see:
- Total decisions
- Breakdown by source (human/agent/telegram)
- Breakdown by decision (approved/rejected)

### Step 4: Test Agent Evaluation (Future)

```bash
# TODO: Create script to test LLM evaluation
node scripts/test-agent-evaluation.cjs
```

---

## Learned Criteria (Stored in agent_config)

```json
{
  "version": "1.0",
  "trained_at": "2025-12-26T17:53:07.449Z",
  "total_decisions": 50,
  "approval_rate": "74.0%",
  "reject_if": [
    "Content is about regulatory compliance (CE, UKCA, FCC, certifications)",
    "Content is legal disclaimers or trademark information",
    "Content is about warranty documentation access",
    "Content is installation-only with no repair value",
    "Content is static data that becomes outdated (e.g., specific firmware version numbers)",
    "Content is obvious/common knowledge with zero value add",
    "Content is too generic and not specific to the actual system"
  ],
  "approve_if": [
    "Content is a legitimate operational specification (current, voltage, pressure, dimensions, capacity)",
    "Content is a step-by-step operational procedure",
    "Content is troubleshooting info with expected values and failure indicators",
    "Content is repair-relevant (even if categorized as installation)",
    "Content is safety or maintenance procedure",
    "Content answers a practical question an owner might ask"
  ],
  "rejection_keywords": ["legal", "too-generic", "zero-value", "compliance", "static-outdated", "regulatory", "installation-only"],
  "approval_keywords": ["operational", "specification", "process", "troubleshooting", "repair-relevant", "maintenance", "safety"]
}
```

---

## Pending Items Count (As of Training)

| Table | Pending | Description |
|-------|---------|-------------|
| `staging_spec_suggestions` | ~1,900 | Equipment specifications |
| `staging_playbook_hints` | ~1,100 | Step-by-step procedures |
| `staging_intent_router` | ~2,200 | Q&A routing pairs |
| `staging_golden_tests` | ~1,700 | Troubleshooting test cases |
| **Total** | **~7,000** | |

---

## Implementation Checklist

### Phase 1: Training Infrastructure ✅ COMPLETE
- [x] Create migration file: `scripts/migrations/024_agent_training_tables.sql`
- [x] Run migration in Supabase SQL Editor
- [x] Verify tables created
- [x] Create `scripts/record-training-decision.cjs`
- [x] Create `scripts/get-pending-dip-item.cjs`

### Phase 2: Chat-Based Training ✅ COMPLETE
- [x] Collect 50 training decisions
- [x] Diverse coverage across 4 tables
- [x] Capture reasoning for each decision

### Phase 3: Pattern Extraction ✅ COMPLETE
- [x] Create `scripts/build-agent-criteria.cjs`
- [x] Extract criteria from reasoning
- [x] Build few-shot examples (8 approvals, 8 rejections)
- [x] Store in `agent_config.learned_criteria`

### Phase 4: Agent Service ✅ COMPLETE
- [x] Create `src/services/agents/dip-review-agent.service.js`
- [x] Implement `evaluateItem()` with LLM
- [x] Implement `processItem()` with thresholds
- [x] Implement `getPendingItems()` for batch processing

### Phase 5: Telegram Integration ✅ COMPLETE
- [x] Create new bot (@BoatOS_Qs_bot)
- [x] Add bot token to `.env`
- [x] Create `src/services/dip-telegram-bot.service.js`
- [x] Implement callback handler for Approve/Reject
- [x] Wire bot into server startup
- [x] Create test scripts

### Phase 6: Testing 🔄 IN PROGRESS
- [ ] Test Telegram escalation (run `test-dip-agent.cjs`)
- [ ] Test callback handling (run `test-dip-bot-polling.cjs`)
- [ ] Test LLM evaluation accuracy
- [ ] Adjust thresholds if needed

### Phase 7: Production Deployment
- [ ] Deploy to Render
- [ ] Verify bot starts in production
- [ ] Monitor initial agent decisions
- [ ] Collect more training data via Telegram callbacks

### Phase 8: Cron Runner (Future)
- [ ] Create scheduled job to process pending items
- [ ] Implement batch processing
- [ ] Add monitoring/alerting

---

## Known Limitations

1. **Training data skew** - All 13 rejections are compliance/legal. No rejected operational content.
2. **Single training session** - Patterns might shift with more diverse content.
3. **Conservative thresholds** - Set high (0.90) to minimize errors, will escalate more items.

**Mitigation:** Telegram callbacks feed back into training data, so agent improves over time.

---

## Commands Reference

```bash
# Check training stats
node scripts/record-training-decision.cjs stats dip

# Get pending item counts
node scripts/get-pending-dip-item.cjs counts

# Get next item for training
node scripts/get-pending-dip-item.cjs next

# Rebuild criteria from training data
node scripts/build-agent-criteria.cjs

# Test Telegram escalation
node scripts/test-dip-agent.cjs

# Start bot for callback testing
node scripts/test-dip-bot-polling.cjs
```

---

## Context for Next Session

**Where we left off:** All infrastructure built. Ready to test the full flow.

**Immediate actions:**
1. Run `node scripts/test-dip-agent.cjs` to send test escalation
2. Run `node scripts/test-dip-bot-polling.cjs` to test callback handling
3. Tap buttons in Telegram to verify end-to-end flow

**After testing works:**
1. Create a script to run agent evaluation on a batch of items
2. Review agent decisions for accuracy
3. Deploy to production (bot will auto-start)

**Production URL for testing:**
- Bot will start automatically when `NODE_ENV=production`
- Uses `TELEGRAM_DIP_BOT_TOKEN` and `TELEGRAM_DIP_CHAT_ID` from env

---

## Related Documentation

- `.cursorrules` - Coding standards (route→service→repository)
- `CLAUDE.md` - Architecture overview, critical rules
- `code updates/` - Session documentation

---

## Maintenance Agent (Phase 2 - Future)

Same architecture, but for `maintenance_tasks_index`:
1. Collect training decisions
2. Extract criteria
3. Build agent
4. Telegram escalation

Will reuse most infrastructure - just need new agent_type='maintenance' config.
