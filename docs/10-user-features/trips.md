# Trips

## Overview

Trip logging allows users to record boat trips with GPS tracking, telemetry, sail configuration changes, weather data, and comments. Trips can be started/stopped/resumed, and automatically generate statistics and place-name titles.

**Who uses it:** Boat owners, crew
**Access:** `/trips.html` (list), `/trip-detail.html` (details)

---

## User Flow

### Starting a Trip

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Open Trips page (/trips.html)                               │
│     └── Shows list of past trips                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Tap "Start Trip"                                            │
│     └── POST /api/trips/start                                   │
│     └── Creates trip with auto-generated title                  │
│     └── Trip status: 'active'                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. While Underway                                              │
│     ├── Telemetry logged to trip_telemetry (GPS, SOG, COG)      │
│     ├── Weather collected every 15 min → trip_weather           │
│     ├── Record sail changes → trip_sail_events                  │
│     └── Add comments → trip_comments                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Tap "Stop Trip"                                             │
│     └── POST /api/trips/:id/stop                                │
│     └── Computes: distance, duration, avg/max speed             │
│     └── Reverse geocodes start/end → auto-generates title       │
│     └── Trip status: 'completed'                                │
└─────────────────────────────────────────────────────────────────┘
```

### Resume Window

If you stop a trip accidentally, you can resume within 30 minutes:

```
POST /api/trips/:id/resume
```

Returns trip to `active` status and clears computed summary fields.

---

## Key Concepts

| Term | Definition |
|------|------------|
| **Trip** | A recorded voyage from start to stop |
| **Active Trip** | Currently running (only one allowed at a time) |
| **Telemetry** | GPS position, SOG, COG, heading, SignalK data |
| **Sail Event** | Record of sail configuration change |
| **Trip Weather** | Weather data collected during trip |
| **Distance (nm)** | Nautical miles calculated from GPS track |
| **SOG** | Speed Over Ground (knots) |
| **COG** | Course Over Ground (degrees) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (trips.js, trip-detail.js)                            │
│  ├── Start/stop/resume controls                                 │
│  ├── Live stats display                                         │
│  ├── Track map visualization                                    │
│  └── Telemetry sample table                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  /api/trips (trips.route.js)                                    │
│  └── trips.service.js                                           │
│      ├── listTrips() - Get trips with filters                   │
│      ├── startTrip() - Create new active trip                   │
│      ├── stopTrip() - Compute stats, generate title             │
│      ├── resumeTrip() - Resume within 30 min                    │
│      ├── getActiveTripStats() - Live stats                      │
│      ├── recordSailEvent() - Log sail change                    │
│      └── getTelemetrySamples() - Data for table                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  weather-collector.service.js                                   │
│  └── Every 15 min: logs weather for active trips                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase                                                       │
│  ├── trips                (trip records)                        │
│  ├── trip_telemetry       (GPS positions)                       │
│  ├── trip_weather         (weather during trip)                 │
│  ├── trip_sail_events     (sail configuration changes)          │
│  └── trip_comments        (user notes)                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Functions (src/services/trips/trips.service.js)

### Distance Calculation (Haversine)

```javascript
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
```

### Stop Trip (Compute Summary)

```javascript
export async function stopTrip(tripId) {
  // Get all telemetry
  const { data: telemetry } = await supabase
    .from('trip_telemetry')
    .select('latitude, longitude, sog, recorded_at')
    .eq('trip_id', tripId)
    .order('recorded_at', { ascending: true });

  const first = telemetry[0];
  const last = telemetry[telemetry.length - 1];
  const speeds = telemetry.map(t => t.sog).filter(Boolean);

  const summary = {
    status: 'completed',
    ended_at: new Date().toISOString(),
    start_lat: first.latitude,
    start_lon: first.longitude,
    end_lat: last.latitude,
    end_lon: last.longitude,
    distance_nm: calculateTotalDistance(telemetry),
    duration_minutes: Math.round((new Date(last.recorded_at) - new Date(first.recorded_at)) / 60000),
    avg_sog: average(speeds),
    max_sog: Math.max(...speeds)
  };

  // Auto-generate title from GPS locations
  const generatedTitle = await generateTripTitle(tripId);
  if (generatedTitle) summary.title = generatedTitle;

  await supabase.from('trips').update(summary).eq('id', tripId);
}
```

### Auto-Generate Trip Title (Reverse Geocoding)

Uses the shared `nominatim.js` utility for consistent place names across trips and anchorages:

```javascript
import { reverseGeocode, delay } from '../../utils/nominatim.js';

// reverseGeocode returns: "Deshaies, Guadeloupe" (town-first, with country/territory)
// Handles French Caribbean territories specially (shows "Guadeloupe" not "France")

export async function generateTripTitle(tripId) {
  const [startName, endName] = await Promise.all([
    reverseGeocode(firstPoint.latitude, firstPoint.longitude),
    reverseGeocode(lastPoint.latitude, lastPoint.longitude)
  ]);

  if (startName === endName) return startName;
  return `${startName} to ${endName}`;  // e.g., "Deshaies, Guadeloupe to Fort-de-France, Martinique"
}
```

See [Nominatim Utility](../30-backend/utility-scripts.md#nominatim-reverse-geocoding) for full details.

### Record Sail Event

```javascript
export async function recordSailEvent(tripId, sailConfig) {
  // Get latest telemetry position
  const { data: latestTelemetry } = await supabase
    .from('trip_telemetry')
    .select('latitude, longitude')
    .eq('trip_id', tripId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return await supabase.from('trip_sail_events').insert({
    trip_id: tripId,
    latitude: latestTelemetry?.latitude,
    longitude: latestTelemetry?.longitude,
    main_sail: sailConfig.main_sail,  // 'full', '1reef', '2reef', '3reef', or null
    jib: sailConfig.jib,              // boolean
    code_zero: sailConfig.code_zero,  // boolean
    asym_spinnaker: sailConfig.asym_spinnaker,  // boolean
    staysail: sailConfig.staysail,    // boolean
    notes: sailConfig.notes
  });
}
```

---

## Files & Locations

| Purpose | Path |
|---------|------|
| **Frontend** | |
| Trips list | `src/public/trips.html` |
| Trip detail | `src/public/trip-detail.html` |
| Trips JS | `src/public/js/trips/trips.js` |
| Detail JS | `src/public/js/trips/trip-detail.js` |
| **Backend** | |
| Routes | `src/routes/trips/trips.route.js` |
| Service | `src/services/trips/trips.service.js` |
| Weather collector | `src/services/trips/weather-collector.service.js` |

---

## API Endpoints

### Trip Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/trips` | List trips (filter by status) |
| GET | `/api/trips/active` | Get active trip (if any) |
| GET | `/api/trips/:id` | Get trip with all related data |
| POST | `/api/trips/start` | Start new trip |
| POST | `/api/trips/:id/stop` | Stop active trip |
| POST | `/api/trips/:id/resume` | Resume within 30 min |
| PATCH | `/api/trips/:id` | Update title |
| DELETE | `/api/trips/:id` | Delete trip (cascade) |

### Live Data

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/trips/:id/stats` | Live stats for active trip |
| GET | `/api/trips/:id/telemetry-samples` | Sampled data for table |

### Sail Events

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/trips/:id/sail-event` | Record sail change |
| GET | `/api/trips/:id/sail-events` | Get all sail events |
| GET | `/api/trips/:id/sail-config` | Get current sail config |

### Comments

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/trips/:id/comments` | Add comment |
| GET | `/api/trips/:id/comments` | Get comments |
| DELETE | `/api/trips/:id/comments/:commentId` | Delete comment |

### Weather

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/trips/collect-weather` | Manual trigger (admin) |

### Administration

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/trips/regenerate-titles` | Regenerate all trip titles using updated geocoding |

**POST /api/trips/regenerate-titles**

Regenerates titles for all completed trips using the shared nominatim utility. This is useful after the geocoding logic was updated to include country/territory context. Rate-limited to respect Nominatim API limits.

```json
// Response
{
  "success": true,
  "data": {
    "updated": 5,
    "total": 12,
    "trips": [
      {
        "id": "uuid",
        "oldTitle": "Deshaies to Fort-de-France",
        "newTitle": "Deshaies, Guadeloupe to Fort-de-France, Martinique"
      }
    ]
  }
}
```

---

## Database Tables

### trips

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| title | text | Trip name (auto-generated or user-set) |
| status | text | `active` / `completed` |
| started_at | timestamp | When trip started |
| ended_at | timestamp | When trip stopped |
| start_lat | numeric | Starting latitude |
| start_lon | numeric | Starting longitude |
| end_lat | numeric | Ending latitude |
| end_lon | numeric | Ending longitude |
| distance_nm | numeric | Total distance (nautical miles) |
| duration_minutes | integer | Trip duration |
| avg_sog | numeric | Average speed (knots) |
| max_sog | numeric | Maximum speed (knots) |
| created_at | timestamp | Record creation |
| updated_at | timestamp | Last update |

### trip_telemetry

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| trip_id | uuid | FK to trips |
| latitude | numeric | GPS latitude |
| longitude | numeric | GPS longitude |
| sog | numeric | Speed over ground (knots) |
| cog | numeric | Course over ground (degrees) |
| heading | numeric | Compass heading |
| signalk_data | jsonb | Raw SignalK data |
| recorded_at | timestamp | When recorded |

### trip_sail_events

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| trip_id | uuid | FK to trips |
| latitude | numeric | Position when changed |
| longitude | numeric | Position when changed |
| main_sail | text | `full`, `1reef`, `2reef`, `3reef`, or null (down) |
| jib | boolean | Jib deployed |
| code_zero | boolean | Code zero deployed |
| asym_spinnaker | boolean | Asymmetric spinnaker deployed |
| staysail | boolean | Staysail deployed |
| notes | text | Optional notes |
| recorded_at | timestamp | When event occurred |

### trip_comments

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| trip_id | uuid | FK to trips |
| comment | text | Comment text |
| created_at | timestamp | When added |

### trip_weather

See [Weather](./weather.md) for full schema.

---

## Telemetry Samples

The `getTelemetrySamples()` function returns data for table display:

```javascript
const { samples, columns, units } = await tripsService.getTelemetrySamples(tripId, 15);

// samples: Array of telemetry + weather merged
// columns: Filtered columns (removes low-variance)
// units: { sog: 'kn', wind_speed_kts: 'kn', wave_height_m: 'm', ... }
```

**Features:**
- Samples at configurable interval (default: 15 min)
- Merges telemetry with closest weather (within 30 min)
- Extracts SignalK values from nested data
- Filters out low-variance columns (>80% null or all same value)
- Preserves units metadata for display

---

## Testing

| Test File | What It Tests |
|-----------|---------------|
| `tests/integration/trips.test.js` | Trips API (if exists) |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Multiple active trips" | **No.** Only one at a time |
| "Auto-start on GPS move" | **No.** Manual start required |
| "Resume anytime" | **No.** 30-minute window only |
| "Real-time GPS in browser" | **Depends.** Needs SignalK or similar source |
| "Route planning" | **No.** Trips are for logging, not planning |

---

## Related Docs

- [Weather](./weather.md) - Trip weather collection
- [Anchor Alarm](./anchor-alarm.md) - GPS position monitoring
