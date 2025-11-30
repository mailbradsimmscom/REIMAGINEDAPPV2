# Position Monitor Feature

**Date:** 2025-11-30
**Status:** Complete
**Branch:** Stable-v4-Working

---

## Overview

A simple position monitoring page that compares current GPS coordinates against a saved reference point. The user sets an expectation ("less" or "more") and the icon turns green if both lat/long match that expectation, or red if they're mismatched.

**Use case:** Quick visual check to see if the boat has drifted consistently in one direction from a reference point.

---

## How It Works

1. **Set Reference:** User can fill in current position or manually enter lat/long, then save
2. **Set Expectation:** Toggle between "Less" or "More"
3. **Monitor:** Page continuously compares current position to reference
4. **Status Indicator:**
   - **Green:** Both lat AND long match expectation (both less, or both more than reference)
   - **Red:** Mismatch (one less, one more - inconsistent drift)
   - **Neutral:** No reference set

---

## Files Created/Modified

### New Files

**`src/public/position-monitor.html`**

Features:
- Current position display (3 decimal places, auto-updating via geolocation)
- Reference position input fields (editable)
- "Fill Current" button to populate fields with current GPS
- "Save" button to store reference to localStorage
- "Less/More" toggle to set drift expectation
- Status indicator showing green/red/neutral based on comparison
- Comparison details showing each coordinate's status
- Mobile navigation footer included
- State persisted in localStorage (`positionMonitor` key)

### Modified Files

**`src/public/unified-mobile.html`**

Changes:
- Replaced "Coming Soon" placeholder (line 370) with Position Monitor link
- Added `updatePositionMonitorStatus()` function to update icon color
- Icon states:
  - `📍` - No reference set or geolocation unavailable
  - `🟢` - Both coordinates match expectation
  - `🔴` - Coordinates mismatch
- Status updates every 30 seconds automatically

---

## localStorage Schema

```javascript
localStorage.setItem('positionMonitor', JSON.stringify({
  reference: {
    lat: 25.123,    // Reference latitude (3 decimals)
    lon: -80.456    // Reference longitude (3 decimals)
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
3. Allow location access when prompted
4. Tap "Fill Current" to populate reference fields
5. Tap "Save" to store reference
6. Select "Less" or "More" expectation
7. Status indicator shows green/red based on drift direction
8. Return to home page - icon should reflect current status

---

## UI/UX Notes

- Uses same iOS-style design language as other mobile pages
- Cards with rounded corners and subtle shadows
- Color coding: Blue for "less", Orange for "more"
- Status indicator uses colored dots and background tints
- Mobile navigation footer included for consistent navigation
- Back link to return to home page

---

## No Backend Required

This feature is entirely client-side:
- Uses browser Geolocation API
- State stored in localStorage
- No database tables needed
- No API endpoints required
