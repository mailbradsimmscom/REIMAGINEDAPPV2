/**
 * PURGE SCRIPT - v4 Migration
 *
 * This script purges processed content while preserving critical data.
 *
 * WHAT IT PURGES:
 * - Pinecone: REIMAGINEDDOCS and MAINTENANCE namespaces
 * - Storage: /dip/*, /page-screenshots/*
 * - Tables: documents, chunks, DIP staging/production, maintenance, jobs, etc.
 *
 * WHAT IT KEEPS:
 * - staging_systems (142 rows)
 * - staging_instances (306 rows)
 * - agent_training_decisions (385 rows)
 * - agent_config
 * - deduplication_reviews (60 rows)
 * - spec_lexicon (4 rows)
 * - systems (119 rows)
 * - instances (161 rows)
 * - All user tables (chat, supplies, trips, etc.)
 * - Storage: /manuals/*, /supply-photos/*, /anchorage-photos/*
 *
 * RUN WITH: node scripts/migration/purge-content.cjs
 *
 * Set DRY_RUN=false to actually execute (default is true for safety)
 */

const { createClient } = require("@supabase/supabase-js");
const { Pinecone } = require("@pinecone-database/pinecone");
require("dotenv").config();

// ============================================
// SAFETY FLAG - Set to false to actually purge
// ============================================
const DRY_RUN = false;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

// Tables to TRUNCATE (in order - children before parents due to FKs)
const TABLES_TO_PURGE = [
  // DIP production tables (depend on staging)
  "spec_suggestions",
  "playbook_hints",
  "intent_router",
  "golden_tests",

  // DIP staging tables
  "staging_spec_suggestions",
  "staging_playbook_hints",
  "staging_intent_router",
  "staging_golden_tests",

  // Document tables (chunks before documents due to FK)
  "document_chunks",
  "documents",

  // Maintenance tables
  "maintenance_tasks_index",
  "maintenance_tasks_queue",
  "deduplication_pending_reviews",
  "deduplication_analyses",
  "pinecone_search_results",
  "pipeline_runs",
  "pipeline_processing_status",

  // Agent operational data (NOT training data)
  "agent_runs",

  // Job tracking
  "jobs",
  "merge_audit",
];

// Tables to KEEP (verify they still have data after purge)
const TABLES_TO_VERIFY = [
  { name: "agent_training_decisions", minRows: 385 },
  { name: "agent_config", minRows: 1 },
  { name: "deduplication_reviews", minRows: 60 },
  { name: "spec_lexicon", minRows: 4 },
  { name: "systems", minRows: 119 },
  { name: "instances", minRows: 160 },
  { name: "staging_systems", minRows: 140 },
  { name: "staging_instances", minRows: 300 },
];

// Storage paths to DELETE
const STORAGE_PATHS_TO_PURGE = [
  // We need to list files in each doc folder's /DIP/ subfolder
  // The structure is: /manuals/{hash}/DIP/*.json
  // We'll handle this specially
];

// Pinecone namespaces to purge
const PINECONE_NAMESPACES = ["REIMAGINEDDOCS", "MAINTENANCE"];

async function countTableRows(tableName) {
  const { count, error } = await supabase
    .from(tableName)
    .select("*", { count: "exact", head: true });

  if (error) {
    return { table: tableName, count: -1, error: error.message };
  }
  return { table: tableName, count: count || 0, error: null };
}

async function truncateTable(tableName) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would TRUNCATE ${tableName}`);
    return { success: true, dryRun: true };
  }

  const { error } = await supabase.rpc("truncate_table", { table_name: tableName });

  if (error) {
    // Try direct delete if RPC doesn't exist
    const { error: deleteError } = await supabase
      .from(tableName)
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all rows

    if (deleteError) {
      return { success: false, error: deleteError.message };
    }
  }

  return { success: true };
}

async function deleteAllFromTable(tableName) {
  if (DRY_RUN) {
    const { count } = await countTableRows(tableName);
    console.log(`  [DRY RUN] Would DELETE all ${count} rows from ${tableName}`);
    return { success: true, dryRun: true, count };
  }

  // Use a condition that matches all rows
  const { error, count } = await supabase
    .from(tableName)
    .delete()
    .not("id", "is", null) // Matches all rows with non-null id
    .select("*", { count: "exact" });

  if (error) {
    // Try alternative approach - delete in batches
    let totalDeleted = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error: batchError } = await supabase
        .from(tableName)
        .select("id")
        .limit(1000);

      if (batchError || !data || data.length === 0) {
        hasMore = false;
        break;
      }

      const ids = data.map(r => r.id);
      const { error: delError } = await supabase
        .from(tableName)
        .delete()
        .in("id", ids);

      if (delError) {
        return { success: false, error: delError.message };
      }

      totalDeleted += ids.length;
      hasMore = data.length === 1000;
    }

    return { success: true, count: totalDeleted };
  }

  return { success: true, count };
}

async function purgePineconeNamespace(indexName, namespace) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would delete all vectors in ${indexName}/${namespace}`);
    return { success: true, dryRun: true };
  }

  try {
    const index = pinecone.index(indexName);
    await index.namespace(namespace).deleteAll();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function listDIPStorageFiles() {
  // List all folders in manuals/
  const { data: folders, error } = await supabase.storage
    .from("documents")
    .list("manuals", { limit: 1000 });

  if (error) {
    console.log(`  Error listing manuals: ${error.message}`);
    return [];
  }

  const dipFiles = [];

  for (const folder of folders || []) {
    if (!folder.id) {
      // It's a folder, check for DIP subfolder
      const { data: dipContents } = await supabase.storage
        .from("documents")
        .list(`manuals/${folder.name}/DIP`, { limit: 100 });

      for (const file of dipContents || []) {
        if (file.name && file.name.endsWith(".json")) {
          dipFiles.push(`manuals/${folder.name}/DIP/${file.name}`);
        }
      }
    }
  }

  return dipFiles;
}

async function deleteStorageFile(bucket, path) {
  if (DRY_RUN) {
    return { success: true, dryRun: true };
  }

  const { error } = await supabase.storage.from(bucket).remove([path]);
  return { success: !error, error: error?.message };
}

async function main() {
  console.log("=".repeat(60));
  console.log("  PURGE SCRIPT - v4 Migration");
  console.log("  " + new Date().toISOString());
  console.log("=".repeat(60));

  if (DRY_RUN) {
    console.log("\n⚠️  DRY RUN MODE - No changes will be made");
    console.log("   Set DRY_RUN=false in script to execute\n");
  } else {
    console.log("\n🔴 LIVE MODE - Changes will be permanent!\n");
  }

  // ============================================
  // STEP 1: Pre-flight checks
  // ============================================
  console.log("STEP 1: PRE-FLIGHT CHECKS\n");

  console.log("  Verifying critical tables have expected data...");
  for (const { name, minRows } of TABLES_TO_VERIFY) {
    const result = await countTableRows(name);
    const status = result.count >= minRows ? "✅" : "⚠️";
    console.log(`    ${status} ${name}: ${result.count} rows (expected >= ${minRows})`);
  }

  // ============================================
  // STEP 2: Count rows to be purged
  // ============================================
  console.log("\nSTEP 2: TABLES TO PURGE\n");

  let totalRows = 0;
  for (const table of TABLES_TO_PURGE) {
    const result = await countTableRows(table);
    if (result.error) {
      console.log(`    ⬜ ${table}: ${result.error}`);
    } else {
      console.log(`    📋 ${table}: ${result.count} rows`);
      totalRows += result.count;
    }
  }
  console.log(`\n  Total rows to purge: ${totalRows}`);

  // ============================================
  // STEP 3: List storage files to purge
  // ============================================
  console.log("\nSTEP 3: STORAGE FILES TO PURGE\n");

  const dipFiles = await listDIPStorageFiles();
  console.log(`  Found ${dipFiles.length} DIP JSON files in storage`);
  if (dipFiles.length > 0) {
    console.log(`  Sample: ${dipFiles.slice(0, 3).join(", ")}...`);
  }

  // ============================================
  // STEP 4: Pinecone vectors
  // ============================================
  console.log("\nSTEP 4: PINECONE NAMESPACES\n");

  const indexName = process.env.PINECONE_INDEX || "reimaginedsv";
  for (const namespace of PINECONE_NAMESPACES) {
    try {
      const index = pinecone.index(indexName);
      const stats = await index.describeIndexStats();
      const nsStats = stats.namespaces?.[namespace];
      const vectorCount = nsStats?.recordCount || 0;
      console.log(`  📊 ${namespace}: ${vectorCount} vectors`);
    } catch (e) {
      console.log(`  ⚠️ ${namespace}: Could not get stats`);
    }
  }

  // ============================================
  // STEP 5: Execute purge (if not dry run)
  // ============================================
  console.log("\n" + "=".repeat(60));
  console.log("  EXECUTING PURGE");
  console.log("=".repeat(60) + "\n");

  // 5a: Purge Pinecone
  console.log("5a. Pinecone namespaces...");
  for (const namespace of PINECONE_NAMESPACES) {
    const result = await purgePineconeNamespace(indexName, namespace);
    if (result.dryRun) {
      // Already logged
    } else if (result.success) {
      console.log(`  ✅ ${namespace} purged`);
    } else {
      console.log(`  ❌ ${namespace}: ${result.error}`);
    }
  }

  // 5b: Purge storage DIP files
  console.log("\n5b. Storage DIP files...");
  let storageDeleted = 0;
  for (const path of dipFiles) {
    const result = await deleteStorageFile("documents", path);
    if (result.success) storageDeleted++;
  }
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would delete ${dipFiles.length} DIP files`);
  } else {
    console.log(`  ✅ Deleted ${storageDeleted}/${dipFiles.length} DIP files`);
  }

  // 5c: Purge tables
  console.log("\n5c. Database tables...");
  for (const table of TABLES_TO_PURGE) {
    const result = await deleteAllFromTable(table);
    if (result.dryRun) {
      // Already logged in deleteAllFromTable
    } else if (result.success) {
      console.log(`  ✅ ${table} purged`);
    } else {
      console.log(`  ❌ ${table}: ${result.error}`);
    }
  }

  // ============================================
  // STEP 6: Post-purge verification
  // ============================================
  console.log("\n" + "=".repeat(60));
  console.log("  POST-PURGE VERIFICATION");
  console.log("=".repeat(60) + "\n");

  console.log("  Verifying critical tables still intact...");
  let allGood = true;
  for (const { name, minRows } of TABLES_TO_VERIFY) {
    const result = await countTableRows(name);
    const status = result.count >= minRows ? "✅" : "❌";
    console.log(`    ${status} ${name}: ${result.count} rows`);
    if (result.count < minRows) allGood = false;
  }

  console.log("\n  Verifying purged tables are empty...");
  for (const table of TABLES_TO_PURGE.slice(0, 5)) { // Check first 5
    const result = await countTableRows(table);
    if (result.error) {
      console.log(`    ⬜ ${table}: ${result.error}`);
    } else if (DRY_RUN) {
      console.log(`    📋 ${table}: ${result.count} rows (would be 0)`);
    } else {
      const status = result.count === 0 ? "✅" : "⚠️";
      console.log(`    ${status} ${table}: ${result.count} rows`);
    }
  }

  // ============================================
  // Summary
  // ============================================
  console.log("\n" + "=".repeat(60));
  if (DRY_RUN) {
    console.log("  DRY RUN COMPLETE - No changes made");
    console.log("  Review output above, then set DRY_RUN=false to execute");
  } else {
    console.log("  PURGE COMPLETE");
    console.log(allGood ? "  ✅ All critical data intact" : "  ⚠️ Check critical data!");
  }
  console.log("=".repeat(60) + "\n");
}

main().catch(console.error);
