const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const BACKUP_DIR = path.join(process.env.HOME, "backups/boatos-v4-pre-migration");
const STORAGE_DIR = path.join(BACKUP_DIR, "storage");

// Tables to backup (critical data only - not purging these)
const CRITICAL_TABLES = [
  "systems",
  "instances",
  "agent_training_decisions",
  "agent_config",
  "deduplication_reviews",
  "spec_lexicon",
  "chat_threads",
  "chat_messages",
  "chat_sessions",
  "supplies",
  "supply_categories",
  "supply_units",
  "trips",
  "anchor_watch_zones",
  "anchorages",
  "season_recaps",
  "user_tasks",
  "staging_systems",
  "staging_instances"
];

// Storage buckets/paths to backup
const STORAGE_PATHS = [
  { bucket: "documents", prefix: "manuals" },
  { bucket: "documents", prefix: "supply-photos" },
  { bucket: "documents", prefix: "anchorage-photos" }
];

async function backupTable(tableName) {
  console.log(`  Backing up ${tableName}...`);

  const { data, error } = await supabase
    .from(tableName)
    .select("*");

  if (error) {
    console.log(`    Error: ${error.message}`);
    return { table: tableName, count: 0, error: error.message };
  }

  const filePath = path.join(BACKUP_DIR, `${tableName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`    Saved ${data.length} rows to ${tableName}.json`);

  return { table: tableName, count: data.length, error: null };
}

async function listStorageFiles(bucket, prefix) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(prefix, { limit: 1000 });

  if (error) {
    console.log(`    Error listing ${prefix}: ${error.message}`);
    return [];
  }

  // Filter out folders, get files
  const files = [];
  for (const item of data || []) {
    if (item.id) {
      files.push(`${prefix}/${item.name}`);
    } else if (item.name && !item.name.includes(".")) {
      // It's a folder, recurse
      const subFiles = await listStorageFiles(bucket, `${prefix}/${item.name}`);
      files.push(...subFiles);
    } else if (item.name) {
      files.push(`${prefix}/${item.name}`);
    }
  }

  return files;
}

async function downloadStorageFile(bucket, filePath) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(filePath);

  if (error) {
    return { path: filePath, error: error.message };
  }

  const localPath = path.join(STORAGE_DIR, bucket, filePath);
  const dir = path.dirname(localPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync(localPath, buffer);

  return { path: filePath, error: null, size: buffer.length };
}

async function main() {
  console.log("===========================================");
  console.log("  SUPABASE BACKUP - v4-pre-migration");
  console.log("  " + new Date().toISOString());
  console.log("===========================================\n");

  // Ensure directories exist
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

  // 1. Backup critical tables
  console.log("1. BACKING UP CRITICAL TABLES\n");
  const tableResults = [];

  for (const table of CRITICAL_TABLES) {
    const result = await backupTable(table);
    tableResults.push(result);
  }

  // 2. List and download storage files
  console.log("\n2. BACKING UP STORAGE FILES\n");
  const storageResults = [];

  for (const { bucket, prefix } of STORAGE_PATHS) {
    console.log(`  Listing ${bucket}/${prefix}...`);
    const files = await listStorageFiles(bucket, prefix);
    console.log(`    Found ${files.length} files`);

    for (const file of files) {
      process.stdout.write(`    Downloading ${file}...`);
      const result = await downloadStorageFile(bucket, file);
      if (result.error) {
        console.log(` ERROR: ${result.error}`);
      } else {
        console.log(` OK (${(result.size / 1024).toFixed(1)} KB)`);
      }
      storageResults.push(result);
    }
  }

  // 3. Write summary
  console.log("\n3. WRITING SUMMARY\n");

  const summary = {
    timestamp: new Date().toISOString(),
    git_tag: "v4-pre-migration",
    tables: tableResults,
    storage: {
      total_files: storageResults.length,
      successful: storageResults.filter(r => !r.error).length,
      failed: storageResults.filter(r => r.error).length,
      files: storageResults
    }
  };

  fs.writeFileSync(
    path.join(BACKUP_DIR, "backup-summary.json"),
    JSON.stringify(summary, null, 2)
  );

  // Print summary
  console.log("===========================================");
  console.log("  BACKUP COMPLETE");
  console.log("===========================================");
  console.log(`  Location: ${BACKUP_DIR}`);
  console.log(`  Tables: ${tableResults.filter(r => !r.error).length}/${CRITICAL_TABLES.length} successful`);
  console.log(`  Total rows: ${tableResults.reduce((sum, r) => sum + r.count, 0)}`);
  console.log(`  Storage files: ${storageResults.filter(r => !r.error).length}/${storageResults.length} successful`);
  console.log("===========================================\n");

  // List what's in backup dir
  console.log("Backup contents:");
  const files = fs.readdirSync(BACKUP_DIR);
  files.forEach(f => console.log(`  ${f}`));
}

main().catch(console.error);
