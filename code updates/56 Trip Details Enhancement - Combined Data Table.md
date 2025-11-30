# 56 Trip Details Enhancement - Combined Data Table

**Date:** 2025-11-30
**Status:** Complete

## Summary

Enhanced the Trip Details page to show ALL telemetry and weather data in a single unified table, plus auto-naming trips from GPS locations.

## Changes Made

### 1. Combined Trip Details Table

Previously had separate displays for:
- Telemetry data (SignalK from Pi)
- Weather data (Open-Meteo API)

Now merged into single "Trip Details (15 min samples)" table showing everything.

**Files Modified:**
- `src/services/trips/trips.service.js` - `getTelemetrySamples()` now fetches both `trip_telemetry` and `trip_weather`, merges by closest timestamp
- `src/public/trip-detail.html` - Renamed card to "Trip Details"
- `src/public/js/trips/trip-detail.js` - Dynamic table rendering with all columns

### 2. Dynamic Column Discovery

The table dynamically discovers ALL fields in the SignalK JSONB payload:
- Flattens nested objects to dot-notation (e.g., `propulsion.port.revolutions`)
- Extracts `.value` from SignalK sensor format
- Builds columns from whatever data exists

### 3. Weather Data Integration

Weather columns added:
| Column | Display | Format |
|--------|---------|--------|
| wind_speed_kts | Wind | 13.4kts |
| wind_gusts_kts | Gusts | 18.3kts |
| wind_direction | Wind Dir | 68° |
| wave_height_m | Waves | 1.4m |
| wave_period_s | Wave Per | 5.5s |
| swell_height_m | Swell | 0.8m |
| air_temp_c | Air Temp | 27°C |
| pressure_hpa | Pressure | 1013hPa |
| cloud_cover_pct | Clouds | 62% |
| visibility_m | Vis | 21.0km |

### 4. SignalK Data (from Pi)

Engine data captured and displayed:
| Column | Display | Format |
|--------|---------|--------|
| propulsion.port.revolutions | Port RPM | 800 (Hz×60) |
| propulsion.port.temperature | Port Temp | 77°C (K-273) |
| propulsion.port.oilPressure | Port Oil | 32.0psi (Pa÷6895) |
| propulsion.port.engineLoad | Port Load | 24% (ratio×100) |
| propulsion.port.runTime | Port Hrs | 243h (s÷3600) |
| propulsion.port.fuel.rate | Port Fuel | 1.2L/h (m³/s×3.6M) |
| electrical.batteries.0.voltage | Batt1 | 13.9V |
| steering.rudderAngle | Rudder | 0° |
| navigation.gnss.satellites | Sats | 14 |

### 5. Auto-Naming Trips from GPS

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
        "cog": 45,
        "heading": 48,
        "wind_speed_kts": 13.4,
        "wave_height_m": 1.36,
        "propulsion.port.revolutions": 13.33,
        "electrical.batteries.0.voltage": 13.85,
        "_raw": { /* full SignalK object */ }
      }
    ],
    "columns": ["recorded_at", "latitude", "longitude", "sog", ...]
  }
}
```

## Unit Conversions (Frontend)

| Source Unit | Display Unit | Conversion |
|-------------|--------------|------------|
| Hz (revolutions) | RPM | ×60 |
| Kelvin | °C | -273.15 |
| Pascal | PSI | ÷6894.76 |
| Seconds (runtime) | Hours | ÷3600 |
| Ratio (load) | % | ×100 |
| m³/s (fuel) | L/hr | ×3,600,000 |
| Meters (visibility) | km | ÷1000 |
| Meters (log) | nm | ÷1852 |

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
| `src/services/trips/trips.service.js` | Combined telemetry+weather fetch, added GPS title generation, fixed geocode zoom |
| `src/routes/trips/trips.route.js` | Added telemetry-samples endpoint |
| `src/public/trip-detail.html` | Renamed to "Trip Details", dynamic table container |
| `src/public/js/trips/trip-detail.js` | Dynamic column rendering, unit formatting, weather column shortcuts |
| `src/start.js` | Weather collector runs in dev mode |

## Testing

1. View trip detail page - should show combined table with weather + SignalK data
2. Stop a trip - should auto-generate title from GPS locations
3. Check weather collector logs - should run on dev server startup
