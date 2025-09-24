-- Dump staging_playbook_hints table
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
ORDER BY doc_id, id;

-- Dump playbook_hints table  
SELECT 
  id,
  test_name,
  test_type,
  description,
  steps,
  expected_result,
  system_norm,
  subsystem_norm,
  doc_id,
  created_at,
  confidence
FROM playbook_hints
ORDER BY doc_id, id;
