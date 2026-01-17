# Anchor Alarm

## Overview

The Anchor Alarm monitors boat position while at anchor and alerts if the boat drags. Runs on the main app with position monitoring via GPS, and can optionally run on a Raspberry Pi on the boat for always-on monitoring.

**Who uses it:** Boat owners at anchor
**Access:** `/anchor-watch-admin.html`, `/position-monitor.html`
**Last Updated:** 2026-01-17

---

## User Flow

### Setting Anchor Watch

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Navigate to Anchor Watch Admin                              │
│     └── /anchor-watch-admin.html                                │
│     └── Map auto-centers on current GPS position                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Set Anchor Point                                            │
│     ├── Click "Infer Anchor Position" (centroid of last 20 GPS) │
│     ├── Manually enter coordinates (supports 17.04.446 format)  │
│     └── Drag anchor marker on map to fine-tune                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Set Swing Radius                                            │
│     ├── Enter radius in meters                                  │
│     └── Or drag radius handle on map                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Activate Watch                                              │
│     └── POST /admin/api/anchor-watch/activate                   │
│     └── Creates anchor_watch_zones record                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Monitoring Active                                           │
│     ├── getStatus() called periodically                         │
│     ├── Distance calculated: current pos → anchor point         │
│     ├── Status determined: safe / warning / dragging            │
│     └── Alerts sent via Telegram and SMS (critical only)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

| Term | Definition |
|------|------------|
| **Anchor Point** | Center of the watch zone (lat/lon) |
| **Swing Radius** | Maximum allowed drift (meters) |
| **Current Position** | Latest GPS coordinates |
| **Drift Distance** | Haversine distance from anchor point |
| **Centroid** | Average of recent positions (for anchor calculation) |
| **Status** | `inactive`, `safe`, `warning`, `dragging`, `gps_lost` |

---

## Recent Changes (2026-01-17)

### Position Monitor Enhancements

The `/position-monitor.html` page now includes:

#### Wind Data Display
- **Wind Speed** card showing true wind speed in knots
- **True Wind Direction** card showing wind direction in degrees
- Both update every 5 seconds along with GPS position

#### Boundary Limits Feature
Allows setting position boundaries for drift monitoring:

1. **Fill Current** - Copies current GPS position to reference fields
2. **Save** - Saves reference position (shows "Saved!" confirmation)
3. **Boundary Limits** section displays saved reference coordinates
4. **Less/More/Ignore** toggles for each coordinate:
   - **Less**: Current position must be less than reference
   - **More**: Current position must be more than reference
   - **Ignore**: Coordinate is not checked
5. **Status indicator** at top shows green (within limits) or red (outside limits)

```
┌─────────────────────────────────────────────────────────────────┐
│  Position Monitor Layout                                         │
├─────────────────────────────────────────────────────────────────┤
│  [Status: Within Limits / Outside Limits / No Reference Set]    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  CURRENT POSITION                                        │    │
│  │  N 17°8.769'  /  W 61°45.942'                           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌───────────────────────┐  ┌───────────────────────┐          │
│  │  WIND SPEED           │  │  TRUE WIND DIRECTION  │          │
│  │  23.1 kt              │  │  86°                  │          │
│  └───────────────────────┘  └───────────────────────┘          │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  REFERENCE POSITION                                      │    │
│  │  [N/S] [deg] ° [min] '   [Fill Current] [Save]          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  BOUNDARY LIMITS                                         │    │
│  │  Lat  N 17°8.777'  [Less] [More] [Ignore]  ✓            │    │
│  │  Lon  W 61°45.943' [Less] [More] [Ignore]  ✓            │    │
│  │                              [Save]                      │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Previous Changes (2026-01-09)

### 1. Map Centers on Current GPS When No Alarm Set

Previously, opening the page with no alarm set showed a world view (0,0). Now:

```javascript
// In initMap() - anchor-watch-admin.html
async function initMap() {
  const statusResult = await apiCall('/status');

  if (statusResult.data.current_lat && statusResult.data.current_lon) {
    // Use position from status (when alarm active)
    initialCenter = [statusResult.data.current_lat, statusResult.data.current_lon];
  } else {
    // No alarm set - fetch GPS directly
    const gpsResponse = await fetch('/api/gps/current');
    const gpsResult = await gpsResponse.json();
    if (gpsResult.success && gpsResult.data) {
      initialCenter = [gpsResult.data.latitude, gpsResult.data.longitude];
    }
  }
}
```

### 2. Coordinate Input Accepts B&G Format

Users can now enter coordinates in degrees.minutes.decimal format directly from their chartplotter:

```javascript
// parseCoordinate() in anchor-watch-admin.html
// Input: "17.04.446" (17° 04.446')
// Output: 17.0741 (decimal degrees)

function parseCoordinate(input) {
  const str = input.toString().trim();
  const isNegative = str.startsWith('-');
  const absStr = isNegative ? str.substring(1) : str;

  // Count dots to detect format
  const dotCount = (absStr.match(/\./g) || []).length;

  let result;
  if (dotCount === 2) {
    // Format: degrees.minutes.decimal (e.g., 17.04.446 = 17° 04.446')
    const parts = absStr.split('.');
    const degrees = parseInt(parts[0], 10);
    const minutes = parseFloat(parts[1] + '.' + parts[2]);
    result = degrees + (minutes / 60);
  } else {
    // Standard decimal format (e.g., 17.0741)
    result = parseFloat(absStr);
  }

  return isNegative ? -result : result;
}
```

**Examples:**
- `17.04.446` → `17.0741°` (17° 04.446' N)
- `-61.53.788` → `-61.8965°` (61° 53.788' W)

### 3. SMS Alerts Only for Critical Status

SMS via Twilio now only sends for truly critical alerts, not warnings:

```javascript
// anchor-watch-alerts.service.js
// OLD: const isCritical = ['warning', 'dragging', 'gps_lost'].includes(status.status);
// NEW:
const isCritical = ['dragging', 'gps_lost'].includes(status.status);
```

| Status | Telegram | SMS (Twilio) |
|--------|----------|--------------|
| safe → warning | Yes | **No** |
| warning → dragging | Yes | Yes |
| GPS lost | Yes | Yes |
| Periodic (30 min) | Yes | No |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  UI (Browser)                                                   │
│  ├── anchor-watch-admin.html (configure)                        │
│  └── position-monitor.html (view)                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Node.js Backend                                                │
│  ├── anchor-watch.service.js (status calculation)               │
│  ├── anchor-watch-alerts.service.js (alert polling)             │
│  ├── telegram.service.js (send Telegram alerts)                 │
│  ├── twilio.service.js (send SMS for critical alerts)           │
│  └── gps.repository.js (GPS data)                               │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ↓                    ↓                    ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Supabase       │  │  GPS Source     │  │  Alerts         │
│                 │  │                 │  │                 │
│  anchor_watch_  │  │  Device GPS or  │  │  Telegram: all  │
│  zones          │  │  Pi GPS         │  │  SMS: critical  │
│  alerts         │  │                 │  │  only           │
│  gps_position   │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Status Calculation (anchor-watch.service.js)

### Configuration (from env)

```javascript
class AnchorWatchService {
  constructor() {
    this.safeRatio = parseFloat(env.ANCHOR_WATCH_SAFE_RATIO);       // 0.7
    this.warningRatio = parseFloat(env.ANCHOR_WATCH_WARNING_RATIO); // 0.9
    this.centroidSamples = parseInt(env.ANCHOR_WATCH_CENTROID_SAMPLES); // 20
    this.staleThresholdSec = parseInt(env.ANCHOR_WATCH_STALE_THRESHOLD_SEC); // 300
  }
}
```

### Haversine Distance Calculation

```javascript
calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;  // Distance in meters
}
```

### Status Determination

```javascript
determineStatus(distanceMeters, radiusMeters) {
  const ratio = distanceMeters / radiusMeters;
  if (ratio <= this.safeRatio) return 'safe';      // ≤70% of radius
  if (ratio <= this.warningRatio) return 'warning'; // 70-90% of radius
  return 'dragging';                                 // >90% of radius
}
```

### Get Status (Main Function)

```javascript
async getStatus() {
  // 1. Get active zone from database
  const zone = await supabase.from('anchor_watch_zones')
    .select('*').eq('is_active', true).single();

  if (!zone) return { active: false, status: 'inactive' };

  // 2. Get current GPS position
  const currentPosition = await gpsRepository.getCurrentPosition();

  if (!currentPosition) return { active: true, status: 'gps_lost' };

  // 3. Check if GPS data is stale
  const positionAge = (Date.now() - new Date(currentPosition.timestamp).getTime()) / 1000;
  if (positionAge > this.staleThresholdSec) {
    requestLogger.warn('GPS data is stale', { age_seconds: positionAge });
  }

  // 4. Calculate distance from anchor
  const distance = this.calculateDistance(
    currentPosition.latitude, currentPosition.longitude,
    zone.center_lat, zone.center_lng
  );

  // 5. Determine status
  const status = this.determineStatus(distance, zone.radius_meters);

  // 6. Create alert if dragging
  if (status === 'dragging') {
    await this.createAlertIfNeeded(zone.zone_id, 'anchor_drag', currentPosition, distance);
  }

  return {
    active: true,
    anchor_lat: zone.center_lat,
    anchor_lon: zone.center_lng,
    radius_meters: zone.radius_meters,
    current_lat: currentPosition.latitude,
    current_lon: currentPosition.longitude,
    distance_meters: Math.round(distance * 100) / 100,
    status: status,
    last_updated: currentPosition.timestamp
  };
}
```

### Centroid Calculation (for Setting Anchor)

```javascript
async calculateCentroid() {
  const positions = await gpsRepository.getRecentPositions(this.centroidSamples);

  const sum = positions.reduce((acc, pos) => ({
    lat: acc.lat + pos.latitude,
    lon: acc.lon + pos.longitude
  }), { lat: 0, lon: 0 });

  return {
    latitude: sum.lat / positions.length,
    longitude: sum.lon / positions.length,
    sample_size: positions.length
  };
}
```

---

## Files & Locations

| Purpose | Path |
|---------|------|
| **Frontend** | |
| Anchor watch admin | `src/public/anchor-watch-admin.html` |
| Position monitor | `src/public/position-monitor.html` |
| **Backend** | |
| Main service | `src/services/anchor-watch.service.js` |
| Alert polling service | `src/services/anchor-watch-alerts.service.js` |
| Telegram service | `src/services/telegram.service.js` |
| Twilio SMS service | `src/services/twilio.service.js` |
| GPS repository | `src/repositories/gps.repository.js` |
| GPS route | `src/routes/gps.route.js` |
| Admin route | `src/routes/admin/anchor-watch.route.js` |
| **Pi (Optional)** | |
| Pi scripts | `pi/home/brad/Code/` |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/gps/current` | Get current GPS position (no auth required) |
| GET | `/admin/api/anchor-watch/status` | Get watch status |
| POST | `/admin/api/anchor-watch/activate` | Start monitoring |
| POST | `/admin/api/anchor-watch/deactivate` | Stop monitoring |
| PUT | `/admin/api/anchor-watch/radius` | Change swing radius |
| GET | `/admin/api/anchor-watch/positions` | Get positions with distances |
| POST | `/admin/api/anchor-watch/infer` | Calculate centroid |

---

## Database Tables

### anchor_watch_zones

| Column | Type | Description |
|--------|------|-------------|
| zone_id | uuid | Primary key |
| center_lat | numeric | Anchor latitude |
| center_lng | numeric | Anchor longitude |
| radius_meters | numeric | Swing radius |
| is_active | boolean | Currently active |
| activated_at | timestamp | When activated |
| deactivated_at | timestamp | When deactivated |
| created_at | timestamp | Record creation |

### anchor_watch_alerts

| Column | Type | Description |
|--------|------|-------------|
| alert_id | uuid | Primary key |
| zone_id | uuid | FK to zones |
| alert_type | text | `anchor_drag` |
| position_lat | numeric | Position when triggered |
| position_lng | numeric | Position when triggered |
| distance_meters | numeric | Drift distance |
| acknowledged | boolean | User acknowledged |
| details | jsonb | SOG, COG, etc. |
| created_at | timestamp | When created |

### gps_position

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| latitude | numeric | GPS latitude |
| longitude | numeric | GPS longitude |
| speed_over_ground | numeric | SOG (knots) |
| course_over_ground | numeric | COG (degrees) |
| true_wind_speed | numeric | Wind speed |
| true_wind_direction | numeric | Wind direction |
| timestamp | timestamp | Position time |
| source | text | `device` / `pi` / `manual` |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANCHOR_WATCH_SAFE_RATIO` | `0.7` | Safe zone threshold (70% of radius) |
| `ANCHOR_WATCH_WARNING_RATIO` | `0.9` | Warning zone threshold (90% of radius) |
| `ANCHOR_WATCH_CENTROID_SAMPLES` | `20` | Positions for centroid calculation |
| `ANCHOR_WATCH_STALE_THRESHOLD_SEC` | `300` | GPS stale after 5 min |
| `TELEGRAM_BOT_TOKEN` | - | For Telegram alerts |
| `TELEGRAM_CHAT_ID` | - | Telegram alert recipient |
| `TWILIO_ACCOUNT_SID` | - | For SMS alerts |
| `TWILIO_AUTH_TOKEN` | - | Twilio auth |
| `TWILIO_PHONE_NUMBER` | - | SMS sender number |
| `ALERT_PHONE_NUMBER` | - | SMS recipient |

---

## Status Zones (Visual)

```
                          Radius
            ◄───────────────────────────►

            ┌─────────────────────────────┐
            │                             │
            │       ┌───────────────┐     │  DRAGGING (>90%)
            │       │               │     │  🔴 Red - SMS + Telegram
            │       │   WARNING     │     │
            │       │   (70-90%)    │     │  ⚠️ Orange - Telegram only
            │       │   ┌───────┐   │     │
            │       │   │ SAFE  │   │     │
            │       │   │ (≤70%)│   │     │  ✅ Green
            │       │   │   ⚓   │   │     │  Anchor Point
            │       │   └───────┘   │     │
            │       └───────────────┘     │
            │                             │
            └─────────────────────────────┘
```

---

## Alert Flow

```
1. Status check determines 'dragging' or 'gps_lost'
     │
     ▼
2. anchor-watch-alerts.service.js detects status change
     │
     ├── Polls every 20 seconds
     ├── Checks if status changed from previous
     │
     ▼
3. Send Telegram alert (all status changes)
     │
     ├── "⚠️ ANCHOR ALARM"
     ├── "Status: DRAGGING"
     ├── "Drift: 45m (limit: 30m)"
     └── "Position: 17.0741° N, 61.8967° W"
     │
     ▼
4. Send SMS if critical (dragging or gps_lost only)
     │
     ├── Uses Twilio
     └── ~$0.0075 per message
```

---

## Production-Only Services

These only run when `NODE_ENV=production` (in `src/start.js`):

```javascript
if (env.NODE_ENV === 'production') {
  await telegramBotService.start();
  anchorWatchAlertsService.start();  // Polls for status changes
}
```

**Why:** Prevents multiple polling instances and Telegram bot conflicts when developers run locally.

---

## Testing

| Test File | What It Tests |
|-----------|---------------|
| `tests/integration/anchor-watch.test.js` | Anchor watch API |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Requires Pi" | **No.** Works from main app with device GPS |
| "Real-time GPS always on" | **No.** Polls at intervals |
| "Runs locally" | **No.** Alert service only runs in production |
| "Auto-sets anchor" | **No.** User must manually activate |
| "Stores all positions" | **No.** Rolling window, older positions pruned |
| "SMS for all alerts" | **No.** SMS only for dragging/gps_lost (critical) |

---

## Related Docs

- [Anchorages](./anchorages.md) - Historical anchorage log
- [Trips](./trips.md) - Trip logging with GPS
- [Weather](./weather.md) - Weather monitoring
