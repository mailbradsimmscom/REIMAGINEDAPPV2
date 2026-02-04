-- Migration 001: Add colloquial_keywords to search_systems RPC
--
-- colloquial_keywords contains operational terms users type in chat:
-- "grill", "watermaker", "NMEA 2000", "waypoints", "clicking noise"
-- These terms don't appear in synonyms_fts or spec_keywords.
--
-- Changes:
-- 1. Added colloquial_keywords to WHERE clause tsvector (enables matching)
-- 2. Added colloquial_keywords to ranking weights as weight D (0.1)

CREATE OR REPLACE FUNCTION public.search_systems(q text, top_n integer DEFAULT 10)
 RETURNS TABLE(asset_uid text, rank real)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    s.asset_uid::text as asset_uid,
    ts_rank(
      -- Weighted fields (higher weight = more important)
      setweight(to_tsvector('english', COALESCE(s.model_norm, '')), 'A') ||           -- Weight A (1.0)
      setweight(to_tsvector('english', COALESCE(s.description, '')), 'A') ||          -- Weight A (1.0)
      setweight(to_tsvector('english', COALESCE(s.manufacturer_norm, '')), 'B') ||    -- Weight B (0.4)
      setweight(to_tsvector('english', COALESCE(s.system_norm, '')), 'C') ||          -- Weight C (0.2)
      setweight(to_tsvector('english', COALESCE(s.subsystem_norm, '')), 'C') ||       -- Weight C (0.2)
      setweight(to_tsvector('english', COALESCE(s.spec_keywords, '')), 'D') ||        -- Weight D (0.1)
      setweight(to_tsvector('english', COALESCE(s.colloquial_keywords, '')), 'D'),    -- Weight D (0.1)
      plainto_tsquery('english', q)
    ) as rank
  FROM systems s
  WHERE
    to_tsvector('english',
      COALESCE(s.manufacturer_norm, '') || ' ' ||
      COALESCE(s.model_norm, '') || ' ' ||
      COALESCE(s.system_norm, '') || ' ' ||
      COALESCE(s.subsystem_norm, '') || ' ' ||
      COALESCE(s.spec_keywords, '') || ' ' ||
      COALESCE(s.synonyms_fts, '') || ' ' ||
      COALESCE(s.colloquial_keywords, '') || ' ' ||
      COALESCE(s.description, '')
    ) @@ plainto_tsquery('english', q)
  ORDER BY rank DESC
  LIMIT top_n;
END;
$function$;
