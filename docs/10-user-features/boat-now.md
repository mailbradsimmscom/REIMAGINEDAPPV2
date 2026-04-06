# Current (Boat Now)

## Overview

"Current" provides a real-time dashboard showing the boat's current position, weather conditions, and historical data charts. Replaces "Edit Task" on the main mobile dashboard.

**Who uses it:** Boat owners, crew
**Access:**
- Main dashboard → Current button
- Other Links → Current
- Direct: `/public/boat-now.html`

---

## Features

### Current Status (Top Section)
- **Location Name** - Reverse geocoded using shared nominatim utility
- **Temperature** - Current air temperature (°C)
- **Wind Speed** - Current wind (knots) with direction (compass + degrees)
- **Wave Height** - Current wave height (m) with direction
- **Precipitation** - Current rain (mm)
- **Weather Description** - Human-readable conditions
- **Position Coordinates** - Lat/lon with timestamp

### Historical Charts (Selectable: 5h or 12h)
Charts showing data from `gps_position` table, downsampled server-side via `gps_positions_summary_in_range` RPC at 10-minute intervals (~30-70 points):

**Time window selector:** Pill buttons (5h / 12h) above the charts section. Defaults to 5h. Switching reloads all charts with the new time window.

1. **Wind Speed** - True wind speed over time (knots) with dynamic Y-axis
   - Orange dashed average line with "Avg: X.X kts" label
2. **Wind Direction** - True wind direction over time (degrees 0-360) with dynamic Y-axis
   - Orange dashed average line with "Avg: X°" label
3. **Position Track Map** - Leaflet map with OpenStreetMap tiles showing:
   - Blue polyline of movement track
   - Red marker for current position
   - Green marker for center point (5-hour average position)
   - Orange dashed circle showing movement radius (max distance from center)
   - Orange marker for farthest point from center
   - Auto-zoom to fit movement radius bounds
4. **Movement Stats** - Yellow box below map showing:
   - Movement radius in cm/m/km (auto-scales based on distance)
   - Calculated using Haversine formula for accurate distance

---

## Data Sources

| Data | Source | Frequency |
|------|--------|-----------|
| Position | `gps_position` table | ~10 sec from SignalK, downsampled to 10 min via `gps_positions_summary_in_range` RPC |
| Wind (historical) | `gps_position` table | ~10 sec from SignalK, downsampled to 10 min via RPC. Uses `idx_gps_position_timestamp` index |
| Weather (current) | Open-Meteo API | On page load |
| Place name | Nominatim API | On page load |

**Note:** Raw GPS data is captured every ~10 seconds (~1,700 points over 5 hours). The service uses the `gps_positions_summary_in_range` Postgres RPC for server-side downsampling at 600-second (10-minute) intervals, returning ~30 points for 5h or ~70 points for 12h. This avoids the Supabase 1,000-row default limit that previously truncated the data.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (boat-now.html)                                       │
│  ├── Current conditions display                                 │
│  ├── Time window selector (5h / 12h pills, default 5h)          │
│  ├── 2 Chart.js line charts with annotation plugin (avg lines)  │
│  ├── Leaflet map with position track + movement radius circle   │
│  ├── Movement stats box (radius calculation)                    │
│  └── Refresh on page reload only                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  GET /api/boat-now (initial load)                                │
│  └── boat-now.service.js → getBoatStatus()                      │
│      ├── gpsRepository.getCurrentPosition()                     │
│      ├── gpsRepository.getPositionsSummaryInRange(N hours, 600s) │
│      ├── reverseGeocode() from nominatim utility                │
│      └── fetchCurrentWeather() from Open-Meteo                  │
│                                                                  │
│  GET /api/boat-now/history (time window switch)                  │
│  └── boat-now.service.js → getHistory()                         │
│      └── gpsRepository.getPositionsSummaryInRange() only         │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌───────────┐   ┌──────────────┐
        │ Supabase │   │ Nominatim │   │  Open-Meteo  │
        │gps_position│  │    API    │   │ Marine API   │
        └──────────┘   └───────────┘   │ Forecast API │
                                       └──────────────┘
```

---

## API Endpoints

### GET /api/boat-now

Returns current boat status with weather and historical data. Used on initial page load.

**Query Parameters:**
- `hours` (optional, default: 5) - Hours of history to fetch

**Response:**
```json
{
  "success": true,
  "data": {
    "hasData": true,
    "current": {
      "position": {
        "latitude": 17.0723,
        "longitude": -61.8883,
        "timestamp": "2026-01-11T16:30:00Z"
      },
      "placeName": "Jolly Harbour, Antigua and Barbuda",
      "weather": {
        "temperature_c": 27.5,
        "wind_speed_kts": 12.3,
        "wind_direction": 95,
        "wind_direction_compass": "E",
        "wind_gusts_kts": 18.5,
        "precipitation_mm": 0,
        "weather_code": 1,
        "weather_description": "Mainly clear",
        "wave_height_m": 1.2,
        "wave_direction": 85,
        "wave_direction_compass": "E",
        "wave_period_s": 6.5
      }
    },
    "history": {
      "hoursBack": 5,
      "pointCount": 31,
      "data": {
        "timestamps": ["2026-01-11T11:30:00Z", ...],
        "windSpeed": [10.5, 11.2, ...],
        "windDirection": [92, 95, ...],
        "latitude": [17.0723, ...],
        "longitude": [-61.8883, ...],
        "sog": [0.1, 0.2, ...]
      }
    }
  }
}
```

### GET /api/boat-now/history

Returns historical GPS data only (no weather, no geocode). Used when switching between 5h/12h time windows — avoids re-fetching current conditions and external APIs.

**Query Parameters:**
- `hours` (optional, default: 5) - Hours of history to fetch

**Response:** Same shape as the `history` object above, returned directly in `data`.

---

## Charts (2026-04-06)

Both wind charts include:
- **Average line** (orange dashed) — flat horizontal line showing mean value, labeled at right
- **Trend line** (red dashed) — linear regression from first to last data point, labeled at left with direction arrow (e.g., "↑ +2.1 kts" or "↓ -1.3 kts")

The trend line shows whether wind speed is building or dying, and whether direction is veering or backing over the selected time window.

---

## Files & Locations

| Purpose | Path |
|---------|------|
| **Frontend** | |
| Page | `src/public/boat-now.html` |
| **Backend** | |
| Routes | `src/routes/boat-now/boat-now.route.js` |
| Service | `src/services/boat-now/boat-now.service.js` |
| **Dependencies** | |
| GPS Repository | `src/repositories/gps.repository.js` |
| Nominatim Utility | `src/utils/nominatim.js` |

---

## Weather API Details

### Open-Meteo Marine API
- Endpoint: `https://marine-api.open-meteo.com/v1/marine`
- Data: wave_height, wave_direction, wave_period

### Open-Meteo Forecast API
- Endpoint: `https://api.open-meteo.com/v1/forecast`
- Data: temperature, wind_speed, wind_direction, wind_gusts, precipitation, weather_code
- Wind units: knots

---

## Weather Codes

| Code | Description |
|------|-------------|
| 0 | Clear sky |
| 1 | Mainly clear |
| 2 | Partly cloudy |
| 3 | Overcast |
| 51-55 | Drizzle |
| 61-65 | Rain |
| 80-82 | Rain showers |
| 95 | Thunderstorm |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Auto-refresh" | **No.** Refresh on page reload only |
| "Historical weather" | **No.** Only current weather from API |
| "Forecast" | **No.** Current conditions only |
| "Anchor alarm" | **No.** See [Anchor Alarm](./anchor-alarm.md) |

---

## Related Docs

- [Trips](./trips.md) - Trip tracking with weather collection
- [Anchorages](./anchorages.md) - Historical anchorage data
- [Anchor Alarm](./anchor-alarm.md) - Real-time anchor monitoring
- [Utility Scripts](../30-backend/utility-scripts.md) - Nominatim utility
