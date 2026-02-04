-- Migration 002: Add GIN index for search_systems RPC
--
-- The search_systems function builds a tsvector on-the-fly from 8 concatenated
-- columns. Without an index, every call does a sequential scan + tsvector build
-- for all rows. This functional GIN index matches the exact WHERE clause expression
-- so PostgreSQL can use it for the @@ operator.
--
-- ref_model_synonyms already has btree on synonym_norm (unique) which is optimal
-- for exact-match lookups — no GIN needed there.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_systems_search_fts
ON systems
USING GIN (
  to_tsvector('english',
    COALESCE(manufacturer_norm, '') || ' ' ||
    COALESCE(model_norm, '') || ' ' ||
    COALESCE(system_norm, '') || ' ' ||
    COALESCE(subsystem_norm, '') || ' ' ||
    COALESCE(spec_keywords, '') || ' ' ||
    COALESCE(synonyms_fts, '') || ' ' ||
    COALESCE(colloquial_keywords, '') || ' ' ||
    COALESCE(description, '')
  )
);
