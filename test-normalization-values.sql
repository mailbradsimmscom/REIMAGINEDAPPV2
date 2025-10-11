-- Test different normalization values to find the best one
-- Run this in Supabase SQL Editor

SELECT
  manufacturer_norm,
  model_norm,
  LEFT(description, 40) as description_preview,
  -- No normalization (raw score)
  ts_rank(
    setweight(to_tsvector('english', COALESCE(model_norm, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(canonical_model_id, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(description, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(manufacturer_norm, '')), 'B'),
    plainto_tsquery('english', 'harken winches'),
    0
  ) as rank_none,
  -- Normalization 1: divide by 1 + log(length)
  ts_rank(
    setweight(to_tsvector('english', COALESCE(model_norm, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(canonical_model_id, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(description, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(manufacturer_norm, '')), 'B'),
    plainto_tsquery('english', 'harken winches'),
    1
  ) as rank_norm_1,
  -- Normalization 32: divide by rank + 1 (CURRENT)
  ts_rank(
    setweight(to_tsvector('english', COALESCE(model_norm, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(canonical_model_id, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(description, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(manufacturer_norm, '')), 'B'),
    plainto_tsquery('english', 'harken winches'),
    32
  ) as rank_norm_32
FROM systems
WHERE manufacturer_norm = 'Harken'
ORDER BY rank_none DESC
LIMIT 5;
