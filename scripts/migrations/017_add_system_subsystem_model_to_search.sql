-- Migration: Add system_norm, subsystem_norm, and model_norm to keyword search
-- This enhances search to match on broader system categories (e.g., "GPS", "Navigation", "VHF")

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
      to_tsvector('english',
        COALESCE(s.canonical_model_id, '') || ' ' ||
        COALESCE(s.manufacturer_norm, '') || ' ' ||
        COALESCE(s.model_norm, '') || ' ' ||
        COALESCE(s.system_norm, '') || ' ' ||
        COALESCE(s.subsystem_norm, '') || ' ' ||
        COALESCE(s.spec_keywords, '') || ' ' ||
        COALESCE(s.synonyms_fts, '') || ' ' ||
        COALESCE(s.description, '')
      ),
      plainto_tsquery('english', q)
    ) as rank
  FROM systems s
  WHERE
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

COMMENT ON FUNCTION search_systems IS 'Full-text search on systems table. Searches: canonical_model_id, manufacturer_norm, model_norm, system_norm, subsystem_norm, spec_keywords, synonyms_fts, and description columns.';
