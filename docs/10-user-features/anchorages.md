# Anchorages & Moorings

## Overview

Anchorage tracking allows users to maintain a history of where they've anchored or moored, with GPS coordinates, duration, wind conditions, and computed anchor position.

**Who uses it:** Boat owners, crew
**Access:** `/anchorages`
**Last Updated:** 2026-02-26

---

## User Flow

### Detecting Anchorages from GPS History

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Open Anchorages page (/anchorages)                          │
│     └── Shows list of recorded anchorages                       │
│     └── Mobile nav footer at bottom                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Tap "Refresh New Anchorages"                                │
│     └── POST /api/anchorages/detect                             │
│     └── Dynamic lookback (starts from most recent anchorage)   │
│     └── Analyzes for stationary periods (4+ hours)              │
│     └── 300m movement threshold (handles anchor swing)          │
│     └── Merges overlapping candidates at same location          │
│     └── Updates existing anchorages if duration extends         │
│     └── Auto-merges existing duplicate records                  │
│     └── Detects "still here" (current anchorage)                │
│     └── Auto-geocodes location names                            │
│     └── Links to arrival/departure trips if found               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Edit anchorage details                                      │
│     ├── Set location name (auto-filled, editable)               │
│     ├── Set type: Anchor / Mooring / Marina                     │
│     │   └── Badge updates immediately when changed              │
│     ├── Enter scope in meters                                   │
│     └── Add notes                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Anchor position is computed                                 │
│     └── When scope is saved, anchor position is calculated      │
│     └── Uses inverse haversine (upwind of boat position)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

| Term | Definition |
|------|------------|
| **Anchorage** | A recorded stay at anchor or mooring |
| **Scope** | Length of rode/chain deployed (meters) |
| **Anchor Position** | Computed position of anchor based on scope and wind |
| **Boat Position** | Average GPS position during stay |
| **Duration** | Time spent at anchor/mooring |

---

## Recent Changes (2026-02-26)

### Return Visit Detection

Fixed a bug where returning to a previously visited anchorage would not create a new record. The detection now handles two cases:

1. **`findAtLocation` match with time gap:** If the candidate arrives 24+ hours after the existing record's `departed_at`, it's treated as a return visit and a new anchorage is inserted. The existing record is not modified.

2. **`mergeExistingDuplicates` with time gap:** Duplicate merging now checks time gaps between records. Records within 300m are only merged if the earlier record's departure is within 24 hours of the later record's arrival. This prevents merging separate stays at the same location weeks apart.

### Lookback Window

Changed GPS lookback from 2nd most recent anchorage to most recent anchorage's `departed_at`. Fallback reduced from 90 to 14 days. This avoids Supabase query timeouts when scanning large volumes of GPS data.

---

## Changes (2026-01-12)

### Improved Detection Algorithm

Major improvements to anchorage detection:

| Feature | Before | After |
|---------|--------|-------|
| Movement threshold | 55m (~0.0005°) | 300m (~0.0027°) - handles anchor swing |
| Lookback period | Fixed 90 days | Dynamic - starts from most recent anchorage |
| Duplicate handling | Skip if exists | Update if duration extends, auto-merge duplicates |
| Current anchorage | Always shows "departed" | Shows "Still here" if within 2 hours |
| Candidate merging | None | Merges overlapping candidates at same location |
| Return visits | Not detected | 24-hour gap = new record, not merge |

**Why 300m threshold?** Boats at anchor swing with wind/tide changes. A 7:1 scope in deep water can result in 200m+ swing radius. The previous 55m threshold caused false "movement" detection.

**Why dynamic lookback?** Only scans GPS data from the most recent anchorage's departure. Keeps queries fast and avoids timeouts.

**Why 24-hour gap for merges?** Small moves within a marina or anchorage (under 300m) should be merged into a single stay. But if you left and came back days or weeks later, that's a separate visit and needs its own record.

---

## Earlier Changes (2026-01-09)

### Detection Rewritten in JavaScript (No Database RPC)

Previously required `detect_anchorages_from_gps` PostgreSQL function. Now runs entirely in JavaScript:

```javascript
// anchorages.repository.js - detectFromGpsHistory()

// 1. Fetch GPS with timestamp-based pagination (Supabase 1000 row limit)
const allPositions = [];
let lastTimestamp = ninetyDaysAgo.toISOString();

while (true) {
  const { data: batch } = await supabase
    .from('gps_position')
    .select('timestamp, latitude, longitude, true_wind_speed, true_wind_direction')
    .gt('timestamp', lastTimestamp)
    .order('timestamp', { ascending: true })
    .limit(1000);  // Supabase max

  if (!batch || batch.length === 0) break;
  allPositions.push(...batch);
  lastTimestamp = batch[batch.length - 1].timestamp;
  if (batch.length < 1000) break;
}

// 2. Group by hour
const hourlyPositions = this.groupPositionsByHour(allPositions);

// 3. Find stationary periods (movement < 0.0005° between hours)
const candidates = this.findStationaryPeriods(hourlyPositions, minHours);
```

**Why timestamp pagination?** Supabase enforces 1000 row limit regardless of `.range()` calls. Using timestamp cursors correctly fetches all 400k+ GPS records.

### 2. Auto-Geocodes New Anchorages

When detecting anchorages, location names are automatically populated via the shared Nominatim utility:

```javascript
// In detectNewAnchorages() - anchorages.service.js
import { reverseGeocode, delay } from '../../utils/nominatim.js';

const anchorage = await anchoragesRepository.create({ ... });

// Auto-geocode (with rate limiting)
if (inserted > 0) {
  await delay(); // Nominatim rate limit (1.1 seconds)
}
const locationName = await reverseGeocode(anchorage.latitude, anchorage.longitude);
if (locationName) {
  await anchoragesRepository.update(anchorage.id, { location_name: locationName });
}
```

### 3. Shared Nominatim Utility

Both anchorages and trips now use a shared reverse geocoding utility (`src/utils/nominatim.js`). This ensures consistent place naming across the app.

**Features:**
- Town-first preference (more recognizable for sailors)
- French Caribbean handling (shows "Guadeloupe" not "France")
- Rate limiting (1.1s between calls)
- Country context in all place names

```javascript
// src/utils/nominatim.js
const placeName = await reverseGeocode(16.3089, -61.7989);
// Returns: "Deshaies, Guadeloupe"
```

See [Utility Scripts](../30-backend/utility-scripts.md#nominatim-reverse-geocoding) for full documentation.

### 4. Badge Updates Immediately

When changing the type dropdown (Anchor/Mooring/Marina), the badge at the top of the card now updates immediately without saving:

```javascript
// In renderAnchorages() - anchorages.js
this.container.querySelectorAll('.type-select').forEach(select => {
  select.addEventListener('change', (e) => {
    const card = e.target.closest('.anchorage-card');
    const badge = card.querySelector('.anchorage-type-badge');
    badge.className = `anchorage-type-badge ${e.target.value}`;
    badge.textContent = typeLabels[e.target.value];
  });
});
```

### 5. Mobile Nav Footer Added

Page now includes the common mobile navigation footer:

```html
<script src="/public/js/mobile-nav.js"></script>
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (anchorages.js)                                       │
│  ├── Detect button triggers GPS analysis                        │
│  ├── Editable fields: name, type, scope, notes                  │
│  ├── Display: coordinates, duration, wind, trips                │
│  ├── Badge updates immediately on type change                   │
│  └── Computed anchor position updates on save                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  /api/anchorages (anchorages.route.js)                          │
│  └── anchorages.service.js                                      │
│      ├── listAnchorages() - Get all with formatted fields       │
│      ├── detectNewAnchorages() - Analyze GPS + auto-geocode     │
│      ├── updateAnchorage() - Compute anchor pos on scope change │
│      ├── formatCoordinate() - Decimal to degrees/minutes        │
│      └── computeAnchorPosition() - Inverse haversine            │
│  └── src/utils/nominatim.js (shared utility)                    │
│      └── reverseGeocode() - OpenStreetMap Nominatim             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  anchorages.repository.js                                       │
│  ├── findAll() - List with trip joins                           │
│  ├── detectFromGpsHistory() - JavaScript-based detection        │
│  │   ├── groupPositionsByHour() - Hourly averages               │
│  │   ├── findStationaryPeriods() - Movement analysis            │
│  │   ├── averageAngle() - Circular mean for wind direction      │
│  │   └── groupToCandidate() - Build anchorage candidate         │
│  ├── findTripNearTime() - Link to arrival/departure trips       │
│  └── exists() - Prevent duplicates                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase                                                       │
│  ├── anchorages         (anchorage records)                     │
│  ├── gps_position       (GPS history for detection)             │
│  └── trips              (linked arrival/departure trips)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Functions

### Coordinate Formatting (service layer)

Converts decimal degrees to nautical format like B&G displays:

```javascript
// 14.73022 → "N 14°43.813'"
// -61.18192 → "W 61°10.915'"
export function formatCoordinate(decimal, isLatitude) {
  const abs = Math.abs(decimal);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  const dir = isLatitude
    ? (decimal >= 0 ? 'N' : 'S')
    : (decimal >= 0 ? 'E' : 'W');
  return `${dir} ${degrees}°${minutes.toFixed(3)}'`;
}
```

### Anchor Position Calculation

Computes anchor position upwind of boat using inverse haversine:

```javascript
export function computeAnchorPosition(boatLat, boatLon, scopeMeters, windDir) {
  const R = 6371000; // Earth radius in meters
  const bearing = windDir * Math.PI / 180;
  const lat1 = boatLat * Math.PI / 180;
  const lon1 = boatLon * Math.PI / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(scopeMeters / R) +
    Math.cos(lat1) * Math.sin(scopeMeters / R) * Math.cos(bearing)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(scopeMeters / R) * Math.cos(lat1),
    Math.cos(scopeMeters / R) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    anchor_lat: lat2 * 180 / Math.PI,
    anchor_lon: lon2 * 180 / Math.PI
  };
}
```

### GPS Detection (JavaScript-based)

Groups GPS positions by hour and identifies stationary periods:

```javascript
// Group by hour and calculate averages
groupPositionsByHour(positions) {
  const hourly = new Map();

  for (const pos of positions) {
    const hour = new Date(pos.timestamp);
    hour.setMinutes(0, 0, 0);
    const key = hour.toISOString();

    if (!hourly.has(key)) hourly.set(key, { hour, positions: [] });
    hourly.get(key).positions.push(pos);
  }

  return Array.from(hourly.values())
    .map(({ hour, positions }) => ({
      hour,
      lat: positions.reduce((sum, p) => sum + p.latitude, 0) / positions.length,
      lon: positions.reduce((sum, p) => sum + p.longitude, 0) / positions.length,
      avgWindSpeed: positions.reduce((sum, p) => sum + (p.true_wind_speed || 0), 0) / positions.length,
      avgWindDir: this.averageAngle(positions.map(p => p.true_wind_direction).filter(d => d != null))
    }))
    .sort((a, b) => a.hour - b.hour);
}

// Find stationary periods
findStationaryPeriods(hourlyPositions, minHours) {
  const MOVEMENT_THRESHOLD = 0.0027; // ~300 meters in degrees (anchor swing tolerance)
  const candidates = [];
  let currentGroup = [hourlyPositions[0]];

  for (let i = 1; i < hourlyPositions.length; i++) {
    const prev = hourlyPositions[i - 1];
    const curr = hourlyPositions[i];

    const movement = Math.sqrt(
      Math.pow(curr.lat - prev.lat, 2) +
      Math.pow(curr.lon - prev.lon, 2)
    );

    const timeDiff = (curr.hour - prev.hour) / (1000 * 60 * 60);

    if (movement < MOVEMENT_THRESHOLD && timeDiff <= 2) {
      currentGroup.push(curr);
    } else {
      if (currentGroup.length >= minHours) {
        candidates.push(this.groupToCandidate(currentGroup));
      }
      currentGroup = [curr];
    }
  }

  if (currentGroup.length >= minHours) {
    candidates.push(this.groupToCandidate(currentGroup));
  }

  return candidates;
}

// Circular mean for wind direction (handles 359° → 1° wraparound)
averageAngle(angles) {
  if (angles.length === 0) return 0;
  const sinSum = angles.reduce((sum, a) => sum + Math.sin(a * Math.PI / 180), 0);
  const cosSum = angles.reduce((sum, a) => sum + Math.cos(a * Math.PI / 180), 0);
  return ((Math.atan2(sinSum, cosSum) * 180 / Math.PI) + 360) % 360;
}
```

---

## Files & Locations

| Purpose | Path |
|---------|------|
| **Frontend** | |
| Page | `src/public/anchorages.html` |
| JS Manager | `src/public/js/anchorages/anchorages.js` |
| **Backend** | |
| Routes | `src/routes/anchorages/anchorages.route.js` |
| Service | `src/services/anchorages/anchorages.service.js` |
| Repository | `src/repositories/anchorages.repository.js` |
| **Database** | |
| Migration | `scripts/migrations/023_create_anchorages_table.sql` |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/anchorages` | List all anchorages with formatted fields |
| GET | `/api/anchorages/:id` | Get single anchorage |
| POST | `/api/anchorages/detect` | Detect and auto-geocode new anchorages |
| POST | `/api/anchorages/populate-names` | Re-geocode anchorages without names |
| POST | `/api/anchorages` | Create anchorage manually |
| PATCH | `/api/anchorages/:id` | Update anchorage (name, type, scope, notes) |
| DELETE | `/api/anchorages/:id` | Delete anchorage |

### Response Format

All endpoints return the standard envelope:

```json
{
  "success": true,
  "data": { ... },
  "requestId": "abc123"
}
```

### Detect Endpoint

Now includes auto-geocoded location names:

```javascript
POST /api/anchorages/detect
Body: { "minHours": 4 }

Response:
{
  "success": true,
  "data": {
    "detected": 18,        // Raw candidates found in GPS history
    "inserted": 2,         // New anchorages created
    "updated": 3,          // Existing anchorages with extended duration
    "merged": 4,           // Duplicate records merged/deleted
    "anchorages": [
      {
        "id": "...",
        "location_name": "Jolly Harbour, Antigua and Barbuda",
        "latitude": 17.07401,
        "longitude": -61.8967,
        "arrived_at": "2026-01-09T15:00:00+00:00",
        "departed_at": null,  // null means "still here"
        ...
      }
    ]
  }
}
```

### Populate Names Endpoint

Uses OpenStreetMap Nominatim API with improved French Caribbean handling. Rate-limited to 1 request/second per Nominatim policy.

```javascript
POST /api/anchorages/populate-names

Response:
{
  "success": true,
  "data": {
    "updated": 4,
    "anchorages": [
      { "id": "abc123", "location_name": "Deshaies, Guadeloupe" },
      { "id": "def456", "location_name": "Terre-de-Haut, Guadeloupe" },
      { "id": "ghi789", "location_name": "Le Carbet, Martinique" }
    ]
  }
}
```

---

## Database Table

### anchorages

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| location_name | text | Auto-geocoded or user-editable name |
| latitude | double | Average boat position (decimal degrees) |
| longitude | double | Average boat position (decimal degrees) |
| arrived_at | timestamptz | When anchored |
| departed_at | timestamptz | When departed (null if still there) |
| duration_hours | integer | Computed duration |
| avg_wind_speed | double | Average wind during stay (knots) |
| avg_wind_direction | double | Average wind direction (degrees) |
| anchorage_type | text | `anchor`, `mooring`, or `marina` |
| scope_meters | double | Rode/chain length (meters) |
| anchor_lat | double | Computed anchor position (upwind) |
| anchor_lon | double | Computed anchor position (upwind) |
| arrival_trip_id | uuid | FK to trips (that brought us here) |
| departure_trip_id | uuid | FK to trips (that took us away) |
| notes | text | Optional notes |
| auto_detected | boolean | Was this auto-detected from GPS? |
| created_at | timestamptz | Record creation |
| updated_at | timestamptz | Last update |

---

## UI Fields

| Field | Type | Editable | Notes |
|-------|------|----------|-------|
| Location Name | text | Yes | Auto-geocoded, user can override |
| Boat Position | display | No | Degrees/minutes format (N 14°43.813') |
| Arrived | display | No | AST timezone, linked trip if available |
| Departed | display | No | AST timezone, linked trip if available |
| Duration | display | No | e.g., "1 day 13 hours" |
| Wind | display | No | e.g., "3.8 kts from ESE (125°)" |
| Type | dropdown | Yes | Anchor / Mooring / Marina (badge updates immediately) |
| Scope | number | Yes | Meters (both anchor and mooring) |
| Anchor Position | display | No | Computed when scope saved |
| Notes | textarea | Yes | Optional notes |

---

## Geocoding Examples

| Location | Old Result | New Result |
|----------|------------|------------|
| 16.30546, -61.79796 | Ferry, France | Deshaies, Guadeloupe |
| 15.87164, -61.58654 | Terre-de-Haut, France | Terre-de-Haut, Guadeloupe |
| 14.73022, -61.18191 | Le Carbet, France | Le Carbet, Martinique |
| 17.07401, -61.8967 | Jolly Harbour, Antigua and Barbuda | (unchanged) |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Auto-detect on page load" | **No.** Manual button to avoid performance issues |
| "Real-time anchor tracking" | **No.** See [Anchor Alarm](./anchor-alarm.md) for that |
| "Edit boat position" | **No.** Positions come from GPS history |
| "Multiple anchors at once" | **No.** One anchor/mooring per stay |
| "Requires database functions" | **No.** Detection now runs entirely in JavaScript |

---

## Related Docs

- [Trips](./trips.md) - Linked arrival/departure trips
- [Anchor Alarm](./anchor-alarm.md) - Real-time anchor monitoring
- [Season Recap](./season-recap.md) - AI-generated sailing summaries (uses anchorage data)
- [Utility Scripts](../30-backend/utility-scripts.md) - Shared Nominatim utility
