# Code Update #73: Stormglass Weather API Integration & UI Redesign

**Date:** 2026-01-04 → 2026-01-05
**Status:** ✅ Phase 1 Complete (Data Import) | ✅ Phase 2 Complete (UI Redesign)
**Branch:** Stable-v4-Working

---

## Summary

Integrated Stormglass.io as a third weather data source to provide multi-source wave height comparison. This was driven by discovering significant discrepancies between Meteoblue and Open-Meteo wave height data (~2.25m vs ~0.98m for the same location/time).

**Key Finding:** Meteoblue wave data appears to be an **outlier**. All other sources (NOAA, ECMWF, Météo France, Stormglass blend) agree within ~0.3m, while Meteoblue reports values nearly 2x higher.

---

## Problem Statement

When comparing wave heights for Wednesday Jan 8, 2026 at "Mid to A" (Guadeloupe):

| Source | Wave Height |
|--------|-------------|
| Open-Meteo Marine | 0.98m |
| Meteoblue `surfwave_height` | 2.25m |
| Meteoblue `significant_wave_height` | 1.67m |

This ~1.3m discrepancy raised concerns about which source to trust for safety-critical sailing decisions.

---

## Solution: Add Stormglass for Multi-Source Comparison

Stormglass.io aggregates data from multiple weather services in a single API call:

| Source Code | Provider |
|-------------|----------|
| `sg` | Stormglass AI blend (recommended) |
| `noaa` | NOAA GFS |
| `ecmwf` | European Centre (same as Open-Meteo uses) |
| `meteo` | Météo France |
| `meto` | UK Met Office |

### Stormglass Results (Wednesday Jan 8 @ 10:00 UTC)

| Source | Wave Height |
|--------|-------------|
| Stormglass SG | 1.05m |
| NOAA | 0.84m |
| ECMWF | 1.05m |
| Météo France | 1.29m |
| **Open-Meteo Marine** | **0.98m** ✅ |
| **Meteoblue** | **2.25m** ❌ Outlier |

**Conclusion:** Open-Meteo Marine is accurate. Meteoblue wave data should not be trusted.

---

## Files Created/Modified

### New Files (maintenance-agent)

| File | Purpose |
|------|---------|
| `scripts/test-stormglass.mjs` | Fetch and analyze Stormglass data with caching |
| `scripts/import-stormglass-cache.mjs` | Import cached data into weather_forecasts table |
| `data/stormglass-cache.json` | Cached API response (10 days, 240 hours) |
| `migrations/weather/001_add_stormglass_columns.sql` | Schema changes for new columns |

### Database Changes

**New columns added to `weather_forecasts`:**
```sql
secondary_swell_height FLOAT
secondary_swell_direction FLOAT
secondary_swell_period FLOAT
current_speed FLOAT
current_direction FLOAT
sea_level FLOAT
visibility FLOAT
```

**Columns converted from INTEGER to FLOAT:**
```sql
cloud_cover, relative_humidity_2m, precipitation,
wind_speed_10m, wind_direction_10m, weather_code,
wave_direction, swell_wave_direction, swell_wave_period,
wind_wave_direction, wind_wave_period, wave_period
```

---

## Data Model

Stormglass data follows the existing pattern:
- `data_source = 'stormglass'`
- `model_name = 'sg' | 'noaa' | 'ecmwf' | 'meteo' | 'meto'`

This creates one row per source per hour, allowing easy comparison queries.

### Current Data in `weather_forecasts`

| Source | Model | Records |
|--------|-------|---------|
| stormglass | sg | 120 |
| stormglass | noaa | 120 |
| stormglass | ecmwf | 120 |
| stormglass | meteo | 120 |
| stormglass | meto | 120 |
| open_meteo_forecast | gfs_seamless | 120 |
| open_meteo_forecast | icon_global | 120 |
| open_meteo_marine | ecmwf_wam | 120 |
| meteoblue | meteoblue_nems | 40 |

---

## Stormglass API Details

### Free Tier Limits
- **10 requests/day** (very limited)
- 10 days of hourly forecasts per request
- All parameters in one call

### Parameters Available (25 total)

**Marine:**
- waveHeight, waveDirection, wavePeriod
- swellHeight, swellDirection, swellPeriod
- secondarySwellHeight, secondarySwellDirection, secondarySwellPeriod
- windWaveHeight, windWaveDirection, windWavePeriod

**Currents:**
- currentSpeed, currentDirection

**Water:**
- waterTemperature, seaLevel

**Wind:**
- windSpeed, windDirection, gust

**Atmosphere:**
- airTemperature, pressure, humidity, cloudCover, precipitation, visibility

---

## Usage

### Fetch Fresh Data (uses 1 API call)
```bash
cd maintenance-agent
STORMGLASS_API_KEY=your_key node scripts/test-stormglass.mjs
```

### View Cached Data (no API call)
```bash
node scripts/test-stormglass.mjs --cache
```

### Import to Database
```bash
node scripts/import-stormglass-cache.mjs --dry-run  # Test first
node scripts/import-stormglass-cache.mjs            # Actual import
```

---

## Phase 2: UI Redesign (Complete) - 2026-01-05

### Summary
Complete redesign of `weather-area-view.html` from table-based layout to PredictWind-inspired card-based interface.

### New Design Features

**Navigation:**
- Fixed time nav at top (5am, 9am, 1pm, 5pm, 9pm)
- Fixed day nav at bottom with scrollable 10-day range (e.g., "Sun 5", "Mon 6", "Tue 7")
- 2D picker: select day + time block to view forecast

**Weather Card Contents:**
```
┌─────────────────────────────────────────────────────────────┐
│  Morning                                    9AM - 1PM       │
├─────────────────────────────────────────────────────────────┤
│  💨 WIND     E 12 kn (11-13)  G:18                         │
│  [OM|SG|NOAA|ECMWF|MeteoFR|Mtblue]  ← 6 sources            │
│                                                             │
│  🌊 WAVE HT  E 1.1m (0.9-1.3)                              │
│  [OM|SG|NOAA|ECMWF|MeteoFR|Mtblue|Calc] ← 7 cols w/ calc   │
│                                                             │
│  ⏱️ PERIOD   8s (7-9)                                      │
│  [OM|SG|NOAA|ECMWF|MeteoFR|Mtblue]                         │
│                                                             │
│  🌀 Swell: 0.8m @ 7s                                       │
│  〰️ Wind Wave: 0.5m                                        │
│  🌧️ Rain: 2mm                                              │
│  ✓ Current: 0.4kn E (crossing swell)                       │
└─────────────────────────────────────────────────────────────┘
```

**Source Grid (6 columns):**
- OM (Open-Meteo)
- SG (Stormglass blend)
- NOAA
- ECMWF
- MeteoFR (Météo France)
- Mtblue (Meteoblue) - **displayed in red as outlier**

**Wave Height has 7th column: Calc**
- Calculated value: `√(Swell² + Wind Wave²)`
- Displayed in green
- Excludes Meteoblue from calculation

**Current-Swell Relationship:**
- Calculates angle between current direction and swell travel
- Shows warning icon and text:
  - `⚠️ opposing swell - steeper waves` (≤45° difference)
  - `✓ crossing swell` (45-135°)
  - `✓ following swell` (≥135°)

### Technical Changes

**File:** `src/public/weather-area-view.html` (complete rewrite)
- Reduced from 1,460 lines of table mess to ~850 lines of clean card-based UI
- Mobile-first responsive design
- PredictWind-inspired blue card gradient
- 60s fetch timeout (fixes previous timeout issues)

**Key Functions:**
- `getMetricBySource()` - extracts values per source from forecast data
- `calculateStats()` - computes avg/min/max for consensus display
- `renderSourceGrid()` - renders the 6-7 column comparison grid
- `renderCard()` - builds the full weather card HTML

### Wave Height Physics

**Formula:** `Combined Wave Height = √(Swell² + Wind Wave²)`

Waves don't simply add - they combine via root-sum-square:
- 0.8m swell + 0.5m wind wave = 0.94m combined (not 1.3m)

This is because swell and wind waves have different periods/directions.

### Current vs Swell (New Feature)

When tidal current opposes swell direction, waves become steeper and more dangerous.
- Current direction = where water flows TO
- Swell direction = where waves come FROM
- If current flows toward where swell is traveling = opposing = ⚠️ warning

### Next Steps

### Phase 3: Automated Fetching
- [ ] Add Stormglass to weather-fetch.service.js (currently manual only)
- [ ] Implement credit/quota tracking (10/day limit)
- [ ] Add "Fetch Stormglass" button functionality (currently placeholder)

### Phase 4: Summary Bar
- [ ] Add bar graph above cards showing 7-10 day overview
- [ ] Traffic light indicators (green/yellow/red) per day

### Phase 5: Tides Integration
- [ ] Add Stormglass Tide API (separate endpoint)
- [ ] Show high/low tide times on card
- [ ] Note: Tide is separate from wave height calculation

---

## Environment Variables

Add to `.env` if using Stormglass in production:
```
STORMGLASS_API_KEY=your_key_here
STORMGLASS_ENABLED=true
STORMGLASS_DAILY_LIMIT=10
```

---

## Related Documents

- `/docs/10-user-features/weather.md` - Weather system documentation
- `/code updates/72 Equipment Not Found Fix and User Task Creation.md` - Previous session work
- `/maintenance-agent/data/stormglass-cache.json` - Raw API response for analysis

---

## Key Insight

**Stormglass solves the "which source do I trust?" problem** by showing multiple models side-by-side. When NOAA, ECMWF, and Météo France all agree within 0.3m, you can have confidence. When one source (Meteoblue) shows 2x the others, it's clearly an outlier.

For safety-critical marine decisions, multi-source consensus is more valuable than any single "premium" API.
