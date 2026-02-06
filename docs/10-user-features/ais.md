# AIS (Automatic Identification System)

## Overview

AIS provides real-time tracking of nearby vessels using AIS radio data. The feature has two modes: **Around Us** (all vessels sorted by distance) and **Friends** (curated list of tracked vessels with last-seen history).

**Who uses it:** Boat owners and crew
**Access:** `/public/ais.html` (mobile-optimized, iOS native design)
**Data source:** AIS receiver feeding `ais_vessels` table (external process)

---

## User Flow

### Around Us Tab

```
1. Page loads → fetches GPS position from gps repository
2. Fetches all vessels from ais_vessels table
3. Calculates Haversine distance (nautical miles) from our position to each vessel
4. Sorts by distance (nearest first)
5. Marks vessels that are in ais_friends with red heart
6. Displays: vessel name, type badge, navigation state, distance, heart toggle
```

### Friends Tab

```
1. Fetches friends from ais_friends table
2. Cross-references with ais_vessels to check if friend is currently nearby
3. If nearby: shows live distance and updates last_seen position
4. If not nearby: shows "Last seen X ago at [coords]"
5. Manual add form: enter MMSI + vessel name
6. Heart button removes friend
```

### Friend Lifecycle

```
+------------------------------------------+
|  Vessel appears in AIS range             |
|  → Shows in Around Us tab                |
+------------------------------------------+
              |
              v (user taps heart)
+------------------------------------------+
|  POST /admin/api/ais/friends             |
|  → Saves MMSI, name, ship_type           |
|  → Sets initial last_seen if in range    |
+------------------------------------------+
              |
              v (friend moves out of range)
+------------------------------------------+
|  Friend no longer in ais_vessels         |
|  → Friends tab shows "Last seen X ago"   |
|  → Last known position preserved         |
+------------------------------------------+
              |
              v (friend returns to range)
+------------------------------------------+
|  Friend found in ais_vessels again       |
|  → Updates last_seen position            |
|  → Shows live distance in Friends tab    |
+------------------------------------------+
```

---

## Architecture

```
+----------------------------+
|  ais.html (frontend)       |
|  +-- js/ais.js             |
|  +-- js/mobile-hamburger.js|
+----------------------------+
            |
            v
+----------------------------+
|  ais.route.js (admin API)  |
|  GET  /admin/api/ais/around-us    → vessels + distances
|  GET  /admin/api/ais/friends      → friends + positions
|  POST /admin/api/ais/friends      → add friend
|  DELETE /admin/api/ais/friends/:mmsi → remove friend
+----------------------------+
            |
            v
+----------------------------+
|  ais.service.js            |
|  +-- calculateDistanceNm() (Haversine)
|  +-- getVesselsAroundUs()
|  +-- getFriendsWithPositions()
|  +-- addFriend()
|  +-- removeFriend()
+----------------------------+
            |
            v
+-------------------+  +-------------------+
|  ais.repository   |  |  gps.repository   |
|  +-- ais_vessels  |  |  +-- GPS position |
|  +-- ais_friends  |  +-------------------+
+-------------------+
```

---

## API Endpoints

### GET /admin/api/ais/around-us

Returns all AIS vessels sorted by distance from current GPS position.

**Response:**
```json
{
  "success": true,
  "data": {
    "ourPosition": {
      "latitude": 17.074,
      "longitude": -61.897,
      "timestamp": "2026-02-06T12:00:00Z"
    },
    "vessels": [
      {
        "mmsi": "338328718",
        "name": "Sea Breeze",
        "latitude": 17.075,
        "longitude": -61.898,
        "speed_over_ground": 4.2,
        "course_over_ground": 180,
        "ship_type": "Sailing",
        "navigation_state": "Under way using engine",
        "updated_at": "2026-02-06T11:59:30Z",
        "distance_nm": 0.12,
        "is_friend": true
      }
    ],
    "count": 15
  }
}
```

### GET /admin/api/ais/friends

Returns friends list enriched with live position data if vessel is nearby.

**Response:**
```json
{
  "success": true,
  "data": {
    "ourPosition": { "latitude": 17.074, "longitude": -61.897 },
    "friends": [
      {
        "mmsi": "338328718",
        "name": "Sea Breeze",
        "ship_type": "Sailing",
        "created_at": "2026-01-15T10:00:00Z",
        "is_nearby": true,
        "latitude": 17.075,
        "longitude": -61.898,
        "distance_nm": 0.12,
        "last_latitude": 17.075,
        "last_longitude": -61.898,
        "last_seen_at": "2026-02-06T12:00:00Z"
      }
    ],
    "count": 3
  }
}
```

### POST /admin/api/ais/friends

Add a vessel as a friend.

**Body:** `{ "mmsi": "338328718", "name": "Sea Breeze", "ship_type": "Sailing" }`
**Returns:** 201 with created friend record. 409 if already a friend.

### DELETE /admin/api/ais/friends/:mmsi

Remove a vessel from friends.

**Returns:** `{ "success": true, "data": { "mmsi": "338328718", "removed": true } }`

---

## Database Tables

### ais_vessels

Populated by an external AIS receiver process (not managed by this app). Contains live vessel position data.

| Column | Type | Description |
|--------|------|-------------|
| mmsi | text | Maritime Mobile Service Identity (unique vessel ID) |
| name | text | Vessel name |
| latitude | float | Current latitude |
| longitude | float | Current longitude |
| speed_over_ground | float | Speed in knots |
| course_over_ground | float | Course in degrees |
| ship_type | text | Vessel type (Sailing, Pleasure Craft, etc.) |
| navigation_state | text | Current state (Under way, At anchor, etc.) |
| updated_at | timestamptz | Last AIS position update |

### ais_friends

Managed by this feature. Stores curated friend vessels.

| Column | Type | Description |
|--------|------|-------------|
| mmsi | text PK | Friend's MMSI |
| name | text | Vessel name |
| ship_type | text | Vessel type |
| last_latitude | float | Last known latitude |
| last_longitude | float | Last known longitude |
| last_seen_at | timestamptz | When friend was last detected nearby |
| created_at | timestamptz | When added as friend |

---

## Distance Calculation

Uses Haversine formula with Earth radius = 3,440.065 nautical miles:

```javascript
// src/services/ais.service.js:19-32
calculateDistanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
```

---

## Files & Locations

| Purpose | Path |
|---------|------|
| Frontend page | `src/public/ais.html` |
| Client-side JS | `src/public/js/ais.js` |
| Route (admin-protected) | `src/routes/admin/ais.route.js` |
| Service (business logic) | `src/services/ais.service.js` |
| Repository (DB access) | `src/repositories/ais.repository.js` |
| GPS repository (position) | `src/repositories/gps.repository.js` |

---

## Design Notes

- **iOS native design:** SF Pro Display font, safe-area-inset padding, iOS color palette
- **Mobile-first:** Touch targets (44px heart buttons), overscroll-behavior: none
- **Type badges:** Color-coded by vessel type (blue=sailing, green=pleasure, orange=nearby)
- **Auto-refresh:** Data refreshes when switching tabs
- **Admin-protected:** All API calls require x-admin-token header
- **External data dependency:** `ais_vessels` table is populated by an external AIS receiver process, not by this application
