-- First, drop the existing function
DROP FUNCTION IF EXISTS search_systems(text, integer);

-- Then create the updated function with additional columns in tsvector
CREATE OR REPLACE FUNCTION search_systems(q text, top_n integer DEFAULT 10)
RETURNS TABLE(canonical_model_id text, rank real) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.canonical_model_id::text as canonical_model_id,
    ts_rank(
      to_tsvector('english', 
        COALESCE(s.canonical_model_id, '') || ' ' ||
        COALESCE(s.manufacturer_norm, '') || ' ' ||
        COALESCE(s.spec_keywords, '') || ' ' ||
        COALESCE(s.synonyms_fts, '') || ' ' ||
        COALESCE(s.description, '')
      ),
      websearch_to_tsquery('english', q)
    ) as rank
  FROM systems s
  WHERE 
    to_tsvector('english', 
      COALESCE(s.canonical_model_id, '') || ' ' ||
      COALESCE(s.manufacturer_norm, '') || ' ' ||
      COALESCE(s.spec_keywords, '') || ' ' ||
      COALESCE(s.synonyms_fts, '') || ' ' ||
      COALESCE(s.description, '')
    ) @@ websearch_to_tsquery('english', q)
  ORDER BY rank DESC
  LIMIT top_n;
END;
$$;
