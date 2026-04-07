-- 005_create_journeys.sql
-- Journey feature: planning + sailing state for weather-optimized route planning
-- Phase 1: Tables only, no AI/scoring logic

-- ========== JOURNEYS ==========
CREATE TABLE IF NOT EXISTS journeys (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    status              text            NOT NULL DEFAULT 'planning',
    title               text            NOT NULL,
    start_name          text,
    start_lat           double precision,
    start_lon           double precision,
    end_name            text,
    end_lat             double precision,
    end_lon             double precision,
    earliest_departure  timestamptz,
    selected_route_id   uuid,           -- FK added after journey_routes exists
    selected_departure  timestamptz,
    trip_id             uuid,           -- FK to trips, set when journey begins
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT chk_journeys_status CHECK (status IN ('planning', 'sailing', 'completed'))
);

CREATE INDEX IF NOT EXISTS idx_journeys_status ON journeys(status);
CREATE INDEX IF NOT EXISTS idx_journeys_created_at ON journeys(created_at DESC);

-- ========== JOURNEY ROUTES ==========
CREATE TABLE IF NOT EXISTS journey_routes (
    id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    journey_id              uuid            NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    name                    text            NOT NULL,
    waypoints               jsonb           NOT NULL DEFAULT '[]',
    distance_nm             double precision,
    estimated_duration_hrs  double precision,
    estimated_avg_sog       double precision,
    sort_order              integer         NOT NULL DEFAULT 0,
    is_selected             boolean         NOT NULL DEFAULT false,
    ai_description          text,
    created_at              timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journey_routes_journey_id ON journey_routes(journey_id);

-- ========== JOURNEY SCENARIOS ==========
CREATE TABLE IF NOT EXISTS journey_scenarios (
    id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    journey_id              uuid            NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
    route_id                uuid            NOT NULL REFERENCES journey_routes(id) ON DELETE CASCADE,
    departure_time          timestamptz     NOT NULL,
    overall_score           double precision,
    waypoint_scores         jsonb,
    ai_summary              text,
    scored_at               timestamptz,
    forecast_staleness_hrs  double precision,
    created_at              timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journey_scenarios_journey_id ON journey_scenarios(journey_id);
CREATE INDEX IF NOT EXISTS idx_journey_scenarios_route_id ON journey_scenarios(route_id);

-- ========== FK: journeys.selected_route_id → journey_routes ==========
ALTER TABLE journeys
    ADD CONSTRAINT fk_journeys_selected_route
    FOREIGN KEY (selected_route_id)
    REFERENCES journey_routes(id)
    ON DELETE SET NULL;

-- ========== FK: journeys.trip_id → trips ==========
ALTER TABLE journeys
    ADD CONSTRAINT fk_journeys_trip
    FOREIGN KEY (trip_id)
    REFERENCES trips(id)
    ON DELETE SET NULL;

-- ========== ADD journey_id TO TRIPS ==========
ALTER TABLE trips ADD COLUMN IF NOT EXISTS journey_id uuid;

ALTER TABLE trips
    ADD CONSTRAINT fk_trips_journey
    FOREIGN KEY (journey_id)
    REFERENCES journeys(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trips_journey_id ON trips(journey_id);
