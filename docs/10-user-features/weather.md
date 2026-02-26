# Weather

## Overview

Weather provides marine-specific forecasts for saved locations using multiple weather APIs for multi-source comparison. Features AI-powered sailing analysis with 10-day recommendations. Weather runs primarily in the **maintenance-agent** service.

**Who uses it:** Boat owners planning trips
**Access:** `/weather-areas.html` → `/weather-area-view.html` (maintenance service)

**Data Sources (6 total):**
| Source | Provider | Cost | Horizon | Notes |
|--------|----------|------|---------|-------|
| OM (Open-Meteo) | Open-Meteo | Free | 7 days | Forecast + Marine APIs |
| SG (Stormglass) | Stormglass blend | 10/day | 10 days | AI-weighted blend |
| NOAA | Stormglass/NOAA | 10/day | 10 days | US weather service |
| ECMWF | Stormglass/ECMWF | 10/day | 10 days | European model |
| MeteoFR | Stormglass/Météo France | 10/day | 10 days | French weather service |
| Expert | MWXC email forecast | Free | 5-6 days | Human meteorologist, 80th percentile of ranges |

**Key Features:**
1. **Multi-Source Comparison** - See all 6 sources side-by-side
2. **AI Sailing Analysis** - OpenAI-powered best sailing window recommendations
3. **10-Day Graphs** - Wind and wave trends with calculated values
4. **Current-Swell Relationship** - Safety warnings for opposing currents

**Two Components:**
1. **Weather Areas** (maintenance-agent) - User-defined locations with forecast fetching
2. **Trip Weather Collector** (main app) - Background job that logs weather during active trips

---

## User Flow

### Adding a Weather Area

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Navigate to Weather Areas                                   │
│     └── Opens maintenance-agent: /weather-areas.html            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Add New Area                                                │
│     ├── Enter name (e.g., "Miami Marina")                       │
│     ├── Enter latitude/longitude                                │
│     └── POST /api/weather/areas                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Auto-Fetch Weather (background)                             │
│     ├── Open-Meteo Forecast API (free)                          │
│     ├── Open-Meteo Marine API (free)                            │
│     └── Meteoblue Sea API (if credits available)                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. View Forecasts                                              │
│     ├── GET /api/weather/areas/:id/current                      │
│     ├── GET /api/weather/areas/:id/7day                         │
│     └── GET /api/weather/areas/:id/comparison                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

| Term | Definition |
|------|------------|
| **Weather Area** | Named location with lat/lon for forecast fetching |
| **Open-Meteo** | Free weather API (forecast + marine data) |
| **Stormglass** | Premium API aggregating multiple models (10 calls/day free) |
| **Expert** | Human meteorologist forecast parsed from daily MWXC emails |
| **GFS/ICON** | Weather models (gfs_seamless, icon_global) |
| **Marine Data** | Wave height, swell, period, direction |
| **Consensus** | Average of all 6 sources (including Expert when available) |
| **Calculated Wave** | Combined wave height: √(Swell² + Wind Wave²) |
| **Trip Weather** | Weather logged during active boat trips |

---

## Weather Area View UI

The main forecast view (`weather-area-view.html`) provides a card-based interface for viewing and comparing weather data.

### Navigation

```
┌─────────────────────────────────────────────────────────────────┐
│  Time Nav (top, fixed)                                          │
│  [5am] [9am] [1pm] [5pm] [9pm]                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Weather Card (main content)                                    │
│  - Wind with 6-source grid (includes Expert)                    │
│  - Wave Height with 7-source grid (includes Calc)               │
│  - Wave Period with 6-source grid (includes Expert)             │
│  - Consensus line (all-source avg)                              │
│  - Swell, Wind Wave, Rain                                       │
│  - Current-swell relationship                                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Day Nav (bottom, fixed, scrollable)                            │
│  [🤖 AI] [Mon 5] [Tue 6] [Wed 7] ... [Wed 14]                   │
└─────────────────────────────────────────────────────────────────┘
```

### Time Blocks

| Block | Hours (UTC) | Label |
|-------|-------------|-------|
| Early | 5am - 9am | 5am |
| Morning | 9am - 1pm | 9am |
| Afternoon | 1pm - 5pm | 1pm |
| Evening | 5pm - 9pm | 5pm |
| Night | 9pm - 5am | 9pm |

### Source Grid Display

Each metric shows a 6-column comparison grid:

```
┌────────┬────────┬────────┬────────┬────────┬────────┐
│   OM   │   SG   │  NOAA  │  ECMWF │MeteoFR │ Expert │
│  12kn  │  11kn  │  13kn  │  12kn  │  11kn  │  17kn  │
└────────┴────────┴────────┴────────┴────────┴────────┘
```

**Wave Height** has a 7th column: **Calc** (green)
- Shows calculated combined wave: √(Swell² + Wind Wave²)
- Physics-based - swell and wind waves don't simply add

### Expert Source Column

The Expert column shows data from the parsed MWXC professional forecast email. Key behaviors:
- **Same value for all time blocks** on a given day (expert forecasts are daily, not hourly)
- **80th percentile** of the expert's range (e.g., 12-18 kn → 17 kn), rounded up
- **Rounding:** Integers for wind (kn) and period (s), one decimal for waves (m)
- **Unit conversion:** Expert seas/swell are in feet → converted to meters (÷ 3.281)
- **Blank** when no expert forecast exists for that day (typically beyond 5-6 days out)
- **Included in consensus** — expert values participate in all averaging calculations
- **Data source:** `structured_data` jsonb column on `weather_expert_forecasts` table

### Current-Swell Relationship

Safety indicator showing how tidal current interacts with swell:

| Condition | Icon | Meaning |
|-----------|------|---------|
| Opposing | ⚠️ | Current flows opposite to swell travel - creates steep, dangerous waves |
| Crossing | ✓ | Current crosses swell at angle - moderate effect |
| Following | ✓ | Current flows with swell - smooth conditions |

**Calculation:**
- Current direction = where water flows TO
- Swell direction = where waves come FROM
- Swell travels toward (swell_direction + 180°)
- Angle difference determines relationship

---

## AI Sailing Analysis

The **🤖 AI** button shows a 10-day sailing conditions analysis.

### Features

1. **Color-Coded Score Bar** - Daily sailing conditions at a glance
   - 🟢 Green (80-100): Excellent
   - 🟡 Yellow (60-79): Good
   - 🟠 Orange (40-59): Fair
   - 🔴 Red (0-39): Poor

2. **Best Windows** - Top 3 sailing windows with conditions
3. **Avoid** - Bottom 3 windows to avoid
4. **10-Day Graphs**:
   - Wind: Avg wind (blue) + Gust estimate (red), 7-30kn scale
   - Waves: Consensus (blue) + Calculated (green), 0.7-2.1m scale
5. **AI Summary** - OpenAI-generated natural language recommendation
6. **Days 11-17 Outlook** - Seasonal patterns beyond forecast data

### Scoring System

Each time block (50 total over 10 days) gets a score 0-100:

| Factor | Weight | Scoring |
|--------|--------|---------|
| Wind | 25 pts | <15kn=25, 15-20kn=20, 20-25kn=10, >25kn=0 |
| Waves | 25 pts | <1.0m=25, 1.0-1.3m=20, 1.3-1.5m=10, >1.5m=0 |
| Period | 25 pts | >8s=25, 6-8s=20, 4-6s=15, <4s=5 |
| Current | 25 pts | Following=25, Crossing=20, Opposing=5 |

### AI Endpoint

```
POST /api/weather/ai-sailing-summary
```

**Request:**
```json
{
  "scores": [
    {
      "day": "2026-01-05",
      "dayName": "Mon",
      "dayNum": 5,
      "timeBlock": "Morning",
      "timeLabel": "9am",
      "score": 85,
      "wind": 12,
      "waveConsensus": 0.9,
      "waveCalc": 0.8,
      "period": 7,
      "currentRelation": "following"
    }
    // ... 50 time blocks
  ],
  "area": { "name": "Mid to A", "lat": 16.77, "lng": -61.73 },
  "preferences": {
    "maxWind": 25,
    "preferWind": 20,
    "maxWave": 1.5,
    "preferWave": 1.3,
    "minPeriod": 6
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": "Best sailing window is Tuesday through Wednesday morning with light 12-15kn winds...",
    "outlook": "For days 11-17, typical January trade winds in the Caribbean...",
    "generatedAt": "2026-01-05T16:35:37.554Z"
  }
}
```

**Model:** `config.openai.summaryModel` (env: `OPENAI_SUMMARY_MODEL`, default `gpt-4.1-mini`)

---

## Expert Forecast Email Pipeline

Automatically ingests daily Caribbean sailing forecast emails from a professional forecaster, parses them into structured data, and maps relevant sections to saved weather areas.

### Overview

- **Source:** Daily emails (Mon-Sat) from `support@mwxc.com` via Gmail API
- **Pipeline:** 2 LLM calls + code diffs (optimized from 11 sequential calls)
- **Schedule:** Every 2 hours Mon-Sat 6am-8pm EST (`0 11,13,15,17,19,21,23,1 * * 1-6` UTC)
- **Retention:** 10 days (configurable via `FORECAST_RETENTION_DAYS`)

### Pipeline (4 Steps)

| Step | Type | Model | Purpose |
|------|------|-------|---------|
| 1 | **LLM** | `config.openai.model` (gpt-5.1) | Extract raw text blocks from email (one-time) |
| 1b | **Code** | None | GPS-match areas to extracted sections by lat/lon |
| 2 | **Code** (regex) | None | Normalize shorthand → structured JSON (`forecast-shorthand-parser.js`) |
| 2b | **Code** | None | Map areas to normalized sections by bounding boxes |
| 3 | **LLM** | `config.openai.summaryModel` (gpt-4.1-mini) | Render structured JSON → prose for all areas (one call) |
| 4 | **Code** | None | Diff structured data for change summaries (deterministic) |

### Parse Status State Machine

```
queued → parsing → parsed | partial | failed
```

- `queued`: email ingested, waiting for parse
- `parsing`: parse in progress (job lock held). Auto-recovered to `queued` if stuck >10 minutes
- `parsed`: all steps completed
- `partial`: Step 1 OK but Step 3 failed — structured data saved
- `failed`: Step 1 failed

### Fire-and-Forget

`POST /forecast-email/check` returns immediately after Gmail ingestion. Parsing runs in background with job lock (prevents duplicate work). Frontend polls `GET /forecast-email/parse-progress` for status.

### Structured JSON (Step 1 Output)

Stored in `weather_forecast_emails.structured_forecast` (jsonb). This is the canonical format — diffs and re-rendering use this, not prose.

```json
{
  "region_name": "E Caribbean",
  "primary_date": "2026-02-24",
  "synopsis": "faithful paraphrase",
  "outlook": "faithful paraphrase",
  "sections": [{
    "section_id": "antigua-st-martin",
    "lat_range": [17.0, 18.5],
    "lon_range": [-63.0, -61.0],
    "days": [{
      "date": "2026-02-24",
      "wind": { "dir": "ESE", "range_kt": [12, 18], "gust_kt": 22 },
      "seas_ft": [4, 6],
      "swell": [{ "dir": "ENE", "ft": [3, 5], "period_s": [8, 10] }],
      "sailing_notes": { "W-NW": "advice", "N": "advice" }
    }]
  }]
}
```

### Change Summaries (Step 4)

Deterministic code diffs on structured numeric data. Wind direction bucketed to 8-point compass (only reports changes ≥1 bucket). Output format: `[{ "label": "Feb 24", "text": "Wind up 12-18kt → 15-20kt. Swell down 0.9-1.5m → 0.6-1.2m." }]`

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/weather/areas/:id/expert-forecast?date=YYYY-MM-DD` | Expert forecast for area+date |
| GET | `/api/weather/areas/:id/expert-forecasts` | All expert forecasts for area (10-day) |
| POST | `/api/weather/forecast-email/check` | Trigger Gmail check (fire-and-forget) |
| GET | `/api/weather/forecast-email/status` | Ingestion status |
| GET | `/api/weather/forecast-email/parse-progress` | Parse progress (for polling) |
| GET | `/api/weather/data-status` | Combined: last weather API fetch + last expert email |
| GET | `/api/weather/expert-forecast-changes` | Per-area change summaries |

### Database Tables

**weather_forecast_emails** — raw ingested emails

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| gmail_message_id | text | Unique, for dedup |
| sender_email | text | Email sender |
| subject | text | Email subject |
| received_at | timestamptz | When email was received |
| raw_text | text | Full email body |
| structured_forecast | jsonb | Step 1 structured JSON (canonical) |
| email_hash | text | SHA-256 of raw_text |
| forecast_date | date | Primary forecast date |
| parse_status | text | queued/parsing/parsed/partial/failed |
| parse_error | text | Error message if failed |
| region_tag | text | Region from subject |
| parsed_at | timestamptz | When parsing completed |

**weather_expert_forecasts** — parsed excerpts per area per date

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| email_id | uuid | FK to weather_forecast_emails (CASCADE) |
| area_id | uuid | FK to weather_areas |
| forecast_date | date | Date this forecast covers |
| region_name | text | Email section name |
| synopsis | text | Prose synopsis |
| outlook | text | Prose outlook |
| wind_forecast | text | Prose wind |
| swell_forecast | text | Prose swell |
| sailing_suggestion | text | Prose sailing advice |
| precipitation | text | Prose precipitation |
| area_change_summary | text | JSON array of delta bullets |
| structured_data | jsonb | Structured day data from regex parser (wind, seas, swell, etc.) |
| llm_raw_response | text | Raw LLM response (debug) |

**Unique constraint:** `(email_id, area_id, forecast_date)`

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GMAIL_CLIENT_ID` | — | Google OAuth client ID |
| `GMAIL_CLIENT_SECRET` | — | Google OAuth client secret |
| `GMAIL_REFRESH_TOKEN` | — | OAuth refresh token |
| `FORECAST_SENDER_EMAIL` | `support@mwxc.com` | Email sender to filter |
| `FORECAST_EMAIL_ENABLED` | `false` | Feature toggle |
| `FORECAST_RETENTION_DAYS` | `10` | Days to keep emails |
| `FORECAST_GMAIL_SEARCH_DAYS` | `4` | Gmail search window |
| `OPENAI_SUMMARY_MODEL` | `gpt-4.1-mini` | Cheap model for rendering |

### Files

| Purpose | Path |
|---------|------|
| Parser service | `maintenance-agent/src/services/forecast-email-parser.service.js` |
| Shorthand parser | `maintenance-agent/src/services/forecast-shorthand-parser.js` (regex, Step 2) |
| Parser tests | `maintenance-agent/tests/forecast-shorthand-parser.test.js` |
| Email service | `maintenance-agent/src/services/forecast-email.service.js` |
| Repository | `maintenance-agent/src/repositories/forecast-email.repository.js` |
| Gmail repository | `maintenance-agent/src/repositories/gmail.repository.js` |
| Scheduler | `maintenance-agent/src/jobs/scheduler.job.js` |
| Frontend (areas) | `src/public/weather-areas.html` |
| Frontend (view) | `src/public/weather-area-view.html` |

---

## Stormglass Integration

### API Details

- **Free Tier:** 10 requests/day
- **Data:** 10 days of hourly forecasts
- **Endpoint:** `https://api.stormglass.io/v2/weather/point`

### Parameters Fetched

**Marine:**
- waveHeight, waveDirection, wavePeriod
- swellHeight, swellDirection, swellPeriod
- secondarySwellHeight, secondarySwellDirection, secondarySwellPeriod
- windWaveHeight, windWaveDirection, windWavePeriod

**Currents:**
- currentSpeed, currentDirection

**Atmosphere:**
- windSpeed, windDirection, gust
- airTemperature, pressure, humidity, cloudCover
- precipitation, visibility

### Data Model

Stored in `weather_forecasts` with:
- `data_source = 'stormglass'`
- `model_name = 'sg' | 'noaa' | 'ecmwf' | 'meteo' | 'meto'`

One row per model per hour, allowing easy multi-model comparison.

### Environment Variables

```env
STORMGLASS_API_KEY=your_key_here
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Main App (boatos-main)                                         │
│  └── weather-collector.service.js                               │
│      ├── Runs every 15 minutes                                  │
│      ├── Checks for active trips                                │
│      └── Logs weather to trip_weather table                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Maintenance Agent (boatos-maintenance)                         │
│  ├── weather.route.js         (API endpoints + AI summary)      │
│  ├── weather-fetch.service.js (orchestration)                   │
│  ├── weather-area.service.js  (area CRUD)                       │
│  ├── weather-forecast.service.js (forecast queries)             │
│  ├── weather-credits.service.js (Meteoblue credits)             │
│  ├── forecast-email.service.js (expert email pipeline)          │
│  ├── forecast-email-parser.service.js (2-step LLM parse)       │
│  ├── weather.repository.js    (database)                        │
│  ├── forecast-email.repository.js (email + forecast CRUD)       │
│  ├── gmail.repository.js      (Gmail API via fetch)             │
│  ├── stormglass.repository.js (Stormglass API)                  │
│  ├── open-meteo.repository.js (Open-Meteo API)                  │
│  └── meteoblue.repository.js  (Meteoblue API)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  External APIs                                                  │
│  ├── https://api.open-meteo.com/v1/forecast      (free)         │
│  ├── https://marine-api.open-meteo.com/v1/marine (free)         │
│  ├── https://api.stormglass.io/v2/weather/point  (10/day free)  │
│  ├── https://my.meteoblue.com/...                (paid credits) │
│  └── https://api.openai.com/v1/chat/completions  (AI summary)   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase                                                       │
│  ├── weather_areas          (saved locations)                   │
│  ├── weather_forecasts      (forecast data)                     │
│  ├── weather_fetch_logs     (fetch history)                     │
│  ├── weather_api_credits    (Meteoblue credits)                 │
│  ├── weather_forecast_emails (ingested expert emails)           │
│  ├── weather_expert_forecasts (parsed per-area forecasts)       │
│  └── trip_weather           (weather during trips)              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Trip Weather Collector (src/services/trips/weather-collector.service.js)

Background job that runs in ALL environments (started in `src/start.js`).

### Configuration

```javascript
const COLLECTION_INTERVAL_MS = 15 * 60 * 1000;  // 15 minutes
```

### Open-Meteo Marine API Call

```javascript
async function fetchMarineWeather(lat, lon) {
  const url = new URL('https://marine-api.open-meteo.com/v1/marine');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('current', [
    'wave_height',
    'wave_direction',
    'wave_period',
    'wind_wave_height',
    'wind_wave_direction',
    'wind_wave_period',
    'swell_wave_height',
    'swell_wave_direction',
    'swell_wave_period'
  ].join(','));

  const response = await fetch(url.toString());
  return response.json();
}
```

### Open-Meteo Forecast API Call

```javascript
async function fetchStandardWeather(lat, lon) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('current', [
    'temperature_2m',
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
    'pressure_msl',
    'cloud_cover',
    'visibility',
    'precipitation'
  ].join(','));
  url.searchParams.set('wind_speed_unit', 'kn');  // knots

  const response = await fetch(url.toString());
  return response.json();
}
```

### Weather Record Structure

```javascript
const weatherRecord = {
  trip_id: tripId,
  latitude: lat,
  longitude: lon,
  source: 'open-meteo-marine',

  // Wind (from standard API, in knots)
  wind_speed_kts: standard.wind_speed_10m,
  wind_direction: standard.wind_direction_10m,
  wind_gusts_kts: standard.wind_gusts_10m,

  // Waves (from marine API)
  wave_height_m: marine.wave_height,
  wave_period_s: marine.wave_period,
  wave_direction: marine.wave_direction,

  // Swell (from marine API)
  swell_height_m: marine.swell_wave_height,
  swell_period_s: marine.swell_wave_period,
  swell_direction: marine.swell_wave_direction,

  // Atmosphere (from standard API)
  air_temp_c: standard.temperature_2m,
  pressure_hpa: standard.pressure_msl,
  cloud_cover_pct: standard.cloud_cover,
  visibility_m: standard.visibility,
  precipitation_mm: standard.precipitation,

  // Debug data
  api_response: { marine: marineData, standard: standardData }
};
```

### Start/Stop Functions

```javascript
export function startWeatherCollector() {
  // Runs immediately, then every 15 minutes
  collectWeatherForActiveTrips();
  collectionTimer = setInterval(collectWeatherForActiveTrips, COLLECTION_INTERVAL_MS);
}

export function stopWeatherCollector() {
  clearInterval(collectionTimer);
  collectionTimer = null;
}
```

---

## Weather Areas Service (maintenance-agent)

### Fetch Orchestration (weather-fetch.service.js:25-127)

```javascript
async fetchForArea(areaId, options = {}) {
  const { sources = ['openmeteo', 'meteoblue'] } = options;
  const area = await weatherRepository.getAreaById(areaId);

  const results = {
    openMeteoForecast: null,
    openMeteoMarine: null,
    meteoblue: null
  };

  // 1. Open-Meteo Forecast (free, GFS & ICON models)
  if (fetchOpenMeteo) {
    const forecastData = await openMeteoRepository.fetchForecastData(
      area.latitude, area.longitude, ['gfs_seamless', 'icon_global']
    );
    const forecasts = openMeteoRepository.transformForecastResponse(forecastData, areaId);
    await weatherRepository.storeForecasts(forecasts);
  }

  // 2. Open-Meteo Marine (free)
  const marineData = await openMeteoRepository.fetchMarineData(lat, lon);
  const forecasts = openMeteoRepository.transformMarineResponse(marineData, areaId);

  // 3. Meteoblue (if enabled and credits available)
  if (config.meteoblue.enabled) {
    const canFetch = await weatherCreditsService.canFetch('meteoblue');
    if (canFetch) {
      const seaData = await meteoblueRepository.fetchSeaData(lat, lon);
      await weatherCreditsService.recordUsage('meteoblue', 1);
    }
  }
}
```

---

## Files & Locations

### Main App

| Purpose | Path |
|---------|------|
| Weather collector | `src/services/trips/weather-collector.service.js` |
| Start hook | `src/start.js:30` (startWeatherCollector) |
| Weather areas page | `src/public/weather-areas.html` |
| Add area page | `src/public/weather-area-add.html` |
| View area page | `src/public/weather-area-view.html` |

### Maintenance Agent

| Purpose | Path |
|---------|------|
| Routes | `maintenance-agent/src/routes/weather.route.js` |
| Area service | `maintenance-agent/src/services/weather-area.service.js` |
| Fetch service | `maintenance-agent/src/services/weather-fetch.service.js` |
| Forecast service | `maintenance-agent/src/services/weather-forecast.service.js` |
| Credits service | `maintenance-agent/src/services/weather-credits.service.js` |
| Repository | `maintenance-agent/src/repositories/weather.repository.js` |
| Pages | `maintenance-agent/public/weather-*.html` |

---

## API Endpoints (Maintenance Agent)

### Areas

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/weather/areas` | List all active areas |
| GET | `/api/weather/areas/:id` | Get area by ID |
| POST | `/api/weather/areas` | Create area (auto-fetches weather) |
| PUT | `/api/weather/areas/:id` | Update area |
| DELETE | `/api/weather/areas/:id` | Soft delete area |

### Forecasts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/weather/areas/:id/forecast` | Get all forecasts |
| GET | `/api/weather/areas/:id/current` | Get current conditions |
| GET | `/api/weather/areas/:id/7day` | Get 7-day summary |
| GET | `/api/weather/areas/:id/comparison` | Model comparison |
| POST | `/api/weather/areas/:id/fetch` | Manual fetch trigger |

### Credits

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/weather/credits` | Get Meteoblue credit status |

---

## Database Tables

### weather_areas

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| name | text | Area name |
| latitude | numeric | Coordinates |
| longitude | numeric | Coordinates |
| description | text | Optional notes |
| sailing_direction | text | N/NE/E/SE/S/SW/W/NW (for expert forecast matching) |
| is_active | boolean | Active flag |
| deleted_at | timestamp | Soft delete |
| created_at | timestamp | Creation time |
| updated_at | timestamp | Last update |

### weather_forecasts

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| area_id | uuid | FK to weather_areas |
| forecast_time | timestamp | When forecast is for |
| data_source | text | open_meteo_forecast/marine/meteoblue |
| model_name | text | gfs_seamless/icon_global/etc |
| wind_speed_kts | numeric | Wind speed |
| wind_direction | integer | Wind direction (degrees) |
| wave_height_m | numeric | Wave height |
| swell_height_m | numeric | Swell height |
| temperature_c | numeric | Air temperature |
| pressure_hpa | numeric | Barometric pressure |
| raw_data | jsonb | Full API response |
| created_at | timestamp | Record creation |

**Unique constraint:** `(area_id, forecast_time, data_source, model_name)`

### weather_fetch_logs

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| area_id | uuid | FK to weather_areas |
| data_source | text | API source |
| status | text | success/failed/skipped |
| records_fetched | integer | Records from API |
| records_stored | integer | Records saved |
| error_message | text | Error if failed |
| credits_used | integer | For paid APIs |
| credits_remaining | integer | Remaining credits |
| created_at | timestamp | When fetched |

### weather_api_credits

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| api_name | text | meteoblue |
| credits_total | integer | Monthly allocation |
| credits_used | integer | Used this period |
| credits_remaining | integer | Remaining |
| reset_date | date | When credits reset |
| last_request_at | timestamp | Last API call |

### trip_weather

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| trip_id | uuid | FK to trips |
| latitude | numeric | Position when collected |
| longitude | numeric | Position when collected |
| source | text | open-meteo-marine |
| wind_speed_kts | numeric | Wind (knots) |
| wind_direction | integer | Wind direction |
| wind_gusts_kts | numeric | Wind gusts |
| wave_height_m | numeric | Wave height |
| wave_period_s | numeric | Wave period |
| wave_direction | integer | Wave direction |
| swell_height_m | numeric | Swell height |
| swell_period_s | numeric | Swell period |
| swell_direction | integer | Swell direction |
| air_temp_c | numeric | Air temperature |
| pressure_hpa | numeric | Barometric pressure |
| cloud_cover_pct | integer | Cloud cover % |
| visibility_m | numeric | Visibility (meters) |
| precipitation_mm | numeric | Precipitation |
| api_response | jsonb | Full API responses |
| created_at | timestamp | When collected |

---

## Testing

| Test File | What It Tests |
|-----------|---------------|
| `maintenance-agent/test-weather-api.js` | Weather API calls |
| `maintenance-agent/test-all-weather-data.js` | Full weather data flow |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Weather is in main app" | **Partially.** Areas are in maintenance-agent, trip collector is in main |
| "Meteoblue is always used" | **No.** Credit-limited, skipped when empty |
| "Real-time updates" | **No.** Fetched on-demand or every 15 min during trips |
| "Sea temperature available" | **No.** Open-Meteo free tier doesn't include it |
| "WebSocket updates" | **No.** Manual refresh or polling |

---

## Related Docs

- [Trips](./trips.md) - Trip logging (uses trip_weather)
- [Maintenance](./maintenance.md) - Maintenance agent details
- [Environments](../00-foundations/environments.md) - Service locations
