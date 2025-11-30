# 56 Trip Details Enhancement - Combined Data Table

**Date:** 2025-11-30
**Status:** Complete

## Summary

Enhanced the Trip Details page to show telemetry and weather data in a single unified table with:
- **No hardcoded column mappings** - algorithmic column naming and unit conversion
- **Smart filtering** - removes useless columns (switches, no variance, all objects)
- **SignalK meta.units** - uses embedded unit metadata for conversions
- Auto-naming trips from GPS locations

## Changes Made

### 1. Combined Trip Details Table

Previously had separate displays for:
- Telemetry data (SignalK from Pi)
- Weather data (Open-Meteo API)

Now merged into single "Trip Details (15 min samples)" table showing everything.

**Files Modified:**
- `src/services/trips/trips.service.js` - `getTelemetrySamples()` fetches both tables, merges by closest timestamp
- `src/public/trip-detail.html` - Table CSS and container
- `src/public/js/trips/trip-detail.js` - Dynamic table rendering

### 2. Smart Value Extraction (No Hardcoding)

**`extractSignalKValues()`** walks the SignalK JSONB tree:
- Only extracts `.value` properties that are primitives (string, number, boolean)
- Skips objects/arrays (avoids `[object Object]` in cells)
- Captures `meta.units` from sibling property for unit conversion
- Skips metadata fields (`$source`, `timestamp`, `values`, `pgn`)

### 3. Column Filtering

**`filterLowVarianceColumns()`** removes useless columns:
- Columns where >80% of values are null
- Columns where all values are identical (no variance)
- Columns where all values are objects
- **Hardcoded exclusion:** `switches.bank.*` data (28 switches × order/state = 56 useless columns)

Result: 102 raw columns → 58 meaningful columns

### 4. Algorithmic Column Naming

**`generateColumnName()`** converts paths to readable names without hardcoding:
```
propulsion.port.revolutions → "Port Revolutions"
electrical.batteries.0.voltage → "Batteries 0 Voltage"
navigation.gnss.satellites → "Gnss Satellites"
```

Logic:
- Split camelCase: `rudderAngle` → "Rudder Angle"
- Split underscores: `wind_speed` → "Wind Speed"
- Collapse redundant prefixes (electrical, navigation, etc.)
- Handle numeric indices

### 5. Unit-Based Formatting

**`formatValueWithUnit()`** converts SI units to display units based on `meta.units`:

| Unit | Conversion | Display |
|------|------------|---------|
| `rad` | ×180/π | degrees (°) |
| `K` | -273.15 | °C |
| `Pa` | ÷6894.76 | PSI |
| `Hz` | ×60 | RPM |
| `m/s` | ×1.94384 | knots |
| `m` | smart | m/km/nm based on value |
| `s` | ÷3600 if >1hr | hours |
| `m3/s` | ×3,600,000 | L/hr |
| `ratio` | ×100 | % |

No column-specific hardcoding - works on any SignalK data.

### 6. Auto-Naming Trips from GPS

When a trip is stopped, it now:
1. Gets first telemetry point (start location)
2. Gets last telemetry point (end location)
3. Reverse geocodes both using Nominatim (zoom=14)
4. Generates title like "Port Elizabeth to Wallibou"

**Fix Applied:** Changed zoom level from 10 to 14 for Caribbean islands to get village/town names instead of just country.

**Files Modified:**
- `src/services/trips/trips.service.js` - Added `generateTripTitle()`, updated `stopTrip()` to call it

### 6. Weather Collector in Dev Mode

Weather collector now runs in development mode too (not just production).

**File Modified:** `src/start.js` - Moved `startWeatherCollector()` outside production-only block

## Data Flow

```
Pi (SignalK) ──► trip_telemetry table ─┐
                                       ├──► getTelemetrySamples() ──► Trip Details Table
Open-Meteo API ──► trip_weather table ─┘
```

Matching logic:
- Sample telemetry at 15-minute intervals
- For each sample, find closest weather record (within 30 min)
- Merge into single row with all fields

## API Endpoint

```
GET /api/trips/:id/telemetry-samples?interval=15
```

Response:
```json
{
  "success": true,
  "data": {
    "samples": [
      {
        "recorded_at": "2025-11-30T11:48:31Z",
        "latitude": 13.024,
        "longitude": -61.255,
        "sog": 5.2,
        "propulsion.port.revolutions": 13.33,
        "wind_speed_kts": 13.4,
        "_raw": { /* full SignalK object */ }
      }
    ],
    "columns": ["recorded_at", "latitude", "longitude", "sog", ...],
    "units": {
      "steering.rudderAngle": "rad",
      "propulsion.port.temperature": "K",
      "propulsion.port.oilPressure": "Pa",
      "navigation.speedOverGround": "m/s",
      ...
    }
  }
}
```

## AI Insights (Proof of Concept)

Tested sending full table (14 samples × 58 columns = ~9.5K tokens, 7% of GPT-5.1 context) for trip analysis.

**GPT-5.1 Insights from "Port Elizabeth to Wallibou" trip:**

- Peak 8.4 kts at 12:09 UTC in 13-14 kt wind and 1.38m seas
- Current analysis: Early STW 2.45kt but SOG 2.88kt (adverse), later SOG exceeded STW (favorable)
- Depth profile: 31m near St Vincent → 225m offshore → 12m at Wallibou anchorage
- Primarily sailing: Engines at low RPM (18-29), minimal fuel rate - just ticking over
- Arrival: Speed zero at 14:49-14:57, depth 9-10m, 11-12 kt wind ENE, water 29°C

**Conclusion:** Full table fits easily in context. No truncation needed. Feature can be added to UI.

## Retroactive Fix

Ran script to update existing trip title:
```
Trip ID: 7dd45a2c-fdad-426d-876c-7f4bc420535c
Old title: "Trip - Nov 30, 2025"
New title: "Port Elizabeth to Wallibou"
```

## Files Changed

| File | Changes |
|------|---------|
| `src/services/trips/trips.service.js` | `extractSignalKValues()`, `filterLowVarianceColumns()`, `getTelemetrySamples()` returns units, GPS title generation |
| `src/routes/trips/trips.route.js` | Added telemetry-samples endpoint |
| `src/public/trip-detail.html` | Table CSS, container |
| `src/public/js/trips/trip-detail.js` | `generateColumnName()`, `formatValueWithUnit()` - algorithmic, no hardcoding |
| `src/start.js` | Weather collector runs in dev mode |

## Key Design Decisions

1. **No hardcoded column mappings** - Works on any SignalK data from any boat
2. **Use SignalK meta.units** - The data is self-describing, no guessing
3. **Filter garbage algorithmically** - Variance check, null check, object check
4. **One hardcoded exclusion** - `switches.bank.*` explicitly excluded (never useful for trip analysis)

## Testing

1. View trip detail page - should show combined table with weather + SignalK data
2. Verify no "Switches Bank" columns appear
3. Verify no `[object Object]` values in cells
4. Stop a trip - should auto-generate title from GPS locations
