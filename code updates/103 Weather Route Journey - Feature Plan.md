# 103 Weather Route Journey — Feature Plan

**Date:** 2026-04-04
**Status:** Complete — All 5 phases implemented (2026-04-07)
**Priority:** Major new feature

---

## Concept

A **Journey** is a macro sailing plan from start to finish (e.g., "BVI to Antigua"). The system generates up to 5 route options, the user selects up to 3, picks an earliest departure date, and the system scores up to **18 scenarios** (6 departure windows × up to 3 routes) to recommend the best combination of route and timing. If the user selects fewer routes, the scenario count scales down accordingly (e.g., 1 route × 6 windows = 6 scenarios).

Once the user commits to a route and departs, the journey transitions from **planning** to **sailing** state, showing forward-looking weather along the remaining route based on the boat's live GPS position.

---

## Terminology

| Term | Definition |
|------|-----------|
| **Journey** | Macro start-to-finish plan (e.g., "BVI to Antigua") |
| **Route** | A specific path option within a journey, defined by waypoints |
| **Scenario** | A route + departure time combination, scored by weather conditions |
| **Departure Window** | 3-day window from earliest start, in 12-hour jumps (6 options) |
| **Planning State** | Evaluating routes and departure windows, can re-run as forecasts update |
| **Sailing State** | Committed to one route, showing forward weather from current GPS position |

---

## User Flow

### Planning State

```
1. CREATE JOURNEY
   └── User provides: start name/coords, finish name/coords

2. AI GENERATES ROUTES (up to 5)
   ├── Considers Caribbean geography, channels, island effects
   ├── Each route has: name, waypoints (lat/lon array), estimated distance_nm
   └── Shows routes on a map

3. USER SELECTS ROUTES (up to 3)
   └── Deselected routes are discarded

4. SET DEPARTURE
   ├── User picks earliest start date + time
   └── System generates 6 windows (12-hour jumps over 3 days)
       e.g., Fri 6am, Fri 6pm, Sat 6am, Sat 6pm, Sun 6am, Sun 6pm

5. SCORE SCENARIOS (up to 18)
   ├── For each route × departure window:
   │   ├── Simulate passage using estimated SOG
   │   ├── At each waypoint, determine estimated arrival time
   │   ├── Fetch weather forecast for that lat/lon at that time
   │   ├── Score using existing scoring engine (wind/wave/period/sea dir/current)
   │   └── Produce overall journey score (weighted average of waypoint scores)
   ├── Rank all scenarios
   └── AI generates summary recommendation

6. COMPARE & DECIDE
   ├── Grid view: routes (columns) × departure windows (rows)
   ├── Each cell shows overall score + key conditions
   ├── Can drill into any scenario for waypoint-by-waypoint breakdown
   └── Can re-run scoring as forecasts update (button or auto-refresh)
```

### Transition: Begin Journey

```
7. BEGIN JOURNEY
   ├── User selects one scenario (route + departure)
   ├── Journey state: planning → sailing
   ├── Triggered from the TRIP START page:
   │   ├── "Is this part of a journey?" → Yes
   │   ├── Select from planned journeys
   │   ├── Select which route
   │   └── Trip starts, journey begins
   ├── Other routes/scenarios become inactive
   └── Active trip is linked to the journey
```

### Sailing State

```
8. SAILING VIEW
   ├── System knows boat position from GPS (gps_position table)
   ├── Shows remaining route waypoints ahead
   ├── For each upcoming waypoint:
   │   ├── Estimate arrival time based on current SOG
   │   ├── Show forecast weather at that point and time
   │   └── Show score for that leg
   ├── Overall "what's ahead" summary
   └── Updates as boat progresses and forecasts refresh

9. JOURNEY COMPLETE
   ├── When trip stops and boat is near destination
   ├── Journey state: sailing → completed
   └── Historical record preserved
```

---

## Data Model

### New Tables

#### `journeys`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK, gen_random_uuid() |
| status | text | `planning` / `sailing` / `completed` |
| title | text | User-provided or auto-generated (e.g., "BVI to Antigua") |
| start_name | text | Start location name |
| start_lat | double precision | Start latitude |
| start_lon | double precision | Start longitude |
| end_name | text | End location name |
| end_lat | double precision | End latitude |
| end_lon | double precision | End longitude |
| earliest_departure | timestamptz | Earliest departure date/time |
| selected_route_id | uuid | FK to journey_routes (set when journey begins) |
| selected_departure | timestamptz | Chosen departure time (set when journey begins) |
| trip_id | uuid | FK to trips (set when journey begins) |
| created_at | timestamptz | now() |
| updated_at | timestamptz | now() |

#### `journey_routes`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| journey_id | uuid | FK to journeys |
| name | text | Route name (e.g., "Direct via Anegada Passage") |
| waypoints | jsonb | Array of `{lat, lon, name}` objects |
| distance_nm | double precision | Estimated total distance |
| estimated_duration_hrs | double precision | Based on estimated avg SOG |
| estimated_avg_sog | double precision | Used for time calculations |
| sort_order | integer | Display order |
| is_selected | boolean | User selected this route for comparison (max 3) |
| ai_description | text | AI-generated route description |
| created_at | timestamptz | now() |

#### `journey_scenarios`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| journey_id | uuid | FK to journeys |
| route_id | uuid | FK to journey_routes |
| departure_time | timestamptz | One of the 6 departure windows |
| overall_score | double precision | Weighted average score (0-100) |
| waypoint_scores | jsonb | Per-waypoint breakdown (see below) |
| ai_summary | text | AI-generated scenario summary |
| scored_at | timestamptz | When this scenario was last scored |
| forecast_staleness_hrs | double precision | How old the forecast data was when scored |
| created_at | timestamptz | now() |

**`waypoint_scores` JSON structure:**
```json
[
  {
    "waypoint_index": 0,
    "lat": 18.45,
    "lon": -64.62,
    "name": "Departure - BEYC",
    "estimated_arrival": "2026-04-07T06:00:00Z",
    "score": 82,
    "wind_score": 30,
    "wave_score": 28,
    "sea_dir_score": 13,
    "current_score": 11,
    "wind_kts": 14,
    "wave_m": 1.2,
    "effective_wave_m": 1.1,
    "period_s": 8,
    "wind_dir": "ENE",
    "sea_relation": "Broad Reach",
    "current_relation": "Following"
  }
]
```

### Modified Tables

#### `trips` — Add column

| Column | Type | Description |
|--------|------|-------------|
| journey_id | uuid | FK to journeys (nullable, only set when trip is part of a journey), ON DELETE SET NULL |

### FK and Ownership Rules

**Dual-link on "begin journey":** Both `journeys.trip_id` and `trips.journey_id` reference each other. To avoid drift:
- **`trips.journey_id` is authoritative** — this is what the main app reads to know "is this trip part of a journey?"
- **`journeys.trip_id`** is a convenience back-reference for querying "which trip is running this journey?"
- **Write order on begin:** Single transaction:
  1. Update `journeys` → set `status='sailing'`, `selected_route_id`, `selected_departure`, `trip_id`
  2. Update `trips` → set `journey_id`
  3. Commit

**ON DELETE behavior:**
- `journey_routes.journey_id` → ON DELETE CASCADE (routes belong to journey, delete together)
- `journey_scenarios.journey_id` → ON DELETE CASCADE (scenarios belong to journey)
- `journey_scenarios.route_id` → ON DELETE CASCADE (if route removed, its scenarios go too)
- `journeys.trip_id` → ON DELETE SET NULL (if trip somehow deleted, journey keeps its history)
- `trips.journey_id` → ON DELETE SET NULL (if journey deleted, trip stays intact)

**Soft delete:** Journeys in `completed` state are never hard-deleted — they're historical records. Hard delete is only allowed in `planning` state (user abandons a plan). The CASCADE on routes/scenarios makes this clean.

---

## Scoring Engine for Scenarios

Reuse the existing `scoreTimeBlock()` algorithm from `weather-area-view.html`, extracted to a shared/server-side module.

### Per-Waypoint Scoring

For each waypoint along a route at the estimated arrival time:

1. **Fetch weather** — Call Open-Meteo forecast + marine APIs for that lat/lon (free, unlimited)
2. **Determine sailing direction** — Calculate bearing from this waypoint to the next waypoint
3. **Score** — Apply the existing 4-component algorithm:
   - Wind (35 pts): ≤15kt=35, 15-25kt linear→0, ≥25kt=0
   - Wave+Period (35 pts): effective wave ≤1.5m=35, 1.5-2.5m linear→0, ≥2.5m=0
   - Sea Direction (15 pts): Swell vs sailing direction (Reaching→Opposing)
   - Current (15 pts): Current vs sailing direction (Following→Opposing)

### Overall Journey Score

Weighted average of waypoint scores, with heavier weight on:
- **Exposed sections** (open water crossings vs lee of islands)
- **Worst-scoring waypoint** (a journey is only as good as its worst leg)

Formula: `overallScore = 0.6 × weightedAvg + 0.4 × worstWaypointScore`

This ensures a route with one terrible waypoint doesn't hide behind good averages.

---

## AI Route Generation

### Prompt Strategy

Given start/end coordinates, the AI generates Caribbean sailing routes considering:
- Island geography and coastlines
- Known passages (Anegada, Mona, Dominica Channel, etc.)
- Lee sides vs windward sides of islands
- Typical trade wind patterns
- Overnight stop opportunities
- Direct vs island-hopping options

### Waypoint Density

- One waypoint every ~15-20nm for open water
- Additional waypoints at channel entries/exits
- Waypoints at notable landmarks or decision points
- Typically 3-8 waypoints per route depending on distance

### Example: BVI to Antigua (3 routes)

**Route A: Direct via Anegada Passage** (88nm)
- BEYC → Round Rock Passage → Anegada Passage midpoint → Barbuda west → Antigua north → Jolly Harbour
- 5 waypoints, ~14 hours at 6.5kt

**Route B: Via St Martin** (120nm)
- BEYC → Anegada Passage → Anguilla Channel → Simpson Bay → south coast St Martin → St Barths → Antigua
- 7 waypoints, ~18 hours (with possible overnight in St Martin)

**Route C: Via Saba/St Kitts** (140nm)
- BEYC → south of Virgin Gorda → Saba → St Kitts channel → Nevis → Antigua south
- 8 waypoints, ~22 hours

---

## Weather Data Fetching Strategy

### During Scenario Scoring

For each scenario (route + departure time):

1. Calculate estimated position at each hour along the route
2. Group positions by nearest waypoint
3. Fetch Open-Meteo forecast + marine data for each waypoint lat/lon
4. Match forecast time to estimated arrival time at each waypoint

**API calls per full scoring run:**
- Per waypoint: 2 calls (forecast + marine)
- Forecast data covers 7 days, so one fetch per waypoint covers all 6 departure windows
- Only unique lat/lon points need fetching (3 routes × avg 5 waypoints = 15 max, fewer if routes share waypoints)
- **Optimization:** Dedupe by rounded lat/lon (0.01° ≈ 1km) within a scoring job. Routes that share a departure point or converge at the same destination skip redundant fetches.
- **Actual API calls: ~20-30 (unique points × 2)** — all free via Open-Meteo

### During Sailing State

- Fetch weather for remaining waypoints ahead every 30-60 minutes
- Use boat's current GPS position + current SOG for arrival estimates
- Minimal API calls (only waypoints ahead, not behind)

---

## Where This Lives

### Service Architecture

This is a **cross-service feature**:

| Component | Service | Reason |
|-----------|---------|--------|
| Journey CRUD, route generation | **maintenance-agent** | AI/LLM calls, weather fetching |
| Scenario scoring | **maintenance-agent** | Weather data + scoring engine |
| Trip integration (begin journey) | **main app** | Trip start flow, GPS |
| Sailing state forward weather | **maintenance-agent** | Scoring engine + weather fetching already here |
| Frontend pages | **main app** (src/public/) | All UI served from main |

### Cross-Service Data Flow

Both services share the same Supabase database. The data contract is:

- **maintenance-agent owns**: `journeys`, `journey_routes`, `journey_scenarios` tables + all writes
- **main app reads**: journey/route data directly from Supabase (no proxy needed — same DB)
- **main app writes**: `trips.journey_id` when linking a trip to a journey
- **Sailing forward weather**: Main app gets GPS position, calls maintenance-agent endpoint `GET /api/journey/:id/ahead?lat=X&lon=Y&sog=Z` which computes forward weather + scores and returns the result. This keeps all scoring/weather logic in one place.

### Frontend Page Serving

All frontend pages (`journey-plan.html`, `journey-sailing.html`) are served as static files from the **main app** (`src/public/`). These pages make API calls directly to **maintenance-agent** endpoints (`/api/journey/*`) — same pattern as `weather-areas.html` and `weather-area-view.html` which already call maintenance-agent APIs from main-app-served pages. No main-app journey service/repository layer needed for reads — the frontend talks to maintenance-agent HTTP directly.

### Router Mounting

Journey gets its own dedicated router in maintenance-agent, **not** nested under weather routes:

```javascript
// maintenance-agent/src/index.js
app.use('/api/journey', journeyRoutes);  // Dedicated router
app.use('/api/weather', weatherRoutes);  // Existing weather router (unchanged)
```

This keeps journey and weather/forecast-email pipelines cleanly separated.

### Scoring Module

The scoring algorithm currently lives only in `src/public/weather-area-view.html` (client-side). For journey scoring, it must run server-side in maintenance-agent.

**Approach:** Extract to `maintenance-agent/src/utils/scoring.js` as the **canonical server-side implementation**. The frontend `scoreTimeBlock()` in `weather-area-view.html` remains as-is for now (it works, don't break it). Both implementations must produce identical results for the same inputs.

**Alignment requirement:** Any future changes to scoring weights/thresholds must be applied to both locations. Add a comment in each file referencing the other. Long-term, the frontend could call a scoring API instead of computing locally, but that's not v1.

### New Files

| File | Purpose |
|------|---------|
| `maintenance-agent/src/services/journey.service.js` | Journey CRUD, AI route generation, scenario scoring |
| `maintenance-agent/src/repositories/journey.repository.js` | DB operations for journeys, routes, scenarios |
| `maintenance-agent/src/routes/journey.route.js` | API endpoints, mounted at `/api/journey` |
| `maintenance-agent/src/utils/scoring.js` | Server-side scoring algorithm (canonical, matches frontend) |
| `src/public/journey-plan.html` | Planning UI: create journey, view routes, compare scenarios |
| `src/public/journey-sailing.html` | Sailing UI: forward weather along route |
| ~~`src/public/js/journey/journey-plan.js`~~ | Not created — JS is inline in journey-plan.html |
| ~~`src/public/js/journey/journey-sailing.js`~~ | Not created — JS is inline in journey-sailing.html |

### Modified Files

| File | Change |
|------|--------|
| `src/public/trips.html` | Add "Is this part of a journey?" to trip start flow |
| `src/public/js/trips/trips.js` | Journey selection UI in startTrip() |
| `src/services/trips/trips.service.js` | Accept journey_id when starting trip, write to `trips.journey_id` |
| `maintenance-agent/src/index.js` | Mount journey router at `/api/journey` |

---

## API Endpoints

All journey endpoints live in maintenance-agent, mounted at `/api/journey`.

### Journey Management

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/journey` | Create journey (start/end, triggers AI route generation) |
| GET | `/api/journey` | List journeys (filter by status) |
| GET | `/api/journey/:id` | Get journey with routes and scenarios |
| PUT | `/api/journey/:id` | Update journey (e.g., change departure window) |
| DELETE | `/api/journey/:id` | Delete journey (planning state only) |

### Route Management

| Method | Path | Description |
|--------|------|-------------|
| PUT | `/api/journey/:id/routes/select` | Select routes for comparison (array of route IDs, max 3) |
| POST | `/api/journey/:id/routes/regenerate` | Re-generate routes with AI |

### Scenario Scoring

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/journey/:id/score` | Score all scenarios (selected routes × departure windows) |
| GET | `/api/journey/:id/scenarios` | Get all scored scenarios with rankings |
| GET | `/api/journey/:id/scenarios/:scenarioId` | Get detailed waypoint-by-waypoint breakdown |

### Begin Journey

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/journey/:id/begin` | Transition to sailing state (requires route_id + departure_time + trip_id) |

**Order of operations:** The trip must be started first (main app `POST /api/trips/start` with `journey_id`), then `POST /api/journey/:id/begin` is called with the `trip_id` in the request body. This avoids the main app needing to call back after begin, and ensures the trip record exists before the journey references it. The begin endpoint sets `journeys.trip_id`, `journeys.selected_route_id`, `journeys.selected_departure`, and `journeys.status = 'sailing'` in a single transaction.

### Sailing State

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/journey/:id/ahead` | Forward weather for remaining route. Accepts `?lat=X&lon=Y&sog=Z` from boat GPS. Returns scored waypoints ahead with ETAs. |

---

## UI Design

### Journey Planning Page (`journey-plan.html`)

```
┌─────────────────────────────────────────────────────────────────┐
│  JOURNEY: BVI to Antigua                          [Planning]    │
│  Start: BEYC, BVI (18.45, -64.62)                              │
│  End: Jolly Harbour, Antigua (17.07, -61.90)                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  MAP                                                            │
│  - Shows all routes as colored lines on Leaflet map            │
│  - Selected routes highlighted, deselected routes dimmed       │
│  - Waypoints as markers                                        │
│  - Start (green) and End (red) markers                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  ROUTES                                                         │
│  [✓] Route A: Direct via Anegada (88nm, ~14hrs) ████████ 78    │
│  [✓] Route B: Via St Martin (120nm, ~18hrs)     ██████   62    │
│  [ ] Route C: Via Saba/St Kitts (140nm, ~22hrs) ███████  71    │
│                                                                 │
│  DEPARTURE WINDOW                                               │
│  Earliest: [Fri Apr 10, 6:00 AM]                               │
│                                                                 │
│  [Score Scenarios]                                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  SCENARIO COMPARISON GRID                                       │
│                                                                 │
│              │ Route A (Direct) │ Route B (St Martin) │         │
│  ────────────┼──────────────────┼─────────────────────┤         │
│  Fri 6am     │ 🟢 82           │ 🟡 68               │         │
│  Fri 6pm     │ 🟡 74           │ 🟡 65               │         │
│  Sat 6am     │ 🟢 87 ⭐ BEST   │ 🟡 75               │         │
│  Sat 6pm     │ 🟢 80           │ 🟡 71               │         │
│  Sun 6am     │ 🟠 58           │ 🟠 52               │         │
│  Sun 6pm     │ 🔴 42           │ 🟠 45               │         │
│                                                                 │
│  AI: "Best option is Route A departing Saturday 6am.           │
│  Moderate NE trades 14kt, 1.2m seas with 8s period through     │
│  Anegada Passage. Conditions deteriorate Sunday as tropical     │
│  wave approaches."                                              │
│                                                                 │
│  [Begin Journey: Route A, Sat 6am]                             │
└─────────────────────────────────────────────────────────────────┘
```

### Sailing View (`journey-sailing.html`)

```
┌─────────────────────────────────────────────────────────────────┐
│  JOURNEY: BVI to Antigua                         [Sailing]      │
│  Route: Direct via Anegada Passage                              │
│  Departed: Sat Apr 11, 6:00 AM                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  MAP                                                            │
│  - Route line with completed section (solid) vs ahead (dashed) │
│  - Boat icon at current GPS position                           │
│  - Weather icons at upcoming waypoints                         │
│  - Color-coded route segments by score                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  WHAT'S AHEAD                                                   │
│                                                                 │
│  📍 Current: 18.32, -64.85 | SOG: 7.2kt                       │
│                                                                 │
│  → Waypoint 3: Anegada Passage (22nm, ~3hrs)                   │
│    🟢 Score: 81 | Wind: ENE 16kt | Waves: 1.3m @8s            │
│                                                                 │
│  → Waypoint 4: Barbuda West (38nm, ~5.5hrs)                    │
│    🟡 Score: 72 | Wind: ENE 19kt | Waves: 1.6m @7s            │
│                                                                 │
│  → Waypoint 5: Antigua North (52nm, ~7.5hrs)                   │
│    🟢 Score: 78 | Wind: ENE 15kt | Waves: 1.2m @8s            │
│                                                                 │
│  🏁 Jolly Harbour (62nm, ~9hrs)                                │
│    ETA: Sat Apr 11, 3:00 PM                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Data Model + Journey CRUD
- SQL migrations for `journeys`, `journey_routes`, `journey_scenarios` tables
- SQL migration to add `journey_id` (nullable FK) to `trips` table
- Zod validation schemas for all journey route inputs (create, update, route select)
- Basic CRUD endpoints in maintenance-agent (mounted at `/api/journey`)
- Smoke tests: create journey, list, get by ID, delete
- No AI, no scoring — just the skeleton

### Phase 2: AI Route Generation
- Build the route generation prompt with Caribbean constraints
- **Server-side waypoint validation:** Verify all AI-generated waypoints are in water using a coastline check (simplified Caribbean polygon bounds or a lightweight geo library). Reject/flag routes that fail. Also validate min/max distance between consecutive waypoints (reject <1nm or >50nm gaps).
- Generate waypoints for Caribbean routes
- Map display with multiple routes (Leaflet)
- Route selection UI
- Smoke tests: route generation returns valid waypoints, validation catches land points

### Phase 3: Scenario Scoring
- Extract scoring algorithm to `maintenance-agent/src/utils/scoring.js` (must match `scoreTimeBlock()` output exactly)
- **Golden scoring tests:** Create a fixture of 5-10 test cases with fixed inputs (wind, wave, period, directions, current) and expected component scores + total. Run these against server-side `scoring.js` in CI. For frontend parity, extract `scoreTimeBlock()` into a standalone `.js` file importable by both the HTML page (via `<script>`) and Node test runner. This avoids needing headless browser testing — the shared fixture file runs in Node against both implementations.
- Weather fetching for arbitrary waypoints with lat/lon deduplication
- Score all scenarios (up to 18)
- Comparison grid UI
- AI summary for scenarios (uses `OPENAI_SUMMARY_MODEL` / `gpt-4.1-mini` consistent with weather area AI summary)

### Phase 4: Trip Integration + Begin Journey
- Modify trip start flow to support journey selection
- "Begin Journey" transition (planning → sailing)
- Link trip to journey (`trips.journey_id`)

### Phase 5: Sailing State
- Forward weather view via `GET /api/journey/:id/ahead`
- ETA calculations using current SOG from GPS
- Auto-refresh as boat progresses
- Journey completion

### Per-Phase Checklist (applies to all phases)

Each phase that ships user-facing endpoints or tables must include:
- SQL migration file(s)
- Zod input validation on route handlers
- Smoke tests for critical paths
- `npm run docs:all` to regenerate auto-docs
- Update `docs/10-user-features/` with journey feature doc
- Update `docs/API_REFERENCE.md` with new endpoints

---

## Open Questions

1. **AI route knowledge** — Does the AI (GPT) have sufficient Caribbean sailing route knowledge, or do we need to seed it with our own route data/constraints? May need to provide channel coordinates, common anchorages, etc. in the prompt.

2. **Multi-leg journeys** — If a journey includes an overnight stop (e.g., BVI → St Martin → Antigua), is that one journey with two legs, or two separate journeys? Keeping it as one journey with stop-over waypoints seems cleaner.

3. **Re-scoring frequency** — In planning state, how often should scenarios be re-scored as forecasts update? On-demand (button) vs automatic (e.g., daily)?

4. **Historical routes** — Should completed journeys become "saved routes" that can be reused for future planning without regenerating?

5. **SOG estimation** — Default estimated SOG for time calculations. Use historical trip avg (typically 6-8kt for this boat)? Allow user override per journey?

---

## Design Decisions (Resolved)

### Journey scores are Open-Meteo-only (v1)

The weather area view blends up to 6 sources (Open-Meteo, Stormglass, NOAA, ECMWF, MeteoFR, Expert). Journey scoring uses **Open-Meteo only** in v1 for these reasons:
- Open-Meteo is free and unlimited — route scoring may need 20-30 calls per run
- Stormglass has a 10-call/day limit — can't support multi-waypoint route scoring
- Expert data is corridor-based, not point-based — doesn't map to arbitrary waypoints

This means journey scores may differ slightly from weather area scores for the same location and time. This is an accepted trade-off for v1. If alignment becomes important later, we can add Stormglass for a single "critical waypoint" per route (e.g., the most exposed channel crossing) without exhausting the daily limit.

### Router is independent from weather

Journey routes mount at `/api/journey`, completely separate from `/api/weather`. No shared router files. This avoids coupling with the forecast-email pipeline and keeps both features independently deployable.

### Scoring lives server-side in maintenance-agent

Canonical server-side scoring in `maintenance-agent/src/utils/scoring.js`. The frontend `scoreTimeBlock()` in `weather-area-view.html` is a parallel implementation. Both must produce identical results. Comments in each file reference the other. No shared module across repos in v1 — that adds bundling/resolution complexity for no immediate benefit.

---

## Dependencies

- Open-Meteo API (free, unlimited) — primary weather data source for route scoring
- OpenAI API — route generation uses `OPENAI_MODEL` (currently `gpt-5.1-chat-latest`), scenario summaries use `OPENAI_SUMMARY_MODEL` (currently `gpt-4.1-mini`)
- Existing scoring algorithm — extracted and reused
- Leaflet maps — already in use for weather areas map
- GPS position system — already operational
- Trip system — already operational, needs minor modification

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| AI generates bad routes (through land, dangerous areas) | **Phase 2 requirement:** Server-side waypoint validation (water check, distance between points). Reject and regenerate on failure. User can also manually edit waypoints. |
| Open-Meteo rate limiting | Batch requests; cache by rounded lat/lon within a scoring job; forecast data covers 7 days so one fetch per waypoint handles all 6 departure windows |
| Scoring doesn't account for island effects | Waypoints at channel entries/exits capture the worst conditions; user can add waypoints manually |
| Forecast accuracy degrades beyond 3-4 days | Show confidence indicator; weight nearer-term scores higher |
| Feature complexity creep | Strict phasing — each phase is independently useful |
| Journey scores differ from weather area scores | Accepted in v1: journey uses Open-Meteo only, weather areas blend 6 sources. Documented in Design Decisions. |
| Forecast email pipeline interference | Journey has its own router (`/api/journey`) and tables — no shared code with forecast-email pipeline |

---

## Codebase Audit (2026-04-04)

Deep dive validation of all assumptions against the live codebase. No code changes — audit only.

### Validated Assumptions

| Assumption | Status | Evidence |
|------------|--------|----------|
| Router mounting pattern in maintenance-agent | **Confirmed** | `maintenance-agent/src/index.js:124-127` — `app.use('/api/weather', weatherRoutes)`. Adding `app.use('/api/journey', journeyRoutes)` follows exact same pattern. No auth middleware on weather routes (public). |
| `startTrip()` can accept optional `journey_id` | **Confirmed** | `src/services/trips/trips.service.js:181-213` — Takes no params, does `supabase.from('trips').insert({ status: 'active', title })`. Adding optional `journey_id` to insert is backward-compatible. **Only one call site:** `src/routes/trips.route.js` line 131. |
| `trips` table supports nullable column addition | **Confirmed** | Schema dump shows 15 columns, all nullable except `id`, `status`, `started_at`. Adding nullable `journey_id` won't affect existing rows or queries. |
| Open-Meteo supports arbitrary lat/lon (no area_id) | **Confirmed** | `maintenance-agent/src/repositories/open-meteo.repository.js` — `fetchForecastData(latitude, longitude, models)` and `fetchMarineData(latitude, longitude)` accept raw coords. No area_id in API calls. |
| `scoreTimeBlock()` is pure math, no DOM dependencies | **Confirmed** | `src/public/weather-area-view.html:581-701` — Pure function taking `(forecasts, day)`, returns score object. Uses only math operations and array methods. Can be extracted to Node.js. |
| No naming conflicts with "journey" | **Confirmed** | Grep for `journey` across entire codebase: zero results. Clean namespace. |
| CORS already configured between services | **Confirmed** | Both `src/app.js` and `maintenance-agent/src/index.js` allow `localhost:3000`, `localhost:3001`, `192.168.20.106:*`, and production URLs. |
| Frontend can call maintenance-agent directly | **Confirmed** | `weather-area-view.html:346-348` already uses `API_BASE = 'http://localhost:3001/api/weather'` locally and `'https://boatos-maintenance.onrender.com/api/weather'` in production. Journey pages follow same pattern with `/api/journey`. |
| Both services share same Supabase DB | **Confirmed** | Main app: `src/repositories/supabaseClient.js`. Maintenance-agent: `maintenance-agent/src/repositories/supabase.repository.js`. Both connect to same `SUPABASE_URL`. |

### Critical Finding: Open-Meteo Transform Requires area_id

The `transformForecastResponse(apiResponse, areaId, models)` and `transformMarineResponse(apiResponse, areaId)` functions in `open-meteo.repository.js` take `areaId` as a parameter and embed it in each transformed record for insertion into `weather_forecasts`.

**Impact on journey:** Journey waypoints are NOT weather areas — they don't have an `area_id`. Two options:

1. **Don't store in `weather_forecasts` table** — Score waypoints in-memory from raw API response without persisting. Simpler, no schema changes. Forecast data is ephemeral anyway (re-fetched each scoring run).
2. **Write a separate transform** in `journey.service.js` that extracts the same weather fields without `area_id`. Store in `journey_scenarios.waypoint_scores` jsonb (already planned).

**Recommendation:** Option 1 for v1. Fetch Open-Meteo → extract wind/wave/period/current → score → store results in `journey_scenarios.waypoint_scores`. No new weather storage table needed.

### ~~Critical Finding: Supabase Key Alignment~~ — CLOSED

**Verified:** `SUPABASE_SERVICE_KEY` is set in both environments. The fallback chain in `supabaseClient.js` resolves to the service key (not anon key). Both services use the same key with full write access. No RLS policies in place. No action needed.

### Scoring Input Format — Unit Conversion Detail

The `scoreTimeBlock()` function handles unit conversions internally:

| Source | Wind Unit | Conversion |
|--------|-----------|------------|
| `open_meteo_forecast` | km/h | × 0.539957 → knots |
| `stormglass` | m/s | × 1.94384 → knots |
| `expert` | knots | direct |

**For journey scoring (Open-Meteo only):** Server-side scoring must apply the km/h → knots conversion. The function identifies source by `data_source` field on each forecast record. Since journey uses Open-Meteo exclusively, all wind values will be in km/h and need the 0.539957 multiplier.

Current speed is converted from m/s → knots (× 1.94384) regardless of source.

### SELECT * Safety Check

All `trips` queries in the codebase verified:

| File | Query | Impact of new column |
|------|-------|---------------------|
| `trips.service.js:71` | `.select('*')` | Gets `journey_id: null` — harmless |
| `trips.service.js:98` | `.select('*')` | Gets `journey_id: null` — harmless |
| `trips.service.js:109` | `.select('latitude, longitude, recorded_at, sog')` | Explicit columns — unaffected |
| `trips.service.js:123` | `.select('wind_speed_kts, ...')` | Explicit columns — unaffected |
| `trips.js` (frontend) | Renders trip list | Ignores unknown fields — unaffected |

### Migration Numbering

Existing migrations: `001` through `004` in `scripts/migrations/`. Journey migrations should be `005_create_journeys.sql`, `006_create_journey_routes.sql`, `007_create_journey_scenarios.sql`, `008_add_journey_id_to_trips.sql`.

**Note:** Migrations may have been applied directly in Supabase SQL editor (per Rule #4 in CLAUDE.md — "tables may have been created directly in Supabase"). Migration files serve as documentation. Always verify against live schema dump.

### Regression Risk Summary

| Component | Risk Level | Reason |
|-----------|-----------|--------|
| Router mounting (maintenance-agent) | **None** | Additive, isolated from existing routes |
| `startTrip()` modification | **Very Low** | Optional param, one call site, backward-compatible |
| `trips` table column addition | **None** | Nullable, no existing queries break |
| `scoreTimeBlock()` extraction | **None** | Original stays in HTML, server copy is independent |
| Frontend journey pages | **None** | New pages, no existing pages modified (except trips.html in Phase 4) |
| `trips.html` modification (Phase 4) | **Low** | Journey selection is additive UI, trip start still works without it |
| Supabase cross-service writes | **Low** | Same DB, verify key alignment pre-deploy |
| Open-Meteo fetching for waypoints | **None** | Uses existing repo methods with different coords, no area_id dependency |
| Forecast email pipeline | **None** | Completely separate router, tables, and service |
