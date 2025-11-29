# Trip Tracking Feature - Design Document

**Date:** 2025-11-29
**Status:** In Progress
**Priority:** High
**Version:** 1.3

---

## Implementation Progress

| Phase | Status | Notes |
|-------|--------|-------|
| **Database Tables** | ✅ DONE | All 5 tables created in Supabase |
| **Pi Collector** | ✅ DONE | Built in Python, polls Supabase, collects SignalK data |
| **Basic UI (Start/Stop)** | ✅ DONE | Service, routes, HTML, JS all created |
| **Sail Events** | ✅ DONE | UI + API for main/jib/code0/asym config |
| **Weather Collection** | ✅ DONE | Background job fetches Open-Meteo every 15 min |
| **Trip Review** | ✅ DONE | Detail page with map, stats, sail timeline, weather, comments |

### Resume Instructions (After Context Loss)

1. **All cloud features complete** - Pi Collector also complete (Python)
2. **Tables created** - `trips`, `trip_telemetry`, `trip_weather`, `trip_sail_events`, `trip_comments`
3. **Files created** - See "Files Created" section below
4. **Column note:** `asym_spinnaker` (not `asymmetric` - reserved word)
5. **TESTED** - Trip created successfully, Pi collector running

### Files Created

| File | Purpose |
|------|---------|
| `src/services/trips/trips.service.js` | Business logic (start/stop/resume/delete, sail events, comments) |
| `src/services/trips/weather-collector.service.js` | Background job for Open-Meteo weather data |
| `src/routes/trips/trips.route.js` | API endpoints (CRUD, sail events, comments, weather trigger) |
| `src/routes/trips/index.js` | Router export |
| `src/public/trips.html` | Trip list + Start/Stop UI with sail config |
| `src/public/trip-detail.html` | Trip detail page with map, stats, timeline |
| `src/public/js/trips/trips.js` | Frontend for trip list/start/stop |
| `src/public/js/trips/trip-detail.js` | Frontend for trip detail view |
| `src/app.js` | Updated with trips routes mount |
| `src/start.js` | Updated to start weather collector in production |

### API Endpoints Created

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trips` | List trips |
| GET | `/api/trips/active` | Get active trip |
| GET | `/api/trips/:id` | Get trip with track, weather, comments |
| GET | `/api/trips/:id/stats` | Get live stats (for active trip) |
| POST | `/api/trips/start` | Start new trip |
| POST | `/api/trips/:id/stop` | Stop trip (computes summary) |
| POST | `/api/trips/:id/resume` | Resume trip (30 min window) |
| PATCH | `/api/trips/:id` | Update title |
| DELETE | `/api/trips/:id` | Delete trip (cascade) |

### UI Features Implemented

- Start trip button (when no active trip)
- Stop trip button (when active)
- Live duration timer (updates every second)
- Live distance/speed stats (updates every 10 seconds)
- Trip title editing
- Resume banner (shows for trips ended < 30 min ago)
- Trip history list with distance/duration
- Delete trip modal with confirmation
- Mobile-first responsive design

---

## 1. Overview

### Purpose
Track sailing trips with comprehensive data collection from SignalK (boat instruments), weather APIs, and user input (sail configuration). Enable post-trip review with maps, statistics, and notes.

### Key Features
- Start/stop trip recording from mobile or desktop
- Track sail configuration changes with GPS timestamps
- Collect SignalK data every 2 minutes (position, speed, wind, depth, engines, batteries)
- Collect weather data every 15 minutes (Open-Meteo marine API)
- View trip history with map, timeline, and statistics
- Add post-trip comments
- Delete trips (cascading purge of all data)
- **Offline resilience** via SQLite outbox on Pi

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                               │
│                    (Render - Cloud Hosted)                          │
│                                                                      │
│   [Begin Trip] → [Sail Config] → [Save] → [Stop Trip]              │
│                                                                      │
│   [Trip History] → [View Trip] → [Map + Stats + Comments]          │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ REST API
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SUPABASE                                     │
│                    (Shared Database)                                 │
│                                                                      │
│   trips ─────────────┬─── trip_telemetry (SignalK data)            │
│   (controller)       ├─── trip_weather (Open-Meteo data)           │
│                      ├─── trip_sail_events (sail changes)          │
│                      └─── trip_comments (post-trip notes)          │
└─────────────────────────────────────────────────────────────────────┘
                              ▲
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
┌──────────────────────────┐    ┌──────────────────────────┐
│    PI (On Boat)          │    │    Open-Meteo API        │
│                          │    │    (Weather Data)        │
│  - Polls for active trip │    │                          │
│  - Reads SignalK         │    │  - Marine forecast       │
│  - SQLite outbox         │    │  - Wave/swell data       │
│  - Syncs to Supabase     │    │  - Wind/temp/pressure    │
└──────────────────────────┘    └──────────────────────────┘
         │
         ▼
┌──────────────────────────┐
│    SignalK Server        │
│    (On Same Pi)          │
│                          │
│  - NMEA 2000 data        │
│  - Victron data          │
│  - GPS, wind, depth      │
│  - Engine, batteries     │
└──────────────────────────┘
```

### 2.1 Offline/Outbox Pattern

The Pi uses a **SQLite outbox** for resilience:

1. Pi collects SignalK data every 2 minutes
2. Data is written to **local SQLite** first (always succeeds)
3. Background worker syncs SQLite → Supabase with retries
4. If Pi loses internet, data queues locally
5. When connectivity returns, backfill happens automatically

This ensures **no data loss** during connectivity gaps.

### 2.2 Constraints

- **Single vessel** - No vessel_id needed
- **One active trip at a time** - Enforced by database constraint
- **Pi polls Supabase** - No direct Render → Pi connection needed

---

## 3. Database Schema

### 3.1 trips (Controller Table)

```sql
CREATE TABLE trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Status (Pi watches this)
  status TEXT NOT NULL DEFAULT 'active',  -- 'active', 'completed', 'cancelled'

  -- Timestamps
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,

  -- Start/End positions (computed on trip end from telemetry)
  start_lat DOUBLE PRECISION,
  start_lon DOUBLE PRECISION,
  end_lat DOUBLE PRECISION,
  end_lon DOUBLE PRECISION,

  -- Summary stats (computed on trip end)
  distance_nm DOUBLE PRECISION,           -- nautical miles (Haversine sum)
  duration_minutes INTEGER,
  avg_sog DOUBLE PRECISION,               -- average speed over ground
  max_sog DOUBLE PRECISION,               -- max speed

  -- Metadata
  title TEXT,                             -- auto-generated, user can override

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for Pi polling
CREATE INDEX idx_trips_status ON trips(status) WHERE status = 'active';

-- Constraint: Only one active trip at a time
CREATE UNIQUE INDEX idx_trips_one_active
ON trips ((1))
WHERE status = 'active';

-- RLS Policy
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for now" ON trips FOR ALL USING (true);
```

**Notes:**
- `start_lat/lon` and `end_lat/lon` are **computed on trip stop** from first/last telemetry
- `distance_nm` is **computed on trip stop** using Haversine formula over track
- `title` is **auto-generated** as "Trip - {date}" but user can override

### 3.2 trip_telemetry (SignalK Snapshots)

```sql
CREATE TABLE trip_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

  -- Timestamp
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Key fields (for efficient queries)
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  sog DOUBLE PRECISION,                   -- speed over ground (knots)
  cog DOUBLE PRECISION,                   -- course over ground (degrees)
  heading DOUBLE PRECISION,               -- compass heading (degrees)

  -- Full SignalK snapshot (flexible storage)
  signalk_data JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_trip_telemetry_trip_id ON trip_telemetry(trip_id);
CREATE INDEX idx_trip_telemetry_recorded_at ON trip_telemetry(trip_id, recorded_at);
CREATE INDEX idx_trip_telemetry_latest ON trip_telemetry(trip_id, recorded_at DESC);  -- For "get latest" queries

-- RLS Policy
ALTER TABLE trip_telemetry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for now" ON trip_telemetry FOR ALL USING (true);
```

### 3.3 trip_weather (Open-Meteo Snapshots)

```sql
CREATE TABLE trip_weather (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

  -- Timestamp and position
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,

  -- Source tracking
  source TEXT DEFAULT 'open-meteo-marine',

  -- Weather data
  wind_speed_kts DOUBLE PRECISION,        -- wind speed in knots
  wind_direction DOUBLE PRECISION,        -- degrees
  wind_gusts_kts DOUBLE PRECISION,

  -- Wave data
  wave_height_m DOUBLE PRECISION,         -- meters
  wave_period_s DOUBLE PRECISION,         -- seconds
  wave_direction DOUBLE PRECISION,        -- degrees

  -- Swell data
  swell_height_m DOUBLE PRECISION,
  swell_period_s DOUBLE PRECISION,
  swell_direction DOUBLE PRECISION,

  -- Atmosphere
  air_temp_c DOUBLE PRECISION,
  sea_temp_c DOUBLE PRECISION,
  pressure_hpa DOUBLE PRECISION,
  cloud_cover_pct INTEGER,
  visibility_m INTEGER,
  precipitation_mm DOUBLE PRECISION,

  -- Full API response (for future fields)
  api_response JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_trip_weather_trip_id ON trip_weather(trip_id);
CREATE INDEX idx_trip_weather_recorded_at ON trip_weather(trip_id, recorded_at);

-- RLS Policy
ALTER TABLE trip_weather ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for now" ON trip_weather FOR ALL USING (true);
```

### 3.4 trip_sail_events (Sail Configuration Changes)

```sql
CREATE TABLE trip_sail_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

  -- Timestamp and position (position auto-filled from latest telemetry)
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,

  -- Sail configuration
  main_sail TEXT,                         -- 'full', '1reef', '2reef', '3reef', NULL (down)
  jib BOOLEAN DEFAULT FALSE,
  code_zero BOOLEAN DEFAULT FALSE,
  asym_spinnaker BOOLEAN DEFAULT FALSE,   -- renamed from 'asymmetric' (reserved word in PostgreSQL)

  -- Notes
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_trip_sail_events_trip_id ON trip_sail_events(trip_id);
CREATE INDEX idx_trip_sail_events_recorded_at ON trip_sail_events(trip_id, recorded_at);

-- RLS Policy
ALTER TABLE trip_sail_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for now" ON trip_sail_events FOR ALL USING (true);
```

**Note:** Position is **auto-filled by backend** from latest `trip_telemetry` row, not sent by client.

### 3.5 trip_comments (Post-Trip Notes)

```sql
CREATE TABLE trip_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

  -- Comment content
  comment TEXT NOT NULL,

  -- Optional: link to specific time in trip
  trip_timestamp TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_trip_comments_trip_id ON trip_comments(trip_id);

-- RLS Policy
ALTER TABLE trip_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for now" ON trip_comments FOR ALL USING (true);
```

---

## 4. Pi Code (SignalK Data Collector)

### 4.1 Overview

The Pi runs a Node.js script that:
1. Polls Supabase every 30 seconds for active trips
2. When active trip found: collects SignalK data every 2 minutes
3. **Writes to SQLite outbox first** (for offline resilience)
4. Background worker syncs outbox → Supabase
5. Stops when trip becomes inactive

### 4.2 Environment Variables (.env on Pi)

```env
# Supabase connection
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key

# SignalK connection
SIGNALK_URL=http://localhost:3000/signalk/v1/api/vessels/self

# Polling intervals (milliseconds)
TRIP_POLL_INTERVAL=30000       # Check for active trip every 30 sec
TELEMETRY_INTERVAL=120000      # Collect data every 2 min

# SQLite outbox
OUTBOX_DB_PATH=./outbox.sqlite
OUTBOX_SYNC_INTERVAL=10000     # Sync to Supabase every 10 sec
```

### 4.3 Pi Script: trip-collector.js

```javascript
/**
 * Trip Data Collector for Pi
 *
 * Polls Supabase for active trips and collects SignalK data.
 * Uses SQLite outbox for offline resilience.
 *
 * Run with: node trip-collector.js
 * Or use PM2: pm2 start trip-collector.js --name trip-collector
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import Database from 'better-sqlite3';

// Configuration
const config = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY,
  signalkUrl: process.env.SIGNALK_URL || 'http://localhost:3000/signalk/v1/api/vessels/self',
  tripPollInterval: parseInt(process.env.TRIP_POLL_INTERVAL) || 30000,
  telemetryInterval: parseInt(process.env.TELEMETRY_INTERVAL) || 120000,
  outboxDbPath: process.env.OUTBOX_DB_PATH || './outbox.sqlite',
  outboxSyncInterval: parseInt(process.env.OUTBOX_SYNC_INTERVAL) || 10000,
};

// Initialize Supabase client
const supabase = createClient(config.supabaseUrl, config.supabaseKey);

// Initialize SQLite outbox
const db = new Database(config.outboxDbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stream TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    synced_at TEXT
  )
`);

// State
let currentTripId = null;
let telemetryTimer = null;
let syncTimer = null;

/**
 * Fetch all data from SignalK
 */
async function getSignalKData() {
  try {
    const response = await fetch(config.signalkUrl);
    if (!response.ok) {
      throw new Error(`SignalK returned ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('[SignalK] Error fetching data:', error.message);
    return null;
  }
}

/**
 * Extract key navigation values from SignalK data
 */
function extractNavigation(signalkData) {
  if (!signalkData) return {};

  const nav = signalkData.navigation || {};
  const position = nav.position?.value || {};

  return {
    latitude: position.latitude || null,
    longitude: position.longitude || null,
    sog: nav.speedOverGround?.value ? nav.speedOverGround.value * 1.94384 : null, // m/s to knots
    cog: nav.courseOverGroundTrue?.value ? nav.courseOverGroundTrue.value * (180/Math.PI) : null, // radians to degrees
    heading: nav.headingTrue?.value ? nav.headingTrue.value * (180/Math.PI) : null,
  };
}

/**
 * Write telemetry to SQLite outbox (offline-safe)
 */
function writeToOutbox(tripId, signalkData) {
  const nav = extractNavigation(signalkData);

  const telemetry = {
    trip_id: tripId,
    recorded_at: new Date().toISOString(),
    latitude: nav.latitude,
    longitude: nav.longitude,
    sog: nav.sog,
    cog: nav.cog,
    heading: nav.heading,
    signalk_data: signalkData,
  };

  const stmt = db.prepare(`
    INSERT INTO outbox (stream, payload, created_at)
    VALUES (?, ?, ?)
  `);

  stmt.run('trip_telemetry', JSON.stringify(telemetry), new Date().toISOString());

  console.log(`[Outbox] Queued: lat=${nav.latitude?.toFixed(5)}, lon=${nav.longitude?.toFixed(5)}, sog=${nav.sog?.toFixed(1)}kts`);
}

/**
 * Sync outbox to Supabase
 */
async function syncOutbox() {
  const rows = db.prepare(`
    SELECT id, stream, payload FROM outbox
    WHERE synced_at IS NULL
    ORDER BY id
    LIMIT 50
  `).all();

  if (rows.length === 0) return;

  console.log(`[Sync] Processing ${rows.length} queued records...`);

  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload);

      if (row.stream === 'trip_telemetry') {
        const { error } = await supabase
          .from('trip_telemetry')
          .insert(payload);

        if (error) throw error;
      }

      // Mark as synced
      db.prepare(`UPDATE outbox SET synced_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), row.id);

    } catch (error) {
      console.error(`[Sync] Error syncing row ${row.id}:`, error.message);
      // Will retry on next sync cycle
      break;
    }
  }

  // Cleanup old synced records (keep last 1000)
  db.prepare(`
    DELETE FROM outbox
    WHERE synced_at IS NOT NULL
    AND id NOT IN (
      SELECT id FROM outbox
      WHERE synced_at IS NOT NULL
      ORDER BY id DESC
      LIMIT 1000
    )
  `).run();
}

/**
 * Collect and write telemetry (called every 2 minutes during active trip)
 */
async function collectTelemetry() {
  if (!currentTripId) return;

  console.log(`[Collector] Collecting telemetry for trip ${currentTripId}`);

  const signalkData = await getSignalKData();
  if (signalkData) {
    writeToOutbox(currentTripId, signalkData);
  }
}

/**
 * Start telemetry collection
 */
function startCollection(tripId) {
  if (telemetryTimer) {
    clearInterval(telemetryTimer);
  }

  currentTripId = tripId;
  console.log(`[Collector] Starting collection for trip ${tripId}`);

  // Collect immediately, then every 2 minutes
  collectTelemetry();
  telemetryTimer = setInterval(collectTelemetry, config.telemetryInterval);
}

/**
 * Stop telemetry collection
 */
function stopCollection() {
  if (telemetryTimer) {
    clearInterval(telemetryTimer);
    telemetryTimer = null;
  }

  if (currentTripId) {
    console.log(`[Collector] Stopped collection for trip ${currentTripId}`);
    currentTripId = null;
  }
}

/**
 * Check for active trips (called every 30 seconds)
 */
async function checkForActiveTrip() {
  try {
    const { data: trips, error } = await supabase
      .from('trips')
      .select('id')
      .eq('status', 'active')
      .limit(1);

    if (error) {
      console.error('[Poll] Error checking trips:', error.message);
      return;
    }

    const activeTrip = trips?.[0];

    if (activeTrip && activeTrip.id !== currentTripId) {
      // New active trip found
      startCollection(activeTrip.id);
    } else if (!activeTrip && currentTripId) {
      // Trip ended
      stopCollection();
    }

  } catch (error) {
    console.error('[Poll] Error:', error.message);
  }
}

/**
 * Validate required Supabase tables exist
 */
async function validateTables() {
  console.log('[Validate] Checking required tables in Supabase...');

  const requiredTables = ['trips', 'trip_telemetry'];

  for (const table of requiredTables) {
    try {
      const { error } = await supabase
        .from(table)
        .select('id')
        .limit(1);

      if (error) {
        throw new Error(`Table '${table}' check failed: ${error.message}`);
      }

      console.log(`[Validate] ✓ Table '${table}' exists`);
    } catch (err) {
      console.error(`[Validate] ✗ Table '${table}' - ${err.message}`);
      throw new Error(`Required table '${table}' not found or inaccessible. Please create tables in Supabase first.`);
    }
  }

  console.log('[Validate] All required tables validated');
}

/**
 * Main loop
 */
async function main() {
  console.log('========================================');
  console.log('Trip Data Collector Starting');
  console.log('========================================');
  console.log(`SignalK URL: ${config.signalkUrl}`);
  console.log(`Poll interval: ${config.tripPollInterval / 1000}s`);
  console.log(`Telemetry interval: ${config.telemetryInterval / 1000}s`);
  console.log(`Outbox DB: ${config.outboxDbPath}`);
  console.log('========================================');

  // Validate Supabase tables exist before starting
  await validateTables();

  // Test SignalK connection
  const testData = await getSignalKData();
  if (testData) {
    console.log('[SignalK] Connection OK');
    const nav = extractNavigation(testData);
    console.log(`[SignalK] Current position: ${nav.latitude?.toFixed(5)}, ${nav.longitude?.toFixed(5)}`);
  } else {
    console.warn('[SignalK] Connection failed - will retry');
  }

  // Start outbox sync worker
  console.log('[Sync] Starting outbox sync worker...');
  syncTimer = setInterval(syncOutbox, config.outboxSyncInterval);

  // Start polling for active trips
  console.log('[Poll] Starting trip poll loop...');
  checkForActiveTrip(); // Check immediately
  setInterval(checkForActiveTrip, config.tripPollInterval);
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\n[Shutdown] Stopping collector...');
  stopCollection();
  if (syncTimer) clearInterval(syncTimer);
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Shutdown] Stopping collector...');
  stopCollection();
  if (syncTimer) clearInterval(syncTimer);
  db.close();
  process.exit(0);
});

// Start
main().catch(console.error);
```

### 4.4 Package.json for Pi

```json
{
  "name": "trip-collector",
  "version": "1.0.0",
  "type": "module",
  "main": "trip-collector.js",
  "scripts": {
    "start": "node trip-collector.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "better-sqlite3": "^9.2.2",
    "node-fetch": "^3.3.2"
  }
}
```

### 4.5 Running on Pi

```bash
# Install dependencies
cd /path/to/trip-collector
npm install

# Test run
node trip-collector.js

# Run with PM2 (recommended for production)
pm2 start trip-collector.js --name trip-collector
pm2 save
pm2 startup  # Auto-start on boot
```

---

## 5. Weather Data Collection

### 5.1 Open-Meteo Marine API

Weather data is collected by the **Render backend** (not Pi) every 15 minutes during active trips.

**API Endpoint:**
```
https://marine-api.open-meteo.com/v1/marine?
  latitude={lat}&
  longitude={lon}&
  current=wave_height,wave_direction,wave_period,
          wind_wave_height,wind_wave_direction,wind_wave_period,
          swell_wave_height,swell_wave_direction,swell_wave_period&
  hourly=wave_height,wave_period,wind_wave_height,swell_wave_height
```

**Combined with standard weather:**
```
https://api.open-meteo.com/v1/forecast?
  latitude={lat}&
  longitude={lon}&
  current=temperature_2m,wind_speed_10m,wind_direction_10m,
          wind_gusts_10m,pressure_msl,cloud_cover,visibility,
          precipitation
```

### 5.2 Weather Collection Service (on Render)

The main backend runs a background job during active trips:
1. Queries `trips` for active trips
2. Gets latest position from `trip_telemetry`
3. If no telemetry yet, skips (waits for Pi to provide position)
4. Fetches Open-Meteo data for that position
5. Writes to `trip_weather`

---

## 6. UI Screens

### 6.1 Trip Control Screen (New Page)

**URL:** `/trips` or `/sailing`

**Inactive State:**
```
┌─────────────────────────────────────┐
│  ⛵ Trip Tracking                    │
├─────────────────────────────────────┤
│                                     │
│         [Begin Trip]                │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  Recent Trips:                      │
│  • Nov 28 - Bequia to Mustique     │
│  • Nov 25 - Day sail (3.2 nm)      │
│  • Nov 20 - Passage from St Lucia  │
│                                     │
└─────────────────────────────────────┘
```

**Active State (After Begin Trip):**
```
┌─────────────────────────────────────┐
│  ⛵ Trip In Progress     ● LIVE     │
├─────────────────────────────────────┤
│                                     │
│  Duration: 02:34:15                 │
│  Distance: 12.4 nm                  │
│  Avg Speed: 4.8 kts                 │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  SAIL CONFIGURATION                 │
│                                     │
│  Main:  (•) Full  ( ) 1R  ( ) 2R   │
│         ( ) 3R    ( ) Down          │
│                                     │
│  [✓] Jib                           │
│  [ ] Code Zero                      │
│  [ ] Asymmetric                     │
│                                     │
│         [Save Configuration]        │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│         [Stop Trip]                 │
│                                     │
└─────────────────────────────────────┘
```

### 6.2 Trip Detail Screen (Post-Trip Review)

**URL:** `/trips/{id}`

```
┌─────────────────────────────────────┐
│  ← Back     Nov 28 Trip    [Delete] │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐   │
│  │                             │   │
│  │      [MAP WITH TRACK]       │   │
│  │   (simplified, every 5th    │   │
│  │    point for performance)   │   │
│  │   Start ●────────────● End  │   │
│  │                             │   │
│  └─────────────────────────────┘   │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  SUMMARY                            │
│  Duration:    3h 45m                │
│  Distance:    18.2 nm               │
│  Avg Speed:   4.9 kts               │
│  Max Speed:   7.2 kts               │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  SAIL EVENTS                        │
│  10:00 - Started with Full Main+Jib│
│  11:30 - 1 Reef in main            │
│  13:00 - Dropped sails, motor      │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  CONDITIONS (avg)                   │
│  Wind:   12 kts from NE            │
│  Waves:  1.2m @ 8s                 │
│  Temp:   28°C                       │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  COMMENTS                           │
│  "Great sail, bit rolly..."         │
│  [Add Comment]                      │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  [Edit Title]                       │
│                                     │
└─────────────────────────────────────┘
```

---

## 7. API Endpoints (Render Backend)

### 7.1 Trip Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trips` | List all trips (supports `?status=`, `?limit=`, `?offset=`) |
| GET | `/api/trips/:id` | Get trip summary with aggregated data |
| POST | `/api/trips/start` | Begin new trip (returns new trip ID) |
| POST | `/api/trips/:id/stop` | End active trip (computes summary stats) - **requires confirmation** |
| POST | `/api/trips/:id/resume` | Resume a stopped trip (within 30 min window) |
| PATCH | `/api/trips/:id` | Update trip (title) |
| DELETE | `/api/trips/:id` | Delete trip (cascade) |

### 7.2 Trip Detail Response Format

```json
GET /api/trips/:id

{
  "trip": {
    "id": "uuid",
    "status": "completed",
    "started_at": "2025-11-28T10:00:00Z",
    "ended_at": "2025-11-28T13:45:00Z",
    "title": "Day sail to Bequia",
    "distance_nm": 18.2,
    "duration_minutes": 225,
    "avg_sog": 4.9,
    "max_sog": 7.2,
    "start_lat": 12.602,
    "start_lon": -61.450,
    "end_lat": 12.654,
    "end_lon": -61.232
  },
  "track": [
    {"lat": 12.602, "lon": -61.450, "t": "2025-11-28T10:00:00Z"},
    {"lat": 12.610, "lon": -61.440, "t": "2025-11-28T10:10:00Z"},
    // ... simplified track (every 5th point)
  ],
  "sail_events": [
    {"recorded_at": "...", "main_sail": "full", "jib": true, ...},
    ...
  ],
  "weather_summary": {
    "avg_wind_kts": 12,
    "max_wind_kts": 18,
    "avg_wave_height_m": 1.2,
    "avg_temp_c": 28
  },
  "comments": [...]
}
```

### 7.3 Sail Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/trips/:id/sail-event` | Record sail change (position auto-filled from telemetry) |
| GET | `/api/trips/:id/sail-events` | Get sail events for trip |

**POST body:**
```json
{
  "main_sail": "1reef",
  "jib": true,
  "code_zero": false,
  "asym_spinnaker": false,
  "notes": "Wind picked up"
}
```

Position is **server-side populated** from latest telemetry.

### 7.4 Comments

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/trips/:id/comments` | Add comment |
| GET | `/api/trips/:id/comments` | Get comments |
| DELETE | `/api/trips/:id/comments/:cid` | Delete comment |

### 7.5 Raw Data (for detailed analysis)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trips/:id/telemetry` | Get all telemetry points (`?limit=1000`) |
| GET | `/api/trips/:id/weather` | Get all weather records |

---

## 8. Business Logic

### 8.1 Trip Start

```javascript
// POST /api/trips/start
async function startTrip() {
  // Check no active trip exists
  const existing = await db.query('SELECT id FROM trips WHERE status = $1', ['active']);
  if (existing.rows.length > 0) {
    throw new Error('A trip is already in progress');
  }

  // Create new trip
  const title = `Trip - ${new Date().toLocaleDateString()}`;
  const result = await db.query(
    'INSERT INTO trips (status, title) VALUES ($1, $2) RETURNING *',
    ['active', title]
  );

  return result.rows[0];
}
```

### 8.2 Trip Stop (Compute Summary)

```javascript
// POST /api/trips/:id/stop
async function stopTrip(tripId) {
  // Get all telemetry for trip
  const telemetry = await db.query(
    'SELECT latitude, longitude, sog, recorded_at FROM trip_telemetry WHERE trip_id = $1 ORDER BY recorded_at',
    [tripId]
  );

  if (telemetry.rows.length === 0) {
    throw new Error('No telemetry data recorded for this trip');
  }

  // Compute summary
  const first = telemetry.rows[0];
  const last = telemetry.rows[telemetry.rows.length - 1];

  const summary = {
    start_lat: first.latitude,
    start_lon: first.longitude,
    end_lat: last.latitude,
    end_lon: last.longitude,
    distance_nm: calculateTotalDistance(telemetry.rows), // Haversine sum
    duration_minutes: Math.round((new Date(last.recorded_at) - new Date(first.recorded_at)) / 60000),
    avg_sog: average(telemetry.rows.map(r => r.sog).filter(Boolean)),
    max_sog: Math.max(...telemetry.rows.map(r => r.sog).filter(Boolean)),
    status: 'completed',
    ended_at: new Date().toISOString(),
  };

  // Update trip
  await db.query(
    `UPDATE trips SET
      status = $1, ended_at = $2,
      start_lat = $3, start_lon = $4,
      end_lat = $5, end_lon = $6,
      distance_nm = $7, duration_minutes = $8,
      avg_sog = $9, max_sog = $10
    WHERE id = $11`,
    [summary.status, summary.ended_at, summary.start_lat, summary.start_lon,
     summary.end_lat, summary.end_lon, summary.distance_nm, summary.duration_minutes,
     summary.avg_sog, summary.max_sog, tripId]
  );
}

// Haversine distance calculation
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function calculateTotalDistance(telemetryRows) {
  let total = 0;
  for (let i = 1; i < telemetryRows.length; i++) {
    const prev = telemetryRows[i - 1];
    const curr = telemetryRows[i];
    if (prev.latitude && prev.longitude && curr.latitude && curr.longitude) {
      total += haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    }
  }
  return Math.round(total * 100) / 100;
}
```

### 8.3 Sail Event Insert (Auto-fill Position)

```javascript
// POST /api/trips/:id/sail-event
async function recordSailEvent(tripId, sailConfig) {
  // Get latest telemetry position
  const latest = await db.query(
    'SELECT latitude, longitude FROM trip_telemetry WHERE trip_id = $1 ORDER BY recorded_at DESC LIMIT 1',
    [tripId]
  );

  const position = latest.rows[0] || { latitude: null, longitude: null };

  // Insert sail event with position
  await db.query(
    `INSERT INTO trip_sail_events (trip_id, latitude, longitude, main_sail, jib, code_zero, asym_spinnaker, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tripId, position.latitude, position.longitude,
     sailConfig.main_sail, sailConfig.jib, sailConfig.code_zero, sailConfig.asym_spinnaker, sailConfig.notes]
  );
}
```

### 8.4 Track Simplification for Map

```javascript
// GET /api/trips/:id returns simplified track
function simplifyTrack(telemetryRows, sampleRate = 5) {
  // Take every Nth point for map display
  return telemetryRows
    .filter((_, i) => i % sampleRate === 0)
    .map(row => ({
      lat: row.latitude,
      lon: row.longitude,
      t: row.recorded_at
    }));
}
```

### 8.5 Resume Trip (Accidental Stop Recovery)

```javascript
// POST /api/trips/:id/resume
async function resumeTrip(tripId) {
  const RESUME_WINDOW_MINUTES = 30;

  // Get the trip
  const trip = await db.query(
    'SELECT id, status, ended_at FROM trips WHERE id = $1',
    [tripId]
  );

  if (!trip.rows[0]) {
    throw new Error('Trip not found');
  }

  const tripData = trip.rows[0];

  // Check if trip is in 'completed' status
  if (tripData.status !== 'completed') {
    throw new Error('Only completed trips can be resumed');
  }

  // Check if another trip is already active
  const activeTrip = await db.query(
    'SELECT id FROM trips WHERE status = $1',
    ['active']
  );
  if (activeTrip.rows.length > 0) {
    throw new Error('Another trip is already in progress');
  }

  // Check resume window (30 minutes)
  const endedAt = new Date(tripData.ended_at);
  const now = new Date();
  const minutesSinceEnd = (now - endedAt) / 60000;

  if (minutesSinceEnd > RESUME_WINDOW_MINUTES) {
    throw new Error(`Cannot resume trip - ended more than ${RESUME_WINDOW_MINUTES} minutes ago`);
  }

  // Resume: set status back to active, clear summary fields
  await db.query(
    `UPDATE trips SET
      status = 'active',
      ended_at = NULL,
      start_lat = NULL, start_lon = NULL,
      end_lat = NULL, end_lon = NULL,
      distance_nm = NULL, duration_minutes = NULL,
      avg_sog = NULL, max_sog = NULL,
      updated_at = NOW()
    WHERE id = $1`,
    [tripId]
  );

  return { success: true, message: 'Trip resumed' };
}
```

**UI requirement:** Stop button should show confirmation dialog: "End trip? This will finalize statistics."

---

## 9. Data Flow Timeline

```
USER                    RENDER                  SUPABASE                PI
  │                        │                        │                    │
  │  [Begin Trip]          │                        │                    │
  │───────────────────────>│                        │                    │
  │                        │  INSERT trip           │                    │
  │                        │  status='active'       │                    │
  │                        │───────────────────────>│                    │
  │                        │                        │                    │
  │                        │                        │   (polls every 30s)│
  │                        │                        │<───────────────────│
  │                        │                        │   "active trip!"   │
  │                        │                        │                    │
  │                        │                        │   SignalK → SQLite │
  │                        │                        │   SQLite → Supabase│
  │                        │                        │<───────────────────│
  │                        │                        │     (every 2 min)  │
  │                        │                        │                    │
  │                        │   Weather job          │                    │
  │                        │   (every 15 min)       │                    │
  │                        │───────────────────────>│                    │
  │                        │   INSERT weather       │                    │
  │                        │                        │                    │
  │  [Save Sail Config]    │                        │                    │
  │───────────────────────>│                        │                    │
  │                        │  Get latest position   │                    │
  │                        │  INSERT sail_event     │                    │
  │                        │───────────────────────>│                    │
  │                        │                        │                    │
  │  [Stop Trip]           │                        │                    │
  │───────────────────────>│                        │                    │
  │                        │  Compute summary       │                    │
  │                        │  UPDATE trip           │                    │
  │                        │  status='completed'    │                    │
  │                        │───────────────────────>│                    │
  │                        │                        │                    │
  │                        │                        │   (polls)          │
  │                        │                        │<───────────────────│
  │                        │                        │   "no active trip" │
  │                        │                        │   stops collecting │
  │                        │                        │                    │
```

---

## 10. Storage Estimates

### Per Trip (3 hour sail)

| Table | Records | Est. Size |
|-------|---------|-----------|
| trip_telemetry | 90 (every 2 min) | ~450 KB |
| trip_weather | 12 (every 15 min) | ~24 KB |
| trip_sail_events | ~5 | ~2 KB |
| trip_comments | ~3 | ~1 KB |
| **Total per trip** | | **~500 KB** |

### Extrapolated

| Usage | Storage |
|-------|---------|
| 10 trips | ~5 MB |
| 50 trips | ~25 MB |
| 100 trips | ~50 MB |

Very manageable. Delete old trips to reclaim space.

---

## 11. Implementation Order

### Phase 1: Database & Pi Collector
1. Create Supabase tables (SQL above)
2. Deploy Pi collector script with SQLite outbox
3. Test: manually insert active trip, verify telemetry flows

### Phase 2: Basic UI
4. Create `/trips` page with Begin/Stop
5. Wire up trip start/stop API (including summary computation)
6. Test end-to-end flow

### Phase 3: Sail Events
7. Add sail configuration UI
8. Create sail event API (with server-side position fill)
9. Record sail changes

### Phase 4: Weather
10. Add weather collection background job
11. Fetch Open-Meteo data during trips

### Phase 5: Trip Review
12. Create trip detail page
13. Add map with simplified track
14. Show summary stats
15. Add comments feature
16. Add title editing

### Phase 6: Polish
17. Trip list with search/filter and pagination
18. Export trip data (GPX?)
19. Graphs (speed, wind over time)

---

## 12. Decisions Made

| Question | Decision |
|----------|----------|
| Trip title | Auto-generate "Trip - {date}", user can override |
| Multiple active trips | Prevent - only one active trip allowed |
| Offline mode | SQLite outbox on Pi, auto-backfill |
| Engine hours | Derive from maintenance tables later (not in trip tracking) |
| Crew log | Not needed for now |
| Sail event position | Server-side auto-fill from latest telemetry |
| Track simplification | Sample every 5th point for map display |
| Data types | DOUBLE PRECISION for all lat/lon/speed fields |
| Accidental stop | Confirm dialog + resume within 30 min window |
| Table validation | Pi validates tables exist before starting |

---

## 13. Files to Create

### Render (Main App)
- `src/routes/trips/trips.route.js` - API endpoints
- `src/routes/trips/index.js` - Router mount
- `src/services/trips/trips.service.js` - Business logic
- `src/services/trips/weather-collector.service.js` - Open-Meteo integration
- `src/public/trips.html` - Trip control page
- `src/public/trip-detail.html` - Trip review page
- `src/public/js/trips/trips.js` - Frontend JS

### Pi
- `trip-collector/trip-collector.js` - Main collector script (with outbox)
- `trip-collector/package.json` - Dependencies
- `trip-collector/.env` - Configuration

---

**Document Version:** 1.5
**Last Updated:** 2025-11-29 (ALL PHASES COMPLETE - Pi Collector tested and working)
