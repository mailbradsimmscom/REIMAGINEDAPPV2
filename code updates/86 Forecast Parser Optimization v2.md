# Session: Forecast Parser Optimization v2 (2026-02-24)

## What Was Built

Rewrote the forecast email parser from 11 sequential LLM calls to 2 LLM calls + code diffs.

### Architecture Change

**Before (v1):** 11 sequential calls, all `gpt-5.1-chat-latest`, ~4-5 min per email
- Step 1: 1 LLM call — map GPS to sections (full email sent)
- Step 2: 5 LLM calls — extract forecasts per area (full email re-sent each time)
- Step 3: 5 LLM calls — generate change summaries per area

**After (v2):** 2 LLM calls + code, ~30-60s per email
- Step 1 (LLM, `config.openai.model`): Parse full email → structured JSON once
- Step 2 (Code): Map areas to sections by lat/lon bounding boxes with closest-center tiebreaker
- Step 3 (LLM, `config.openai.summaryModel`): Render structured JSON → prose for all areas in one call
- Step 4 (Code): Diff structured data for change summaries — deterministic, null-safe, compass-bucketed

### Key Design Principles
- **Structured first, prose last** — canonical format is structured JSON, prose is a render step
- **Fire-and-forget** — check endpoint returns immediately, parsing runs in background
- **Checkpoint/resume** — structured_forecast stored after Step 1; retry skips Step 1 if data exists
- **Job lock** — `parse_status` state machine prevents duplicate parsing
- **No hardcoded models** — all from config

## Files Modified

### Maintenance Agent (`maintenance-agent/`)

| File | Changes |
|------|---------|
| `src/config/env.js` | Added `OPENAI_SUMMARY_MODEL` (default `gpt-4.1-mini`), `FORECAST_RETENTION_DAYS` (default `10`), `FORECAST_GMAIL_SEARCH_DAYS` (default `4`). Fixed stale `OPENAI_MODEL` default from `gpt-4-turbo-preview` to `gpt-4.1-mini`. Wired `summaryModel`, `retentionDays`, `gmailSearchDays` into config object |
| `src/services/forecast-email-parser.service.js` | **Full rewrite.** `_parseEmailToStructuredForecast` (Step 1 LLM), `_mapAreasToSections` (Step 2 code), `_buildForecastsForAreas` (Step 3 LLM), `_computeChangeSummary` (Step 4 code). Added `_validateStructuredForecast`, `_findSectionForArea`. Fixed: dynamic import → static, double getAllAreas removed |
| `src/repositories/forecast-email.repository.js` | Added `storeStructuredForecast()`, `getStructuredForecast()`, `acquireParseLock()`. Changed insert status from `'pending'` to `'queued'`. Added config import for retention days |
| `src/services/forecast-email.service.js` | **Rewrite.** `checkAndIngest()` returns after ingestion (fire-and-forget). Added `_parseInBackground()` with job lock. Added `getParseProgress()` for frontend polling. Gmail search uses `config.forecastEmail.gmailSearchDays` (was hardcoded `2d`). Cleanup uses `config.forecastEmail.retentionDays` (was hardcoded `10`). Status counts all parse states |
| `src/routes/weather.route.js` | Added `GET /forecast-email/parse-progress` endpoint. Fixed hardcoded `'gpt-4.1-mini'` in AI sailing summary → uses `env.OPENAI_SUMMARY_MODEL`. Data-status accepts `partial` parse state |

### Main App (`src/public/`)

| File | Changes |
|------|---------|
| `weather-areas.html` | Check Emails button: instant response → polls `parse-progress` every 5s → shows "Parsing (X active)..." → "Done — Y parsed" → auto-refreshes data status + changes card |

### Database (run in Supabase)

| Change | Table |
|--------|-------|
| Added `structured_forecast` (jsonb) column | `weather_forecast_emails` |
| Added `email_hash` (text) column | `weather_forecast_emails` |
| Updated `parse_status` CHECK constraint | `weather_forecast_emails` — now includes `queued`, `pending`, `parsing`, `parsed`, `partial`, `failed` |
| Deleted all rows | `weather_expert_forecasts` (clean slate, regenerated from structured data) |
| Reset all emails to `queued` | `weather_forecast_emails` (re-parsed with new pipeline) |

## Config / Env Vars

| Var | Value | Where |
|-----|-------|-------|
| `OPENAI_SUMMARY_MODEL` | `gpt-4.1-mini` | maintenance-agent .env (new) |
| `FORECAST_RETENTION_DAYS` | `10` | maintenance-agent .env (new, optional — has default) |
| `FORECAST_GMAIL_SEARCH_DAYS` | `4` | maintenance-agent .env (new, optional — has default) |

**Render:** Add `OPENAI_SUMMARY_MODEL=gpt-4.1-mini` to boatos-maintenance env vars.

## Parse Status State Machine

```
queued → parsing → parsed | partial | failed
```
- `queued`: email ingested, waiting for parse
- `parsing`: parse in progress (job lock held)
- `parsed`: all steps completed
- `partial`: Step 1 OK but Step 3 failed — structured data saved, prose missing
- `failed`: Step 1 failed

## Structured JSON Format (Step 1 Output)

Stored in `weather_forecast_emails.structured_forecast` (jsonb):
```json
{
  "issue_time": "2026-02-24T10:00:00Z",
  "region_name": "E Caribbean",
  "primary_date": "2026-02-24",
  "synopsis": "faithful paraphrase",
  "outlook": "faithful paraphrase",
  "sections": [{
    "section_id": "antigua-st-martin",
    "section_name": "Antigua-StMartin",
    "lat_range": [17.0, 18.5],
    "lon_range": [-63.0, -61.0],
    "days": [{
      "date": "2026-02-24",
      "wind": { "dir": "ESE", "range_kt": [12, 18], "gust_kt": 22 },
      "seas_ft": [4, 6],
      "swell": { "dir": "ENE", "ft": [3, 5], "period_s": [8, 10] },
      "precipitation": "isolated showers",
      "sailing_notes": { "W-NW": "...", "N": "...", "SE": "..." }
    }]
  }]
}
```

## Key Constants

| Constant | Value | Location |
|----------|-------|----------|
| `FT_TO_M` | `0.3048` | `forecast-email-parser.service.js` |
| `COMPASS_BUCKET` | 16→8 point mapping | `forecast-email-parser.service.js` |
| Validation: wind max | 150kt | `_validateStructuredForecast` |
| Validation: swell max | 30ft | `_validateStructuredForecast` |
| Validation: date range | ±10 days | `_validateStructuredForecast` |

## Previous Session Context

- 5 active weather areas: Antigua, Path to Barbuda (N), Path to Montserrat (SE), Path to St Barts (NE), South the Guadeloupe (S)
- 9 emails in DB (reset to `queued` for re-parse)
- Maintenance agent on branch `Agent-Enablement`, main app on `Stable-v4-Working`
- Plan doc: `/Users/brad/.cursor/plans/forecast-parser-optimization.plan.md`
