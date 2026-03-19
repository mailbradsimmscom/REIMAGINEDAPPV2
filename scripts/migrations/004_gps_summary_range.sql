-- Migration 004: GPS summary functions for performance optimization
-- Replaces multi-round-trip batch fetching with single SQL calls

-- 1. gps_positions_summary_in_range
-- Used by safe-box (anchor-watch) to get downsampled GPS positions in a time range.
-- Replaces 24 sequential Supabase batch queries with 1 query.
CREATE OR REPLACE FUNCTION gps_positions_summary_in_range(
  p_start timestamptz,
  p_end timestamptz,
  p_interval_seconds int DEFAULT 60
)
RETURNS TABLE (
  "timestamp" timestamptz,
  latitude double precision,
  longitude double precision,
  true_wind_speed double precision,
  true_wind_direction double precision,
  depth double precision,
  total_count bigint
) AS $$
  WITH numbered AS (
    SELECT
      g."timestamp",
      g.latitude,
      g.longitude,
      g.true_wind_speed,
      g.true_wind_direction,
      g.depth,
      -- Assign bucket number based on interval
      FLOOR(EXTRACT(EPOCH FROM (g."timestamp" - p_start)) / p_interval_seconds) AS bucket
    FROM gps_position g
    WHERE g."timestamp" > p_start
      AND g."timestamp" <= p_end
  ),
  -- Pick first row per bucket (lowest timestamp)
  sampled AS (
    SELECT DISTINCT ON (bucket)
      numbered."timestamp",
      numbered.latitude,
      numbered.longitude,
      numbered.true_wind_speed,
      numbered.true_wind_direction,
      numbered.depth
    FROM numbered
    ORDER BY bucket, numbered."timestamp"
  )
  SELECT
    s."timestamp",
    s.latitude,
    s.longitude,
    s.true_wind_speed,
    s.true_wind_direction,
    s.depth,
    (SELECT COUNT(*) FROM numbered) AS total_count
  FROM sampled s
  ORDER BY s."timestamp";
$$ LANGUAGE sql STABLE;


-- 2. gps_hourly_summary
-- Used by anchorage detection to get hourly-averaged GPS data.
-- Replaces batch fetching + JS groupPositionsByHour() with 1 query.
CREATE OR REPLACE FUNCTION gps_hourly_summary(
  p_start timestamptz
)
RETURNS TABLE (
  hour timestamptz,
  avg_lat double precision,
  avg_lon double precision,
  avg_wind_speed double precision,
  avg_wind_dir double precision,
  position_count bigint
) AS $$
  SELECT
    date_trunc('hour', g."timestamp") AS hour,
    AVG(g.latitude) AS avg_lat,
    AVG(g.longitude) AS avg_lon,
    AVG(COALESCE(g.true_wind_speed, 0)) AS avg_wind_speed,
    -- Circular average for wind direction
    MOD((DEGREES(ATAN2(
      AVG(SIN(RADIANS(COALESCE(g.true_wind_direction, 0)))),
      AVG(COS(RADIANS(COALESCE(g.true_wind_direction, 0))))
    )) + 360)::numeric, 360)::double precision AS avg_wind_dir,
    COUNT(*) AS position_count
  FROM gps_position g
  WHERE g."timestamp" > p_start
  GROUP BY date_trunc('hour', g."timestamp")
  ORDER BY hour;
$$ LANGUAGE sql STABLE;
