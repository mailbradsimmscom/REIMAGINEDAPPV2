# Position Monitor Feature

**Date:** 2025-11-30
**Status:** Complete
**Branch:** Agent-Enablement

---

## Overview

A simple position monitoring page that compares current GPS coordinates against a saved reference point. The user sets an expectation ("less" or "more") and the icon turns green if both lat/long match that expectation, or red if they're mismatched.

**Use case:** Quick visual check to see if the boat has drifted consistently in one direction from a reference point.

---

## How It Works

1. **Set Reference:** User can fill in current position or manually enter lat/long, then save
2. **Set Expectation:** Toggle between "Less" or "More"
3. **Monitor:** Page continuously compares current position to reference (polls every 5 seconds)
4. **Status Indicator:**
   - **Green:** Both lat AND long match expectation (both less, or both more than reference)
   - **Red:** Mismatch (one less, one more - inconsistent drift)
   - **Neutral:** No reference set

---

## Coordinate Display Format

Position is displayed in **Degrees and Decimal Minutes (DDM)** format, matching B&G MFD displays:

```
N 13°17.773'    (Latitude)
W 61°14.135'    (Longitude)
```

This is converted from decimal degrees (e.g., `13.2961976, -61.235688`) using:
- Degrees = floor(abs(value))
- Minutes = (abs(value) - degrees) * 60
- Direction: N/S for latitude, E/W for longitude

---

## Files Created/Modified

### New Files

**`src/routes/gps.route.js`**

Simple public API endpoint for GPS position:
- `GET /api/gps/current` - Returns latest GPS position from Supabase `gps_position` table
- No authentication required
- Returns: latitude, longitude, timestamp, speed_over_ground, course_over_ground

**`src/public/position-monitor.html`**

Features:
- Current position display in DDM format (matching B&G MFD style)
- Reference position input fields (decimal degrees, editable)
- "Fill Current" button to populate fields with current GPS
- "Save" button to store reference to localStorage
- "Less/More" toggle to set drift expectation
- Status indicator showing green/red/neutral based on comparison
- Comparison details showing each coordinate's status
- Polls GPS API every 5 seconds for updates
- Mobile navigation footer included
- State persisted in localStorage (`positionMonitor` key)

### Modified Files

**`src/app.js`**

Changes:
- Added import for `gpsRouter` from `./routes/gps.route.js`
- Added route registration: `app.use('/api/gps', gpsRouter);`

**`src/public/unified-mobile.html`**

Changes:
- Replaced "Coming Soon" placeholder with Position Monitor link
- Updated `updatePositionMonitorStatus()` function to use GPS API instead of browser geolocation
- Icon states:
  - `📍` - No reference set or GPS unavailable
  - `🟢` - Both coordinates match expectation
  - `🔴` - Coordinates mismatch
- Status updates every 30 seconds automatically

---

## Data Source

GPS data comes from the boat's actual GPS hardware via the Supabase `gps_position` table:

```javascript
// API Response
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

This is the same GPS data used by the anchor watch feature, populated by the RPi GPS collector.

---

## localStorage Schema

```javascript
localStorage.setItem('positionMonitor', JSON.stringify({
  reference: {
    lat: 13.296198,    // Reference latitude (decimal degrees)
    lon: -61.235688    // Reference longitude (decimal degrees)
  },
  expectation: 'less'  // 'less' or 'more'
}));
```

---

## Status Logic

```
If expectation = "less":
  - Green if: current_lat < ref_lat AND current_lon < ref_lon
  - Red if: one is less, one is more

If expectation = "more":
  - Green if: current_lat > ref_lat AND current_lon > ref_lon
  - Red if: one is more, one is less
```

---

## Testing

1. Go to http://localhost:3000/public/unified-mobile.html
2. Tap the "Position" quick action card
3. GPS data loads automatically from boat's GPS
4. Tap "Fill Current" to populate reference fields
5. Tap "Save" to store reference
6. Select "Less" or "More" expectation
7. Status indicator shows green/red based on drift direction
8. Return to home page - icon should reflect current status

Test the API directly:
```bash
curl http://localhost:3000/api/gps/current | jq .
```

---

## UI/UX Notes

- Uses same iOS-style design language as other mobile pages
- Coordinates displayed in B&G MFD style (DDM format)
- Monospace font for coordinate display
- Cards with rounded corners and subtle shadows
- Color coding: Blue for "less", Orange for "more"
- Status indicator uses colored dots and background tints
- Mobile navigation footer included for consistent navigation
- Back link to return to home page

---

## Architecture

```
┌─────────────────────────┐
│  position-monitor.html  │
│  (Frontend)             │
└───────────┬─────────────┘
            │ fetch every 5s
            ↓
┌─────────────────────────┐
│  /api/gps/current       │
│  (gps.route.js)         │
└───────────┬─────────────┘
            │
            ↓
┌─────────────────────────┐
│  gps.repository.js      │
│  getCurrentPosition()   │
└───────────┬─────────────┘
            │
            ↓
┌─────────────────────────┐
│  Supabase               │
│  gps_position table     │
│  (populated by RPi)     │
└─────────────────────────┘
```
