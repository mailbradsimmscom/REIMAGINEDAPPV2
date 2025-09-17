-- Compare playbook_hints and staging_playbook_hints tables
-- This query will show any differences between the two tables

WITH staging_data AS (
  SELECT 
    id,
    title,
    procedures,
    preconditions,
    error_codes,
    related_procedures,
    page_references,
    category,
    system_norm,
    subsystem_norm,
    doc_id,
    created_at,
    confidence
  FROM staging_playbook_hints
),
production_data AS (
  SELECT 
    id,
    test_name as title,
    steps as procedures,
    description as preconditions,
    expected_result as error_codes,
    NULL as related_procedures,
    NULL as page_references,
    test_type as category,
    system_norm,
    subsystem_norm,
    doc_id,
    created_at,
    confidence
  FROM playbook_hints
),
comparison AS (
  SELECT 
    'MISSING_IN_PRODUCTION' as difference_type,
    s.id,
    s.title,
    s.doc_id
  FROM staging_data s
  LEFT JOIN production_data p ON s.id = p.id
  WHERE p.id IS NULL
  
  UNION ALL
  
  SELECT 
    'MISSING_IN_STAGING' as difference_type,
    p.id,
    p.title,
    p.doc_id
  FROM production_data p
  LEFT JOIN staging_data s ON p.id = s.id
  WHERE s.id IS NULL
  
  UNION ALL
  
  SELECT 
    'DATA_MISMATCH' as difference_type,
    s.id,
    s.title,
    s.doc_id
  FROM staging_data s
  JOIN production_data p ON s.id = p.id
  WHERE 
    s.title != p.title OR
    s.procedures::text != p.procedures::text OR
    s.preconditions::text != p.preconditions::text OR
    s.error_codes::text != p.error_codes::text OR
    s.doc_id != p.doc_id
)

SELECT 
  difference_type,
  COUNT(*) as count,
  STRING_AGG(DISTINCT doc_id, ', ') as affected_doc_ids
FROM comparison
GROUP BY difference_type

UNION ALL

SELECT 
  'TOTAL_COUNTS' as difference_type,
  (SELECT COUNT(*) FROM staging_data) as staging_count,
  (SELECT COUNT(*) FROM production_data) as production_count
FROM (SELECT 1) x;
