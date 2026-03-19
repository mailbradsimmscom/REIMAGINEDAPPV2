# Anchor Alarm

## Overview

The Anchor Alarm monitors boat position while at anchor and alerts if the boat drags. Runs on the main app with position monitoring via GPS, and can optionally run on a Raspberry Pi on the boat for always-on monitoring.

**Who uses it:** Boat owners at anchor
**Access:** `/anchor-watch-admin.html`, `/anchor-safe-box.html`, `/position-monitor.html`
**Last Updated:** 2026-03-02

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
│  2. Set Anchor Point (two methods)                              │
│     ├── A) "Smart Setup" - physics-based inference              │
│     │   └── Calls GET /admin/api/anchor-watch/safe-box          │
│     │   └── Infers anchor from wind direction + chain catenary  │
│     │   └── Sets radius from max observed swing + 5%            │
│     ├── B) "Calculate" - from scope, depth, and bearing         │
│     │   ├── Enter scope (chain/rode length in meters)           │
│     │   ├── Enter depth (water depth in meters)                 │
│     │   ├── Set bearing to anchor (compass or manual)           │
│     │   └── Client-side: Pythagorean + spherical trig           │
│     ├── Manually enter coordinates (supports DDM format)        │
│     └── Drag anchor marker on map to fine-tune                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Set Swing Radius                                            │
│     ├── Smart Setup pre-sets from observed data                 │
│     ├── Adjust via slider or drag radius handle on map          │
│     └── Slider max adjusts dynamically for large radii          │
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
│     ├── Status determined: safe or dragging (binary)            │
│     └── Alerts sent via Telegram and SMS (dragging only)        │
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
| **Safe Radius** | Max observed GPS-to-anchor distance + 5% (from Smart Setup) |
| **Scope** | Length of chain/rode deployed (meters) |
| **Depth** | Water depth at anchor (meters) |
| **Bearing** | Compass direction from boat to anchor (degrees) |
| **Horizontal Distance** | Ground distance to anchor: `sqrt(scope² - depth²)` |
| **Status** | `inactive`, `safe`, `dragging`, `gps_lost` |
| **Arc Coverage** | Degrees of wind direction observed — higher = more confidence |

---

## Smart Setup (2026-03-02)

### How It Works

Smart Setup uses physics-based inference to determine the anchor position and alarm radius from observed GPS data. One button replaces the old "Infer" method.

**The physics:**
1. Boat on anchor chain swings in an arc centered on the anchor
2. Each GPS position + wind direction → one estimate of anchor location (boat is downwind of anchor)
3. Horizontal chain reach computed via catenary formula (not straight line)
4. GPS antenna is at stern, so 50ft (15.24m) is added to reach the bow/chain attachment
5. Freeboard (1.7m) added to depth for total height in catenary calc
6. Low wind (<5kt) positions skipped — boat doesn't weathervane reliably
7. Median of all estimates = anchor position (resistant to outliers)
8. Max observed GPS-to-anchor distance + 5% = alarm radius

**After clicking Smart Setup:**
- Anchor marker appears at inferred position (draggable)
- Preview circle shows the computed safe radius
- Info panel displays: wind estimates used, confidence radius, arc coverage, safe radius
- Slider pre-set to computed radius (dynamic max accommodates large radii)
- Orange warning if arc coverage < 90° (limited wind directions observed)
- Click "Activate Anchor Watch" to start monitoring

### Smart Setup vs Calculate

| Aspect | **Smart Setup** | **Calculate** |
|--------|-----------------|---------------|
| Data source | All GPS positions since arrival at anchorage | Current GPS + nautical measurements |
| Inputs | None (automatic) | Scope, depth, bearing |
| Runs on | Server (`GET /safe-box`) | Client (browser only) |
| Sets radius | Yes (from observed swing) | No (manual slider) |
| Best for | After settling at anchor (1+ hours of data) | Immediate setup after dropping anchor |
| Accuracy | Excellent with diverse wind directions | Good if scope and depth are known |

### Safe Box Analysis Page

`/anchor-safe-box.html` provides detailed visualization of the anchor inference:
- Leaflet map with position dots (time-gradient coloring)
- Wind arrows color-coded by speed
- Swing circle (red dashed = safe radius, blue solid = max observed)
- Inferred anchor position with confidence radius
- Adjustable chain scope input
- "Apply to Anchor Watch" button

---

## Status Determination (2026-03-02)

Status is binary — inside the radius is safe, outside is dragging:

```javascript
determineStatus(distanceMeters, radiusMeters) {
  if (distanceMeters <= radiusMeters) return 'safe';
  return 'dragging';
}
```

| Status | Condition | Telegram | SMS |
|--------|-----------|----------|-----|
| safe | distance <= radius | Only on return from dragging | No |
| dragging | distance > radius | Yes | Yes |
| gps_lost | No GPS data | Yes | Yes |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  UI (Browser)                                                   │
│  ├── anchor-watch-admin.html (configure + monitor)              │
│  ├── anchor-safe-box.html (detailed analysis visualization)     │
│  └── position-monitor.html (simple position view)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Node.js Backend                                                │
│  ├── anchor-watch.service.js (status + safe-box inference)      │
│  ├── anchor-watch-alerts.service.js (alert polling)             │
│  ├── telegram.service.js (send Telegram alerts)                 │
│  ├── twilio.service.js (send SMS for critical alerts)           │
│  └── gps.repository.js (GPS data via gps_positions_summary_in_range RPC) │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ↓                    ↓                    ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Supabase       │  │  GPS Source     │  │  Alerts         │
│                 │  │                 │  │                 │
│  anchor_watch_  │  │  Device GPS or  │  │  Telegram: all  │
│  zones          │  │  Pi GPS         │  │  SMS: dragging  │
│  alerts         │  │                 │  │  + gps_lost     │
│  gps_position   │  │                 │  │                 │
│  anchorages     │  │                 │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Files & Locations

| Purpose | Path |
|---------|------|
| **Frontend** | |
| Anchor watch admin | `src/public/anchor-watch-admin.html` |
| Safe box analysis | `src/public/anchor-safe-box.html` |
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
| GET | `/admin/api/anchor-watch/safe-box` | Get physics-based anchor inference + swing circle |
| POST | `/admin/api/anchor-watch/activate` | Start monitoring |
| POST | `/admin/api/anchor-watch/deactivate` | Stop monitoring |
| PUT | `/admin/api/anchor-watch/radius` | Change swing radius |
| GET | `/admin/api/anchor-watch/positions` | Get positions with distances |
| POST | `/admin/api/anchor-watch/infer` | Calculate centroid (legacy) |

### Safe Box API Response Shape

```
GET /admin/api/anchor-watch/safe-box?interval=60

data.swingCircle = {
  centerLat, centerLon,        // Inferred anchor position
  maxSwingMeters,              // Max observed GPS-to-anchor distance
  safeRadiusMeters,            // maxSwingMeters + 5%
  arcCoverageDeg,              // Wind direction coverage in degrees
  arcStartDeg, arcEndDeg       // Arc boundaries
}

data.inferredAnchor = {
  latitude, longitude,         // Anchor position (same as swingCircle center)
  confidenceRadiusMeters,      // How tight the inference is
  estimateCount,               // Number of wind-qualified estimates used
  chainScopeMeters,            // Chain scope used (default 45m)
  gpsToBowMeters,              // GPS-to-bow offset (15.24m / 50ft)
  freeboardMeters,             // Freeboard height (1.7m)
  minWindKt                    // Minimum wind threshold (5kt)
}

data.downsampledPositions      // GPS positions used (1 per minute)
data.outlierPositions          // Count of outliers filtered (two-pass: physical cap + 2-sigma)
data.totalPositions            // Total raw GPS positions in range

// swingCircle is null when < 10 wind-qualified estimates
```

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

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANCHOR_WATCH_CENTROID_SAMPLES` | `20` | Positions for centroid calculation (legacy infer) |
| `ANCHOR_WATCH_STALE_THRESHOLD_SEC` | `300` | GPS stale after 5 min |
| `TELEGRAM_BOT_TOKEN` | - | For Telegram alerts |
| `TELEGRAM_CHAT_ID` | - | Telegram alert recipient |
| `TWILIO_ACCOUNT_SID` | - | For SMS alerts |
| `TWILIO_AUTH_TOKEN` | - | Twilio auth |
| `TWILIO_PHONE_NUMBER` | - | SMS sender number |
| `ALERT_PHONE_NUMBER` | - | SMS recipient |

**Deprecated** (still in env but no longer used by `determineStatus`):
| `ANCHOR_WATCH_SAFE_RATIO` | `0.7` | Previously: safe zone threshold |
| `ANCHOR_WATCH_WARNING_RATIO` | `0.9` | Previously: warning zone threshold |

---

## Alert Flow

```
1. anchor-watch-alerts.service.js polls every 20 seconds
     │
     ▼
2. Calls anchorWatchService.getStatus()
     │
     ├── distance <= radius → 'safe'
     └── distance > radius  → 'dragging'
     │
     ▼
3. On status change:
     ├── safe → dragging: Telegram + SMS
     ├── dragging → safe: Telegram ("Anchor holding")
     └── GPS lost: Telegram + SMS
     │
     ▼
4. Periodic "all good" update every 30 minutes (when safe)
```

---

## Boat Constants (for Smart Setup inference)

| Constant | Value | Description |
|----------|-------|-------------|
| GPS_TO_BOW_M | 15.24 (50ft) | Distance from GPS antenna (stern) to bow roller |
| FREEBOARD_M | 1.7 | Waterline to bow roller height |
| MIN_WIND_KT | 5 | Skip positions with wind below this |
| Default chain scope | 45m | Used internally by safe-box when no scope param |
| MAX_SWING_M | scope + 20m | Physical cap for GPS outlier rejection |

## GPS Outlier Filtering (Safe Box)

Two-pass approach to remove bad GPS fixes:

1. **Pass 1 — Physical cap**: Compute median center (resistant to outliers), drop any point more than `chain_scope + 20m` from it. This catches wild GPS jumps that are physically impossible.
2. **Pass 2 — 2-sigma**: On the remaining clean data, compute mean distance + 2×stdDev from median center, drop points beyond that cutoff. This catches moderate outliers that survived pass 1.

The physical cap adapts to the chain scope input from the UI (e.g., 45m scope → 65m cap).

---

## Position Monitor Enhancements (2026-01-17)

The `/position-monitor.html` page includes:

- **Wind Speed** and **True Wind Direction** cards (update every 5 seconds)
- **Boundary Limits** — set position boundaries for drift monitoring with Less/More/Ignore toggles

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

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Requires Pi" | **No.** Works from main app with device GPS |
| "Real-time GPS always on" | **No.** Polls at intervals |
| "Runs locally" | **No.** Alert service only runs in production |
| "Auto-sets anchor" | **No.** User must click Smart Setup or Calculate |
| "Chain scope needed for alarm" | **No.** Alarm radius is from observed swing, not theoretical |
| "SMS for all alerts" | **No.** SMS only for dragging/gps_lost (critical) |
| "Warning before dragging" | **No.** Status is binary: safe or dragging |

---

## Related Docs

- [Anchorages](./anchorages.md) - Historical anchorage log
- [Trips](./trips.md) - Trip logging with GPS
- [Weather](./weather.md) - Weather monitoring
