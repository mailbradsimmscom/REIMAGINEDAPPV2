# Session: Forecast Parser v3 — Split-Brain Pipeline (2026-02-24)

## Problem

- v2 parser had a single LLM call that asked gpt-5.1-chat-latest to do 8+ cognitive tasks at once (parse shorthand, resolve dates, extract subsections, guarantee numeric fidelity, paraphrase synopsis, infer lat/lon, output strict JSON)
- Model refused, returning an error JSON instead of structured forecast data
- Even when it worked (8 of 11 emails), it took 4+ minutes per email

## Architecture (v3)

```
Step 1  (LLM, gpt-4.1-mini):  Extract raw text blocks from email — simple splitting, no normalization
Step 1b (Code):                GPS-match extracted sections to our weather areas (1° tolerance)
Step 2  (LLM, gpt-4.1-mini):  Normalize ONLY matched sections — parse meteorological shorthand (parallelized)
Step 3  (LLM, gpt-4.1-mini):  Render structured JSON → plain English prose (one call, all areas)
Step 4  (Code):                Compute change summaries by diffing structured data
```

Key insight: W Caribbean emails (12+ sections, none matching our areas) skip Steps 2-3 entirely.

---

## LLM Prompts (with placeholder context)

### Step 1 — Extract Raw Blocks

This is the simplest LLM call. It receives the raw email and splits it into geographic sections. No normalization, no number parsing, no date resolution. The model just copies text blocks verbatim.

**Model:** `config.openai.summaryModel` (gpt-4.1-mini)

**Prompt (with realistic sample data filled in):**

```
Extract the major sections from this sailing weather forecast email. Do NOT normalize, parse numbers, or resolve dates — just extract the raw text blocks.

EMAIL SUBJECT: Caribbean Weather - E Caribbean
EMAIL DATE: 2026-02-24

EMAIL BODY:
OFFSHORE FORECAST FOR THE EASTERN CARIBBEAN
NATIONAL WEATHER SERVICE
ISSUED 0600 UTC MON 24 FEB 2026

SYNOPSIS...A MODERATE TROPICAL WAVE AXIS NEAR 58W IS MOVING W AT 15KTS.
HIGH PRESSURE RIDGING ACROSS THE NW ATLANTIC SUPPORTS ESE-E FLOW 15-20KTS
THROUGH THE WEEK. SLIGHT WEAKENING WED-THU AS RIDGE SHIFTS E.

ANTIGUA TO ST MARTIN...17.0N-18.5N 61.0W-63.5W
WIND...ESE-E 15-20KT G25K TODAY. E 12-18KT TUE25. E-ENE 10-15KT WED26.
       ENE 12-18KT THU27. E 15-22KT G28K FRI28.
SEAS...5-7FT TODAY...4-6FT TUE-WED...5-7FT THU-FRI.
SWELL...ENE 4-6FT 8-10S.
PRECIP...ISOLD SHWRS TODAY-TUE. SCTD SHWRS WED-THU.
SUGGEST...W-NW: GOOD CONDITIONS FOR SAILING TODAY THROUGH WED.
          DETERIORATING THU-FRI WITH HIGHER WINDS. SE: MODERATE CHOP
          THROUGHOUT. AVOID OPEN CROSSINGS FRI.

GUADELOUPE...15.8N-16.5N 60.5W-62.0W
WIND...ESE 12-18KT TODAY...
[... more sections ...]

OUTLOOK...TROPICAL WAVE MAY BRING INCREASED SHOWERS LATE NEXT WEEK.
WIND SPEEDS EXPECTED TO REMAIN MODERATE 12-20KTS THROUGH THE PERIOD.

Extract into this JSON structure:
{
  "issue_time": "best guess ISO timestamp from subject/header",
  "region_name": "region from subject (e.g. 'E Caribbean', 'W Caribbean')",
  "primary_date": "2026-02-24",
  "synopsis_raw": "raw text of the SYNOPSIS section as-is",
  "outlook_raw": "raw text of the OUTLOOK section as-is, or null if none",
  "sections": [
    {
      "section_name": "Name of geographic sub-region (e.g. 'Mexico', 'Antigua-StMartin')",
      "lat_range": [south_lat, north_lat],
      "lon_range": [west_lon, east_lon],
      "wind_block": "raw WIND text for this section, copied as-is",
      "seas_block": "raw SEAS text for this section, copied as-is, or null",
      "precip_block": "raw PRECIP text for this section, copied as-is, or null",
      "suggest_block": "raw SUGGEST text for this section, copied as-is, or null"
    }
  ]
}

RULES:
- One section per geographic sub-region mentioned in the WIND section.
- Copy the text for each block verbatim — do NOT rephrase, summarize, or parse.
- lat_range/lon_range: approximate decimal degrees. Caribbean longitudes are NEGATIVE. Use GENEROUS bounding boxes — extend 1 degree beyond the region in each direction to ensure overlap. lon_range must be [west, east] where west is more negative (e.g. [-63.5, -61.0]).
- If a section (SEAS, PRECIP, SUGGEST) doesn't exist for a region, set to null.
- Include ALL geographic sub-regions, even "OTHER AREAS".
```

### Step 2 — Normalize Matched Sections

One call per matched section, parallelized via `Promise.allSettled`. Only sections whose GPS bounding box overlaps a weather area (within 1 degree tolerance) reach this step. The model parses meteorological shorthand into structured JSON.

**Model:** `config.openai.summaryModel` (gpt-4.1-mini)

**Prompt (with realistic sample data for the "Antigua-StMartin" section):**

```
Parse this meteorological shorthand into structured JSON for the "Antigua-StMartin" region.

DATE CONTEXT: Today = 2026-02-24. Day references like "Tue24" = 2026-02-24. Tonight = same date as today.

WIND:
ESE-E 15-20KT G25K TODAY. E 12-18KT TUE25. E-ENE 10-15KT WED26. ENE 12-18KT THU27. E 15-22KT G28K FRI28.

SEAS:
5-7FT TODAY...4-6FT TUE-WED...5-7FT THU-FRI.

PRECIP:
ISOLD SHWRS TODAY-TUE. SCTD SHWRS WED-THU.

SUGGEST:
W-NW: GOOD CONDITIONS FOR SAILING TODAY THROUGH WED. DETERIORATING THU-FRI WITH HIGHER WINDS. SE: MODERATE CHOP THROUGHOUT. AVOID OPEN CROSSINGS FRI.

Return JSON:
{
  "section_id": "lowercase-hyphenated (e.g. 'antigua-st-martin')",
  "section_name": "Antigua-StMartin",
  "lat_range": [17.0, 18.5],
  "lon_range": [-63.5, -61.0],
  "days": [
    {
      "date": "YYYY-MM-DD",
      "wind": { "dir": "ESE", "range_kt": [12, 18], "gust_kt": 22 },
      "seas_ft": [4, 6],
      "swell": { "dir": "ENE", "ft": [3, 5], "period_s": [8, 10] },
      "precipitation": "description or null",
      "sailing_notes": { "W-NW": "advice text" }
    }
  ]
}

RULES:
- Keep all numeric values in original units (knots for wind, feet for waves/swell).
- One entry per day that has explicit WIND data.
- sailing_notes: key by compass direction from SUGGEST section. If no SUGGEST data, set to {}.
- If a value is not present, set to null. Do NOT guess.
- gust_kt: extract from "g" notation (e.g. "g38k" = 38). If no gust, set to null.
- For ranges like "12-18", use [12, 18]. For single values like "under 15", use [0, 15].
```

### Step 3 — Render to Prose

Single LLM call for all matched areas. Converts the structured JSON from Step 2 into plain English, performing unit conversions (feet to meters) and expanding abbreviations. The model also selects sailing advice based on each area's `sailing_direction`.

**Model:** `config.openai.summaryModel` (gpt-4.1-mini)

**Prompt (with realistic sample data for 1 area, 5 days):**

```
Render this structured weather forecast data into plain English for each area.

SYNOPSIS: A moderate tropical wave axis near 58W is moving W at 15kts. High pressure ridging across the NW Atlantic supports ESE-E flow 15-20kts through the week.
OUTLOOK: Tropical wave may bring increased showers late next week. Wind speeds expected to remain moderate 12-20kts through the period.

STRUCTURED DATA:
[
  {
    "section_id": "antigua-st-martin",
    "section_name": "Antigua-StMartin",
    "days": [
      {
        "date": "2026-02-24",
        "wind": { "dir": "ESE", "range_kt": [15, 20], "gust_kt": 25 },
        "seas_ft": [5, 7],
        "swell": { "dir": "ENE", "ft": [4, 6], "period_s": [8, 10] },
        "precipitation": "Isolated showers",
        "sailing_notes": { "W-NW": "Good conditions for sailing", "SE": "Moderate chop" }
      },
      {
        "date": "2026-02-25",
        "wind": { "dir": "E", "range_kt": [12, 18], "gust_kt": null },
        "seas_ft": [4, 6],
        "swell": { "dir": "ENE", "ft": [4, 6], "period_s": [8, 10] },
        "precipitation": "Isolated showers",
        "sailing_notes": { "W-NW": "Good conditions for sailing", "SE": "Moderate chop" }
      },
      {
        "date": "2026-02-26",
        "wind": { "dir": "ENE", "range_kt": [10, 15], "gust_kt": null },
        "seas_ft": [4, 6],
        "swell": { "dir": "ENE", "ft": [3, 5], "period_s": [8, 10] },
        "precipitation": "Scattered showers",
        "sailing_notes": { "W-NW": "Good conditions", "SE": "Moderate chop" }
      },
      {
        "date": "2026-02-27",
        "wind": { "dir": "ENE", "range_kt": [12, 18], "gust_kt": null },
        "seas_ft": [5, 7],
        "swell": { "dir": "ENE", "ft": [4, 6], "period_s": [8, 10] },
        "precipitation": "Scattered showers",
        "sailing_notes": { "W-NW": "Deteriorating with higher winds", "SE": "Moderate chop" }
      },
      {
        "date": "2026-02-28",
        "wind": { "dir": "E", "range_kt": [15, 22], "gust_kt": 28 },
        "seas_ft": [5, 7],
        "swell": { "dir": "ENE", "ft": [4, 6], "period_s": [8, 10] },
        "precipitation": null,
        "sailing_notes": { "W-NW": "Avoid open crossings", "SE": "Avoid open crossings" }
      }
    ]
  }
]

AREAS TO RENDER:
[
  {
    "id": "a1b2c3d4-5678-90ab-cdef-111111111111",
    "name": "English Harbour, Antigua",
    "sailing_direction": "W-NW",
    "section_id": "antigua-st-martin",
    "section_name": "Antigua-StMartin"
  }
]

RULES:
- Convert feet to meters (1 ft = 0.3048m, round to 1 decimal). Do NOT include feet.
- Use nautical standard: knots for wind, meters for wave/swell heights.
- Expand abbreviations: "ESE" → "East-southeast", etc.
- For each area, use its sailing_direction to select the relevant sailing advice from sailing_notes. If direction is "none", give general conditions.
- Do NOT add, change, or reinterpret any numeric values from the structured data.
- Synopsis and outlook: render once as plain English, include in every entry.
- One to three sentences per field.

Return JSON:
{
  "areas": {
    "<area-id>": [
      {
        "date": "YYYY-MM-DD",
        "synopsis": "plain English",
        "outlook": "plain English",
        "wind_forecast": "plain English wind",
        "swell_forecast": "plain English swell",
        "sailing_suggestion": "plain English sailing advice",
        "precipitation": "plain English precip or null"
      }
    ]
  }
}

Each area must have exactly 5 entries for dates: 2026-02-24, 2026-02-25, 2026-02-26, 2026-02-27, 2026-02-28.
```

---

## Full Source Code

### forecast-email-parser.service.js

**Path:** `/Users/brad/code/REIMAGINEDAPPV2/maintenance-agent/src/services/forecast-email-parser.service.js`

```javascript
/**
 * Forecast Email Parser Service (v3)
 * Split-brain pipeline: extract first, normalize only what we need.
 *
 *   Step 1  (LLM):  Extract raw blocks from email (simple, won't refuse)
 *   Step 1b (Code): GPS-match areas to extracted sections
 *   Step 2  (LLM):  Normalize matched sections only (parallelized, one per section)
 *   Step 3  (LLM):  Render structured JSON → plain English prose (one call, all areas)
 *   Step 4  (Code): Compute change summaries by diffing structured data
 */

import OpenAI from 'openai';
import crypto from 'crypto';
import { getConfig } from '../config/env.js';
import { weatherRepository } from '../repositories/weather.repository.js';
import { forecastEmailRepository } from '../repositories/forecast-email.repository.js';
import supabaseRepo from '../repositories/supabase.repository.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('forecast-email-parser');

const openai = new OpenAI({ apiKey: config.openai.apiKey, timeout: 120000 });

const FT_TO_M = 0.3048;

// 16-point → 8-point compass bucketing (each maps to nearest 8-point)
const COMPASS_BUCKET = {
  N: 'N', NNE: 'NE', NE: 'NE', ENE: 'NE', E: 'E', ESE: 'E',
  SE: 'SE', SSE: 'SE', S: 'S', SSW: 'SW', SW: 'SW', WSW: 'W',
  W: 'W', WNW: 'NW', NW: 'NW', NNW: 'N',
};

function compassBucket(dir16) {
  return COMPASS_BUCKET[dir16] || dir16;
}

// Safe nested property access — returns null if any part is missing
function safeGet(obj, path) {
  const parts = path.split('.');
  let val = obj;
  for (const p of parts) {
    val = val?.[p];
    if (val == null) return null;
  }
  return val;
}

export const forecastEmailParserService = {
  /**
   * Parse a forecast email and map sections to weather areas.
   * Main entry point — runs the full pipeline.
   */
  async parseAndMap(email) {
    const areas = await weatherRepository.getAllAreas();
    if (areas.length === 0) {
      logger.warn('No active weather areas to map forecasts to');
      await forecastEmailRepository.updateParseStatus(email.id, 'parsed', null, null);
      return { forecastsWritten: 0, errors: [] };
    }

    try {
      // Step 1: Extract raw blocks (or reuse existing structured data)
      let structured = await forecastEmailRepository.getStructuredForecast(email.id);
      if (!structured) {
        // Step 1a: Extract raw text blocks from email (simple LLM call)
        const extracted = await this._extractRawBlocks(email);
        const emailHash = crypto.createHash('sha256').update(email.raw_text).digest('hex');

        if (!extracted.sections || extracted.sections.length === 0) {
          logger.warn('No sections extracted from email');
          // Store the extracted data as-is so we don't re-process
          await forecastEmailRepository.storeStructuredForecast(email.id, extracted, emailHash);
          await forecastEmailRepository.updateParseStatus(email.id, 'parsed', null, extracted.primary_date);
          return { forecastsWritten: 0, errors: [] };
        }

        // Step 1b: GPS-match areas to extracted sections (code)
        const matchedSectionNames = this._matchSectionsToAreas(extracted.sections, areas);

        if (matchedSectionNames.length === 0) {
          logger.info('No extracted sections match our weather areas — skipping normalize', {
            emailSubject: email.subject,
            sectionCount: extracted.sections.length,
            sectionNames: extracted.sections.map(s => s.section_name),
          });
          await forecastEmailRepository.storeStructuredForecast(email.id, extracted, emailHash);
          await forecastEmailRepository.updateParseStatus(email.id, 'parsed', null, extracted.primary_date);
          return { forecastsWritten: 0, errors: [] };
        }

        // Step 2: Normalize only matched sections (LLM, parallelized)
        const matchedSections = extracted.sections.filter(s => matchedSectionNames.includes(s.section_name));
        const normalizedSections = await this._normalizeSections(matchedSections, email);

        // Build final structured forecast
        structured = {
          issue_time: extracted.issue_time,
          region_name: extracted.region_name,
          primary_date: extracted.primary_date,
          synopsis: extracted.synopsis_raw,
          outlook: extracted.outlook_raw,
          sections: normalizedSections,
        };

        await forecastEmailRepository.storeStructuredForecast(email.id, structured, emailHash);
      } else {
        logger.info('Reusing existing structured forecast (retry/resume)', { emailId: email.id });
      }

      if (!structured.sections || structured.sections.length === 0) {
        logger.warn('No sections in structured forecast (email may not cover our region)');
        await forecastEmailRepository.updateParseStatus(email.id, 'parsed', null, structured.primary_date);
        return { forecastsWritten: 0, errors: [] };
      }

      // Step 2b: Map areas to normalized sections (code)
      const areaMapping = this._mapAreasToSections(structured, areas);
      const mappedAreas = Object.values(areaMapping).flat();
      if (mappedAreas.length === 0) {
        logger.warn('No areas matched any section bounding boxes');
        await forecastEmailRepository.updateParseStatus(email.id, 'parsed', null, structured.primary_date);
        return { forecastsWritten: 0, errors: [] };
      }

      // Step 3: Render to prose (LLM — one call for all areas)
      let proseByArea;
      try {
        proseByArea = await this._buildForecastsForAreas(structured, areaMapping);
      } catch (err) {
        logger.error('Step 3 (render) failed — marking as partial', { error: err.message });
        await forecastEmailRepository.updateParseStatus(email.id, 'partial', err.message, structured.primary_date);
        return { forecastsWritten: 0, errors: [{ step: 'render', error: err.message }] };
      }

      // Step 4: Get previous structured data for diffs, then insert forecasts
      let forecastsWritten = 0;
      const errors = [];

      for (const [sectionId, sectionAreas] of Object.entries(areaMapping)) {
        const section = structured.sections.find(s => s.section_id === sectionId);
        if (!section) continue;

        for (const area of sectionAreas) {
          const areaForecasts = proseByArea[area.id];
          if (!areaForecasts || areaForecasts.length === 0) continue;

          // Get previous structured data for this area (for diffs)
          const previousForecasts = await forecastEmailRepository.getExpertForecastsByArea(area.id);

          const insertedIds = [];
          for (const forecast of areaForecasts) {
            try {
              const row = await forecastEmailRepository.insertExpertForecast({
                email_id: email.id,
                area_id: area.id,
                forecast_date: forecast.date,
                region_name: section.section_name,
                synopsis: forecast.synopsis || null,
                outlook: forecast.outlook || null,
                wind_forecast: forecast.wind_forecast || null,
                swell_forecast: forecast.swell_forecast || null,
                sailing_suggestion: forecast.sailing_suggestion || null,
                precipitation: forecast.precipitation || null,
                buoy_readings: null,
                full_excerpt: null,
                llm_raw_response: null,
              });
              insertedIds.push(row.id);
              forecastsWritten++;
            } catch (err) {
              logger.error('Failed to insert expert forecast', { area_id: area.id, error: err.message });
              errors.push({ area_id: area.id, error: err.message });
            }
          }

          // Step 4: Compute change summary from structured data (code — no LLM)
          if (previousForecasts.length > 0 && insertedIds.length > 0) {
            try {
              const prevEmailId = previousForecasts[0].email_id;
              const prevStructured = await forecastEmailRepository.getStructuredForecast(prevEmailId);

              if (prevStructured) {
                const prevSection = this._findSectionForArea(prevStructured, area);
                if (prevSection) {
                  const summary = this._computeChangeSummary(prevSection.days, section.days);
                  if (summary) {
                    await forecastEmailRepository.updateChangeSummary(insertedIds[0], summary);
                  }
                }
              }
            } catch (err) {
              logger.warn('Failed to compute change summary', { area: area.name, error: err.message });
            }
          }
        }
      }

      const primaryDate = structured.primary_date || new Date(email.received_at).toISOString().split('T')[0];
      await forecastEmailRepository.updateParseStatus(email.id, 'parsed', null, primaryDate);

      logger.info('Forecast email parsed successfully', {
        emailId: email.id,
        forecastsWritten,
        errorCount: errors.length,
      });

      return { forecastsWritten, errors, primaryDate, regionName: structured.region_name };
    } catch (err) {
      await forecastEmailRepository.updateParseStatus(email.id, 'failed', err.message);
      logger.error('Forecast email parsing failed', { emailId: email.id, error: err.message });
      throw err;
    }
  },

  /**
   * Parse the most recent email for a single newly-added area.
   * Reuses stored structured data — no Step 1 LLM call needed.
   */
  async parseForNewArea(area) {
    const recentEmails = await forecastEmailRepository.getRecentEmails(10);
    const email = recentEmails.find(e => e.parse_status === 'parsed' || e.parse_status === 'partial');
    if (!email) {
      logger.info('No parsed emails available for new area', { area: area.name });
      return { forecastsWritten: 0 };
    }

    const structured = await forecastEmailRepository.getStructuredForecast(email.id);
    if (!structured) {
      logger.info('No structured forecast available for new area', { area: area.name, emailId: email.id });
      return { forecastsWritten: 0 };
    }

    try {
      const areaMapping = this._mapAreasToSections(structured, [area]);
      if (Object.keys(areaMapping).length === 0) {
        logger.warn('New area did not match any email section', { area: area.name });
        return { forecastsWritten: 0 };
      }

      const proseByArea = await this._buildForecastsForAreas(structured, areaMapping);
      const areaForecasts = proseByArea[area.id];
      if (!areaForecasts || areaForecasts.length === 0) {
        return { forecastsWritten: 0 };
      }

      const sectionId = Object.keys(areaMapping)[0];
      const section = structured.sections.find(s => s.section_id === sectionId);
      let forecastsWritten = 0;

      for (const forecast of areaForecasts) {
        try {
          await forecastEmailRepository.insertExpertForecast({
            email_id: email.id,
            area_id: area.id,
            forecast_date: forecast.date,
            region_name: section?.section_name || structured.region_name,
            synopsis: forecast.synopsis || null,
            outlook: forecast.outlook || null,
            wind_forecast: forecast.wind_forecast || null,
            swell_forecast: forecast.swell_forecast || null,
            sailing_suggestion: forecast.sailing_suggestion || null,
            precipitation: forecast.precipitation || null,
            buoy_readings: null,
            full_excerpt: null,
            llm_raw_response: null,
          });
          forecastsWritten++;
        } catch (err) {
          logger.error('Failed to insert expert forecast for new area', { area_id: area.id, error: err.message });
        }
      }

      logger.info('Parsed forecasts for new area', { area: area.name, forecastsWritten });
      return { forecastsWritten };
    } catch (err) {
      logger.error('Failed to parse for new area', { area: area.name, error: err.message });
      return { forecastsWritten: 0, error: err.message };
    }
  },

  // ==================== STEP 1: Extract raw blocks (LLM) ====================

  /**
   * Step 1: Simple extraction — pull raw text blocks from the email.
   * Low cognitive load: no normalization, no numeric parsing, no date resolution.
   * Uses summary model since this is straightforward text splitting.
   */
  async _extractRawBlocks(email) {
    const receivedDate = new Date(email.received_at);
    const dateStr = receivedDate.toISOString().split('T')[0];

    const prompt = `Extract the major sections from this sailing weather forecast email. Do NOT normalize, parse numbers, or resolve dates — just extract the raw text blocks.

EMAIL SUBJECT: ${email.subject}
EMAIL DATE: ${dateStr}

EMAIL BODY:
${email.raw_text}

Extract into this JSON structure:
{
  "issue_time": "best guess ISO timestamp from subject/header",
  "region_name": "region from subject (e.g. 'E Caribbean', 'W Caribbean')",
  "primary_date": "${dateStr}",
  "synopsis_raw": "raw text of the SYNOPSIS section as-is",
  "outlook_raw": "raw text of the OUTLOOK section as-is, or null if none",
  "sections": [
    {
      "section_name": "Name of geographic sub-region (e.g. 'Mexico', 'Antigua-StMartin')",
      "lat_range": [south_lat, north_lat],
      "lon_range": [west_lon, east_lon],
      "wind_block": "raw WIND text for this section, copied as-is",
      "seas_block": "raw SEAS text for this section, copied as-is, or null",
      "precip_block": "raw PRECIP text for this section, copied as-is, or null",
      "suggest_block": "raw SUGGEST text for this section, copied as-is, or null"
    }
  ]
}

RULES:
- One section per geographic sub-region mentioned in the WIND section.
- Copy the text for each block verbatim — do NOT rephrase, summarize, or parse.
- lat_range/lon_range: approximate decimal degrees. Caribbean longitudes are NEGATIVE. Use GENEROUS bounding boxes — extend 1 degree beyond the region in each direction to ensure overlap. lon_range must be [west, east] where west is more negative (e.g. [-63.5, -61.0]).
- If a section (SEAS, PRECIP, SUGGEST) doesn't exist for a region, set to null.
- Include ALL geographic sub-regions, even "OTHER AREAS".`;

    const response = await openai.chat.completions.create({
      model: config.openai.summaryModel,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '';
    logger.info('Step 1 (extract raw blocks) complete', {
      length: content.length,
      preview: content.substring(0, 200),
    });

    const parsed = JSON.parse(content);

    // Auto-fix positive Caribbean longitudes
    for (const section of (parsed.sections || [])) {
      if (section.lon_range && (section.lon_range[0] > 0 || section.lon_range[1] > 0)) {
        section.lon_range = section.lon_range.map(v => v > 0 ? -v : v);
      }
    }

    return parsed;
  },

  // ==================== STEP 1b: GPS-match sections to areas (CODE) ====================

  /**
   * Step 1b: Filter extracted sections to only those covering our weather areas.
   * Returns array of section_name strings that match at least one area.
   */
  _matchSectionsToAreas(sections, areas) {
    const matched = new Set();
    const TOLERANCE = 1.0; // 1 degree padding for imprecise LLM bounding boxes

    for (const area of areas) {
      for (const section of sections) {
        let latRange = section.lat_range;
        let lonRange = section.lon_range;
        if (!latRange || !lonRange) continue;

        // Fix reversed lon_range (LLM sometimes swaps west/east)
        const lonMin = Math.min(lonRange[0], lonRange[1]);
        const lonMax = Math.max(lonRange[0], lonRange[1]);

        if (area.latitude >= (latRange[0] - TOLERANCE) && area.latitude <= (latRange[1] + TOLERANCE) &&
            area.longitude >= (lonMin - TOLERANCE) && area.longitude <= (lonMax + TOLERANCE)) {
          matched.add(section.section_name);
        }
      }
    }

    logger.info('GPS match complete', {
      totalSections: sections.length,
      matchedSections: [...matched],
      areaCount: areas.length,
    });

    return [...matched];
  },

  // ==================== STEP 2: Normalize matched sections (LLM) ====================

  /**
   * Step 2: Normalize raw text blocks into structured JSON.
   * One LLM call per matched section, parallelized.
   * Uses summary model — the heavy lifting is parsing meteorological shorthand.
   */
  async _normalizeSections(sections, email) {
    const receivedDate = new Date(email.received_at);
    const dateStr = receivedDate.toISOString().split('T')[0];
    const year = receivedDate.getUTCFullYear();
    const month = String(receivedDate.getUTCMonth() + 1).padStart(2, '0');

    const normalize = async (section) => {
      const prompt = `Parse this meteorological shorthand into structured JSON for the "${section.section_name}" region.

DATE CONTEXT: Today = ${dateStr}. Day references like "Tue24" = ${year}-${month}-24. Tonight = same date as today.

WIND:
${section.wind_block || 'No data'}

SEAS:
${section.seas_block || 'No data'}

PRECIP:
${section.precip_block || 'No data'}

SUGGEST:
${section.suggest_block || 'No data'}

Return JSON:
{
  "section_id": "lowercase-hyphenated (e.g. 'antigua-st-martin')",
  "section_name": "${section.section_name}",
  "lat_range": ${JSON.stringify(section.lat_range || [0, 0])},
  "lon_range": ${JSON.stringify(section.lon_range || [0, 0])},
  "days": [
    {
      "date": "YYYY-MM-DD",
      "wind": { "dir": "ESE", "range_kt": [12, 18], "gust_kt": 22 },
      "seas_ft": [4, 6],
      "swell": { "dir": "ENE", "ft": [3, 5], "period_s": [8, 10] },
      "precipitation": "description or null",
      "sailing_notes": { "W-NW": "advice text" }
    }
  ]
}

RULES:
- Keep all numeric values in original units (knots for wind, feet for waves/swell).
- One entry per day that has explicit WIND data.
- sailing_notes: key by compass direction from SUGGEST section. If no SUGGEST data, set to {}.
- If a value is not present, set to null. Do NOT guess.
- gust_kt: extract from "g" notation (e.g. "g38k" = 38). If no gust, set to null.
- For ranges like "12-18", use [12, 18]. For single values like "under 15", use [0, 15].`;

      const response = await openai.chat.completions.create({
        model: config.openai.summaryModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content || '';
      const parsed = JSON.parse(content);

      logger.info('Step 2 (normalize) complete for section', {
        section: section.section_name,
        days: parsed.days?.length || 0,
      });

      return parsed;
    };

    // Parallelize all section normalizations
    const results = await Promise.allSettled(sections.map(s => normalize(s)));

    const normalized = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        const section = results[i].value;
        // Validate
        this._validateNormalizedSection(section, receivedDate);
        normalized.push(section);
      } else {
        logger.error('Failed to normalize section', {
          section: sections[i].section_name,
          error: results[i].reason?.message,
        });
      }
    }

    return normalized;
  },

  /**
   * Validate a normalized section — reject absurd values.
   */
  _validateNormalizedSection(section, receivedDate) {
    const warnings = [];

    // Validate lon_range is negative (Caribbean)
    if (section.lon_range && (section.lon_range[0] > 0 || section.lon_range[1] > 0)) {
      warnings.push(`Section "${section.section_name}" has positive longitude — auto-fixing`);
      section.lon_range = section.lon_range.map(v => v > 0 ? -v : v);
    }

    for (const day of (section.days || [])) {
      const dayDate = new Date(day.date + 'T12:00:00Z');
      const diffDays = Math.abs((dayDate - receivedDate) / (24 * 60 * 60 * 1000));
      if (diffDays > 10) {
        warnings.push(`Day "${day.date}" is ${diffDays.toFixed(0)} days from received_at`);
      }

      const windMax = safeGet(day, 'wind.range_kt.1');
      if (windMax != null && (windMax < 0 || windMax > 150)) {
        warnings.push(`Wind max ${windMax}kt out of range for "${day.date}"`);
      }

      const swellMax = safeGet(day, 'swell.ft.1');
      if (swellMax != null && (swellMax < 0 || swellMax > 30)) {
        warnings.push(`Swell max ${swellMax}ft out of range for "${day.date}"`);
      }
    }

    if (warnings.length > 0) {
      logger.warn('Section validation warnings', { section: section.section_name, warnings });
    }
  },

  // ==================== STEP 2b: Map areas to sections (CODE) ====================

  /**
   * Map weather areas to normalized sections by lat/lon bounding boxes.
   * Uses closest-center tiebreaker if multiple sections match.
   * Returns: { section_id: [area, area, ...] }
   */
  _mapAreasToSections(structured, areas) {
    const mapping = {};
    const TOLERANCE = 1.0;

    for (const area of areas) {
      let bestSection = null;
      let bestDist = Infinity;

      for (const section of (structured.sections || [])) {
        const latRange = section.lat_range;
        const lonRange = section.lon_range;
        if (!latRange || !lonRange) continue;

        const lonMin = Math.min(lonRange[0], lonRange[1]);
        const lonMax = Math.max(lonRange[0], lonRange[1]);

        if (area.latitude >= (latRange[0] - TOLERANCE) && area.latitude <= (latRange[1] + TOLERANCE) &&
            area.longitude >= (lonMin - TOLERANCE) && area.longitude <= (lonMax + TOLERANCE)) {
          const centerLat = (latRange[0] + latRange[1]) / 2;
          const centerLon = (lonMin + lonMax) / 2;
          const dist = Math.hypot(area.latitude - centerLat, area.longitude - centerLon);
          if (dist < bestDist) {
            bestDist = dist;
            bestSection = section;
          }
        }
      }

      if (bestSection) {
        if (!mapping[bestSection.section_id]) mapping[bestSection.section_id] = [];
        mapping[bestSection.section_id].push(area);
      }
    }

    logger.info('Area mapping complete', {
      sections: Object.keys(mapping).length,
      areas: Object.values(mapping).flat().map(a => a.name),
    });

    return mapping;
  },

  /**
   * Find the section in a structured forecast that covers a given area.
   */
  _findSectionForArea(structured, area) {
    const mapping = this._mapAreasToSections(structured, [area]);
    const sectionId = Object.keys(mapping)[0];
    if (!sectionId) return null;
    return structured.sections.find(s => s.section_id === sectionId) || null;
  },

  // ==================== STEP 3: Render to prose (LLM) ====================

  /**
   * Step 3: Single LLM call — render structured JSON to plain English for all areas.
   * Uses cheap model (config.openai.summaryModel).
   * Returns: { areaId: [{ date, synopsis, outlook, wind_forecast, ... }] }
   */
  async _buildForecastsForAreas(structured, areaMapping) {
    const areaDescriptions = [];
    const dateSet = new Set();

    for (const [sectionId, sectionAreas] of Object.entries(areaMapping)) {
      const section = structured.sections.find(s => s.section_id === sectionId);
      if (!section) continue;

      for (const day of (section.days || [])) {
        dateSet.add(day.date);
      }

      for (const area of sectionAreas) {
        areaDescriptions.push({
          id: area.id,
          name: area.name,
          sailing_direction: area.sailing_direction || 'none',
          section_id: sectionId,
          section_name: section.section_name,
        });
      }
    }

    const dates = [...dateSet].sort();

    const relevantSectionIds = new Set(Object.keys(areaMapping));
    const compactSections = structured.sections
      .filter(s => relevantSectionIds.has(s.section_id))
      .map(s => ({
        section_id: s.section_id,
        section_name: s.section_name,
        days: s.days,
      }));

    const prompt = `Render this structured weather forecast data into plain English for each area.

SYNOPSIS: ${structured.synopsis || 'Not available'}
OUTLOOK: ${structured.outlook || 'Not available'}

STRUCTURED DATA:
${JSON.stringify(compactSections, null, 2)}

AREAS TO RENDER:
${JSON.stringify(areaDescriptions, null, 2)}

RULES:
- Convert feet to meters (1 ft = ${FT_TO_M}m, round to 1 decimal). Do NOT include feet.
- Use nautical standard: knots for wind, meters for wave/swell heights.
- Expand abbreviations: "ESE" → "East-southeast", etc.
- For each area, use its sailing_direction to select the relevant sailing advice from sailing_notes. If direction is "none", give general conditions.
- Do NOT add, change, or reinterpret any numeric values from the structured data.
- Synopsis and outlook: render once as plain English, include in every entry.
- One to three sentences per field.

Return JSON:
{
  "areas": {
    "<area-id>": [
      {
        "date": "YYYY-MM-DD",
        "synopsis": "plain English",
        "outlook": "plain English",
        "wind_forecast": "plain English wind",
        "swell_forecast": "plain English swell",
        "sailing_suggestion": "plain English sailing advice",
        "precipitation": "plain English precip or null"
      }
    ]
  }
}

Each area must have exactly ${dates.length} entries for dates: ${dates.join(', ')}.`;

    const response = await openai.chat.completions.create({
      model: config.openai.summaryModel,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '';
    logger.info('Step 3 (render) complete', { length: content.length, areaCount: areaDescriptions.length });

    const parsed = JSON.parse(content);
    return parsed.areas || {};
  },

  // ==================== STEP 4: Change summaries (CODE) ====================

  /**
   * Step 4: Compute change summary between two sets of structured day data.
   * Returns JSON string of bullet array, or null if no meaningful changes.
   */
  _computeChangeSummary(prevDays, currDays) {
    if (!prevDays || !currDays) return null;

    const bullets = [];

    for (const curr of currDays) {
      const prev = prevDays.find(p => p.date === curr.date);
      if (!prev) continue;

      const diffs = [];

      // Wind range
      const prevWindKt = safeGet(prev, 'wind.range_kt');
      const currWindKt = safeGet(curr, 'wind.range_kt');
      if (prevWindKt && currWindKt &&
          (prevWindKt[0] !== currWindKt[0] || prevWindKt[1] !== currWindKt[1])) {
        const dir = currWindKt[1] > prevWindKt[1] ? 'up' : 'down';
        diffs.push(`Wind ${dir} ${prevWindKt.join('-')}kt → ${currWindKt.join('-')}kt`);
      }

      // Wind direction (only if bucket changes)
      const prevWindDir = safeGet(prev, 'wind.dir');
      const currWindDir = safeGet(curr, 'wind.dir');
      if (prevWindDir && currWindDir &&
          compassBucket(prevWindDir) !== compassBucket(currWindDir)) {
        diffs.push(`Wind shifted ${prevWindDir} → ${currWindDir}`);
      }

      // Gusts
      const prevGust = safeGet(prev, 'wind.gust_kt');
      const currGust = safeGet(curr, 'wind.gust_kt');
      if (prevGust != null && currGust != null && prevGust !== currGust) {
        diffs.push(`Gusts ${prevGust}kt → ${currGust}kt`);
      }

      // Swell
      const prevSwellFt = safeGet(prev, 'swell.ft');
      const currSwellFt = safeGet(curr, 'swell.ft');
      if (prevSwellFt && currSwellFt &&
          (prevSwellFt[0] !== currSwellFt[0] || prevSwellFt[1] !== currSwellFt[1])) {
        const prevM = prevSwellFt.map(f => (f * FT_TO_M).toFixed(1));
        const currM = currSwellFt.map(f => (f * FT_TO_M).toFixed(1));
        const dir = currSwellFt[1] > prevSwellFt[1] ? 'up' : 'down';
        diffs.push(`Swell ${dir} ${prevM.join('-')}m → ${currM.join('-')}m`);
      }

      // Seas
      const prevSeasFt = safeGet(prev, 'seas_ft');
      const currSeasFt = safeGet(curr, 'seas_ft');
      if (prevSeasFt && currSeasFt &&
          (prevSeasFt[0] !== currSeasFt[0] || prevSeasFt[1] !== currSeasFt[1])) {
        const prevM = prevSeasFt.map(f => (f * FT_TO_M).toFixed(1));
        const currM = currSeasFt.map(f => (f * FT_TO_M).toFixed(1));
        const dir = currSeasFt[1] > prevSeasFt[1] ? 'up' : 'down';
        diffs.push(`Seas ${dir} ${prevM.join('-')}m → ${currM.join('-')}m`);
      }

      if (diffs.length > 0) {
        const label = new Date(curr.date + 'T12:00:00Z')
          .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        bullets.push({ label, text: diffs.join('. ') + '.' });
      }
    }

    return bullets.length > 0 ? JSON.stringify(bullets) : null;
  },
};

export default forecastEmailParserService;
```

---

### forecast-email.service.js

**Path:** `/Users/brad/code/REIMAGINEDAPPV2/maintenance-agent/src/services/forecast-email.service.js`

```javascript
/**
 * Forecast Email Service
 * Orchestrates the full pipeline: check Gmail inbox → ingest → parse → map to areas
 * Parse runs in background (fire-and-forget) so the check endpoint returns immediately.
 */

import { gmailRepository } from '../repositories/gmail.repository.js';
import { forecastEmailRepository } from '../repositories/forecast-email.repository.js';
import { forecastEmailParserService } from './forecast-email-parser.service.js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('forecast-email-service');

export const forecastEmailService = {
  /**
   * Check Gmail for new forecast emails and ingest them.
   * Returns immediately after ingestion — parsing runs in background.
   * @returns {Object} { emailsFound, emailsIngested, parseTriggered, errors }
   */
  async checkAndIngest() {
    if (!config.forecastEmail.enabled) {
      logger.info('Forecast email feature disabled');
      return { emailsFound: 0, emailsIngested: 0, parseTriggered: 0, errors: [], disabled: true };
    }

    const senderEmail = config.forecastEmail.senderEmail;
    const searchDays = config.forecastEmail.gmailSearchDays;
    const results = { emailsFound: 0, emailsIngested: 0, parseTriggered: 0, errors: [] };

    try {
      // Step 1: Search Gmail for recent emails from the forecast sender
      const query = `from:${senderEmail} newer_than:${searchDays}d`;
      logger.info('Searching Gmail for forecast emails', { query });

      const messages = await gmailRepository.searchMessages(query);
      results.emailsFound = messages.length;
      logger.info('Gmail search results', { count: messages.length });

      if (messages.length === 0) {
        logger.info('No new forecast emails found');
        await this._cleanup();
        return results;
      }

      // Step 2: Ingest each message (store in DB, no parsing yet)
      const emailsToProcess = [];

      for (const { id: gmailMessageId } of messages) {
        try {
          // Check if already ingested
          const existing = await forecastEmailRepository.emailExists(gmailMessageId);
          if (existing && existing.parse_status === 'parsed') {
            logger.debug('Email already parsed, skipping', { gmailMessageId });
            continue;
          }
          if (existing && existing.parse_status === 'parsing') {
            logger.debug('Email currently being parsed, skipping', { gmailMessageId });
            continue;
          }

          // Fetch full message
          const message = await gmailRepository.getMessage(gmailMessageId);
          const headers = gmailRepository.extractHeaders(message);
          const rawText = gmailRepository.extractPlainText(message);

          if (!rawText) {
            logger.warn('Empty email body, skipping', { gmailMessageId, subject: headers.subject });
            results.errors.push({ gmailMessageId, error: 'Empty email body' });
            continue;
          }

          const regionTag = this._extractRegionTag(headers.subject);

          // Insert or re-use existing record
          let emailRecord;
          if (existing) {
            logger.info('Existing email found', { gmailMessageId, parse_status: existing.parse_status });
            emailRecord = { id: existing.id };
          } else {
            emailRecord = await forecastEmailRepository.insertEmail({
              gmail_message_id: gmailMessageId,
              sender_email: headers.from,
              subject: headers.subject,
              received_at: headers.date ? new Date(headers.date).toISOString() : new Date().toISOString(),
              raw_text: rawText,
              forecast_date: null,
              region_tag: regionTag,
            });
            results.emailsIngested++;
          }

          emailsToProcess.push({
            ...emailRecord,
            subject: headers.subject,
            raw_text: rawText,
            received_at: headers.date ? new Date(headers.date).toISOString() : new Date().toISOString(),
          });
        } catch (err) {
          logger.error('Failed to ingest email', { gmailMessageId, error: err.message });
          results.errors.push({ gmailMessageId, error: err.message });
        }
      }

      // Step 3: Fire-and-forget parsing — cap concurrency at 4
      // Do NOT await — let parsing run in background so the HTTP response returns immediately
      const PARSE_CONCURRENCY = 4;
      const parseInBatches = async () => {
        for (let i = 0; i < emailsToProcess.length; i += PARSE_CONCURRENCY) {
          const batch = emailsToProcess.slice(i, i + PARSE_CONCURRENCY);
          await Promise.allSettled(batch.map(email => this._parseInBackground(email)));
        }
      };
      parseInBatches().catch(err => logger.error('Batch parsing failed', { error: err.message }));
      results.parseTriggered = emailsToProcess.length;

      // Step 4: Cleanup old emails
      await this._cleanup();

    } catch (err) {
      logger.error('Forecast email check failed', { error: err.message });
      results.errors.push({ error: err.message });
    }

    logger.info('Forecast email check completed', results);
    return results;
  },

  /**
   * Parse an email in the background with job lock protection.
   */
  async _parseInBackground(email) {
    try {
      // Acquire lock
      const locked = await forecastEmailRepository.acquireParseLock(email.id);
      if (!locked) {
        logger.debug('Could not acquire parse lock, skipping', { emailId: email.id });
        return;
      }

      const result = await forecastEmailParserService.parseAndMap(email);
      logger.info('Background parse completed', {
        emailId: email.id,
        subject: email.subject,
        forecastsWritten: result.forecastsWritten,
      });
    } catch (err) {
      logger.error('Background parse failed', { emailId: email.id, error: err.message });
      // parseAndMap already marks as 'failed' internally
    }
  },

  /**
   * Get ingestion status for the status endpoint
   */
  async getStatus() {
    const recentEmails = await forecastEmailRepository.getRecentEmails(20);
    const counts = { queued: 0, parsing: 0, parsed: 0, partial: 0, failed: 0 };
    for (const e of recentEmails) {
      if (counts[e.parse_status] !== undefined) {
        counts[e.parse_status]++;
      }
    }

    return {
      enabled: config.forecastEmail.enabled,
      senderEmail: config.forecastEmail.senderEmail,
      recentEmails: recentEmails.length,
      ...counts,
      pending: counts.queued + counts.parsing, // for backwards compat
      lastEmail: recentEmails[0] || null,
    };
  },

  /**
   * Get parse progress (for frontend polling)
   */
  async getParseProgress() {
    const recentEmails = await forecastEmailRepository.getRecentEmails(20);
    const queued = recentEmails.filter(e => e.parse_status === 'queued').length;
    const parsing = recentEmails.filter(e => e.parse_status === 'parsing').length;
    const parsed = recentEmails.filter(e => e.parse_status === 'parsed').length;
    const partial = recentEmails.filter(e => e.parse_status === 'partial').length;
    const failed = recentEmails.filter(e => e.parse_status === 'failed').length;

    return {
      inProgress: queued + parsing > 0,
      queued,
      parsing,
      parsed,
      partial,
      failed,
      total: recentEmails.length,
    };
  },

  /**
   * Extract a region tag from the email subject
   */
  _extractRegionTag(subject) {
    if (!subject) return null;
    const dashMatch = subject.match(/[-–]\s*(.+)$/);
    if (dashMatch) return dashMatch[1].trim();
    return subject.trim();
  },

  /**
   * Clean up old emails using configured retention
   */
  async _cleanup() {
    try {
      const days = config.forecastEmail.retentionDays;
      const deleted = await forecastEmailRepository.deleteOlderThan(days);
      if (deleted > 0) {
        logger.info('Cleaned up old forecast emails', { deleted, retentionDays: days });
      }
    } catch (err) {
      logger.error('Failed to clean up old emails', { error: err.message });
    }
  },
};

export default forecastEmailService;
```

---

### forecast-email.repository.js

**Path:** `/Users/brad/code/REIMAGINEDAPPV2/maintenance-agent/src/repositories/forecast-email.repository.js`

```javascript
/**
 * Forecast Email Repository
 * Supabase CRUD for weather_forecast_emails and weather_expert_forecasts tables
 */

import supabaseRepo from './supabase.repository.js';
import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const supabase = supabaseRepo.client;
const config = getConfig();
const logger = createLogger('forecast-email-repository');

export const forecastEmailRepository = {
  // ========== WEATHER_FORECAST_EMAILS ==========

  /**
   * Check if a Gmail message has already been ingested
   */
  async emailExists(gmailMessageId) {
    const { data, error } = await supabase
      .from('weather_forecast_emails')
      .select('id, parse_status')
      .eq('gmail_message_id', gmailMessageId)
      .maybeSingle();

    if (error) {
      logger.error('Failed to check email existence', { gmailMessageId, error: error.message });
      throw error;
    }

    return data; // null if not found, { id, parse_status } if found
  },

  /**
   * Insert a new forecast email
   */
  async insertEmail({ gmail_message_id, sender_email, subject, received_at, raw_text, forecast_date, region_tag }) {
    const { data, error } = await supabase
      .from('weather_forecast_emails')
      .insert({
        gmail_message_id,
        sender_email,
        subject,
        received_at,
        raw_text,
        forecast_date,
        region_tag,
        parse_status: 'queued',
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to insert forecast email', { gmail_message_id, error: error.message });
      throw error;
    }

    logger.info('Forecast email inserted', { id: data.id, subject, gmail_message_id });
    return data;
  },

  /**
   * Update parse status of an email
   */
  async updateParseStatus(emailId, status, parseError = null, forecastDate = null) {
    const updates = {
      parse_status: status,
      parse_error: parseError,
    };
    if (status === 'parsed') {
      updates.parsed_at = new Date().toISOString();
    }
    if (forecastDate) {
      updates.forecast_date = forecastDate;
    }

    const { error } = await supabase
      .from('weather_forecast_emails')
      .update(updates)
      .eq('id', emailId);

    if (error) {
      logger.error('Failed to update parse status', { emailId, status, error: error.message });
      throw error;
    }
  },

  /**
   * Get recent forecast emails
   */
  async getRecentEmails(limit = 20) {
    const { data, error } = await supabase
      .from('weather_forecast_emails')
      .select('id, gmail_message_id, subject, received_at, forecast_date, parse_status, parse_error, region_tag, created_at')
      .order('received_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to get recent emails', { error: error.message });
      throw error;
    }

    return data || [];
  },

  /**
   * Delete emails older than N days (cascades to expert_forecasts via FK)
   */
  async deleteOlderThan(days) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('weather_forecast_emails')
      .delete()
      .lt('received_at', cutoff)
      .select('id');

    if (error) {
      logger.error('Failed to delete old emails', { days, error: error.message });
      throw error;
    }

    const count = data?.length || 0;
    if (count > 0) {
      logger.info('Deleted old forecast emails', { count, cutoffDays: days });
    }
    return count;
  },

  /**
   * Store structured forecast JSON on the email row (Step 1 checkpoint)
   */
  async storeStructuredForecast(emailId, structured, emailHash = null) {
    const updates = { structured_forecast: structured };
    if (emailHash) updates.email_hash = emailHash;

    const { error } = await supabase
      .from('weather_forecast_emails')
      .update(updates)
      .eq('id', emailId);

    if (error) {
      logger.error('Failed to store structured forecast', { emailId, error: error.message });
      throw error;
    }
  },

  /**
   * Get structured forecast JSON from the email row
   */
  async getStructuredForecast(emailId) {
    const { data, error } = await supabase
      .from('weather_forecast_emails')
      .select('structured_forecast')
      .eq('id', emailId)
      .single();

    if (error) {
      logger.error('Failed to get structured forecast', { emailId, error: error.message });
      return null;
    }

    return data?.structured_forecast || null;
  },

  /**
   * Atomic job lock: set parse_status to 'parsing' only if eligible.
   * Returns true if lock acquired, false if another worker has it.
   */
  async acquireParseLock(emailId) {
    const { data, error } = await supabase
      .from('weather_forecast_emails')
      .update({ parse_status: 'parsing' })
      .eq('id', emailId)
      .in('parse_status', ['queued', 'failed', 'partial'])
      .select('id');

    if (error) {
      logger.error('Failed to acquire parse lock', { emailId, error: error.message });
      return false;
    }

    return data && data.length > 0;
  },

  // ========== WEATHER_EXPERT_FORECASTS ==========

  /**
   * Insert expert forecast (one row per email per area per date)
   */
  async insertExpertForecast(forecast) {
    const { data, error } = await supabase
      .from('weather_expert_forecasts')
      .insert(forecast)
      .select()
      .single();

    if (error) {
      logger.error('Failed to insert expert forecast', { area_id: forecast.area_id, forecast_date: forecast.forecast_date, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Check if an email produced expert forecasts for any active (non-deleted) areas
   */
  async emailHasActiveForecasts(emailId) {
    const { count, error } = await supabase
      .from('weather_expert_forecasts')
      .select('id, weather_areas!inner(is_active, deleted_at)', { count: 'exact', head: true })
      .eq('email_id', emailId)
      .eq('weather_areas.is_active', true)
      .is('weather_areas.deleted_at', null);

    if (error) {
      logger.error('Failed to check email forecasts', { emailId, error: error.message });
      return false;
    }

    return count > 0;
  },

  /**
   * Update the area_change_summary on a specific forecast row
   */
  async updateChangeSummary(forecastId, summary) {
    const { error } = await supabase
      .from('weather_expert_forecasts')
      .update({ area_change_summary: summary })
      .eq('id', forecastId);

    if (error) {
      logger.error('Failed to update change summary', { forecastId, error: error.message });
      throw error;
    }
  },

  /**
   * Get all expert forecasts for an area (all versions, for comparison)
   * Returns rows from the most recent email only (latest batch)
   */
  async getExpertForecastsByArea(areaId) {
    const { data, error } = await supabase
      .from('weather_expert_forecasts')
      .select('*')
      .eq('area_id', areaId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to get expert forecasts by area', { areaId, error: error.message });
      throw error;
    }

    if (!data || data.length === 0) return [];

    // Return only rows from the most recent email_id
    const latestEmailId = data[0].email_id;
    return data.filter(r => r.email_id === latestEmailId);
  },

  /**
   * Get change summaries for all areas (for weather-areas listing page)
   */
  async getChangeSummaries() {
    const { data, error } = await supabase
      .from('weather_expert_forecasts')
      .select('area_id, area_change_summary, created_at, weather_areas!inner(name, is_active, deleted_at)')
      .not('area_change_summary', 'is', null)
      .eq('weather_areas.is_active', true)
      .is('weather_areas.deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to get change summaries', { error: error.message });
      throw error;
    }

    if (!data || data.length === 0) return [];

    // Deduplicate: one summary per area (most recent)
    const seen = new Map();
    for (const row of data) {
      if (!seen.has(row.area_id)) {
        seen.set(row.area_id, {
          area_id: row.area_id,
          area_name: row.weather_areas?.name || 'Unknown',
          summary: row.area_change_summary,
          updated_at: row.created_at,
        });
      }
    }
    return Array.from(seen.values());
  },

  /**
   * Get the latest expert forecast for an area on a specific date
   * (most recent email wins)
   */
  async getExpertForecast(areaId, date) {
    const { data, error } = await supabase
      .from('weather_expert_forecasts')
      .select('*')
      .eq('area_id', areaId)
      .eq('forecast_date', date)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error('Failed to get expert forecast', { areaId, date, error: error.message });
      throw error;
    }

    return data;
  },

  /**
   * Get latest expert forecasts for an area (for 10-day view)
   * Returns only the most recent version per forecast_date
   */
  async getExpertForecasts(areaId) {
    const { data, error } = await supabase
      .from('weather_expert_forecasts')
      .select('*')
      .eq('area_id', areaId)
      .order('forecast_date', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to get expert forecasts', { areaId, error: error.message });
      throw error;
    }

    // Deduplicate: keep only the latest row per forecast_date
    const latest = new Map();
    for (const row of (data || [])) {
      if (!latest.has(row.forecast_date)) {
        latest.set(row.forecast_date, row);
      }
    }
    return Array.from(latest.values());
  },

  /**
   * Get recent changes across all areas — compares the two most recent
   * versions for each (area_id, forecast_date) pair
   */
  async getRecentChanges(limit = 20) {
    // Fetch all expert forecasts from the last 10 days, ordered for comparison
    const cutoff = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('weather_expert_forecasts')
      .select('*, weather_areas!inner(name, is_active, deleted_at)')
      .gte('forecast_date', cutoff)
      .eq('weather_areas.is_active', true)
      .is('weather_areas.deleted_at', null)
      .order('forecast_date', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Failed to get recent changes', { error: error.message });
      throw error;
    }

    if (!data || data.length === 0) return [];

    // Group by (area_id, forecast_date), compare latest two versions
    const groups = new Map();
    for (const row of data) {
      const key = `${row.area_id}|${row.forecast_date}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    const changes = [];
    const comparedFields = ['wind_forecast', 'swell_forecast', 'sailing_suggestion', 'precipitation', 'synopsis', 'outlook'];

    for (const [, rows] of groups) {
      if (rows.length < 2) continue; // no previous version to compare
      const current = rows[0];
      const previous = rows[1];

      const diffs = [];
      for (const field of comparedFields) {
        const oldVal = previous[field] || '';
        const newVal = current[field] || '';
        if (oldVal !== newVal && oldVal && newVal) {
          diffs.push({ field, previous: oldVal, current: newVal });
        }
      }

      if (diffs.length > 0) {
        changes.push({
          area_id: current.area_id,
          area_name: current.weather_areas?.name || 'Unknown',
          forecast_date: current.forecast_date,
          updated_at: current.created_at,
          diffs,
        });
      }
    }

    // Sort by most recently updated, limit
    changes.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    return changes.slice(0, limit);
  },
};

export default forecastEmailRepository;
```

---

### scheduler.job.js (forecast-email-check section)

**Path:** `/Users/brad/code/REIMAGINEDAPPV2/maintenance-agent/src/jobs/scheduler.job.js`

```javascript
    // Forecast email check - Mon-Sat at 8am,9am,10am,11am,noon EST (13-17 UTC)
    const forecastEmailSchedule = '0 13,14,15,16,17 * * 1-6';
    const forecastEmailTask = cron.schedule(forecastEmailSchedule, () => {
      agentLogger.cronJobExecuted('forecast-email-check');
      this.performForecastEmailCheck();
    });

    this.scheduledTasks.push({
      name: 'forecast-email-check',
      schedule: forecastEmailSchedule,
      task: forecastEmailTask,
    });

    agentLogger.cronJobScheduled('forecast-email-check', forecastEmailSchedule);
```

And the handler:

```javascript
  /**
   * Check Gmail for new forecast emails, parse and map to areas
   */
  async performForecastEmailCheck() {
    if (!config.forecastEmail?.enabled) {
      logger.debug('Forecast email feature disabled, skipping cron');
      return;
    }

    logger.info('Performing scheduled forecast email check');

    try {
      const result = await forecastEmailService.checkAndIngest();
      logger.info('Scheduled forecast email check completed', {
        found: result.emailsFound,
        ingested: result.emailsIngested,
        parsed: result.emailsParsed,
        errors: result.errors.length,
      });
    } catch (error) {
      logger.error('Scheduled forecast email check failed', { error: error.message });
    }
  },
```

---

## Current Status

- 2 emails tested: Tue24 parsed fully (25 expert forecasts for 5 areas x 5 days), Mon23 partial (render timed out)
- Fire-and-forget working -- button returns immediately, polls for progress
- Concurrency capped at 4 emails per batch
- Cron schedule: Mon-Sat 8am, 9am, 10am, 11am, noon EST (cron expression: `0 13,14,15,16,17 * * 1-6`)
- GPS matching uses 1 degree tolerance + auto-fixes reversed lon_range
- OpenAI client timeout: 120s
- Parse lock prevents duplicate processing (`acquireParseLock` uses atomic Supabase update with status filter)
- Structured forecast stored as checkpoint on email row -- retries skip Step 1
- `parseForNewArea()` reuses stored structured data -- no LLM call for Step 1

## Known Issues

- **Speed:** 3 sequential LLM calls per email is slow (~2 min). Normalize step (Step 2) could potentially be done in code or combined with render.
- **Mon23 email render timed out** -- needs retry (status is 'partial', so `acquireParseLock` will accept it on next cron run)
- **No change deltas yet** -- need 2 fully parsed emails for the same area to produce a diff. Once Mon23 retries successfully, diffs should populate.
- **W Caribbean emails** produce 0 forecasts (no area matches) but still cost 1 LLM call for Step 1 extraction. Could be skipped entirely with a subject-line filter.
- **Compass bucketing** in change summaries uses 8-point (NNE becomes NE). Minor direction shifts within the same 8-point bucket are silently ignored.
