

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "http" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."f_unaccent"("text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    AS $_$
  select unaccent('unaccent', $1)
$_$;


ALTER FUNCTION "public"."f_unaccent"("text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_job_status"("job_uuid" "uuid") RETURNS json
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    job_record RECORD;
    result JSON;
BEGIN
    SELECT * INTO job_record FROM jobs WHERE job_id = job_uuid;
    
    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Job not found');
    END IF;
    
    result := json_build_object(
        'job_id', job_record.job_id,
        'status', job_record.status,
        'progress', job_record.counters,
        'summary', json_build_object(
            'namespace', 'REIMAGINEDDOCS',
            'doc_id', job_record.doc_id
        ),
        'errors', CASE 
            WHEN job_record.error IS NOT NULL THEN 
                json_build_array(job_record.error)
            ELSE 
                '[]'::json
        END,
        'created_at', job_record.created_at,
        'updated_at', job_record.updated_at,
        'completed_at', job_record.completed_at
    );
    
    RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_job_status"("job_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_dip_complete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  res http_response;
begin
  if new.status = 'DIP_COMPLETE' then
    res := net.http_post(
      url := 'https://379d562e4624.ngrok-free.app/admin/api/dip/clean',
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object(
        'doc_id', new.doc_id,
        'job_id', new.id
      )::text
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."notify_dip_complete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_knowledge_facts"() RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW knowledge_facts;
  RETURN json_build_object('success', true, 'message', 'Knowledge facts view refreshed');
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."refresh_knowledge_facts"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_knowledge_facts"() IS 'RPC-safe function to refresh knowledge_facts materialized view';



CREATE OR REPLACE FUNCTION "public"."refresh_knowledge_facts_view"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW knowledge_facts;
END;
$$;


ALTER FUNCTION "public"."refresh_knowledge_facts_view"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."refresh_knowledge_facts_view"() IS 'Refreshes the knowledge_facts materialized view with latest approved data';



CREATE OR REPLACE FUNCTION "public"."search_systems"("q" "text", "top_n" integer DEFAULT 10) RETURNS TABLE("asset_uid" "text", "rank" real)
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."search_systems"("q" "text", "top_n" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "thread_id" "uuid" NOT NULL,
    "role" character varying(20) NOT NULL,
    "content" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "chat_messages_role_check" CHECK ((("role")::"text" = ANY ((ARRAY['user'::character varying, 'assistant'::character varying])::"text"[])))
);


ALTER TABLE "public"."chat_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(255) DEFAULT 'New Chat'::character varying NOT NULL,
    "description" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."chat_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_threads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "name" character varying(255) DEFAULT 'New Thread'::character varying NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."chat_threads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."declined_golden_tests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_id" "text" NOT NULL,
    "query" "text" NOT NULL,
    "expected" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "confidence" numeric,
    "page" integer,
    "manufacturer_norm" "text",
    "model_norm" "text",
    "asset_uid" "uuid",
    "description" "text",
    "test_method" "text",
    "failure_indication" "text",
    "related_procedures" "jsonb" DEFAULT '[]'::"jsonb",
    "declined_at" timestamp with time zone DEFAULT "now"(),
    "declined_by" character varying(255) NOT NULL,
    "decline_reason" "text"
);


ALTER TABLE "public"."declined_golden_tests" OWNER TO "postgres";


COMMENT ON COLUMN "public"."declined_golden_tests"."doc_id" IS 'Reference to the document that generated this golden test';



COMMENT ON COLUMN "public"."declined_golden_tests"."query" IS 'The test query/question that should be asked';



COMMENT ON COLUMN "public"."declined_golden_tests"."expected" IS 'The expected answer/response for this query';



COMMENT ON COLUMN "public"."declined_golden_tests"."manufacturer_norm" IS 'Normalized manufacturer name from systems table';



COMMENT ON COLUMN "public"."declined_golden_tests"."model_norm" IS 'Normalized model name from systems table';



COMMENT ON COLUMN "public"."declined_golden_tests"."asset_uid" IS 'Asset UUID from systems table';



COMMENT ON COLUMN "public"."declined_golden_tests"."description" IS 'Description mapped from models JSON array';



COMMENT ON COLUMN "public"."declined_golden_tests"."test_method" IS 'How to verify this golden rule';



COMMENT ON COLUMN "public"."declined_golden_tests"."failure_indication" IS 'What it means if this rule fails';



COMMENT ON COLUMN "public"."declined_golden_tests"."related_procedures" IS 'Connected procedures or specs as JSONB array';



CREATE TABLE IF NOT EXISTS "public"."declined_intent_router" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "text" DEFAULT 'admin'::"text",
    "doc_id" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "confidence" numeric,
    "manufacturer_norm" "text",
    "model_norm" "text",
    "asset_uid" "uuid",
    "description" "text",
    "question" "text",
    "question_variations" "jsonb" DEFAULT '[]'::"jsonb",
    "answer" "text",
    "question_type" "text",
    "references" "jsonb" DEFAULT '[]'::"jsonb",
    "declined_at" timestamp with time zone DEFAULT "now"(),
    "declined_by" character varying(255) NOT NULL,
    "decline_reason" "text"
);


ALTER TABLE "public"."declined_intent_router" OWNER TO "postgres";


COMMENT ON COLUMN "public"."declined_intent_router"."manufacturer_norm" IS 'Normalized manufacturer name from systems table';



COMMENT ON COLUMN "public"."declined_intent_router"."model_norm" IS 'Normalized model name from systems table';



COMMENT ON COLUMN "public"."declined_intent_router"."asset_uid" IS 'Asset UUID from systems table';



COMMENT ON COLUMN "public"."declined_intent_router"."description" IS 'Description mapped from models JSON array';



COMMENT ON COLUMN "public"."declined_intent_router"."question" IS 'Natural language question (primary version)';



COMMENT ON COLUMN "public"."declined_intent_router"."question_variations" IS 'Alternative ways to ask the same question as JSONB array';



COMMENT ON COLUMN "public"."declined_intent_router"."answer" IS 'Direct, complete answer with specific details';



COMMENT ON COLUMN "public"."declined_intent_router"."question_type" IS 'Question type: What/How/When/Where/Why';



COMMENT ON COLUMN "public"."declined_intent_router"."references" IS 'Page numbers, sections, or related procedures as JSONB array';



CREATE TABLE IF NOT EXISTS "public"."declined_playbook_hints" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_id" character varying(255) NOT NULL,
    "title" character varying(255) NOT NULL,
    "description" "text",
    "steps" "jsonb" NOT NULL,
    "expected_outcome" "text",
    "preconditions" "jsonb",
    "error_codes" "jsonb",
    "page" integer,
    "confidence" numeric(3,2),
    "system_norm" "text",
    "subsystem_norm" "text",
    "manufacturer_norm" "text",
    "model_norm" "text",
    "asset_uid" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "declined_at" timestamp with time zone DEFAULT "now"(),
    "declined_by" character varying(255) NOT NULL,
    "decline_reason" "text",
    CONSTRAINT "playbook_hints_confidence_check1" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric)))
);


ALTER TABLE "public"."declined_playbook_hints" OWNER TO "postgres";


COMMENT ON COLUMN "public"."declined_playbook_hints"."title" IS 'Procedure title from OpenAI response';



COMMENT ON COLUMN "public"."declined_playbook_hints"."description" IS 'Models array converted to comma-separated string';



COMMENT ON COLUMN "public"."declined_playbook_hints"."steps" IS 'Procedure steps array from OpenAI response';



COMMENT ON COLUMN "public"."declined_playbook_hints"."expected_outcome" IS 'Expected outcome from OpenAI response';



COMMENT ON COLUMN "public"."declined_playbook_hints"."preconditions" IS 'Preconditions array from OpenAI response';



COMMENT ON COLUMN "public"."declined_playbook_hints"."error_codes" IS 'Error codes array from OpenAI response';



COMMENT ON COLUMN "public"."declined_playbook_hints"."system_norm" IS 'Normalized system name for grouping';



COMMENT ON COLUMN "public"."declined_playbook_hints"."subsystem_norm" IS 'Normalized subsystem name for grouping';



COMMENT ON COLUMN "public"."declined_playbook_hints"."manufacturer_norm" IS 'Normalized manufacturer name';



COMMENT ON COLUMN "public"."declined_playbook_hints"."model_norm" IS 'Normalized model name';



COMMENT ON COLUMN "public"."declined_playbook_hints"."asset_uid" IS 'Asset unique identifier';



CREATE TABLE IF NOT EXISTS "public"."declined_spec_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_id" character varying(255) NOT NULL,
    "confidence" numeric(3,2),
    "approved_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "manufacturer_norm" "text",
    "model_norm" "text",
    "asset_uid" "uuid",
    "description" "text",
    "parameter" "text",
    "normalized_parameter" "text",
    "parameter_aliases" "jsonb" DEFAULT '[]'::"jsonb",
    "value" "text",
    "range" "text",
    "units" "text",
    "normalized_units" "text",
    "converted_value" "text",
    "category" "text",
    "search_terms" "jsonb" DEFAULT '[]'::"jsonb",
    "concept_group" "text",
    "references" "jsonb" DEFAULT '[]'::"jsonb",
    "declined_at" timestamp with time zone DEFAULT "now"(),
    "declined_by" character varying(255) NOT NULL,
    "decline_reason" "text",
    CONSTRAINT "spec_suggestions_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric)))
);


ALTER TABLE "public"."declined_spec_suggestions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_chunks" (
    "chunk_id" "text" NOT NULL,
    "doc_id" "text" NOT NULL,
    "content_type" "text" NOT NULL,
    "section_path" "text",
    "page_start" integer,
    "page_end" integer,
    "bbox" "jsonb",
    "checksum" "text" NOT NULL,
    "ingest_version" "text",
    "parser_version" "text",
    "embed_model" "text",
    "part_numbers" "text"[],
    "fault_codes" "text"[],
    "standards" "text"[],
    "related_ids" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "chunk_index" integer,
    "text" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "document_chunks_content_type_check" CHECK (("content_type" = ANY (ARRAY['text'::"text", 'table'::"text", 'figure'::"text", 'ocr'::"text"])))
);


ALTER TABLE "public"."document_chunks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "doc_id" "text" NOT NULL,
    "manufacturer" "text",
    "model" "text",
    "revision_date" "date",
    "language" "text" DEFAULT 'en'::"text",
    "brand_family" "text",
    "source_url" "text",
    "last_ingest_version" "text",
    "last_job_id" "uuid",
    "last_ingested_at" timestamp with time zone,
    "chunk_count" integer DEFAULT 0,
    "table_count" integer DEFAULT 0,
    "pages_total" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "storage_path" "text",
    "asset_uid" "uuid",
    "manufacturer_norm" "text",
    "model_norm" "text",
    "system_norm" "text",
    "subsystem_norm" "text"
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


COMMENT ON COLUMN "public"."documents"."asset_uid" IS 'Foreign key linking to systems table';



COMMENT ON COLUMN "public"."documents"."manufacturer_norm" IS 'Normalized manufacturer name from systems table';



COMMENT ON COLUMN "public"."documents"."model_norm" IS 'Normalized model name from systems table';



COMMENT ON COLUMN "public"."documents"."system_norm" IS 'Normalized system name from systems table';



COMMENT ON COLUMN "public"."documents"."subsystem_norm" IS 'Normalized subsystem name from systems table';



CREATE TABLE IF NOT EXISTS "public"."golden_tests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_id" "text" NOT NULL,
    "query" "text" NOT NULL,
    "expected" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "confidence" numeric,
    "page" integer,
    "manufacturer_norm" "text",
    "model_norm" "text",
    "asset_uid" "uuid",
    "description" "text",
    "test_method" "text",
    "failure_indication" "text",
    "related_procedures" "jsonb" DEFAULT '[]'::"jsonb",
    "approved_at" timestamp with time zone,
    "approved_by" "text"
);


ALTER TABLE "public"."golden_tests" OWNER TO "postgres";


COMMENT ON TABLE "public"."golden_tests" IS 'This is a duplicate of staging_golden_tests';



COMMENT ON COLUMN "public"."golden_tests"."doc_id" IS 'Reference to the document that generated this golden test';



COMMENT ON COLUMN "public"."golden_tests"."query" IS 'The test query/question that should be asked';



COMMENT ON COLUMN "public"."golden_tests"."expected" IS 'The expected answer/response for this query';



COMMENT ON COLUMN "public"."golden_tests"."manufacturer_norm" IS 'Normalized manufacturer name from systems table';



COMMENT ON COLUMN "public"."golden_tests"."model_norm" IS 'Normalized model name from systems table';



COMMENT ON COLUMN "public"."golden_tests"."asset_uid" IS 'Asset UUID from systems table';



COMMENT ON COLUMN "public"."golden_tests"."description" IS 'Description mapped from models JSON array';



COMMENT ON COLUMN "public"."golden_tests"."test_method" IS 'How to verify this golden rule';



COMMENT ON COLUMN "public"."golden_tests"."failure_indication" IS 'What it means if this rule fails';



COMMENT ON COLUMN "public"."golden_tests"."related_procedures" IS 'Connected procedures or specs as JSONB array';



CREATE TABLE IF NOT EXISTS "public"."instances" (
    "instance_uid" "uuid" NOT NULL,
    "asset_uid" "uuid" NOT NULL,
    "serial_number" "text",
    "location" "text",
    "system_norm" "text",
    "subsystem_norm" "text",
    "manufacturer_norm" "text",
    "model_norm" "text",
    "canonical_model_id" "text",
    "instance_index" integer,
    "serial_canon" "text" GENERATED ALWAYS AS (NULLIF("upper"("regexp_replace"("btrim"(COALESCE("serial_number", ''::"text")), '[^A-Z0-9]+'::"text", ''::"text", 'g'::"text")), ''::"text")) STORED
);


ALTER TABLE "public"."instances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."intent_router" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "text" DEFAULT 'admin'::"text",
    "doc_id" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "confidence" numeric,
    "manufacturer_norm" "text",
    "model_norm" "text",
    "asset_uid" "uuid",
    "description" "text",
    "question" "text",
    "question_variations" "jsonb" DEFAULT '[]'::"jsonb",
    "answer" "text",
    "question_type" "text",
    "references" "jsonb" DEFAULT '[]'::"jsonb",
    "approved_at" timestamp with time zone,
    "approved_by" "text"
);


ALTER TABLE "public"."intent_router" OWNER TO "postgres";


COMMENT ON TABLE "public"."intent_router" IS 'This is a duplicate of staging_intent_router';



COMMENT ON COLUMN "public"."intent_router"."manufacturer_norm" IS 'Normalized manufacturer name from systems table';



COMMENT ON COLUMN "public"."intent_router"."model_norm" IS 'Normalized model name from systems table';



COMMENT ON COLUMN "public"."intent_router"."asset_uid" IS 'Asset UUID from systems table';



COMMENT ON COLUMN "public"."intent_router"."description" IS 'Description mapped from models JSON array';



COMMENT ON COLUMN "public"."intent_router"."question" IS 'Natural language question (primary version)';



COMMENT ON COLUMN "public"."intent_router"."question_variations" IS 'Alternative ways to ask the same question as JSONB array';



COMMENT ON COLUMN "public"."intent_router"."answer" IS 'Direct, complete answer with specific details';



COMMENT ON COLUMN "public"."intent_router"."question_type" IS 'Question type: What/How/When/Where/Why';



COMMENT ON COLUMN "public"."intent_router"."references" IS 'Page numbers, sections, or related procedures as JSONB array';



CREATE TABLE IF NOT EXISTS "public"."jobs" (
    "job_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "doc_id" "text" NOT NULL,
    "upload_id" "text",
    "storage_path" "text",
    "params" "jsonb" DEFAULT '{}'::"jsonb",
    "counters" "jsonb" DEFAULT '{}'::"jsonb",
    "error" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "started_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "job_type" character varying(50) DEFAULT 'GENERIC'::character varying,
    "dip_success" boolean DEFAULT false,
    "status_v2" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "chk_jobs_job_type" CHECK ((("job_type")::"text" = ANY ((ARRAY['GENERIC'::character varying, 'DIP'::character varying, 'PARSING'::character varying, 'VECTOR_UPSERT'::character varying])::"text"[]))),
    CONSTRAINT "jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'upload_success'::"text", 'upload_complete'::"text", 'parsing'::"text", 'embedding'::"text", 'upserting'::"text", 'completed'::"text", 'failed'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."jobs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."jobs"."status_v2" IS 'queued|extracting|chunking|embedding|suggesting|completed|errored';



CREATE OR REPLACE VIEW "public"."jobs_status_vw" AS
 SELECT "job_id",
    COALESCE("status_v2", "status") AS "status",
    "job_type",
    "doc_id",
    "upload_id",
    "storage_path",
    "created_at",
    "started_at",
    "updated_at",
    "completed_at"
   FROM "public"."jobs";


ALTER VIEW "public"."jobs_status_vw" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."merge_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor" "text" NOT NULL,
    "action" "text" NOT NULL,
    "system_uid" "uuid" NOT NULL,
    "suggestion_id" "uuid",
    "before" "jsonb",
    "after" "jsonb"
);


ALTER TABLE "public"."merge_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."playbook_hints" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_id" character varying(255) NOT NULL,
    "title" character varying(255) NOT NULL,
    "description" "text",
    "steps" "jsonb" NOT NULL,
    "expected_outcome" "text",
    "preconditions" "jsonb",
    "error_codes" "jsonb",
    "page" integer,
    "confidence" numeric(3,2),
    "system_norm" "text",
    "subsystem_norm" "text",
    "manufacturer_norm" "text",
    "model_norm" "text",
    "asset_uid" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "approved_at" timestamp with time zone,
    "approved_by" "text",
    CONSTRAINT "playbook_hints_confidence_check1" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric)))
);


ALTER TABLE "public"."playbook_hints" OWNER TO "postgres";


COMMENT ON TABLE "public"."playbook_hints" IS 'This is a duplicate of staging_playbook_hints';



COMMENT ON COLUMN "public"."playbook_hints"."title" IS 'Procedure title from OpenAI response';



COMMENT ON COLUMN "public"."playbook_hints"."description" IS 'Models array converted to comma-separated string';



COMMENT ON COLUMN "public"."playbook_hints"."steps" IS 'Procedure steps array from OpenAI response';



COMMENT ON COLUMN "public"."playbook_hints"."expected_outcome" IS 'Expected outcome from OpenAI response';



COMMENT ON COLUMN "public"."playbook_hints"."preconditions" IS 'Preconditions array from OpenAI response';



COMMENT ON COLUMN "public"."playbook_hints"."error_codes" IS 'Error codes array from OpenAI response';



COMMENT ON COLUMN "public"."playbook_hints"."system_norm" IS 'Normalized system name for grouping';



COMMENT ON COLUMN "public"."playbook_hints"."subsystem_norm" IS 'Normalized subsystem name for grouping';



COMMENT ON COLUMN "public"."playbook_hints"."manufacturer_norm" IS 'Normalized manufacturer name';



COMMENT ON COLUMN "public"."playbook_hints"."model_norm" IS 'Normalized model name';



COMMENT ON COLUMN "public"."playbook_hints"."asset_uid" IS 'Asset unique identifier';



CREATE TABLE IF NOT EXISTS "public"."spec_lexicon" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "canonical" "text" NOT NULL,
    "unit" "text",
    "synonyms" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."spec_lexicon" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."spec_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_id" character varying(255) NOT NULL,
    "confidence" numeric(3,2),
    "approved_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "manufacturer_norm" "text",
    "model_norm" "text",
    "asset_uid" "uuid",
    "description" "text",
    "parameter" "text",
    "normalized_parameter" "text",
    "parameter_aliases" "jsonb" DEFAULT '[]'::"jsonb",
    "value" "text",
    "range" "text",
    "units" "text",
    "normalized_units" "text",
    "converted_value" "text",
    "category" "text",
    "search_terms" "jsonb" DEFAULT '[]'::"jsonb",
    "concept_group" "text",
    "references" "jsonb" DEFAULT '[]'::"jsonb",
    CONSTRAINT "spec_suggestions_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric)))
);


ALTER TABLE "public"."spec_suggestions" OWNER TO "postgres";


COMMENT ON TABLE "public"."spec_suggestions" IS 'This is a duplicate of staging_spec_suggestions';



CREATE TABLE IF NOT EXISTS "public"."staging_golden_tests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_id" "text" NOT NULL,
    "query" "text" NOT NULL,
    "expected" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "confidence" numeric,
    "page" integer,
    "manufacturer_norm" "text",
    "model_norm" "text",
    "asset_uid" "uuid",
    "description" "text",
    "test_method" "text",
    "failure_indication" "text",
    "related_procedures" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."staging_golden_tests" OWNER TO "postgres";


COMMENT ON TABLE "public"."staging_golden_tests" IS 'This is a duplicate of golden_tests';



COMMENT ON COLUMN "public"."staging_golden_tests"."doc_id" IS 'Reference to the document that generated this golden test';



COMMENT ON COLUMN "public"."staging_golden_tests"."query" IS 'The test query/question that should be asked';



COMMENT ON COLUMN "public"."staging_golden_tests"."expected" IS 'The expected answer/response for this query';



COMMENT ON COLUMN "public"."staging_golden_tests"."manufacturer_norm" IS 'Normalized manufacturer name from systems table';



COMMENT ON COLUMN "public"."staging_golden_tests"."model_norm" IS 'Normalized model name from systems table';



COMMENT ON COLUMN "public"."staging_golden_tests"."asset_uid" IS 'Asset UUID from systems table';



COMMENT ON COLUMN "public"."staging_golden_tests"."description" IS 'Description mapped from models JSON array';



COMMENT ON COLUMN "public"."staging_golden_tests"."test_method" IS 'How to verify this golden rule';



COMMENT ON COLUMN "public"."staging_golden_tests"."failure_indication" IS 'What it means if this rule fails';



COMMENT ON COLUMN "public"."staging_golden_tests"."related_procedures" IS 'Connected procedures or specs as JSONB array';



CREATE TABLE IF NOT EXISTS "public"."staging_instances" (
    "instance_uid" "text",
    "asset_uid" "text",
    "serial_number" "text",
    "location" "text",
    "system_norm" "text",
    "subsystem_norm" "text",
    "manufacturer_norm" "text",
    "model_norm" "text",
    "canonical_model_id" "text",
    "instance_index" "text"
);


ALTER TABLE "public"."staging_instances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staging_intent_router" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "text" DEFAULT 'admin'::"text",
    "doc_id" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "confidence" numeric,
    "manufacturer_norm" "text",
    "model_norm" "text",
    "asset_uid" "uuid",
    "description" "text",
    "question" "text",
    "question_variations" "jsonb" DEFAULT '[]'::"jsonb",
    "answer" "text",
    "question_type" "text",
    "references" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."staging_intent_router" OWNER TO "postgres";


COMMENT ON TABLE "public"."staging_intent_router" IS 'This is a duplicate of intent_router';



COMMENT ON COLUMN "public"."staging_intent_router"."manufacturer_norm" IS 'Normalized manufacturer name from systems table';



COMMENT ON COLUMN "public"."staging_intent_router"."model_norm" IS 'Normalized model name from systems table';



COMMENT ON COLUMN "public"."staging_intent_router"."asset_uid" IS 'Asset UUID from systems table';



COMMENT ON COLUMN "public"."staging_intent_router"."description" IS 'Description mapped from models JSON array';



COMMENT ON COLUMN "public"."staging_intent_router"."question" IS 'Natural language question (primary version)';



COMMENT ON COLUMN "public"."staging_intent_router"."question_variations" IS 'Alternative ways to ask the same question as JSONB array';



COMMENT ON COLUMN "public"."staging_intent_router"."answer" IS 'Direct, complete answer with specific details';



COMMENT ON COLUMN "public"."staging_intent_router"."question_type" IS 'Question type: What/How/When/Where/Why';



COMMENT ON COLUMN "public"."staging_intent_router"."references" IS 'Page numbers, sections, or related procedures as JSONB array';



CREATE TABLE IF NOT EXISTS "public"."staging_playbook_hints" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_id" character varying(255) NOT NULL,
    "title" character varying(255) NOT NULL,
    "description" "text",
    "steps" "jsonb" NOT NULL,
    "expected_outcome" "text",
    "preconditions" "jsonb",
    "error_codes" "jsonb",
    "page" integer,
    "confidence" numeric(3,2),
    "system_norm" "text",
    "subsystem_norm" "text",
    "manufacturer_norm" "text",
    "model_norm" "text",
    "asset_uid" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "playbook_hints_confidence_check1" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric)))
);


ALTER TABLE "public"."staging_playbook_hints" OWNER TO "postgres";


COMMENT ON TABLE "public"."staging_playbook_hints" IS 'This is a duplicate of playbook_hints';



COMMENT ON COLUMN "public"."staging_playbook_hints"."title" IS 'Procedure title from OpenAI response';



COMMENT ON COLUMN "public"."staging_playbook_hints"."description" IS 'Models array converted to comma-separated string';



COMMENT ON COLUMN "public"."staging_playbook_hints"."steps" IS 'Procedure steps array from OpenAI response';



COMMENT ON COLUMN "public"."staging_playbook_hints"."expected_outcome" IS 'Expected outcome from OpenAI response';



COMMENT ON COLUMN "public"."staging_playbook_hints"."preconditions" IS 'Preconditions array from OpenAI response';



COMMENT ON COLUMN "public"."staging_playbook_hints"."error_codes" IS 'Error codes array from OpenAI response';



COMMENT ON COLUMN "public"."staging_playbook_hints"."system_norm" IS 'Normalized system name for grouping';



COMMENT ON COLUMN "public"."staging_playbook_hints"."subsystem_norm" IS 'Normalized subsystem name for grouping';



COMMENT ON COLUMN "public"."staging_playbook_hints"."manufacturer_norm" IS 'Normalized manufacturer name';



COMMENT ON COLUMN "public"."staging_playbook_hints"."model_norm" IS 'Normalized model name';



COMMENT ON COLUMN "public"."staging_playbook_hints"."asset_uid" IS 'Asset unique identifier';



CREATE TABLE IF NOT EXISTS "public"."staging_spec_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "doc_id" character varying(255) NOT NULL,
    "confidence" numeric(3,2),
    "approved_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "manufacturer_norm" "text",
    "model_norm" "text",
    "asset_uid" "uuid",
    "description" "text",
    "parameter" "text",
    "normalized_parameter" "text",
    "parameter_aliases" "jsonb" DEFAULT '[]'::"jsonb",
    "value" "text",
    "range" "text",
    "units" "text",
    "normalized_units" "text",
    "converted_value" "text",
    "category" "text",
    "search_terms" "jsonb" DEFAULT '[]'::"jsonb",
    "concept_group" "text",
    "references" "jsonb" DEFAULT '[]'::"jsonb",
    CONSTRAINT "spec_suggestions_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric)))
);


ALTER TABLE "public"."staging_spec_suggestions" OWNER TO "postgres";


COMMENT ON TABLE "public"."staging_spec_suggestions" IS 'This is a duplicate of spec_suggestions';



CREATE TABLE IF NOT EXISTS "public"."staging_systems" (
    "asset_uid" "text",
    "system_norm" "text",
    "subsystem_norm" "text",
    "manufacturer_norm" "text",
    "model_norm" "text",
    "canonical_model_id" "text",
    "description" "text",
    "manual_url" "text",
    "oem_page" "text",
    "spec_keywords" "text",
    "synonyms_fts" "text",
    "synonyms_human" "text"
);


ALTER TABLE "public"."staging_systems" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."systems" (
    "asset_uid" "uuid" NOT NULL,
    "system_norm" "text",
    "subsystem_norm" "text",
    "manufacturer_norm" "text",
    "model_norm" "text",
    "canonical_model_id" "text",
    "description" "text",
    "manual_url" "text",
    "oem_page" "text",
    "spec_keywords" "text",
    "synonyms_fts" "text",
    "synonyms_human" "text",
    "search" "tsvector" GENERATED ALWAYS AS ((((((("setweight"("to_tsvector"('"simple"'::"regconfig", COALESCE("model_norm", ''::"text")), 'A'::"char") || "setweight"("to_tsvector"('"simple"'::"regconfig", COALESCE("synonyms_fts", ''::"text")), 'A'::"char")) || "setweight"("to_tsvector"('"simple"'::"regconfig", COALESCE("manufacturer_norm", ''::"text")), 'B'::"char")) || "setweight"("to_tsvector"('"simple"'::"regconfig", "public"."f_unaccent"(COALESCE("description", ''::"text"))), 'C'::"char")) || "setweight"("to_tsvector"('"simple"'::"regconfig", COALESCE("spec_keywords", ''::"text")), 'C'::"char")) || "setweight"("to_tsvector"('"simple"'::"regconfig", COALESCE("system_norm", ''::"text")), 'D'::"char")) || "setweight"("to_tsvector"('"simple"'::"regconfig", COALESCE("subsystem_norm", ''::"text")), 'D'::"char"))) STORED,
    "spec_keywords_jsonb" "jsonb" DEFAULT '{}'::"jsonb",
    "synonyms_jsonb" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."systems" OWNER TO "postgres";


COMMENT ON COLUMN "public"."systems"."spec_keywords" IS 'Array of normalized spec objects: [{key,value,unit?,source_doc_id,chunk_id,confidence?,approved_by,approved_at,active}]';



COMMENT ON COLUMN "public"."systems"."spec_keywords_jsonb" IS 'JSONB storage for merged spec suggestions from DIP processing';



COMMENT ON COLUMN "public"."systems"."synonyms_jsonb" IS 'JSONB storage for merged entity synonyms from DIP processing';



CREATE OR REPLACE VIEW "public"."v_systems_with_instances" AS
SELECT
    NULL::"uuid" AS "asset_uid",
    NULL::"text" AS "system_norm",
    NULL::"text" AS "subsystem_norm",
    NULL::"text" AS "manufacturer_norm",
    NULL::"text" AS "model_norm",
    NULL::"text" AS "canonical_model_id",
    NULL::"text" AS "description",
    NULL::"text" AS "manual_url",
    NULL::"text" AS "oem_page",
    NULL::"text" AS "spec_keywords",
    NULL::"text" AS "synonyms_fts",
    NULL::"text" AS "synonyms_human",
    NULL::"tsvector" AS "search",
    NULL::bigint AS "instance_count",
    NULL::"jsonb" AS "instances";


ALTER VIEW "public"."v_systems_with_instances" OWNER TO "postgres";


ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_threads"
    ADD CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_threads"
    ADD CONSTRAINT "chat_threads_session_id_unique" UNIQUE ("session_id");



ALTER TABLE ONLY "public"."declined_golden_tests"
    ADD CONSTRAINT "declined_golden_tests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."declined_intent_router"
    ADD CONSTRAINT "declined_intent_router_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."declined_playbook_hints"
    ADD CONSTRAINT "declined_playbook_hints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."declined_spec_suggestions"
    ADD CONSTRAINT "declined_spec_suggestions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_chunks"
    ADD CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("chunk_id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("doc_id");



ALTER TABLE ONLY "public"."golden_tests"
    ADD CONSTRAINT "golden_tests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."instances"
    ADD CONSTRAINT "instances_pkey" PRIMARY KEY ("instance_uid");



ALTER TABLE ONLY "public"."intent_router"
    ADD CONSTRAINT "intent_router_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("job_id");



ALTER TABLE ONLY "public"."merge_audit"
    ADD CONSTRAINT "merge_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."playbook_hints"
    ADD CONSTRAINT "playbook_hints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."spec_lexicon"
    ADD CONSTRAINT "spec_lexicon_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."spec_suggestions"
    ADD CONSTRAINT "spec_suggestions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staging_golden_tests"
    ADD CONSTRAINT "staging_golden_tests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staging_playbook_hints"
    ADD CONSTRAINT "staging_playbook_hints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staging_intent_router"
    ADD CONSTRAINT "staging_router_duplicate_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staging_spec_suggestions"
    ADD CONSTRAINT "staging_spec_suggestions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."systems"
    ADD CONSTRAINT "systems_pkey" PRIMARY KEY ("asset_uid");



CREATE INDEX "declined_golden_tests_asset_uid_idx" ON "public"."declined_golden_tests" USING "btree" ("asset_uid");



CREATE INDEX "declined_golden_tests_doc_id_idx" ON "public"."declined_golden_tests" USING "btree" ("doc_id");



CREATE INDEX "declined_golden_tests_manufacturer_norm_idx" ON "public"."declined_golden_tests" USING "btree" ("manufacturer_norm");



CREATE INDEX "declined_golden_tests_model_norm_idx" ON "public"."declined_golden_tests" USING "btree" ("model_norm");



CREATE INDEX "declined_golden_tests_status_idx" ON "public"."declined_golden_tests" USING "btree" ("status");



CREATE INDEX "declined_intent_router_asset_uid_idx" ON "public"."declined_intent_router" USING "btree" ("asset_uid");



CREATE INDEX "declined_intent_router_manufacturer_norm_idx" ON "public"."declined_intent_router" USING "btree" ("manufacturer_norm");



CREATE INDEX "declined_intent_router_model_norm_idx" ON "public"."declined_intent_router" USING "btree" ("model_norm");



CREATE INDEX "declined_intent_router_question_type_idx" ON "public"."declined_intent_router" USING "btree" ("question_type");



CREATE INDEX "declined_intent_router_status_idx" ON "public"."declined_intent_router" USING "btree" ("status");



CREATE INDEX "declined_playbook_hints_asset_uid_idx" ON "public"."declined_playbook_hints" USING "btree" ("asset_uid");



CREATE INDEX "declined_playbook_hints_doc_id_idx" ON "public"."declined_playbook_hints" USING "btree" ("doc_id");



CREATE INDEX "declined_playbook_hints_manufacturer_norm_idx" ON "public"."declined_playbook_hints" USING "btree" ("manufacturer_norm");



CREATE INDEX "declined_playbook_hints_model_norm_idx" ON "public"."declined_playbook_hints" USING "btree" ("model_norm");



CREATE INDEX "declined_playbook_hints_status_idx" ON "public"."declined_playbook_hints" USING "btree" ("status");



CREATE INDEX "declined_playbook_hints_subsystem_norm_idx" ON "public"."declined_playbook_hints" USING "btree" ("subsystem_norm");



CREATE INDEX "declined_playbook_hints_system_norm_idx" ON "public"."declined_playbook_hints" USING "btree" ("system_norm");



CREATE INDEX "declined_playbook_hints_title_idx" ON "public"."declined_playbook_hints" USING "btree" ("title");



CREATE INDEX "declined_spec_suggestions_approved_at_idx" ON "public"."declined_spec_suggestions" USING "btree" ("approved_at");



CREATE INDEX "declined_spec_suggestions_asset_uid_idx" ON "public"."declined_spec_suggestions" USING "btree" ("asset_uid");



CREATE INDEX "declined_spec_suggestions_category_idx" ON "public"."declined_spec_suggestions" USING "btree" ("category");



CREATE INDEX "declined_spec_suggestions_concept_group_idx" ON "public"."declined_spec_suggestions" USING "btree" ("concept_group");



CREATE INDEX "declined_spec_suggestions_doc_id_idx" ON "public"."declined_spec_suggestions" USING "btree" ("doc_id");



CREATE INDEX "declined_spec_suggestions_manufacturer_norm_idx" ON "public"."declined_spec_suggestions" USING "btree" ("manufacturer_norm");



CREATE INDEX "declined_spec_suggestions_model_norm_idx" ON "public"."declined_spec_suggestions" USING "btree" ("model_norm");



CREATE INDEX "declined_spec_suggestions_normalized_parameter_idx" ON "public"."declined_spec_suggestions" USING "btree" ("normalized_parameter");



CREATE INDEX "golden_tests_asset_uid_idx" ON "public"."golden_tests" USING "btree" ("asset_uid");



CREATE INDEX "golden_tests_doc_id_idx" ON "public"."golden_tests" USING "btree" ("doc_id");



CREATE INDEX "golden_tests_manufacturer_norm_idx" ON "public"."golden_tests" USING "btree" ("manufacturer_norm");



CREATE INDEX "golden_tests_model_norm_idx" ON "public"."golden_tests" USING "btree" ("model_norm");



CREATE INDEX "golden_tests_status_idx" ON "public"."golden_tests" USING "btree" ("status");



CREATE INDEX "idx_chat_messages_created_at" ON "public"."chat_messages" USING "btree" ("created_at");



CREATE INDEX "idx_chat_messages_thread_id" ON "public"."chat_messages" USING "btree" ("thread_id");



CREATE INDEX "idx_chat_sessions_updated_at" ON "public"."chat_sessions" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_chat_threads_session_id" ON "public"."chat_threads" USING "btree" ("session_id");



CREATE INDEX "idx_chat_threads_updated_at" ON "public"."chat_threads" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_declined_golden_tests_declined_at" ON "public"."declined_golden_tests" USING "btree" ("declined_at");



CREATE INDEX "idx_declined_golden_tests_declined_by" ON "public"."declined_golden_tests" USING "btree" ("declined_by");



CREATE INDEX "idx_declined_intent_router_declined_at" ON "public"."declined_intent_router" USING "btree" ("declined_at");



CREATE INDEX "idx_declined_intent_router_declined_by" ON "public"."declined_intent_router" USING "btree" ("declined_by");



CREATE INDEX "idx_declined_playbook_hints_declined_at" ON "public"."declined_playbook_hints" USING "btree" ("declined_at");



CREATE INDEX "idx_declined_playbook_hints_declined_by" ON "public"."declined_playbook_hints" USING "btree" ("declined_by");



CREATE INDEX "idx_declined_spec_suggestions_declined_at" ON "public"."declined_spec_suggestions" USING "btree" ("declined_at");



CREATE INDEX "idx_declined_spec_suggestions_declined_by" ON "public"."declined_spec_suggestions" USING "btree" ("declined_by");



CREATE INDEX "idx_document_chunks_checksum" ON "public"."document_chunks" USING "btree" ("checksum");



CREATE INDEX "idx_document_chunks_content_type" ON "public"."document_chunks" USING "btree" ("content_type");



CREATE INDEX "idx_document_chunks_doc_id_page" ON "public"."document_chunks" USING "btree" ("doc_id", "page_start");



CREATE INDEX "idx_document_chunks_doc_page" ON "public"."document_chunks" USING "btree" ("doc_id", "page_start");



CREATE INDEX "idx_documents_asset_uid" ON "public"."documents" USING "btree" ("asset_uid");



CREATE INDEX "idx_documents_language" ON "public"."documents" USING "btree" ("language");



CREATE INDEX "idx_documents_manufacturer_model" ON "public"."documents" USING "btree" ("manufacturer", "model");



CREATE INDEX "idx_documents_revision_date" ON "public"."documents" USING "btree" ("revision_date" DESC);



CREATE INDEX "idx_jobs_created_at" ON "public"."jobs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_jobs_dip_success" ON "public"."jobs" USING "btree" ("dip_success");



CREATE INDEX "idx_jobs_doc_id" ON "public"."jobs" USING "btree" ("doc_id");



CREATE INDEX "idx_jobs_job_type" ON "public"."jobs" USING "btree" ("job_type");



CREATE INDEX "idx_jobs_status" ON "public"."jobs" USING "btree" ("status");



CREATE INDEX "idx_jobs_updated_at" ON "public"."jobs" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_staging_golden_tests_asset_uid" ON "public"."staging_golden_tests" USING "btree" ("asset_uid");



CREATE INDEX "idx_staging_golden_tests_manufacturer_norm" ON "public"."staging_golden_tests" USING "btree" ("manufacturer_norm");



CREATE INDEX "idx_staging_golden_tests_model_norm" ON "public"."staging_golden_tests" USING "btree" ("model_norm");



CREATE INDEX "idx_staging_golden_tests_status" ON "public"."staging_golden_tests" USING "btree" ("status");



CREATE INDEX "idx_staging_intent_router_asset_uid" ON "public"."staging_intent_router" USING "btree" ("asset_uid");



CREATE INDEX "idx_staging_intent_router_manufacturer_norm" ON "public"."staging_intent_router" USING "btree" ("manufacturer_norm");



CREATE INDEX "idx_staging_intent_router_model_norm" ON "public"."staging_intent_router" USING "btree" ("model_norm");



CREATE INDEX "idx_staging_intent_router_question_type" ON "public"."staging_intent_router" USING "btree" ("question_type");



CREATE INDEX "idx_staging_intent_router_status" ON "public"."staging_intent_router" USING "btree" ("status");



CREATE INDEX "idx_staging_spec_suggestions_asset_uid" ON "public"."staging_spec_suggestions" USING "btree" ("asset_uid");



CREATE INDEX "idx_staging_spec_suggestions_category" ON "public"."staging_spec_suggestions" USING "btree" ("category");



CREATE INDEX "idx_staging_spec_suggestions_concept_group" ON "public"."staging_spec_suggestions" USING "btree" ("concept_group");



CREATE INDEX "idx_staging_spec_suggestions_manufacturer_norm" ON "public"."staging_spec_suggestions" USING "btree" ("manufacturer_norm");



CREATE INDEX "idx_staging_spec_suggestions_model_norm" ON "public"."staging_spec_suggestions" USING "btree" ("model_norm");



CREATE INDEX "idx_staging_spec_suggestions_normalized_parameter" ON "public"."staging_spec_suggestions" USING "btree" ("normalized_parameter");



CREATE INDEX "idx_systems_spec_keywords_jsonb" ON "public"."systems" USING "gin" ("spec_keywords_jsonb");



CREATE INDEX "idx_systems_synonyms_jsonb" ON "public"."systems" USING "gin" ("synonyms_jsonb");



CREATE INDEX "instances_asset_idx" ON "public"."instances" USING "btree" ("asset_uid");



CREATE UNIQUE INDEX "instances_unique_serial" ON "public"."instances" USING "btree" ("asset_uid", "serial_number") WHERE (NULLIF("serial_number", ''::"text") IS NOT NULL);



CREATE UNIQUE INDEX "instances_unique_serial_canon" ON "public"."instances" USING "btree" ("asset_uid", "serial_canon") WHERE ("serial_canon" IS NOT NULL);



CREATE INDEX "intent_router_asset_uid_idx" ON "public"."intent_router" USING "btree" ("asset_uid");



CREATE INDEX "intent_router_manufacturer_norm_idx" ON "public"."intent_router" USING "btree" ("manufacturer_norm");



CREATE INDEX "intent_router_model_norm_idx" ON "public"."intent_router" USING "btree" ("model_norm");



CREATE INDEX "intent_router_question_type_idx" ON "public"."intent_router" USING "btree" ("question_type");



CREATE INDEX "intent_router_status_idx" ON "public"."intent_router" USING "btree" ("status");



CREATE INDEX "playbook_hints_asset_uid_idx" ON "public"."playbook_hints" USING "btree" ("asset_uid");



CREATE INDEX "playbook_hints_doc_id_idx" ON "public"."playbook_hints" USING "btree" ("doc_id");



CREATE INDEX "playbook_hints_manufacturer_norm_idx" ON "public"."playbook_hints" USING "btree" ("manufacturer_norm");



CREATE INDEX "playbook_hints_model_norm_idx" ON "public"."playbook_hints" USING "btree" ("model_norm");



CREATE INDEX "playbook_hints_status_idx" ON "public"."playbook_hints" USING "btree" ("status");



CREATE INDEX "playbook_hints_subsystem_norm_idx" ON "public"."playbook_hints" USING "btree" ("subsystem_norm");



CREATE INDEX "playbook_hints_system_norm_idx" ON "public"."playbook_hints" USING "btree" ("system_norm");



CREATE INDEX "playbook_hints_title_idx" ON "public"."playbook_hints" USING "btree" ("title");



CREATE INDEX "spec_lexicon_synonyms_idx" ON "public"."spec_lexicon" USING "gin" ("synonyms");



CREATE INDEX "spec_suggestions_approved_at_idx" ON "public"."spec_suggestions" USING "btree" ("approved_at");



CREATE INDEX "spec_suggestions_asset_uid_idx" ON "public"."spec_suggestions" USING "btree" ("asset_uid");



CREATE INDEX "spec_suggestions_category_idx" ON "public"."spec_suggestions" USING "btree" ("category");



CREATE INDEX "spec_suggestions_concept_group_idx" ON "public"."spec_suggestions" USING "btree" ("concept_group");



CREATE INDEX "spec_suggestions_doc_id_idx" ON "public"."spec_suggestions" USING "btree" ("doc_id");



CREATE INDEX "spec_suggestions_manufacturer_norm_idx" ON "public"."spec_suggestions" USING "btree" ("manufacturer_norm");



CREATE INDEX "spec_suggestions_model_norm_idx" ON "public"."spec_suggestions" USING "btree" ("model_norm");



CREATE INDEX "spec_suggestions_normalized_parameter_idx" ON "public"."spec_suggestions" USING "btree" ("normalized_parameter");



CREATE INDEX "staging_golden_tests_doc_id_idx" ON "public"."staging_golden_tests" USING "btree" ("doc_id");



CREATE INDEX "staging_playbook_hints_asset_uid_idx" ON "public"."staging_playbook_hints" USING "btree" ("asset_uid");



CREATE INDEX "staging_playbook_hints_doc_id_idx" ON "public"."staging_playbook_hints" USING "btree" ("doc_id");



CREATE INDEX "staging_playbook_hints_manufacturer_norm_idx" ON "public"."staging_playbook_hints" USING "btree" ("manufacturer_norm");



CREATE INDEX "staging_playbook_hints_model_norm_idx" ON "public"."staging_playbook_hints" USING "btree" ("model_norm");



CREATE INDEX "staging_playbook_hints_status_idx" ON "public"."staging_playbook_hints" USING "btree" ("status");



CREATE INDEX "staging_playbook_hints_subsystem_norm_idx" ON "public"."staging_playbook_hints" USING "btree" ("subsystem_norm");



CREATE INDEX "staging_playbook_hints_system_norm_idx" ON "public"."staging_playbook_hints" USING "btree" ("system_norm");



CREATE INDEX "staging_playbook_hints_title_idx" ON "public"."staging_playbook_hints" USING "btree" ("title");



CREATE INDEX "staging_spec_suggestions_approved_at_idx" ON "public"."staging_spec_suggestions" USING "btree" ("approved_at");



CREATE INDEX "staging_spec_suggestions_doc_id_idx" ON "public"."staging_spec_suggestions" USING "btree" ("doc_id");



CREATE INDEX "systems_search_idx" ON "public"."systems" USING "gin" ("search");



CREATE UNIQUE INDEX "systems_unique_make_model" ON "public"."systems" USING "btree" ("manufacturer_norm", "model_norm");



CREATE OR REPLACE VIEW "public"."v_systems_with_instances" AS
 SELECT "s"."asset_uid",
    "s"."system_norm",
    "s"."subsystem_norm",
    "s"."manufacturer_norm",
    "s"."model_norm",
    "s"."canonical_model_id",
    "s"."description",
    "s"."manual_url",
    "s"."oem_page",
    "s"."spec_keywords",
    "s"."synonyms_fts",
    "s"."synonyms_human",
    "s"."search",
    "count"("i"."instance_uid") AS "instance_count",
    COALESCE("jsonb_agg"("jsonb_build_object"('instance_uid', "i"."instance_uid", 'serial_number', "i"."serial_number", 'location', "i"."location") ORDER BY "i"."serial_number") FILTER (WHERE ("i"."instance_uid" IS NOT NULL)), '[]'::"jsonb") AS "instances"
   FROM ("public"."systems" "s"
     LEFT JOIN "public"."instances" "i" USING ("asset_uid"))
  GROUP BY "s"."asset_uid";



CREATE OR REPLACE TRIGGER "dip_complete_trigger" AFTER UPDATE ON "public"."jobs" FOR EACH ROW EXECUTE FUNCTION "public"."notify_dip_complete"();



CREATE OR REPLACE TRIGGER "update_documents_updated_at" BEFORE UPDATE ON "public"."documents" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_jobs_updated_at" BEFORE UPDATE ON "public"."jobs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_threads"
    ADD CONSTRAINT "chat_threads_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_chunks"
    ADD CONSTRAINT "document_chunks_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("doc_id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_last_job_id_fkey" FOREIGN KEY ("last_job_id") REFERENCES "public"."jobs"("job_id");



ALTER TABLE ONLY "public"."staging_spec_suggestions"
    ADD CONSTRAINT "fk_staging_spec_suggestions_asset_uid" FOREIGN KEY ("asset_uid") REFERENCES "public"."systems"("asset_uid") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."golden_tests"
    ADD CONSTRAINT "golden_tests_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("doc_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."instances"
    ADD CONSTRAINT "instances_asset_uid_fkey" FOREIGN KEY ("asset_uid") REFERENCES "public"."systems"("asset_uid") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."intent_router"
    ADD CONSTRAINT "intent_router_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("doc_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."playbook_hints"
    ADD CONSTRAINT "playbook_hints_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("doc_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."spec_suggestions"
    ADD CONSTRAINT "spec_suggestions_asset_uid_fkey" FOREIGN KEY ("asset_uid") REFERENCES "public"."systems"("asset_uid") ON UPDATE CASCADE ON DELETE SET NULL;



ALTER TABLE ONLY "public"."spec_suggestions"
    ADD CONSTRAINT "spec_suggestions_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("doc_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staging_golden_tests"
    ADD CONSTRAINT "staging_golden_tests_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("doc_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staging_playbook_hints"
    ADD CONSTRAINT "staging_playbook_hints_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("doc_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staging_intent_router"
    ADD CONSTRAINT "staging_router_duplicate_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("doc_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staging_spec_suggestions"
    ADD CONSTRAINT "staging_spec_suggestions_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "public"."documents"("doc_id") ON DELETE CASCADE;



CREATE POLICY "Allow all operations on chat_messages" ON "public"."chat_messages" USING (true);



CREATE POLICY "Allow all operations on chat_sessions" ON "public"."chat_sessions" USING (true);



CREATE POLICY "Allow all operations on chat_threads" ON "public"."chat_threads" USING (true);



ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_threads" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."bytea_to_text"("data" "bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."bytea_to_text"("data" "bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."bytea_to_text"("data" "bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bytea_to_text"("data" "bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."f_unaccent"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."f_unaccent"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."f_unaccent"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_job_status"("job_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_job_status"("job_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_job_status"("job_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."http"("request" "public"."http_request") TO "postgres";
GRANT ALL ON FUNCTION "public"."http"("request" "public"."http_request") TO "anon";
GRANT ALL ON FUNCTION "public"."http"("request" "public"."http_request") TO "authenticated";
GRANT ALL ON FUNCTION "public"."http"("request" "public"."http_request") TO "service_role";



GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying, "content" character varying, "content_type" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying, "content" character varying, "content_type" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying, "content" character varying, "content_type" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_delete"("uri" character varying, "content" character varying, "content_type" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying, "data" "jsonb") TO "postgres";
GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying, "data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying, "data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_get"("uri" character varying, "data" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."http_head"("uri" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_head"("uri" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_head"("uri" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_head"("uri" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_header"("field" character varying, "value" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_header"("field" character varying, "value" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_header"("field" character varying, "value" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_header"("field" character varying, "value" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_list_curlopt"() TO "postgres";
GRANT ALL ON FUNCTION "public"."http_list_curlopt"() TO "anon";
GRANT ALL ON FUNCTION "public"."http_list_curlopt"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_list_curlopt"() TO "service_role";



GRANT ALL ON FUNCTION "public"."http_patch"("uri" character varying, "content" character varying, "content_type" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_patch"("uri" character varying, "content" character varying, "content_type" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_patch"("uri" character varying, "content" character varying, "content_type" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_patch"("uri" character varying, "content" character varying, "content_type" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "data" "jsonb") TO "postgres";
GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "data" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "content" character varying, "content_type" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "content" character varying, "content_type" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "content" character varying, "content_type" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_post"("uri" character varying, "content" character varying, "content_type" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_put"("uri" character varying, "content" character varying, "content_type" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_put"("uri" character varying, "content" character varying, "content_type" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_put"("uri" character varying, "content" character varying, "content_type" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_put"("uri" character varying, "content" character varying, "content_type" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."http_reset_curlopt"() TO "postgres";
GRANT ALL ON FUNCTION "public"."http_reset_curlopt"() TO "anon";
GRANT ALL ON FUNCTION "public"."http_reset_curlopt"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_reset_curlopt"() TO "service_role";



GRANT ALL ON FUNCTION "public"."http_set_curlopt"("curlopt" character varying, "value" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."http_set_curlopt"("curlopt" character varying, "value" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."http_set_curlopt"("curlopt" character varying, "value" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."http_set_curlopt"("curlopt" character varying, "value" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_dip_complete"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_dip_complete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_dip_complete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_knowledge_facts"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_knowledge_facts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_knowledge_facts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_knowledge_facts_view"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_knowledge_facts_view"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_knowledge_facts_view"() TO "service_role";



GRANT ALL ON FUNCTION "public"."search_systems"("q" "text", "top_n" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_systems"("q" "text", "top_n" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_systems"("q" "text", "top_n" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."text_to_bytea"("data" "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."text_to_bytea"("data" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."text_to_bytea"("data" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."text_to_bytea"("data" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."urlencode"("string" "bytea") TO "postgres";
GRANT ALL ON FUNCTION "public"."urlencode"("string" "bytea") TO "anon";
GRANT ALL ON FUNCTION "public"."urlencode"("string" "bytea") TO "authenticated";
GRANT ALL ON FUNCTION "public"."urlencode"("string" "bytea") TO "service_role";



GRANT ALL ON FUNCTION "public"."urlencode"("data" "jsonb") TO "postgres";
GRANT ALL ON FUNCTION "public"."urlencode"("data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."urlencode"("data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."urlencode"("data" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."urlencode"("string" character varying) TO "postgres";
GRANT ALL ON FUNCTION "public"."urlencode"("string" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."urlencode"("string" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."urlencode"("string" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";


















GRANT ALL ON TABLE "public"."chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";



GRANT ALL ON TABLE "public"."chat_sessions" TO "anon";
GRANT ALL ON TABLE "public"."chat_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."chat_threads" TO "anon";
GRANT ALL ON TABLE "public"."chat_threads" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_threads" TO "service_role";



GRANT ALL ON TABLE "public"."declined_golden_tests" TO "anon";
GRANT ALL ON TABLE "public"."declined_golden_tests" TO "authenticated";
GRANT ALL ON TABLE "public"."declined_golden_tests" TO "service_role";



GRANT ALL ON TABLE "public"."declined_intent_router" TO "anon";
GRANT ALL ON TABLE "public"."declined_intent_router" TO "authenticated";
GRANT ALL ON TABLE "public"."declined_intent_router" TO "service_role";



GRANT ALL ON TABLE "public"."declined_playbook_hints" TO "anon";
GRANT ALL ON TABLE "public"."declined_playbook_hints" TO "authenticated";
GRANT ALL ON TABLE "public"."declined_playbook_hints" TO "service_role";



GRANT ALL ON TABLE "public"."declined_spec_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."declined_spec_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."declined_spec_suggestions" TO "service_role";



GRANT ALL ON TABLE "public"."document_chunks" TO "anon";
GRANT ALL ON TABLE "public"."document_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."document_chunks" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."golden_tests" TO "anon";
GRANT ALL ON TABLE "public"."golden_tests" TO "authenticated";
GRANT ALL ON TABLE "public"."golden_tests" TO "service_role";



GRANT ALL ON TABLE "public"."instances" TO "anon";
GRANT ALL ON TABLE "public"."instances" TO "authenticated";
GRANT ALL ON TABLE "public"."instances" TO "service_role";



GRANT ALL ON TABLE "public"."intent_router" TO "anon";
GRANT ALL ON TABLE "public"."intent_router" TO "authenticated";
GRANT ALL ON TABLE "public"."intent_router" TO "service_role";



GRANT ALL ON TABLE "public"."jobs" TO "anon";
GRANT ALL ON TABLE "public"."jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."jobs" TO "service_role";



GRANT ALL ON TABLE "public"."jobs_status_vw" TO "anon";
GRANT ALL ON TABLE "public"."jobs_status_vw" TO "authenticated";
GRANT ALL ON TABLE "public"."jobs_status_vw" TO "service_role";



GRANT ALL ON TABLE "public"."merge_audit" TO "anon";
GRANT ALL ON TABLE "public"."merge_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."merge_audit" TO "service_role";



GRANT ALL ON TABLE "public"."playbook_hints" TO "anon";
GRANT ALL ON TABLE "public"."playbook_hints" TO "authenticated";
GRANT ALL ON TABLE "public"."playbook_hints" TO "service_role";



GRANT ALL ON TABLE "public"."spec_lexicon" TO "anon";
GRANT ALL ON TABLE "public"."spec_lexicon" TO "authenticated";
GRANT ALL ON TABLE "public"."spec_lexicon" TO "service_role";



GRANT ALL ON TABLE "public"."spec_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."spec_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."spec_suggestions" TO "service_role";



GRANT ALL ON TABLE "public"."staging_golden_tests" TO "anon";
GRANT ALL ON TABLE "public"."staging_golden_tests" TO "authenticated";
GRANT ALL ON TABLE "public"."staging_golden_tests" TO "service_role";



GRANT ALL ON TABLE "public"."staging_instances" TO "anon";
GRANT ALL ON TABLE "public"."staging_instances" TO "authenticated";
GRANT ALL ON TABLE "public"."staging_instances" TO "service_role";



GRANT ALL ON TABLE "public"."staging_intent_router" TO "anon";
GRANT ALL ON TABLE "public"."staging_intent_router" TO "authenticated";
GRANT ALL ON TABLE "public"."staging_intent_router" TO "service_role";



GRANT ALL ON TABLE "public"."staging_playbook_hints" TO "anon";
GRANT ALL ON TABLE "public"."staging_playbook_hints" TO "authenticated";
GRANT ALL ON TABLE "public"."staging_playbook_hints" TO "service_role";



GRANT ALL ON TABLE "public"."staging_spec_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."staging_spec_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."staging_spec_suggestions" TO "service_role";



GRANT ALL ON TABLE "public"."staging_systems" TO "anon";
GRANT ALL ON TABLE "public"."staging_systems" TO "authenticated";
GRANT ALL ON TABLE "public"."staging_systems" TO "service_role";



GRANT ALL ON TABLE "public"."systems" TO "anon";
GRANT ALL ON TABLE "public"."systems" TO "authenticated";
GRANT ALL ON TABLE "public"."systems" TO "service_role";



GRANT ALL ON TABLE "public"."v_systems_with_instances" TO "anon";
GRANT ALL ON TABLE "public"."v_systems_with_instances" TO "authenticated";
GRANT ALL ON TABLE "public"."v_systems_with_instances" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






























RESET ALL;
