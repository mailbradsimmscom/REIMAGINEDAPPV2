# Journey Planner

Weather-optimized route planning for sailing passages.

## Overview

A Journey is a macro sailing plan from start to finish (e.g., "USVI to PR"). The system generates route options using AI, scores them against weather forecasts across multiple departure windows, and recommends the best combination of route and timing.

## User Flow

### Planning State

1. **Create Journey** — Tap map for start and end points, enter a title
2. **AI Route Generation** — GPT-5.4 generates up to 5 route options with Caribbean/US East Coast sailing knowledge
3. **Select Routes** — Pick up to 3 routes for comparison
4. **Set Departure** — Choose earliest departure date/time; system generates 6 windows (12hr intervals over 3 days)
5. **Score Scenarios** — System fetches Open-Meteo weather for all waypoints, scores each route x window combination (up to 18 scenarios)
6. **Compare** — Grid view with color-coded scores. AI recommendation highlights best option.

### Begin Journey

- Click "Begin Journey" from the scoring grid to start a trip linked to the chosen route
- Order: trip starts first (main app), then journey transitions to sailing state

### Sailing State

- Forward weather view shows scored waypoints ahead with ETAs based on live GPS + SOG
- Auto-refreshes every 5 minutes
- "Complete Journey" transitions to completed state

## Scoring Algorithm

4 components, 100 points total:

| Component | Points | Logic |
|-----------|--------|-------|
| Wind | 35 | <=15kt = 35, 15-25kt linear to 0, >=25kt = 0 |
| Wave + Period | 35 | Effective wave (height * sqrt(7/period)): <=1.5m = 35, 1.5-2.5m linear to 0, >=2.5m = 0 |
| Sea Direction | 15 | Swell vs sailing bearing: Reaching=15, Broad Reach=13, Beam=10, Close Hauled=7, Opposing=5 |
| Current | 15 | Current vs sailing bearing: Following=15, None=8, Opposing=0 |

**Overall journey score:** `0.6 * average + 0.4 * worst_waypoint`

Server-side implementation: `maintenance-agent/src/utils/scoring.js`
Frontend implementation: `src/public/weather-area-view.html` scoreTimeBlock() (lines 581-701)

## Weather Data

- **Source:** Open-Meteo only (free, unlimited)
- **Forecast API:** Wind speed (km/h, converted to knots), direction, gusts
- **Marine API:** Wave height, period, swell height/direction, wind wave height, ocean currents
- **Deduplication:** Waypoints rounded to 0.01 degrees (~1km) to avoid redundant fetches
- **Coverage:** 7-day forecast — one fetch per waypoint covers all 6 departure windows

## Pages

| Page | URL | Purpose |
|------|-----|---------|
| Journey Planner | `/public/journey-plan.html` | Create, view routes, score, begin |
| Sailing Dashboard | `/public/journey-sailing.html?id=<uuid>` | Forward weather, map, complete |

## API Endpoints

All endpoints on maintenance-agent at `/api/journey`.

### Journey CRUD

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/journey` | Create journey (auto-generates routes) |
| GET | `/api/journey` | List journeys (`?status=planning\|sailing\|completed`) |
| GET | `/api/journey/:id` | Get journey with routes and scenarios |
| PUT | `/api/journey/:id` | Update journey fields |
| DELETE | `/api/journey/:id` | Delete journey (planning state only) |

### Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/journey/:id/routes` | Add a route manually |
| POST | `/api/journey/:id/routes/generate` | Re-generate routes with AI |
| PUT | `/api/journey/:id/routes/select` | Select routes for comparison (max 3). Body: `{ routeIds: ["uuid"] }` |

### Scoring

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/journey/:id/score` | Score scenarios. Body: `{ earliest_departure: "ISO8601" }` |
| GET | `/api/journey/:id/scenarios` | Get all scored scenarios |
| GET | `/api/journey/:id/scenarios/:scenarioId` | Waypoint-by-waypoint breakdown |

### Sailing

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/journey/:id/ahead` | Forward weather. Query: `?lat=X&lon=Y&sog=Z` |

### State Transitions

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/journey/:id/begin` | Planning to sailing. Body: `{ route_id, departure_time, trip_id }` |
| POST | `/api/journey/:id/complete` | Sailing to completed |

## Database Tables

- `journeys` — Journey records with start/end coords, status, selected route/departure
- `journey_routes` — Route options per journey (waypoints as JSONB, distance, duration)
- `journey_scenarios` — Scored scenarios (route x departure window, waypoint_scores JSONB)
- `trips.journey_id` — Nullable FK linking a trip to its journey

## Key Files

| File | Purpose |
|------|---------|
| `maintenance-agent/src/services/journey.service.js` | All business logic |
| `maintenance-agent/src/routes/journey.route.js` | API endpoints with Zod validation |
| `maintenance-agent/src/repositories/journey.repository.js` | Supabase operations |
| `maintenance-agent/src/utils/scoring.js` | Server-side scoring (canonical) |
| `maintenance-agent/src/utils/scoring.test.js` | Golden scoring tests (8 fixtures) |
| `maintenance-agent/src/utils/waypoint-validation.js` | Route validation, haversine, water check |
| `src/public/journey-plan.html` | Planning UI |
| `src/public/journey-sailing.html` | Sailing dashboard |
| `src/public/js/trips/trips.js` | Trip start with journey selection |
