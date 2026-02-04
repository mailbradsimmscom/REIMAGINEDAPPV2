#!/usr/bin/env node
/**
 * Dump Live Database Schema
 *
 * Pulls the ACTUAL database schema from Supabase and writes markdown files
 * that AI tools can reference as the source of truth.
 *
 * First run:
 *   1. Run this script — it will detect the missing RPC function
 *   2. Copy the printed SQL into Supabase SQL Editor and run it
 *   3. Re-run this script
 *
 * Usage:
 *   node scripts/migrations/actual/dump-live-schema.mjs
 *
 * Output (in this same folder):
 *   _schema_summary.md       — Table list, row counts, last dump timestamp
 *   tables/<table_name>.md   — Per-table: columns, types, PKs, FKs, indexes, constraints
 *   functions.md             — All RPC function signatures + SQL bodies
 *   foreign_keys.md          — FK relationship map across all tables
 *   views.md                 — View definitions
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATE_PREFIX = new Date().toISOString().split('T')[0]; // e.g. 2026-02-04
const TABLES_DIR = join(__dirname, `${DATE_PREFIX}_tables`);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.PY_SUPABASE_SERVICE_KEY ||
                     process.env.SUPABASE_SERVICE_KEY ||
                     process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or service key in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const NOW = new Date().toISOString();

// ============================================
// RPC FUNCTION SQL (user must create this once)
// ============================================

const CREATE_RPC_SQL = `
-- Schema dump helper function (read-only, schema introspection only)
-- Run this ONCE in the Supabase SQL Editor, then re-run the dump script.

CREATE OR REPLACE FUNCTION public.dump_schema(query_name text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  CASE query_name

  WHEN 'columns' THEN
    SELECT json_agg(t) INTO result FROM (
      SELECT table_name, column_name, ordinal_position,
             CASE
               WHEN data_type = 'ARRAY' THEN udt_name || '[]'
               WHEN data_type = 'USER-DEFINED' THEN udt_name
               ELSE data_type
             END AS full_type,
             is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    ) t;

  WHEN 'primary_keys' THEN
    SELECT json_agg(t) INTO result FROM (
      SELECT tc.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name, kcu.ordinal_position
    ) t;

  WHEN 'foreign_keys' THEN
    SELECT json_agg(t) INTO result FROM (
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table,
        ccu.column_name AS foreign_column,
        rc.delete_rule,
        rc.update_rule,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
        AND tc.constraint_schema = rc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name, kcu.column_name
    ) t;

  WHEN 'unique_constraints' THEN
    SELECT json_agg(t) INTO result FROM (
      SELECT tc.table_name, tc.constraint_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'UNIQUE'
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
    ) t;

  WHEN 'check_constraints' THEN
    SELECT json_agg(t) INTO result FROM (
      SELECT
        tc.table_name,
        tc.constraint_name,
        cc.check_clause
      FROM information_schema.table_constraints tc
      JOIN information_schema.check_constraints cc
        ON tc.constraint_name = cc.constraint_name
        AND tc.constraint_schema = cc.constraint_schema
      WHERE tc.constraint_type = 'CHECK'
        AND tc.table_schema = 'public'
        AND tc.constraint_name NOT LIKE '%_not_null'
      ORDER BY tc.table_name, tc.constraint_name
    ) t;

  WHEN 'indexes' THEN
    SELECT json_agg(t) INTO result FROM (
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
    ) t;

  WHEN 'functions' THEN
    SELECT json_agg(t) INTO result FROM (
      SELECT
        p.proname AS function_name,
        pg_get_function_arguments(p.oid) AS arguments,
        pg_get_function_result(p.oid) AS return_type,
        CASE p.prokind
          WHEN 'f' THEN 'function'
          WHEN 'p' THEN 'procedure'
          WHEN 'a' THEN 'aggregate'
          WHEN 'w' THEN 'window'
        END AS kind,
        CASE WHEN p.prokind IN ('f', 'p') THEN pg_get_functiondef(p.oid) ELSE NULL END AS definition
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
      ORDER BY p.proname
    ) t;

  WHEN 'row_counts' THEN
    SELECT json_agg(t) INTO result FROM (
      SELECT relname AS table_name, n_live_tup AS row_count
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY relname
    ) t;

  WHEN 'views' THEN
    SELECT json_agg(t) INTO result FROM (
      SELECT table_name, view_definition
      FROM information_schema.views
      WHERE table_schema = 'public'
      ORDER BY table_name
    ) t;

  ELSE
    RAISE EXCEPTION 'Unknown query_name: %', query_name;
  END CASE;

  RETURN COALESCE(result, '[]'::json);
END;
$$;
`;

// ============================================
// HELPERS
// ============================================

async function fetchSchema(queryName) {
  const { data, error } = await supabase.rpc('dump_schema', { query_name: queryName });

  if (error) {
    if (error.message.includes('dump_schema') || error.code === 'PGRST202') {
      console.error('\n\ndump_schema() RPC function not found.\n');
      console.error('Copy the SQL below, paste it into the Supabase SQL Editor, and run it.');
      console.error('Then re-run this script.\n');
      console.error('─'.repeat(70));
      console.error(CREATE_RPC_SQL);
      console.error('─'.repeat(70));
      process.exit(1);
    }
    throw new Error(`dump_schema('${queryName}') error: ${error.message}`);
  }

  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { return []; }
  }
  return data || [];
}

function groupBy(arr, key) {
  const map = {};
  for (const item of arr) {
    const k = item[key];
    if (!map[k]) map[k] = [];
    map[k].push(item);
  }
  return map;
}

function indexType(indexdef) {
  if (!indexdef) return 'btree';
  const m = indexdef.match(/USING\s+(\w+)/i);
  return m ? m[1].toLowerCase() : 'btree';
}

function indexColumns(indexdef) {
  if (!indexdef) return '';
  const m = indexdef.match(/\(([^)]+)\)/);
  return m ? m[1].trim() : '';
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log('Dumping live database schema...');
  console.log(`Database: ${SUPABASE_URL.split('//')[1]?.split('.')[0]}...`);
  console.log(`Timestamp: ${NOW}\n`);

  mkdirSync(TABLES_DIR, { recursive: true });

  // Fetch everything
  console.log('  Fetching columns...');
  const columns = await fetchSchema('columns');

  console.log('  Fetching primary keys...');
  const pks = await fetchSchema('primary_keys');

  console.log('  Fetching foreign keys...');
  const fks = await fetchSchema('foreign_keys');

  console.log('  Fetching unique constraints...');
  const uniques = await fetchSchema('unique_constraints');

  console.log('  Fetching check constraints...');
  const checks = await fetchSchema('check_constraints');

  console.log('  Fetching indexes...');
  const indexes = await fetchSchema('indexes');

  console.log('  Fetching functions...');
  let functions = [];
  try {
    functions = await fetchSchema('functions');
  } catch (err) {
    console.log(`    (functions skipped: ${err.message})`);
  }

  console.log('  Fetching row counts...');
  const rowCounts = await fetchSchema('row_counts');

  console.log('  Fetching views...');
  let views = [];
  try {
    views = await fetchSchema('views');
  } catch (err) {
    console.log(`    (views skipped: ${err.message})`);
  }

  // Group data by table
  const colsByTable = groupBy(columns, 'table_name');
  const pksByTable = groupBy(pks, 'table_name');
  const fksByTable = groupBy(fks, 'table_name');
  const uniquesByTable = groupBy(uniques, 'table_name');
  const checksByTable = groupBy(checks, 'table_name');
  const indexesByTable = groupBy(indexes, 'tablename');
  const rowCountMap = {};
  for (const r of rowCounts) rowCountMap[r.table_name] = Number(r.row_count) || 0;

  const tableNames = Object.keys(colsByTable).sort();

  // -------------------------------------------------------
  // Per-table files
  // -------------------------------------------------------
  console.log(`\n  Writing ${tableNames.length} table files...`);

  for (const table of tableNames) {
    const cols = colsByTable[table] || [];
    const tablePks = (pksByTable[table] || []).map(r => r.column_name);
    const tableFks = fksByTable[table] || [];
    const tableUniques = uniquesByTable[table] || [];
    const tableChecks = checksByTable[table] || [];
    const tableIndexes = indexesByTable[table] || [];
    const rows = rowCountMap[table] ?? '?';

    let md = `# ${table}\n\n`;
    md += `> Generated: ${NOW}  \n`;
    md += `> Rows (approx): ${rows}\n\n`;

    // Columns table
    md += `## Columns\n\n`;
    md += `| # | Column | Type | Nullable | Default |\n`;
    md += `|---|--------|------|----------|--------|\n`;
    for (const col of cols) {
      const nullable = col.is_nullable === 'YES' ? 'YES' : '**NO**';
      const def = col.column_default ? `\`${col.column_default}\`` : '';
      md += `| ${col.ordinal_position} | ${col.column_name} | ${col.full_type} | ${nullable} | ${def} |\n`;
    }

    // Primary Key
    if (tablePks.length > 0) {
      md += `\n## Primary Key\n\n`;
      md += `- (${tablePks.join(', ')})\n`;
    }

    // Foreign Keys
    if (tableFks.length > 0) {
      md += `\n## Foreign Keys\n\n`;
      for (const fk of tableFks) {
        const onDelete = fk.delete_rule !== 'NO ACTION' ? ` ON DELETE ${fk.delete_rule}` : '';
        const onUpdate = fk.update_rule !== 'NO ACTION' ? ` ON UPDATE ${fk.update_rule}` : '';
        md += `- \`${fk.column_name}\` → \`${fk.foreign_table}(${fk.foreign_column})\`${onDelete}${onUpdate}\n`;
      }
    }

    // Unique Constraints
    const uniqueGroups = groupBy(tableUniques, 'constraint_name');
    const uniqueEntries = Object.entries(uniqueGroups);
    if (uniqueEntries.length > 0) {
      md += `\n## Unique Constraints\n\n`;
      for (const [name, uCols] of uniqueEntries) {
        md += `- ${name}: (${uCols.map(c => c.column_name).join(', ')})\n`;
      }
    }

    // Check Constraints
    if (tableChecks.length > 0) {
      md += `\n## Check Constraints\n\n`;
      for (const chk of tableChecks) {
        md += `- ${chk.constraint_name}: \`${chk.check_clause}\`\n`;
      }
    }

    // Indexes
    if (tableIndexes.length > 0) {
      md += `\n## Indexes\n\n`;
      md += `| Index | Type | Columns |\n`;
      md += `|-------|------|---------|\n`;
      for (const idx of tableIndexes) {
        const iType = indexType(idx.indexdef);
        const iCols = indexColumns(idx.indexdef);
        md += `| ${idx.indexname} | ${iType} | ${iCols} |\n`;
      }
    }

    md += '\n';
    writeFileSync(join(TABLES_DIR, `${table}.md`), md);
  }

  // -------------------------------------------------------
  // functions.md
  // -------------------------------------------------------
  if (functions.length > 0) {
    console.log(`  Writing functions.md (${functions.length} functions)...`);

    let md = `# Database Functions\n\n`;
    md += `> Generated: ${NOW}\n\n`;
    md += `${functions.length} public functions found.\n\n---\n\n`;

    for (const fn of functions) {
      md += `## ${fn.function_name}(${fn.arguments || ''})\n\n`;
      md += `- **Returns:** ${fn.return_type || 'void'}\n`;
      md += `- **Kind:** ${fn.kind || 'function'}\n\n`;
      if (fn.definition) {
        md += `\`\`\`sql\n${fn.definition}\n\`\`\`\n\n`;
      }
      md += `---\n\n`;
    }

    writeFileSync(join(TABLES_DIR, 'functions.md'), md);
  }

  // -------------------------------------------------------
  // foreign_keys.md
  // -------------------------------------------------------
  if (fks.length > 0) {
    console.log('  Writing foreign_keys.md...');

    let md = `# Foreign Key Map\n\n`;
    md += `> Generated: ${NOW}\n\n`;

    for (const table of tableNames) {
      const tableFks = fksByTable[table];
      if (!tableFks || tableFks.length === 0) continue;

      md += `## ${table}\n\n`;
      for (const fk of tableFks) {
        const onDelete = fk.delete_rule !== 'NO ACTION' ? ` ON DELETE ${fk.delete_rule}` : '';
        const onUpdate = fk.update_rule !== 'NO ACTION' ? ` ON UPDATE ${fk.update_rule}` : '';
        md += `- \`${fk.column_name}\` → \`${fk.foreign_table}(${fk.foreign_column})\`${onDelete}${onUpdate} *(${fk.constraint_name})*\n`;
      }
      md += '\n';
    }

    writeFileSync(join(TABLES_DIR, 'foreign_keys.md'), md);
  }

  // -------------------------------------------------------
  // views.md
  // -------------------------------------------------------
  if (views.length > 0) {
    console.log(`  Writing views.md (${views.length} views)...`);

    let md = `# Database Views\n\n`;
    md += `> Generated: ${NOW}\n\n`;

    for (const v of views) {
      md += `## ${v.table_name}\n\n`;
      md += `\`\`\`sql\n${v.view_definition}\n\`\`\`\n\n---\n\n`;
    }

    writeFileSync(join(TABLES_DIR, 'views.md'), md);
  }

  // -------------------------------------------------------
  // _schema_summary.md
  // -------------------------------------------------------
  console.log('  Writing _schema_summary.md...');

  let summary = `# Database Schema (Live)\n\n`;
  summary += `> **Generated:** ${NOW}  \n`;
  summary += `> **Database:** ${SUPABASE_URL.split('//')[1]?.split('.')[0]}  \n`;
  summary += `> **Refresh:** \`node scripts/migrations/actual/dump-live-schema.mjs\`\n\n`;

  summary += `## Tables (${tableNames.length})\n\n`;
  summary += `| Table | Rows | Columns | FKs | Indexes |\n`;
  summary += `|-------|------|---------|-----|---------|\n`;

  for (const table of tableNames) {
    const colCount = (colsByTable[table] || []).length;
    const fkCount = (fksByTable[table] || []).length;
    const idxCount = (indexesByTable[table] || []).length;
    const rows = rowCountMap[table] ?? '?';
    summary += `| [${table}](${table}.md) | ${rows} | ${colCount} | ${fkCount} | ${idxCount} |\n`;
  }

  if (functions.length > 0) {
    summary += `\n## Functions (${functions.length})\n\n`;
    summary += `See [functions.md](functions.md) for full definitions.\n\n`;
    summary += `| Function | Arguments | Returns |\n`;
    summary += `|----------|-----------|--------|\n`;
    for (const fn of functions) {
      summary += `| ${fn.function_name} | ${fn.arguments || '(none)'} | ${fn.return_type || 'void'} |\n`;
    }
  }

  if (views.length > 0) {
    summary += `\n## Views (${views.length})\n\n`;
    summary += `See [views.md](views.md) for definitions.\n\n`;
    for (const v of views) {
      summary += `- ${v.table_name}\n`;
    }
  }

  summary += '\n';
  writeFileSync(join(TABLES_DIR, '_schema_summary.md'), summary);

  // Done
  console.log(`\nDone! ${tableNames.length} tables, ${functions.length} functions, ${views.length} views, ${fks.length} FKs`);
  console.log(`Output: scripts/migrations/actual/`);
}

main().catch(err => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
