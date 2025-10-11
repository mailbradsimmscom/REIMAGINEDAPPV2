-- Migration: Implement weighted full-text search ranking
-- Prioritizes model_norm, canonical_model_id, and description matches over manufacturer/system matches
-- This improves search relevance by giving higher scores to exact model/description matches

CREATE OR REPLACE FUNCTION search_systems(q text, top_n integer DEFAULT 10)
RETURNS TABLE (
  asset_uid text,
  rank real
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.asset_uid::text as asset_uid,
    ts_rank(
      -- Weighted fields (higher weight = more important)
      setweight(to_tsvector('english', COALESCE(s.model_norm, '')), 'A') ||           -- Weight A (1.0)
      setweight(to_tsvector('english', COALESCE(s.canonical_model_id, '')), 'A') ||   -- Weight A (1.0)
      setweight(to_tsvector('english', COALESCE(s.description, '')), 'A') ||          -- Weight A (1.0)
      setweight(to_tsvector('english', COALESCE(s.manufacturer_norm, '')), 'B') ||    -- Weight B (0.4)
      setweight(to_tsvector('english', COALESCE(s.system_norm, '')), 'C') ||          -- Weight C (0.2)
      setweight(to_tsvector('english', COALESCE(s.subsystem_norm, '')), 'C') ||       -- Weight C (0.2)
      setweight(to_tsvector('english', COALESCE(s.spec_keywords, '')), 'D'),          -- Weight D (0.1)
      plainto_tsquery('english', q)
    ) as rank
  FROM systems s
  WHERE
    -- Still use unweighted for WHERE clause (faster, just needs to match)
    to_tsvector('english',
      COALESCE(s.canonical_model_id, '') || ' ' ||
      COALESCE(s.manufacturer_norm, '') || ' ' ||
      COALESCE(s.model_norm, '') || ' ' ||
      COALESCE(s.system_norm, '') || ' ' ||
      COALESCE(s.subsystem_norm, '') || ' ' ||
      COALESCE(s.spec_keywords, '') || ' ' ||
      COALESCE(s.synonyms_fts, '') || ' ' ||
      COALESCE(s.description, '')
    ) @@ plainto_tsquery('english', q)
  ORDER BY rank DESC
  LIMIT top_n;
END;
$$;

COMMENT ON FUNCTION search_systems IS 'Weighted full-text search. Priority: model_norm/canonical_model_id/description (A=1.0) > manufacturer_norm (B=0.4) > system_norm/subsystem_norm (C=0.2) > spec_keywords (D=0.1)';
