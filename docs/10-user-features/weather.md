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
| Meteoblue | Meteoblue | Credits | 7 days | **Outlier** - wave data unreliable |

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
| **Meteoblue** | Paid API with credit system (**outlier** - unreliable wave data) |
| **GFS/ICON** | Weather models (gfs_seamless, icon_global) |
| **Marine Data** | Wave height, swell, period, direction |
| **Consensus** | Average of 5 reliable sources (excludes Meteoblue) |
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
│  - Wind with 6-source grid                                      │
│  - Wave Height with 7-source grid (includes Calc)               │
│  - Wave Period with 6-source grid                               │
│  - Consensus line (5-source avg)                                │
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
│   OM   │   SG   │  NOAA  │  ECMWF │MeteoFR │ Mtblue │
│  12kn  │  11kn  │  13kn  │  12kn  │  11kn  │   --   │
└────────┴────────┴────────┴────────┴────────┴────────┘
                                              ↑ Red (outlier)
```

**Wave Height** has a 7th column: **Calc** (green)
- Shows calculated combined wave: √(Swell² + Wind Wave²)
- Physics-based - swell and wind waves don't simply add

### Meteoblue Outlier

Meteoblue wave data shows ~2x higher values than all other sources. Displayed in **red** to indicate unreliability. Example:

| Source | Wave Height |
|--------|-------------|
| Open-Meteo Marine | 0.98m |
| NOAA | 0.84m |
| ECMWF | 1.05m |
| Météo France | 1.29m |
| **Meteoblue** | **2.25m** ❌ |

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

**Model:** `gpt-4.1-mini` (lightweight, fast)

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
│  ├── weather.repository.js    (database)                        │
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
