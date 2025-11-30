# Position Monitor Feature

**Date:** 2025-11-30
**Status:** Complete
**Branch:** Stable-v4-Working

---

## Overview

A position monitoring page that compares current GPS coordinates against saved boundary limits. Each coordinate (lat/lon) has its own Less/More setting, allowing you to set independent boundary conditions.

**Use case:** Monitor if the boat stays within boundary limits. Set a reference position and configure whether each coordinate should stay less than or more than that limit.

---

## How It Works

1. **Set Reference:** Enter boundary limits in DDM format (N 13°17.775' / W 61°14.149') or click "Fill Current"
2. **Set Limits:** For each coordinate, choose "Less" or "More":
   - **Lat must be Less:** Alert if latitude exceeds the limit
   - **Lat must be More:** Alert if latitude drops below the limit
   - Same for Longitude
3. **Monitor:** Page polls GPS every 5 seconds
4. **Status:**
   - **Green (Within Limits):** Both coordinates satisfy their conditions
   - **Red (Outside Limits):** One or both coordinates violate their limits

---

## Coordinate Display Format

Position is displayed in **Degrees and Decimal Minutes (DDM)** format, matching B&G MFD displays:

```
N 13°17.775'    (Latitude)
W 61°14.135'    (Longitude)
```

Reference input also uses DDM format with:
- Direction dropdown (N/S for lat, E/W for lon)
- Degrees field
- Minutes field (to 3 decimal places)

---

## Example Use Case

Anchored at N 13°17.775' W 61°14.140', you don't want to drift:
- South of 17.774' latitude
- West of 14.149' longitude

Configure:
- **Reference:** N 13° 17.774' / W 61° 14.149'
- **Lat must be: More** (stay above 17.774')
- **Lon must be: Less** (stay below 14.149')

If you drift south of 17.774' OR west of 14.149', the status turns red.

---

## Files

### New Files

**`src/routes/gps.route.js`**
- `GET /api/gps/current` - Returns latest GPS position from Supabase
- Public endpoint (no auth required)

**`src/public/position-monitor.html`**
- DDM format display and input (matches B&G MFD)
- Separate Less/More toggle for each coordinate
- Polls GPS API every 5 seconds
- Mobile navigation footer included

### Modified Files

**`src/app.js`**
- Added GPS route: `app.use('/api/gps', gpsRouter);`

**`src/public/unified-mobile.html`**
- Position Monitor card with dynamic status icon
- Uses GPS API with separate lat/lon expectations

---

## Data Source

GPS data from boat's hardware via Supabase `gps_position` table:

```javascript
// GET /api/gps/current
{
  "success": true,
  "data": {
    "latitude": 13.2961976,
    "longitude": -61.235688,
    "timestamp": "2025-11-30T20:19:56.396+00:00",
    "speed_over_ground": 0.1,
    "course_over_ground": 4.5247
  }
}
```

---

## localStorage Schema

```javascript
localStorage.setItem('positionMonitor', JSON.stringify({
  reference: {
    lat: 13.296198,    // Decimal degrees (stored internally)
    lon: -61.235688
  },
  latExpectation: 'more',   // 'less' or 'more'
  lonExpectation: 'less'    // 'less' or 'more'
}));
```

---

## Comparison Logic

Compares **absolute values** (displayed numbers), not signed decimals:

```
latIsLess = |current_lat| < |reference_lat|
lonIsLess = |current_lon| < |reference_lon|

If latExpectation = 'less': latMatches = latIsLess
If latExpectation = 'more': latMatches = !latIsLess

Same for longitude.

Overall: Green if latMatches AND lonMatches, else Red.
```

---

## UI Layout

```
┌─────────────────────────────────┐
│     Position Monitor            │
│     ● Within Limits (green)     │
├─────────────────────────────────┤
│ CURRENT POSITION                │
│ N 13°17.774'                    │
│ W 61°14.137'                    │
│ Last update: 4:34 PM            │
├─────────────────────────────────┤
│ REFERENCE POSITION              │
│ Lat: [N ▼] [13] ° [17.774] '    │
│ Lon: [W ▼] [61] ° [14.149] '    │
│ [Fill Current]  [Save]          │
├─────────────────────────────────┤
│ BOUNDARY LIMITS                 │
│ Lat must be [Less][More]  ✓     │
│ Lon must be [Less][More]  ✓     │
└─────────────────────────────────┘
```

---

## Testing

1. Go to http://localhost:3000/public/position-monitor.html
2. Click "Fill Current" to populate reference
3. Click "Save" to store reference
4. Set Lat to "More" and Lon to "Less" (or as needed)
5. Status shows green if within limits
6. If boat drifts past either limit, status turns red

Test API:
```bash
curl http://localhost:3000/api/gps/current | jq .
```
