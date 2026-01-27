# Code Update #66: Anchorages/Moorings Feature Implementation

**Date:** 2025-12-20
**Status:** IN PROGRESS (paused for compact)
**Author:** Claude Code

---

## Session Summary

### What We Accomplished This Session

1. **Fixed Supabase CPU Crisis (93% → 5%)**
   - Root cause: Inefficient `aggregate_telemetry_*` pg_cron functions scanning entire `telemetry_raw` table
   - Fixed `aggregate_telemetry_1m()` - now only processes last 1 minute
   - Fixed `aggregate_telemetry_5m()` - now only processes last 5 minutes
   - Unscheduled jobs temporarily, applied fixes, re-enabled

2. **Added Staysail to Sail Config**
   - Database: `ALTER TABLE trip_sail_events ADD COLUMN staysail boolean DEFAULT false`
   - Backend: Updated `trips.service.js` and `trips.route.js`
   - Frontend: Updated `trips.html`, `trips.js`, `trip-detail.js`
   - Docs: Updated `docs/10-user-features/trips.md`

3. **Edited Sail Events for Dec 19 Trip**
   - Trip: Rodney Bay to Le Carbet (40.89 nm, 6h 21m)
   - Fixed first sail event: staysail=true, jib=false
   - Inserted second event at 1pm AST: jib=true, staysail=false

4. **Discovered Anchorage Detection from GPS History**
   - Ran complex CTE query on `gps_position` table to find stationary periods
   - Found 10 anchorages over 35 days of GPS data
   - Added wind speed/direction to the query
   - Confirmed coordinate conversion works (decimal → degrees/minutes like B&G display)

5. **Planned Anchorages Feature** (ready to implement)

---

## Anchorages Feature - Implementation Plan

### Overview
Create a standalone page to track anchorage and mooring history, with:
- Editable location names
- Scope field (for both anchor and mooring)
- Inferred anchor/mooring position (computed when scope saved)
- Coordinates in nautical degrees/minutes format (N 14°43.813' W 61°10.919')
- "Refresh New Anchorages" button to detect from GPS history
- Link to trips (arrival/departure)

### Architecture (following .cursorrules)
```
Frontend → Routes (thin) → Services (business logic) → Repositories (DB I/O)
```

### Database Migration (scripts/migrations/023_create_anchorages_table.sql)
**CREATED** ✅
```sql
CREATE TABLE anchorages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_name text,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  arrived_at timestamptz NOT NULL,
  departed_at timestamptz,
  duration_hours integer,
  avg_wind_speed double precision,
  avg_wind_direction double precision,
  anchorage_type text DEFAULT 'anchor' CHECK (anchorage_type IN ('anchor', 'mooring')),
  scope_meters double precision,
  anchor_lat double precision,
  anchor_lon double precision,
  arrival_trip_id uuid REFERENCES trips(id),
  departure_trip_id uuid REFERENCES trips(id),
  notes text,
  auto_detected boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

### Files to Create

| File | Status | Purpose |
|------|--------|---------|
| `scripts/migrations/023_create_anchorages_table.sql` | ✅ DONE | Database migration |
| `src/repositories/anchorages.repository.js` | ⏳ NEXT | DB I/O layer |
| `src/services/anchorages/anchorages.service.js` | Pending | Business logic |
| `src/routes/anchorages/index.js` | Pending | Router export |
| `src/routes/anchorages/anchorages.route.js` | Pending | API endpoints |
| `src/public/anchorages.html` | Pending | Frontend page |
| `src/public/js/anchorages/anchorages.js` | Pending | Manager class |
| `docs/10-user-features/anchorages.md` | Pending | Documentation |

### Files to Modify
- `src/app.js` - Add router import and registration

### Key Functions Needed

**Coordinate Formatting:**
```javascript
function formatCoordinate(decimal, isLatitude) {
  const abs = Math.abs(decimal);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  const dir = isLatitude ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');
  return `${dir} ${degrees}°${minutes.toFixed(3)}'`;
}
```

**Anchor Position Calculation:**
```javascript
function computeAnchorPosition(boatLat, boatLon, scopeMeters, windDir) {
  const R = 6371000;
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

  return { anchor_lat: lat2 * 180 / Math.PI, anchor_lon: lon2 * 180 / Math.PI };
}
```

**GPS Detection Query (tested and working):**
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
