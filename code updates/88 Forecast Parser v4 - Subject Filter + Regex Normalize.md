# Design: Forecast Parser v4 — Subject Filter + Regex Normalize (2026-02-25)

## Evolution Summary

| Version | Calls | Time/email | Architecture | Status |
|---------|-------|------------|-------------|--------|
| v1 | 11 LLM | ~4-5 min | All sequential LLM | Shipped, replaced |
| v2 | 2 LLM + code | ~30-60s | Single mega-prompt refused | Never worked |
| v3 | 3 LLM + code | ~2 min | Split-brain: extract → GPS match → normalize (LLM) → render | Working, 25 forecasts written |
| **v4** | **2 LLM + regex** | **~25s** | Subject filter → extract → GPS match → **regex normalize** → render | **Design phase** |

## Problem Statement

v3 works but has two major inefficiencies:

1. **Wasted LLM calls on irrelevant emails.** We receive ~4 emails/day from `support@mwxc.com` covering different regions (E Caribbean, W Caribbean, Bahamas & Florida, US E Coast & W Atlantic). We only care about E Caribbean. The other 3 emails go through Step 1 (LLM extraction), GPS matching fails, and they produce 0 forecasts. That's 3 wasted LLM calls per day.

2. **Step 2 (Normalize) uses an LLM to parse meteorological shorthand** that follows a consistent, well-defined format. This is a regex problem, not an AI problem. The LLM adds latency (~30-60s), cost, and non-determinism. The shorthand is a mini DSL produced by the same 2-3 forecasters (Shawn Rosenthal, Laura Kee) who use identical notation every day.

## Proposed Architecture (v4)

```
Subject filter (code, .env config)          ← NEW: skip irrelevant emails entirely
↓
Step 1  (LLM, gpt-4.1-mini):  Extract raw text blocks from email
Step 1b (Code):                GPS-match extracted sections to our weather areas
↓
Step 2  (Code, regex):         Normalize matched sections — deterministic    ← CHANGED: was LLM
↓
Step 3  (LLM, gpt-4.1-mini):  Render structured JSON → plain English prose
Step 4  (Code):                Compute change summaries by diffing structured data
```

**LLM calls per email: 2** (extract + render). Down from 3 in v3, 11 in v1.

**W Caribbean / Bahamas / US E Coast emails: 0 LLM calls.** Subject filter rejects them before any processing.

---

## Part 1: Subject-Line Gating via `.env`

### Why

We only care about "E Caribbean." Every other email from this sender is waste. Don't ingest it, don't store it, don't parse it.

### Env Config

```env
# Comma-separated list of region keywords. Only emails whose subject contains
# one of these (case-insensitive) will be ingested and parsed.
# If empty/unset, all emails from FORECAST_SENDER_EMAIL are processed.
FORECAST_REGION_FILTER=E Caribbean
```

### env.js Change

```javascript
// In the Zod schema:
FORECAST_REGION_FILTER: z.string().optional().default(''),

// In the config object:
forecastEmail: {
  senderEmail: env.FORECAST_SENDER_EMAIL,
  enabled: env.FORECAST_EMAIL_ENABLED === 'true',
  retentionDays: parseInt(env.FORECAST_RETENTION_DAYS, 10),
  gmailSearchDays: parseInt(env.FORECAST_GMAIL_SEARCH_DAYS, 10),
  regionFilter: env.FORECAST_REGION_FILTER,  // ← NEW
},
```

**Note:** `FORECAST_RETENTION_DAYS` and `FORECAST_GMAIL_SEARCH_DAYS` are already in the Zod schema and config object from the v2/v3 work. Verify they are present before implementing.

### Service Change (forecast-email.service.js)

**Gmail query filter does the real work.** Code filter is a redundant safety net (costs nothing, catches nothing the Gmail filter misses, but harmless to keep).

**1. Gmail query filter** — the primary filter, reduces API calls by only returning matching emails:

```javascript
// Build Gmail query with subject filter
let query = `from:${senderEmail} newer_than:${searchDays}d`;
if (allowedRegions && allowedRegions.length > 0) {
  const subjectFilter = allowedRegions.map(r => `subject:"${r}"`).join(' OR ');
  query += ` (${subjectFilter})`;
}
// Result: from:support@mwxc.com newer_than:4d (subject:"E Caribbean")
```

**Caveat:** If a region string contains a double quote, it could break the query. For "E Caribbean" this is not an issue. If multi-region support is added later, sanitize the input.

**2. Code filter** — redundant safety net. Gmail's `subject:` operator is reliable (same infrastructure as Gmail UI search), so this will never trigger in practice. But it's a one-liner guard that skips downstream parsing if an email somehow slips through:

```javascript
const allowedRegions = config.forecastEmail.regionFilter
  ?.split(',')
  .map(s => s.trim().toLowerCase())
  .filter(s => s.length > 0);

// Inside the ingestion loop, BEFORE _extractRegionTag and full body processing:
if (allowedRegions && allowedRegions.length > 0) {
  const subjectLower = headers.subject?.toLowerCase() || '';
  if (!allowedRegions.some(region => subjectLower.includes(region))) {
    logger.debug('Skipping email due to region filter', {
      subject: headers.subject,
      allowedRegions
    });
    continue;
  }
}
// _extractRegionTag runs AFTER this filter (no wasted work on skipped emails)
```

### Impact

| Metric | Before (v3) | After (v4) |
|--------|-------------|------------|
| Emails fetched from Gmail per day | ~4 | ~1 |
| Gmail full-body fetches per day | ~4 | ~1 |
| Step 1 LLM calls per day | ~4 | ~1 |
| LLM cost per day | ~$0.04 | ~$0.01 |
| Background worker time per day | ~8 min | ~2 min |

---

## Part 2: Deterministic Regex Parsing (Replace Step 2 LLM)

### Format Analysis from Real Emails

Analyzed 6 emails across 4 regions from 2 different forecasters (Shawn Rosenthal, Laura Kee). The shorthand is a consistent mini DSL.

### The MWXC Shorthand DSL

#### WIND Format

The core pattern: `DIRECTION@SPEED_RANGE gGUST k /SEAS' DATE_TOKEN`

**Real examples from emails (Antigua-StMartin section):**

```
E@15-21g27k/4-6' today
ESE@10-18g23k/3-5' today
SE<ESE@10-18g23k/3-5'<4-6' tonight-Wed25
E@16-23g28k/5-7' Wed25 night-Thu26
E-ESE@15-22g27k/5-7' Fri27-Sat28
```

**All observed wind patterns across all emails:**

| Pattern | Example | Frequency |
|---------|---------|-----------|
| `DIR@LO-HIgGUSTk` | `E@15-21g27k` | ~60% |
| `DIR-DIR@LO-HIgGUSTk` | `ENE-E@16-22g27k` | ~25% |
| `DIR up to HIgGUSTk` | `SW up to 32g40k` | ~5% |
| `under HIk` | `under 15k` | ~3% |
| `Variable mostly DIR@...` | `Variable mostly NW-NE up to 10k` | ~3% |
| `L&V` | `L&V<N-NE up to 15k` | ~1% |
| `Builds DIR@...` | `Builds NE-ENE@12-20g25k` | ~1% |
| No gust | `E@12-18k` or `NE up to 20k` | ~5% |

**The `<` operator** means "then transitioning to" within the same time window:
- `SE<ESE@10-18g23k` → direction shifts from SE to ESE
- `/3-5'<4-6'` → seas increase from 3-5' to 4-6'
- `SSW-SW@16-30g36k<up to 26g33k` → wind decreases

**For structured output:** Take the **first value** before `<` as the primary forecast for that period. The transition is useful context but not needed for the structured data. The raw blocks are preserved in `structured_forecast` if transition data is ever needed.

**Inline seas** appear in the WIND section as `/HEIGHT'` after the wind data:
- `E@15-21g27k/4-6' today` → wind chop is 4-6 feet
- This is different from SWELLS (longer period waves in a separate section)

**No `@` variant** (Laura Kee, US E Coast style):
- `N-NNE 15-20g25k` instead of `N-NNE@15-20g25k`
- Same structure, just missing the `@` delimiter
- Not relevant for E Caribbean (subject filter excludes US E Coast), but making `@` optional costs nothing

#### Date Tokens

Consistent across all emails and both forecasters:

| Token | Meaning |
|-------|---------|
| `today` | Email date |
| `tonight` | Same date, evening |
| `this morning` | Same date, AM |
| `this afternoon` | Same date, PM |
| `Wed25` | 3-letter day + date number |
| `Wed25 night` | Evening of that date |
| `late Wed25` | Later portion of that date |
| `early Thu26` | Early portion of that date |
| `Wed25-Fri27` | Date range |
| `Wed25 night-Sat28` | Range starting evening |
| `rest of Wed25-Sat28` | Remainder through end |

**Resolution:** Given `primary_date` from email subject (e.g., "Wed25 7am" → 2026-02-25), resolve day abbreviations to full dates using the month/year context.

**Month rollover handling (critical):** The naive approach of `for (let d = start; d <= end; d++)` breaks when a range crosses a month boundary (e.g., `Sat28-Mon2` where Sat28 is Feb 28 and Mon2 is March 2). The correct approach:

```javascript
function resolveDateRange(startDay, endDay, primaryDate) {
  // Build a Date object from primaryDate
  const base = new Date(primaryDate + 'T12:00:00Z');
  const baseMonth = base.getUTCMonth();

  // Set start date in the same month as primaryDate
  const start = new Date(base);
  start.setUTCDate(startDay);

  // GUARD: setUTCDate silently overflows on short months.
  // e.g., setUTCDate(31) on Feb 25 → March 3 (Feb has 28 days).
  // If the month changed after setting the day, the day doesn't exist
  // in this month — throw so the caller logs it as a parse failure.
  if (start.getUTCMonth() !== baseMonth) {
    throw new Error(`Day ${startDay} does not exist in month ${baseMonth + 1} of ${base.getUTCFullYear()}`);
  }

  // Set end date
  const end = new Date(base);
  end.setUTCDate(endDay);

  // Core rule: if endDay < startDay, the range crosses a month boundary.
  // e.g., Sat28-Mon2 in February → end is in March.
  if (endDay < startDay) {
    end.setUTCMonth(end.getUTCMonth() + 1);
  }

  // Iterate from start to end using date arithmetic (handles month boundaries)
  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(cursor.toISOString().split('T')[0]);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
```

This uses proper `Date` arithmetic so `Sat28-Mon2` in February correctly yields `[2026-02-28, 2026-03-01, 2026-03-02]`.

**Required unit tests:**
- `resolveDateRange(28, 2, '2026-02-25')` → `['2026-02-28', '2026-03-01', '2026-03-02']` (month rollover)
- `resolveDateRange(25, 27, '2026-02-25')` → `['2026-02-25', '2026-02-26', '2026-02-27']` (same month)
- `resolveDateRange(31, 2, '2026-01-28')` → `['2026-01-31', '2026-02-01', '2026-02-02']` (Jan→Feb rollover)
- `resolveDateRange(30, 1, '2026-02-25')` → throws Error (Feb 30 doesn't exist)

#### SWELLS Format

Very consistent: `HEIGHT' / PERIODsec DIRECTION`

```
5-7'/8secE
6-9'/13secNNW-N
4-6'/5-7secE-SE
```

With transitions:
```
4-6'/8secE<6-9'/13secN
3-5'/8secE today; Builds 4-6'/8secE & 13secNNW tonight
```

**Multi-swell handling:** The `&` operator indicates two swell components arriving simultaneously:
- `4-6'/8secE & 13secNNW` = short-period east swell + long-period north swell

**Data model decision:** Store as an **array** of swell objects per date:
```javascript
swell: [
  { dir: 'E', ft: [4, 6], period_s: [8, 8] },
  { dir: 'NNW', ft: null, period_s: [13, 13] }  // height not specified for 2nd component
]
```

Single-swell days still use an array (length 1) for consistency: `swell: [{ dir: 'E', ft: [4, 6], period_s: [8, 8] }]`.

The `Builds` prefix (e.g., `Builds 4-6'/8secE`) indicates increasing swell — strip prefix, parse normally. The trend information is captured by comparing consecutive days in the diff step.

**Downstream changes required for swell array:**

1. **`_computeChangeSummary`** (forecast-email-parser.service.js ~lines 710-719): Currently accesses `swell.ft` (object). Must change to `swell[0].ft` (primary swell) with a guard for empty arrays. Update both `prevSwellFt` and `currSwellFt` reads.

2. **`_validateNormalizedSection`** (forecast-email-parser.service.js ~lines 506-509): Currently checks `swell.ft[1]` for bounds. Must iterate `swell` array and validate each component.

3. **Step 3 render prompt** (forecast-email-parser.service.js ~lines 617-654): The LLM receives `days` as JSON which now has `swell: [...]` instead of `swell: {...}`. Update the prompt instructions to describe the array format: "swell is an array of swell components; the first element is the primary swell."

4. **Step 1 LLM normalize prompt** (forecast-email-parser.service.js ~lines 424-433): The v3 prompt describes `swell` as `{ dir, ft, period_s }`. This prompt is being **replaced by regex**, so no fix needed — but if the LLM normalize path is kept as a fallback, the prompt schema must change to `swell: [{ dir, ft, period_s }]`.

#### PRECIP Format

Simple keyword + optional intensity:

| Pattern | Example |
|---------|---------|
| Dry | `Dry today-Wed25` |
| Mostly dry | `Mostly dry` |
| Stray | `Stray +5k` or `Stray under 30k` |
| Isolated | `Isolated to 30k` |
| Scattered | `Scattered to 30-35k` |
| Numerous | `Numerous to 30-40k` |
| Coverage transition | `Scattered<Isolated to 30k` |

The `+5k` or `to 30k` indicates squall intensity in knots. Not critical for our structured output — we just need the coverage keyword.

#### SUGGEST Format

**Not shorthand.** Free-form English paragraphs keyed by region header:

```
Antigua-StMartin: Brisk W-NW bound sailing today-Thu26, particularly salty
due to the northerly swell. Brisk W-NW bound sailing continues Fri27 onward,
too rough for some tastes given the elevated wind/seas.
```

**Strategy:** Copy verbatim into `sailing_notes` keyed by section name. No regex needed. The LLM render step (Step 3) will select the relevant advice based on each area's `sailing_direction`.

### Proposed Regex Module Layout

New file: `maintenance-agent/src/services/forecast-shorthand-parser.js`

This is a pure utility module — no imports from services/repositories, no side effects, fully unit-testable.

```
forecast-shorthand-parser.js
├── parseWindBlock(windBlock, primaryDate)       → [{ dates[], wind, seas_ft }]
├── parseSwellBlock(swellBlock, primaryDate)     → [{ dates[], swell[] }]
├── parsePrecipBlock(precipBlock, primaryDate)   → [{ dates[], precipitation }]
├── resolveDateToken(token, primaryDate)         → string[]  (YYYY-MM-DD array)
├── resolveDateRange(startDay, endDay, primary)  → string[]  (handles month rollover)
├── parseDirection(dirStr)                       → string | null
├── parseSpeedRange(speedStr)                    → { range_kt: [lo, hi], gust_kt: number|null }
├── parseSeasInline(seasStr)                     → [lo, hi] (feet) | null
├── parseSwellEntry(swellStr)                    → { dir, ft, period_s }[] (array for multi-swell)
├── mergeByDate(wind[], swell[], precip[], suggest) → days[]
└── normalizeSection(section, primaryDate)       → { section_id, section_name, lat_range, lon_range, days[] }
```

`normalizeSection` is the main entry point — it takes a raw extracted section (from Step 1 LLM output) and returns the same structured format as v3 **except `swell` is now an array** (was a single object). This means downstream code (Step 3 render, Step 4 diff) needs targeted updates to handle `swell[0]` instead of `swell` directly — see "Downstream changes required for swell array" above.

### Step 1 Output Contract (LLM → Regex handoff)

Step 1 (LLM extract) must emit sections with these exact field names so the regex layer is a drop-in replacement for the v3 LLM normalize step:

```javascript
// Each section in Step 1 output:
{
  section_name: "Antigua-StMartin",     // string, region name from email
  lat_range: [16.5, 18.5],             // [south, north] decimal degrees
  lon_range: [-63.5, -61.5],           // [west, east] decimal degrees
  wind_block: "E@15-21g27k/4-6' today; ...",    // raw text, semicolon-delimited
  seas_block: "4-6'/8secE today; ...",           // raw text, semicolon-delimited
  precip_block: "Stray +5k today; ...",          // raw text, semicolon-delimited
  suggest_block: "Antigua-StMartin: Fair W-NW bound sailing..."  // raw English text
}
```

**All block fields are optional** (nullable). If the email doesn't have a SWELLS section for a region, `seas_block` is `null` and the regex parser produces no swell entries for that section. The `suggest_block` is never regex-parsed — it's copied verbatim into `sailing_notes`.

**Output shape after regex normalize** (per day in `days[]`):
```javascript
{
  date: "2026-02-25",
  wind: { dir: "ESE", range_kt: [12, 18], gust_kt: 22 },
  seas_ft: [4, 6],
  swell: [                          // ARRAY (was single object in v3)
    { dir: "E", ft: [4, 6], period_s: [8, 8] },
    { dir: "NNW", ft: null, period_s: [13, 13] }  // optional 2nd component
  ],
  precipitation: "Stray",
  sailing_notes: { raw: "Antigua-StMartin: Brisk W-NW bound sailing..." }
}
```

### Parsing Strategy: Layered Decomposition

The key insight is that the shorthand is structured in layers. We parse outside-in:

#### Layer 1: Pre-processing

Before any parsing, clean the input:

```javascript
function preprocess(block) {
  // Strip parenthetical notes: "(strongest near CpLookout)"
  // MUST happen before regex to avoid matching numbers inside parens
  let cleaned = block.replace(/\([^)]*\)/g, '');
  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  // Strip trailing period
  cleaned = cleaned.replace(/\.\s*$/, '');
  return cleaned;
}
```

#### Layer 2: Segment Splitting

Split by `;` to get time-segmented entries:

```javascript
function splitSegments(block) {
  return preprocess(block)
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}
```

Input: `E@15-21g27k/4-6' today; E@16-22g27k/5-7' tonight-Thu26; E-ESE@15-22g27k/5-7' Fri27-Sat28`

Output:
```
["E@15-21g27k/4-6' today", "E@16-22g27k/5-7' tonight-Thu26", "E-ESE@15-22g27k/5-7' Fri27-Sat28"]
```

**Note:** Some blocks use `...` as separator instead of `;` (mainly in SEAS). Handle both:
```javascript
function splitSegments(block) {
  return preprocess(block)
    .split(/;|\.\.\./)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}
```

#### Layer 3: Transition Splitting (the `<` operator)

Each segment may contain `<` transitions. Split and take the first value as primary:

```javascript
function splitTransitions(segment) {
  const parts = segment.split('<').map(s => s.trim());
  return parts[0]; // Primary (peak/start) value
}
```

Input: `SE<ESE@10-18g23k/3-5'<4-6' tonight-Wed25`
Primary: `SE` (first direction), `/3-5'` (first seas)

**Decision:** Taking the first value only. The transition is preserved in the raw block stored in `structured_forecast.sections[].wind_block` if ever needed for richer display.

#### Layer 4: Date Token Extraction

Pull the date token from the end of the segment:

```javascript
const DATE_PATTERN = /\b(today|tonight|this\s+(?:morning|afternoon)|(?:late|early)\s+[A-Z][a-z]{2}\d{1,2}|[A-Z][a-z]{2}\d{1,2}(?:\s+night)?(?:\s*-\s*(?:[A-Z][a-z]{2}\d{1,2}(?:\s+night)?|today|tonight))?(?:\s+(?:morning|afternoon|evening))?)\s*$/i;
```

**Date range expansion** uses proper date arithmetic (see month rollover section above).

#### Layer 5: Wind Token Extraction

After removing the date token, parse the wind data:

```javascript
// Direction: leading compass letters, with optional range
const DIR_PATTERN = /^(?:Variable\s+(?:mostly\s+)?)?(?:Builds\s+)?(?:L&V|([NESW]{1,3}(?:-[NESW]{1,3})?))/i;

// Speed: @LO-HI or just LO-HI, or "up to HI", or "under HI"
const SPEED_PATTERN = /@?(\d+)-(\d+)/;
const UP_TO_PATTERN = /up\s+to\s+(\d+)/i;
const UNDER_PATTERN = /under\s+(\d+)/i;

// Gust: g followed by digits and k
const GUST_PATTERN = /g(\d+)k/i;

// Inline seas: /DIGITS-DIGITS' or /DIGITS'
const SEAS_PATTERN = /\/(\d+)(?:-(\d+))?'/;
```

**Putting it together for one segment:**

```javascript
function parseWindSegment(segment, primaryDate) {
  // 1. Extract date token from end
  const dateMatch = segment.match(DATE_PATTERN);
  const dateToken = dateMatch ? dateMatch[1] : null;
  const remainder = dateMatch ? segment.replace(dateMatch[0], '').trim() : segment;

  // 2. Handle transitions — take first value before <
  const primary = remainder.split('<')[0].trim();

  // 3. Extract direction
  const dirMatch = primary.match(DIR_PATTERN);
  const dir = dirMatch ? (dirMatch[1] || 'VAR') : null;

  // 4. Extract speed range
  let range_kt = null;
  const speedMatch = primary.match(SPEED_PATTERN);
  const upToMatch = primary.match(UP_TO_PATTERN);
  const underMatch = primary.match(UNDER_PATTERN);

  if (speedMatch) {
    range_kt = [parseInt(speedMatch[1]), parseInt(speedMatch[2])];
  } else if (upToMatch) {
    range_kt = [0, parseInt(upToMatch[1])];
  } else if (underMatch) {
    range_kt = [0, parseInt(underMatch[1])];
  }

  // 5. Extract gust
  const gustMatch = primary.match(GUST_PATTERN);
  const gust_kt = gustMatch ? parseInt(gustMatch[1]) : null;

  // 6. Extract inline seas
  const seasMatch = primary.match(SEAS_PATTERN);
  const seas_ft = seasMatch
    ? [parseInt(seasMatch[1]), parseInt(seasMatch[2] || seasMatch[1])]
    : null;

  // 7. Resolve dates
  const dates = dateToken
    ? resolveDateToken(dateToken, primaryDate)
    : [primaryDate];

  return { dates, wind: { dir, range_kt, gust_kt }, seas_ft };
}
```

#### Layer 6: Swell Parsing

```javascript
// Pattern: HEIGHT'/PERIODsecDIRECTION
const SWELL_PATTERN = /(\d+)-(\d+)'\/(\d+)(?:-(\d+))?sec([NESW]{1,3}(?:-[NESW]{1,3})?)/i;

function parseSwellEntry(str) {
  // Handle multi-swell: "4-6'/8secE & 13secNNW"
  const components = str.split('&').map(s => s.trim());
  const swells = [];

  for (const comp of components) {
    const match = comp.match(SWELL_PATTERN);
    if (match) {
      swells.push({
        dir: match[5],
        ft: [parseInt(match[1]), parseInt(match[2])],
        period_s: match[4]
          ? [parseInt(match[3]), parseInt(match[4])]
          : [parseInt(match[3]), parseInt(match[3])],
      });
    } else {
      // Partial swell (e.g., "13secNNW" without height)
      const partialMatch = comp.match(/(\d+)sec([NESW]{1,3}(?:-[NESW]{1,3})?)/i);
      if (partialMatch) {
        swells.push({
          dir: partialMatch[2],
          ft: null,
          period_s: [parseInt(partialMatch[1]), parseInt(partialMatch[1])],
        });
      }
    }
  }

  return swells.length > 0 ? swells : null;
}
```

#### Layer 7: Precip Parsing

```javascript
const PRECIP_KEYWORDS = ['widespread', 'numerous', 'scattered', 'isolated', 'stray', 'mostly dry', 'dry'];

function parsePrecipSegment(segment) {
  const lower = segment.toLowerCase();
  // Handle transitions: "Scattered<Isolated to 30k" → take first
  const primary = lower.split('<')[0].trim();

  // Check keywords from most severe to least
  for (const keyword of PRECIP_KEYWORDS) {
    if (primary.includes(keyword)) {
      return keyword.charAt(0).toUpperCase() + keyword.slice(1);
    }
  }
  return segment.trim(); // fallback: return as-is
}
```

**Note:** Keywords are ordered from most severe to least (`widespread` > `numerous` > `scattered` > etc.) so the first match is the most significant coverage level.

#### Layer 8: Merge by Date

After parsing wind, swell, and precip blocks independently, merge them by resolved date:

```javascript
function mergeByDate(windEntries, swellEntries, precipEntries, suggestBlock) {
  const byDate = new Map();

  for (const w of windEntries) {
    for (const date of w.dates) {
      if (!byDate.has(date)) byDate.set(date, { date });
      const entry = byDate.get(date);
      // Later entries for the same date overwrite (last segment wins)
      entry.wind = w.wind;
      entry.seas_ft = w.seas_ft;
    }
  }

  for (const s of swellEntries) {
    for (const date of s.dates) {
      if (byDate.has(date)) {
        byDate.get(date).swell = s.swell; // array of swell components
      }
    }
  }

  for (const p of precipEntries) {
    for (const date of p.dates) {
      if (byDate.has(date)) {
        byDate.get(date).precipitation = p.precipitation;
      }
    }
  }

  // Attach sailing notes (suggest block is free-form, copy as-is)
  const sailing_notes = suggestBlock ? { raw: suggestBlock } : {};

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of days) {
    day.sailing_notes = day.sailing_notes || sailing_notes;
    // Ensure all fields exist (null if not present)
    day.wind = day.wind || null;
    day.seas_ft = day.seas_ft || null;
    day.swell = day.swell || null;
    day.precipitation = day.precipitation || null;
  }

  return days;
}
```

### Error Handling & Resilience

**Critical:** If regex parsing fails for a section, it should NOT kill the entire email pipeline. But the parser module is a **pure utility with no I/O** — it should throw on failure, not log. The **caller** (`forecast-email-parser.service.js`) wraps each call in try/catch and handles logging + status.

**Parser module** (`forecast-shorthand-parser.js`) — throws on failure:

```javascript
function normalizeSection(section, primaryDate) {
  // No try/catch here — let errors propagate to caller
  const windEntries = section.wind_block ? parseWindBlock(section.wind_block, primaryDate) : [];
  const swellEntries = section.seas_block ? parseSwellBlock(section.seas_block, primaryDate) : [];
  const precipEntries = section.precip_block ? parsePrecipBlock(section.precip_block, primaryDate) : [];
  const days = mergeByDate(windEntries, swellEntries, precipEntries, section.suggest_block);

  return {
    section_id: section.section_name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    section_name: section.section_name,
    lat_range: section.lat_range,
    lon_range: section.lon_range,
    days,
  };
}
```

**Caller** (`forecast-email-parser.service.js`) — catches per-section, logs, tracks success/fail counts:

```javascript
// In _normalizeSections (or equivalent):
let successCount = 0;
let failCount = 0;

for (const section of matchedSections) {
  try {
    const normalized = normalizeSection(section, primaryDate);
    results.push(normalized);
    successCount++;
  } catch (err) {
    failCount++;
    logger.error('Regex parse failed for section', {
      section: section.section_name,
      error: err.message,
      wind_block: section.wind_block?.substring(0, 200),
    });
    // Skip this section, continue with others
  }
}

// After all sections processed, determine parse_status:
// - successCount > 0 && failCount === 0 → 'parsed'
// - successCount > 0 && failCount > 0  → 'partial'
// - successCount === 0                  → 'failed'
```

**Also update the early-return cases in `parseAndMap`:** The current v3 code sets `parsed` when no sections are extracted or no areas match bounding boxes. This is technically correct (the email was processed, there's just nothing relevant), but should be distinguished from "all sections successfully normalized." Add a log message explaining why no data was produced:

```javascript
// No sections extracted from email → parsed (nothing relevant in this email)
logger.info('No sections matched weather areas', { emailId: email.id });
await forecastEmailRepository.updateParseStatus(email.id, 'parsed', null, primaryDate);
```

This keeps the parser a pure, testable utility with no imports from services/repositories. If MWXC changes their format, regex fails are caught per-section by the caller, logged with raw input for debugging, and the email gets `partial` status rather than `failed`. The raw blocks are always preserved in `structured_forecast` for manual inspection.

### Edge Cases to Handle

| Edge Case | Example | Strategy |
|-----------|---------|----------|
| `<` transition | `SE<ESE@10-18g23k` | Split on `<`, take first |
| No `@` | `N-NNE 15-20g25k` | Make `@` optional in regex |
| `L&V` | `L&V<N-NE up to 15k` | Map to `{ dir: 'VAR', range_kt: [0, 5] }` |
| `Variable` | `Variable mostly NW-NE up to 10k` | Extract direction after `mostly` |
| `Builds` | `Builds NE-ENE@12-20g25k` | Strip prefix, parse normally |
| Diurnal pattern | `diurnal pattern with...mornings / ...evenings` | Take afternoon/evening value (stronger, more relevant for sailing) |
| Parenthetical notes | `(strongest near CpLookout)` | **Strip before parsing** to avoid matching numbers inside parens |
| Multi-period swell | `8-14'/7-10secN-NNE` | Period range `[7, 10]` |
| `&` in swell | `4-6'/8secE & 13secNNW` | Return array of swell components |
| Month rollover | `Sat28-Mon2` in February | Use `Date` arithmetic, not naive day loop |
| `...` separator | `5-7FT TODAY...4-6FT TUE-WED` | Split on `...` in addition to `;` |
| `*Note...` prefix | `*Note that wind driven chop does not reflect swells*` | Strip lines starting with `*` |

### Why Regex > LLM Here

| Criterion | LLM (v3) | Regex (v4) |
|-----------|----------|------------|
| Speed | 30-60 seconds | < 10 milliseconds |
| Cost | ~$0.005/section | $0 |
| Determinism | May vary between calls | Same input → same output |
| Testability | Can't unit test | Full unit test coverage |
| Failure mode | Timeout, refusal, wrong format | Parse error (catchable, logged) |
| Reliability for diffs | LLM may round differently | Exact same numbers every time |
| Brittleness risk | Low (handles novel formats) | Higher (fixed patterns) |

**Mitigating regex brittleness:** Unit tests against real email samples, per-section error isolation, raw blocks always preserved for debugging, and `parse_status = 'partial'` when sections fail.

### What Stays LLM

| Step | Why LLM is still needed |
|------|------------------------|
| Step 1 (Extract) | Email structure varies — section names, ordering, which blocks exist. LLM is good at splitting unstructured text into labeled chunks. Could eventually be replaced with regex too, but lower priority — it's only 1 call and it works. |
| Step 3 (Render to prose) | Converting structured data + sailing direction context into natural English. This is genuinely where LLMs add value. |

---

## Updated Pipeline Summary

### Per Email (E Caribbean only, ~1/day):

| Step | Type | Time | Cost | What |
|------|------|------|------|------|
| Subject filter | Code | <1ms | $0 | Skip non-E Caribbean |
| Step 1: Extract | LLM | ~10s | ~$0.005 | Split email into raw blocks |
| Step 1b: GPS match | Code | <1ms | $0 | Filter to matching sections |
| Step 2: Normalize | **Regex** | <10ms | **$0** | Parse shorthand → structured JSON |
| Step 3: Render | LLM | ~15s | ~$0.005 | Structured JSON → prose |
| Step 4: Diff | Code | <1ms | $0 | Compare with previous forecast |

**Total: ~25 seconds, ~$0.01 per email.**

### Per Day (Mon-Sat):

| Metric | v1 | v3 | v4 |
|--------|-----|-----|-----|
| Emails processed | ~4 | ~4 | ~1 |
| LLM calls | 44 | 12 | 2 |
| Total time | ~16 min | ~8 min | ~25 sec |
| Daily cost | ~$0.40 | ~$0.06 | ~$0.01 |

---

## Implementation Order

1. **Subject filter** (env.js + forecast-email.service.js) — add `FORECAST_REGION_FILTER` to env, Gmail query filter, code filter before `_extractRegionTag`
2. **Expert forecast upsert** (forecast-email.repository.js) — change `insertExpertForecast` to upsert, verify DB unique constraint
3. **Regex parser module** (new file: forecast-shorthand-parser.js) — all parse functions, `resolveDateRange` with overflow guard, swell as array
4. **Unit tests for regex parser** — use real email blocks from samples below; include month rollover, multi-swell, overflow guard tests
5. **Wire regex parser into Step 2** (forecast-email-parser.service.js):
   - Replace `_normalizeSections` LLM call with regex `normalizeSection` calls
   - Add `successCount`/`failCount` tracking for proper `parsed`/`partial`/`failed` status
   - Update `_computeChangeSummary` for `swell[0].ft` (array)
   - Update `_validateNormalizedSection` to iterate swell array
   - Update Step 3 render prompt to describe swell array format
6. **Test end-to-end** — wipe DB, re-trigger, verify structured output, re-trigger same email to verify upsert replaces (no duplicates)
7. **Commit + deploy**

---

## Files to Modify

| File | Change |
|------|--------|
| `maintenance-agent/src/config/env.js` | Add `FORECAST_REGION_FILTER` to Zod schema + config object |
| `maintenance-agent/src/services/forecast-email.service.js` | Add Gmail query filter + code filter in `checkAndIngest()`; move code filter before `_extractRegionTag` |
| `maintenance-agent/src/services/forecast-shorthand-parser.js` | **NEW** — pure regex parsing module |
| `maintenance-agent/src/services/forecast-email-parser.service.js` | Replace `_normalizeSections` LLM with regex calls; add `successCount`/`failCount` tracking; update `_computeChangeSummary` for swell array; update `_validateNormalizedSection` for swell array; update Step 3 render prompt for swell array |
| `maintenance-agent/src/repositories/forecast-email.repository.js` | Change `insertExpertForecast` to upsert with `onConflict: 'area_id,forecast_date'` |
| `maintenance-agent/.env` | Add `FORECAST_REGION_FILTER=E Caribbean` |
| Render env vars | Add `FORECAST_REGION_FILTER=E Caribbean` |
| Supabase | Verify unique constraint exists on `weather_expert_forecasts(area_id, forecast_date)` |

---

## Required Fix: Expert Forecast Upsert

The current `insertExpertForecast()` in `forecast-email.repository.js` (lines 192-205) does a plain INSERT. If an email is re-parsed (e.g., manual retry after `partial` or `failed`), it will either fail on the unique constraint or create duplicate rows.

**Fix:** Change `insertExpertForecast` to use Supabase upsert:

```javascript
async insertExpertForecast(forecast) {
  const { data, error } = await supabase
    .from('weather_expert_forecasts')
    .upsert(forecast, { onConflict: 'area_id,forecast_date' })
    .select()
    .single();

  if (error) throw error;
  return data;
}
```

**Pre-requisite:** Verify a unique constraint exists on `weather_expert_forecasts(area_id, forecast_date)` in Supabase. If not, add it:
```sql
ALTER TABLE weather_expert_forecasts
  ADD CONSTRAINT weather_expert_forecasts_area_date_unique
  UNIQUE (area_id, forecast_date);
```

This ensures re-parsing an email replaces stale data rather than duplicating it. The `getExpertForecasts` dedup logic (lines 324-345) currently handles duplicates client-side, but that's a band-aid — the DB should enforce correctness.

---

## Real Email Samples (for regex validation)

### E Caribbean WIND blocks (Antigua-StMartin section):

**Email 1 (Tue24 8am, Shawn):**
```
SE<ESE@10-18g23k/3-5' today; ESE@10-18g23k<E@15-21g27k/3-5'<4-6' tonight-Wed25; E@16-23g28k/5-7' Wed25 night-Thu26; E-ESE@15-22g27k/5-7' Fri27-Sat28.
```

**Email 2 (Wed25 7am, Shawn):**
```
E@15-21g27k/4-6' today; E@16-22g27k/5-7' tonight-Thu26; E-ESE@15-22g27k/5-7' Fri27-Sun1.
```

### E Caribbean SWELLS blocks (Antigua-StMartin section):

**Email 1:**
```
3-5'/8secE today; Builds 4-6'/8secE & 13secNNW tonight; 4-6'<6-9'/13secNNW-N Wed25; 7-10'/7-10secN-E Thu26; 6-9'/8-10secN-E Fri27; 5-8'/8secE Sat28.
```

**Email 2:**
```
4-6'<6-9'/13secNNW-N today; 7-10'/12secNNW-N tonight-Thu26; 6-9'/8secENE-E Fri27; 5-8'/8secE Sat28-Sun1.
```

### E Caribbean PRECIP blocks (Antigua-StMartin section):

**Email 1:**
```
Stray +5k today-Wed25; Stray or Isolated +5k Wed25 night-Sat28.
```

**Email 2:**
```
Stray +5k today; Stray or Isolated +5k tonight-Sun1.
```

### E Caribbean SUGGEST blocks (Antigua-StMartin section):

**Email 1:**
```
Antigua-StMartin: Fair W-NW bound sailing today. Winds rebuild for brisk W-NW bound sailing tonight-Wed25. Brisk W-NW bound sailing continues Wed25 night onward, too rough for some. No significant changes are expected until at least the second half of next week.
```

**Email 2:**
```
Antigua-StMartin: Brisk W-NW bound sailing today-Thu26, particularly salty due to the northerly swell. Brisk W-NW bound sailing continues Fri27 onward, too rough for some tastes given the elevated wind/seas. No significant changes are expected next week.
```

### W Caribbean WIND block (Mexico section) — for comparison:

```
NNE@15-22g27k<NE@10-17g22k today; NE<ESE@8-17g21k tonight; ESE<SE@9-17g21k Wed25; SE@13-21g26k Wed25 night-Thu26; SE@13-20g25k<10-16g20k Fri27; SE@8-16g20k<E-SE under 12k Fri27 night-Sat28.
```

### US E Coast WIND block (CpLookout-Charleston) — for comparison:

```
SW<SSW-SW up to 32g40k/7-12' (strongest near and N&E of CpLookout) Wed25; SSW-SW@16-30g36k<up to 26g33k/5-10'<4-9' (strongest along NC) Wed25 night-Thu26; S-SW up to 26g34k<Variable up to 22g28k/5-9'<4-7' Thu26 night-Fri27; Variable mainly NNW-NNE<N-NE@10-20g25k/3-6' Sat28.
```

**Note:** US E Coast uses more complex patterns (`up to`, `Variable mainly`, parenthetical notes). These would need handling if we ever expand beyond E Caribbean, but for now the subject filter means we never see them.

---

## Current Source Code (v3, to be modified)

Full source code for all files is in: `code updates/87 Forecast Parser v3 - Split Brain Pipeline.md`

---

## Decisions Made

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Gmail query filter vs code filter | Both | Gmail query reduces API calls, code filter is safety net |
| 2 | `<` transition handling | Take first value only | Simpler, sufficient for structured data. Raw blocks preserved if ever needed. |
| 3 | Diurnal patterns | Take afternoon/evening value | Stronger wind, more relevant for sailing conditions |
| 4 | Multi-swell | Array of swell objects | Preserves data fidelity, downstream can pick primary |
| 5 | Step 1 (extract) to regex? | Not in v4 | Lower priority, LLM works fine for 1 call, email structure varies more |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| MWXC changes shorthand format | Regex fails silently or produces wrong data | Unit tests with real samples; per-section try/catch; `partial` status; raw blocks preserved |
| Month rollover in date ranges | Wrong dates assigned to forecast data | Use `Date` arithmetic with overflow guard; throw on invalid days (Feb 30); unit tests for Jan→Feb, Feb→Mar boundaries |
| `setUTCDate` overflow on short months | Day 31 on Feb base silently becomes Mar 3 | Overflow guard checks if month changed after `setUTCDate`; throws Error if so |
| Swell array breaks downstream consumers | `_computeChangeSummary` and `_validateNormalizedSection` access `swell.ft` (object) | Update all consumers to use `swell[0].ft` with empty-array guard; update Step 3 render prompt |
| Expert forecast duplicates on re-parse | Duplicate rows or constraint violation | Change `insertExpertForecast` to upsert with `onConflict: 'area_id,forecast_date'`; verify DB unique constraint |
| Parenthetical numbers matched by speed regex | Wrong wind speed extracted | Strip parentheticals in pre-processing step before any regex |
| New forecaster with different style | Patterns don't match | Subject filter limits to E Caribbean (1-2 forecasters); log parse failures with raw input |

## parse_status Semantics

| Status | When set | Meaning |
|--------|----------|---------|
| `queued` | Email ingested into DB | Waiting to be parsed |
| `parsing` | Parse lock acquired | Step 1+ in progress |
| `parsed` | All matched sections normalized + expert forecasts written | Complete success |
| `partial` | At least one section succeeded AND at least one section failed regex parse | Partial data written, some sections skipped |
| `failed` | Step 1 (LLM extract) fails, or zero sections normalize successfully | No usable data from this email |

**Key rule:** `partial` means "we got something useful but not everything." The caller checks: if `successCount > 0 && failCount > 0` → `partial`. If `successCount > 0 && failCount === 0` → `parsed`. If `successCount === 0` → `failed`.
