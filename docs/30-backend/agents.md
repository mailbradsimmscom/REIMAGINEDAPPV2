# Automated Agents

## Overview

Automated agents handle complex, multi-step tasks that run autonomously. Located in `scripts/agents/`.

**Who uses it:** Developers, administrators
**When to run:** Periodically or on-demand via CLI or GitHub Actions

---

## Available Agents

| Agent | Purpose | Input | Output |
|-------|---------|-------|--------|
| `manual-hunter.js` | Find and download PDF manuals | Database query | PDFs + reports |
| `manual-validator.js` | Validate downloaded PDFs | PDFs from hunter | Validation reports |

---

## Manual Hunter Agent

**File:** `scripts/agents/manual-hunter.js`

Automates finding and downloading technical manuals for marine equipment systems.

### What It Does

1. Queries `systems_to_fetch` view from database
2. Searches multiple sources (Google, ManualsLib, Archive.org)
3. Downloads PDFs that pass validation
4. Validates content using GPT-4o-mini
5. Generates JSON and Markdown reports

### Usage

```bash
# Run locally
node scripts/agents/manual-hunter.js

# Export systems needing manuals first
node scripts/export-systems-needing-manuals.js
```

### Configuration

**File:** `scripts/agents/manual-hunter-config.js`

| Setting | Default | Description |
|---------|---------|-------------|
| `maxPdfs` | 40 | Stop after N downloads |
| `batchSize` | 5 | Systems processed in parallel |
| `requestDelay` | 2000 | ms between batches |
| `maxSerpApiCalls` | 100 | API call limit |

### Search Strategies

```javascript
// scripts/agents/manual-hunter-strategies.js
// Strategies tried in priority order:
1. WebSearch - Google "{manufacturer} {model} manual filetype:pdf"
2. ManualsLib - Marine-focused manual repository
3. Archive.org - Wayback Machine for discontinued products
4. Manufacturer - Direct manufacturer website
```

### ManualHunter Class

```javascript
// scripts/agents/manual-hunter.js:16-24
class ManualHunter {
  constructor() {
    this.results = [];
    this.pdfsDownloaded = 0;
    this.serpApiCalls = 0;
    this.logger = this.createLogger();
    this.startTime = Date.now();
    this.blacklist = this.loadBlacklist();
  }
}
```

### Blacklist System

Tracks failed attempts to avoid repeated failures:

```javascript
// scripts/agents/manual-hunter.js:118-159
trackFailedAttempt(system, url, reason) {
  const entry = this.blacklist[uid];
  entry.attempts++;
  entry.last_attempt = new Date().toISOString();
  entry.last_rejection_reason = reason;

  if (url && !entry.rejected_urls.includes(url)) {
    entry.rejected_urls.push(url);
  }

  // Auto-blacklist after max attempts
  if (entry.attempts >= config.blacklist.maxAttempts) {
    this.logger.warn(`⛔ Blacklisted: ${system.manufacturer_norm}`);
  }
}
```

### PDF Validation (Inline)

```javascript
// scripts/agents/manual-hunter.js:182-290
async validatePdfContent(pdfText, metadata, system) {
  const prompt = `
Expected Marine Equipment:
- Manufacturer: ${metadata.manufacturer}
- Model: ${metadata.model}

Validate this PDF and provide scores (0-100):
1. manufacturer_match
2. model_match
3. manual_type: "user_manual" | "installation_guide" | ...
4. marine_context: true/false
5. content_relevance

Return recommendation: "APPROVED" | "REVIEW" | "REJECT"
`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    })
  });
}
```

### Output Files

```
scripts/agents/manual-hunter-results/
├── pdfs/                        # Downloaded PDFs
│   └── Manufacturer_Model.pdf
├── run-2025-01-15.json          # Full results
└── run-2025-01-15-report.md     # Human-readable summary
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | For PDF validation |
| `SERPAPI_KEY` | Optional | For Google search |
| `SUPABASE_URL` | Yes | Database connection |
| `SUPABASE_SERVICE_KEY` | Yes | Database auth |

---

## Manual Validator Agent

**File:** `scripts/agents/manual-validator.js`

Validates downloaded PDFs using text extraction + GPT-4o-mini scoring.

### What It Does

1. Reads PDFs from `manual-hunter-results/pdfs/`
2. Extracts text using pdf-parse
3. Validates with GPT-4o-mini
4. Generates ranked reports (CSV, JSON, Markdown)

### Usage

```bash
node scripts/agents/manual-validator.js
```

### Configuration

**File:** `scripts/agents/manual-validator-config.js`

| Setting | Default | Description |
|---------|---------|-------------|
| `batchSize` | 5 | PDFs processed in parallel |
| `maxPages` | 10 | Pages to extract per PDF |
| `llm.model` | `gpt-4o-mini` | Validation model |

### ManualValidator Class

```javascript
// scripts/agents/manual-validator.js:12-18
class ManualValidator {
  constructor() {
    this.results = [];
    this.processed = 0;
    this.logger = this.createLogger();
    this.startTime = Date.now();
  }
}
```

### Validation Logic

```javascript
// scripts/agents/manual-validator.js:151-197
async validatePdf(pdfText, metadata, systemInfo) {
  const prompt = `
Expected Marine Equipment:
- Manufacturer: ${metadata.manufacturer}
- Model: ${metadata.model}
- System Type: ${metadata.system} / ${metadata.subsystem}

Validate and provide:
- manufacturer_match (0-100)
- model_match (0-100)
- manual_type
- marine_context (true/false)
- overall_confidence (0-100)
- recommendation: "APPROVED" | "REVIEW" | "REJECT"
`;
}
```

### Output Files

```
scripts/agents/validation-results/
├── validation-report.csv        # Ranked results
├── validation-report.json       # Full validation data
└── validation-report.md         # Human-readable summary
```

### Report Format

```markdown
## Summary
- **Total Manuals:** 40
- **Approved:** 28 (70%)
- **Review Needed:** 8 (20%)
- **Rejected:** 4 (10%)

## Top 10 Approved Manuals
1. **Yanmar_4JH57.pdf** (95%)
   - Type: user_manual
   - Marine: Yes
```

---

## Workflow: Hunter → Validator

```
┌─────────────────────────────────────────┐
│  1. Export systems needing manuals      │
│     node scripts/export-systems-...     │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  2. Manual Hunter                       │
│     node scripts/agents/manual-hunter   │
│     - Searches web for PDFs             │
│     - Downloads up to 40 PDFs           │
│     - Inline validation (rejects bad)   │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  3. Manual Validator (optional)         │
│     node scripts/agents/manual-validator│
│     - Re-validates all PDFs             │
│     - Ranks by confidence score         │
│     - Generates approval report         │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  4. Bulk Upload                         │
│     node scripts/bulk/batch-upload-pdfs │
│     - Uploads approved PDFs             │
│     - Links to systems in database      │
└─────────────────────────────────────────┘
```

---

## GitHub Actions

Manual Hunter can run as a scheduled GitHub Action:

```yaml
# .github/workflows/manual-hunter.yml
name: Manual Hunter Agent
on:
  workflow_dispatch:
    inputs:
      max_pdfs:
        default: '40'

jobs:
  hunt:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: node scripts/agents/manual-hunter.js
      - uses: actions/upload-artifact@v4
        with:
          name: manual-hunter-pdfs
          path: scripts/agents/manual-hunter-results/pdfs/
```

---

## Files & Locations

| File | Purpose |
|------|---------|
| `scripts/agents/manual-hunter.js` | Main hunter agent |
| `scripts/agents/manual-hunter-config.js` | Hunter configuration |
| `scripts/agents/manual-hunter-strategies.js` | Search strategies |
| `scripts/agents/manual-hunter-python-parser.js` | PDF text extraction |
| `scripts/agents/manual-hunter-blacklist.json` | Failed systems tracking |
| `scripts/agents/manual-validator.js` | Validator agent |
| `scripts/agents/manual-validator-config.js` | Validator configuration |
| `scripts/agents/README.md` | Agent documentation |
| `scripts/agents/STATUS.md` | Current run status |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Agents run automatically" | **No.** Manual trigger or scheduled GitHub Action |
| "All PDFs are uploaded" | **No.** Only approved PDFs after validation |
| "Searches are unlimited" | **No.** Rate limited, max 100 API calls |
| "Works without API keys" | **No.** Requires OPENAI_API_KEY minimum |

---

## DIP Review Agent

**File:** `src/services/agents/dip-review-agent.service.js`
**Telegram Bot:** `src/services/dip-telegram-bot.service.js`

An autonomous agent that learns from human decisions to review and approve/reject DIP (Document Intelligence Pipeline) staging items.

### What It Does

1. Evaluates pending items in DIP staging tables using learned criteria
2. Auto-approves/rejects high-confidence decisions (≥90%)
3. Escalates uncertain items to Telegram for human review
4. Learns continuously from Telegram decisions

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: Training (Chat-based)                                 │
│  - Human reviews items via chat                                 │
│  - Decisions + reasoning stored in agent_training_decisions     │
│  - Target: 50+ diverse decisions                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 2: Pattern Extraction                                    │
│  - Analyze training decisions for patterns                      │
│  - Extract rejection/approval criteria                          │
│  - Build few-shot examples (8 approve, 8 reject)                │
│  - Store in agent_config.learned_criteria                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 3: Autonomous Agent                                      │
│  - Evaluates items using LLM + few-shot examples                │
│  - High confidence (≥0.90) → auto-process                       │
│  - Medium confidence (0.80-0.90) → queue for batch              │
│  - Low confidence (<0.80) → Telegram escalation                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 4: Telegram Escalation                                   │
│  - Bot: @BoatOS_Qs_bot (separate from anchor watch)             │
│  - Sends items with Approve/Reject inline buttons               │
│  - Callback records decision + updates training data            │
│  - Continuous learning loop                                     │
└─────────────────────────────────────────────────────────────────┘
```

### DIP Staging Tables

| Table | Content | Example |
|-------|---------|---------|
| `staging_spec_suggestions` | Equipment specifications | "Max Current Draw: 2.5A" |
| `staging_playbook_hints` | Operational procedures | "How to winterize the watermaker" |
| `staging_intent_router` | Q&A routing pairs | Question → Expected response |
| `staging_golden_tests` | Troubleshooting test cases | Query → Expected result |

Each table has a `status` field: `pending` → `approved` | `rejected`

---

### Database Schema

**Table: `agent_training_decisions`**

Stores every human decision with reasoning for learning.

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

**Table: `agent_config`**

Agent state and learned criteria.

```sql
CREATE TABLE agent_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_type text UNIQUE NOT NULL,    -- 'dip' or 'maintenance'
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

### Learned Criteria

Extracted from 50 training decisions (74% approval rate):

**Reject If:**
- Content is about regulatory compliance (CE, UKCA, FCC, certifications)
- Content is legal disclaimers or trademark information
- Content is about warranty documentation access
- Content is installation-only with no repair value
- Content is static data that becomes outdated (e.g., specific firmware versions)
- Content is obvious/common knowledge with zero value add
- Content is too generic and not specific to the actual system

**Approve If:**
- Content is a legitimate operational specification (current, voltage, pressure, dimensions)
- Content is a step-by-step operational procedure
- Content is troubleshooting info with expected values and failure indicators
- Content is repair-relevant (even if categorized as installation)
- Content is safety or maintenance procedure
- Content answers a practical question an owner might ask

---

### Agent Service API

```javascript
// src/services/agents/dip-review-agent.service.js

// Evaluate a single item using LLM + few-shot examples
export async function evaluateItem(item, sourceTable)
// Returns: { decision, confidence, reasoning, matchedCriteria }

// Process item through full workflow (evaluate + auto-action or escalate)
export async function processItem(item, sourceTable)
// Returns: { action: 'auto_approved'|'auto_rejected'|'escalate'|'queued', evaluation }

// Get pending items for batch processing
export async function getPendingItems(limit = 10)
// Returns: Array of { table, item }

// Get agent statistics
export async function getAgentStats()
// Returns: { totalDecisions, bySource, byDecision, thresholds, isActive }
```

**Confidence Thresholds:**

| Confidence | Action |
|------------|--------|
| ≥ 0.90 | Auto-approve or auto-reject |
| 0.80 - 0.90 | Queue for batch review |
| < 0.80 | Escalate to Telegram |

---

### Telegram Bot

**Bot:** `@BoatOS_Qs_bot` (separate from anchor watch for alert isolation)

**Commands:**
- `/start` - Welcome message with chat ID
- `/stats` - Show agent statistics
- `/help` - Show available commands

**Escalation Message Format:**

```
*DIP Review Needed*
Confidence: 65%

*Table:* `staging_spec_suggestions`

*System:* Yanmar 4JH57
*Parameter:* Max Engine RPM
*Value:* 3800 RPM
*Category:* Performance

*Agent Reasoning:*
Legitimate operational specification

[Approve] [Reject]
```

**Callback Flow:**

1. User taps Approve/Reject button
2. Bot parses callback: `a:spec:uuid` or `r:spec:uuid`
3. Decision recorded to `agent_training_decisions` with `decision_source: 'telegram'`
4. Item status updated in source table
5. `agent_config.total_decisions` incremented
6. Buttons removed from message

---

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_DIP_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_DIP_CHAT_ID` | Yes | Your Telegram chat ID |
| `OPENAI_API_KEY` | Yes | For LLM evaluation |
| `SUPABASE_URL` | Yes | Database connection |
| `SUPABASE_SERVICE_KEY` | Yes | Database auth |

**Render Environment:**
Add `TELEGRAM_DIP_BOT_TOKEN` and `TELEGRAM_DIP_CHAT_ID` to boatos-main service.

---

### Scripts & Commands

**Training:**

```bash
# Get pending item counts by table
node scripts/get-pending-dip-item.cjs counts

# Get next item for training (balanced across tables)
node scripts/get-pending-dip-item.cjs next

# Record a training decision
node scripts/record-training-decision.cjs <json>

# Check training stats
node scripts/record-training-decision.cjs stats dip
```

**Criteria Building:**

```bash
# Rebuild learned criteria from all training decisions
node scripts/build-agent-criteria.cjs

# This updates agent_config with:
# - learned_criteria (reject_if, approve_if, keywords)
# - example_approvals (8 few-shot examples)
# - example_rejections (8 few-shot examples)
```

**Testing:**

```bash
# Send test escalation to Telegram
node scripts/test-dip-agent.cjs

# Start bot polling for callback testing (local)
node scripts/test-dip-bot-polling.cjs
```

---

### Deployment

**Production Startup:**

The DIP bot auto-starts when `NODE_ENV=production`:

```javascript
// src/start.js
if (env.NODE_ENV === 'production') {
  await dipTelegramBotService.start();
}
```

**Deployment Steps:**

1. Add env vars to Render (boatos-main):
   - `TELEGRAM_DIP_BOT_TOKEN`
   - `TELEGRAM_DIP_CHAT_ID`
2. Commit and push to main
3. Render auto-deploys
4. Bot starts automatically

---

### Learning Loop

The agent improves over time:

```
Telegram Decision
       │
       ▼
agent_training_decisions (new row)
       │
       ▼
Run: node scripts/build-agent-criteria.cjs
       │
       ▼
agent_config.learned_criteria (updated)
       │
       ▼
Next evaluations use updated criteria
```

**Auto-rebuild (future):** Trigger criteria rebuild after every N telegram decisions.

---

### Monitoring

**Check Stats via Telegram:**

Send `/stats` to @BoatOS_Qs_bot:

```
*DIP Agent Stats*

Total Decisions: 52
Min to Activate: 50
Agent Active: Yes

*By Source:*
- Human: 50
- Agent: 0
- Telegram: 2

*By Decision:*
- Approved: 37
- Rejected: 15
```

**Database Queries:**

```sql
-- Decision breakdown
SELECT decision, decision_source, COUNT(*)
FROM agent_training_decisions
WHERE agent_type = 'dip'
GROUP BY decision, decision_source;

-- Recent decisions
SELECT source_table, decision, reasoning, created_at
FROM agent_training_decisions
WHERE agent_type = 'dip'
ORDER BY created_at DESC
LIMIT 10;

-- Pending items by table
SELECT 'staging_spec_suggestions' as tbl, COUNT(*) FROM staging_spec_suggestions WHERE status = 'pending'
UNION ALL
SELECT 'staging_playbook_hints', COUNT(*) FROM staging_playbook_hints WHERE status = 'pending'
UNION ALL
SELECT 'staging_intent_router', COUNT(*) FROM staging_intent_router WHERE status = 'pending'
UNION ALL
SELECT 'staging_golden_tests', COUNT(*) FROM staging_golden_tests WHERE status = 'pending';
```

---

### Files & Locations

| File | Purpose |
|------|---------|
| `src/services/agents/dip-review-agent.service.js` | Core evaluation logic |
| `src/services/dip-telegram-bot.service.js` | Telegram bot with callbacks |
| `scripts/get-pending-dip-item.cjs` | Fetch pending items |
| `scripts/record-training-decision.cjs` | Store training decisions |
| `scripts/build-agent-criteria.cjs` | Extract criteria from training |
| `scripts/test-dip-agent.cjs` | Test Telegram escalation |
| `scripts/test-dip-bot-polling.cjs` | Test callback handling |
| `scripts/migrations/024_agent_training_tables.sql` | Database schema |

---

### Future: Batch Processor

Scheduled job to process pending items:

```javascript
// Future: scripts/agents/dip-batch-processor.js
async function processBatch(limit = 50) {
  const items = await getPendingItems(limit);

  for (const { table, item } of items) {
    const result = await processItem(item, table);

    if (result.action === 'auto_approved' || result.action === 'auto_rejected') {
      // Item handled automatically
    } else if (result.action === 'escalate') {
      // Sent to Telegram
    }
    // Rate limit: 1 item/second
    await sleep(1000);
  }
}
```

**Cron Schedule (proposed):** Process 50 items every 4 hours.

---

### Future: Maintenance Agent

Same architecture, different domain:

| Aspect | DIP Agent | Maintenance Agent |
|--------|-----------|-------------------|
| Source | DIP staging tables | `maintenance_tasks_index` |
| Training | 50+ decisions | 50+ decisions |
| agent_type | `'dip'` | `'maintenance'` |
| Telegram | Same bot, different prefix | Same bot, different prefix |

Reuses all infrastructure - just needs `agent_type='maintenance'` config in database.

---

### What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Agent runs continuously" | **No.** Triggered on-demand or via cron |
| "Every item gets LLM call" | **Future:** Pre-filter obvious rejections |
| "Agent replaces human review" | **No.** Escalates uncertain items |
| "Training is one-time" | **No.** Continuous learning via Telegram |

---

## Related Docs

- [Batch Scripts](./batch-scripts.md) - Bulk upload after validation
- [Documents](../20-admin-tools/documents.md) - Document pipeline
- [Systems](../20-admin-tools/systems.md) - Systems needing manuals
