# Anchorages & Moorings

## Overview

Anchorage tracking allows users to maintain a history of where they've anchored or moored, with GPS coordinates, duration, wind conditions, and computed anchor position.

**Who uses it:** Boat owners, crew
**Access:** `/anchorages`

---

## User Flow

### Detecting Anchorages from GPS History

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Open Anchorages page (/anchorages)                          │
│     └── Shows list of recorded anchorages                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Tap "Refresh New Anchorages"                                │
│     └── POST /api/anchorages/detect                             │
│     └── Analyzes GPS history for stationary periods (4+ hours)  │
│     └── Creates anchorage records with wind data                │
│     └── Links to arrival/departure trips if found               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Edit anchorage details                                      │
│     ├── Set location name (e.g., "Soufrière", "Rodney Bay")     │
│     ├── Set type: Anchor or Mooring                             │
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

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (anchorages.js)                                       │
│  ├── Detect button triggers GPS analysis                        │
│  ├── Editable fields: name, type, scope, notes                  │
│  ├── Display: coordinates, duration, wind, trips                │
│  └── Computed anchor position updates on save                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  /api/anchorages (anchorages.route.js)                          │
│  └── anchorages.service.js                                      │
│      ├── listAnchorages() - Get all with formatted fields       │
│      ├── detectNewAnchorages() - Analyze GPS history            │
│      ├── updateAnchorage() - Compute anchor pos on scope change │
│      ├── formatCoordinate() - Decimal to degrees/minutes        │
│      └── computeAnchorPosition() - Inverse haversine            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  anchorages.repository.js                                       │
│  ├── findAll() - List with trip joins                           │
│  ├── detectFromGpsHistory() - CTE query for stationary periods  │
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

### GPS Detection Query

Complex CTE query that identifies stationary periods in GPS history:

```sql
WITH hourly_positions AS (
  SELECT
    date_trunc('hour', timestamp) as hour,
    AVG(latitude) as lat, AVG(longitude) as lon,
    AVG(true_wind_speed) as avg_wind_speed,
    AVG(true_wind_direction) as avg_wind_dir
  FROM gps_position GROUP BY 1
),
with_movement AS (
  SELECT hour, lat, lon, avg_wind_speed, avg_wind_dir,
    SQRT(POWER(lat - LAG(lat) OVER (ORDER BY hour), 2) +
         POWER(lon - LAG(lon) OVER (ORDER BY hour), 2)) as movement
  FROM hourly_positions
),
stationary_hours AS (
  SELECT hour, lat, lon, avg_wind_speed, avg_wind_dir,
    CASE WHEN movement < 0.0005 THEN 0 ELSE 1 END as moved,
    SUM(CASE WHEN movement < 0.0005 THEN 0 ELSE 1 END) OVER (ORDER BY hour) as grp
  FROM with_movement
)
SELECT
  MIN(hour) as arrived_at,
  MAX(hour) as departed_at,
  AVG(lat) as latitude,
  AVG(lon) as longitude,
  COUNT(*) as hours_anchored,
  AVG(avg_wind_speed) as avg_wind_speed,
  AVG(avg_wind_dir) as avg_wind_direction
FROM stationary_hours WHERE moved = 0
GROUP BY grp HAVING COUNT(*) >= 4
ORDER BY MIN(hour) DESC
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
| POST | `/api/anchorages/detect` | Detect new anchorages from GPS history |
| POST | `/api/anchorages/populate-names` | Populate location names via reverse geocoding |
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

```javascript
POST /api/anchorages/detect
Body: { "minHours": 4 }

Response:
{
  "success": true,
  "data": {
    "detected": 10,
    "inserted": 3,
    "anchorages": [...]
  }
}
```

### Populate Names Endpoint

Uses OpenStreetMap Nominatim API (same as trips auto-naming). Rate-limited to 1 request/second per Nominatim policy. Returns place name with country (e.g., "Rodney Bay, Saint Lucia").

```javascript
POST /api/anchorages/populate-names

Response:
{
  "success": true,
  "data": {
    "updated": 10,
    "anchorages": [
      { "id": "abc123", "location_name": "Rodney Bay, Saint Lucia" },
      { "id": "def456", "location_name": "Soufrière, Saint Lucia" }
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
| location_name | text | User-editable name (e.g., "Soufrière") |
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
| Location Name | text | Yes | User can name the anchorage |
| Boat Position | display | No | Degrees/minutes format (N 14°43.813') |
| Arrived | display | No | AST timezone, linked trip if available |
| Departed | display | No | AST timezone, linked trip if available |
| Duration | display | No | e.g., "1 day 13 hours" |
| Wind | display | No | e.g., "3.8 kts from ESE (125°)" |
| Type | dropdown | Yes | Anchor / Mooring / Marina |
| Scope | number | Yes | Meters (both anchor and mooring) |
| Anchor Position | display | No | Computed when scope saved |
| Notes | textarea | Yes | Optional notes |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Auto-detect on page load" | **No.** Manual button to avoid performance issues |
| "Real-time anchor tracking" | **No.** See [Anchor Alarm](./anchor-alarm.md) for that |
| "Edit boat position" | **No.** Positions come from GPS history |
| "Multiple anchors at once" | **No.** One anchor/mooring per stay |

---

## Related Docs

- [Trips](./trips.md) - Linked arrival/departure trips
- [Anchor Alarm](./anchor-alarm.md) - Real-time anchor monitoring
