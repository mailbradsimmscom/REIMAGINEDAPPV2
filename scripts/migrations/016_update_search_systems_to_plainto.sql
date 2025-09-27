-- Migration: Update search_systems to use plainto_tsquery for more flexible matching
-- This replaces websearch_to_tsquery with plainto_tsquery to handle natural language queries better

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
      COALESCE(s.spec_keywords, '') || ' ' ||
      COALESCE(s.synonyms_fts, '') || ' ' ||
      COALESCE(s.description, '')
    ) @@ plainto_tsquery('english', q)
  ORDER BY rank DESC
  LIMIT top_n;
END;
$$;

COMMENT ON FUNCTION search_systems IS 'Full-text search on systems table using plainto_tsquery for flexible natural language matching. Searches canonical_model_id, manufacturer_norm, spec_keywords, synonyms_fts, and description columns.';