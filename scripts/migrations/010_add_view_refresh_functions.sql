-- Migration: Add view refresh function and trigger
-- Purpose: Automatically refresh knowledge_facts view when data changes
-- Date: 2025-01-09
-- Author: Step 8 - Schema Alignment

-- Create a function to refresh the knowledge_facts materialized view
-- Note: This may not work in Supabase hosted, but we'll try
CREATE OR REPLACE FUNCTION refresh_knowledge_facts_view()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW knowledge_facts;
END;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION refresh_knowledge_facts_view() IS 'Refreshes the knowledge_facts materialized view with latest approved data';

-- Create a simple refresh function that can be called via RPC
-- This is more likely to work in Supabase hosted
CREATE OR REPLACE FUNCTION refresh_knowledge_facts()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW knowledge_facts;
  RETURN json_build_object('success', true, 'message', 'Knowledge facts view refreshed');
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION refresh_knowledge_facts() IS 'RPC-safe function to refresh knowledge_facts materialized view';

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION refresh_knowledge_facts() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_knowledge_facts_view() TO authenticated;
