# Code Update #103: Stormglass Weather API Integration

**Date:** 2026-01-04
**Status:** ✅ Phase 1 Complete - Data Import Working
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

## Next Steps

### Phase 2: UI Integration
- [ ] Add Stormglass as selectable source in weather-area-view.html
- [ ] Show multi-source comparison table on weather detail page
- [ ] Add source reliability indicator based on spread

### Phase 3: Automated Fetching
- [ ] Add Stormglass to weather-fetch.service.js
- [ ] Implement credit/quota tracking (10/day limit)
- [ ] Schedule fetch strategically (once per day, or on-demand only)

### Phase 4: Meteoblue Decision
Options:
1. **Stop using Meteoblue for wave data** - Only use for Douglas sea state, salinity, currents
2. **Investigate Meteoblue** - May be using wrong coordinates or different metric
3. **Remove Meteoblue entirely** - If other data isn't valuable enough for the cost

### Phase 5: Source Reliability Scoring
- Track historical accuracy per source vs actual conditions
- Weight sources by reliability in the UI
- Alert when sources disagree significantly

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
