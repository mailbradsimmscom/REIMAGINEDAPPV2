-- Check columns in staging_playbook_hints table
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM
    information_schema.columns
WHERE
    table_name = 'staging_playbook_hints'
ORDER BY
    ordinal_position;
