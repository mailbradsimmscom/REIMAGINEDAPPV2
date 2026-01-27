/**
 * Restore deduplication_reviews from backup
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const backupPath = path.join(process.env.HOME, "backups/boatos-v4-pre-migration/deduplication_reviews.json");

  console.log("Reading backup...");
  const data = JSON.parse(fs.readFileSync(backupPath, "utf-8"));
  console.log(`Found ${data.length} rows to restore`);

  // Get unique analysis_ids from the backup
  const analysisIds = [...new Set(data.map(r => r.analysis_id).filter(Boolean))];
  console.log(`Found ${analysisIds.length} unique analysis_ids`);

  // Create placeholder analysis records with just id and created_at
  console.log("Creating placeholder analysis records...");
  for (const analysisId of analysisIds) {
    const { error } = await supabase
      .from("deduplication_analyses")
      .insert({
        id: analysisId,
        analysis_date: new Date().toISOString(),
        total_tasks: 0,
        duplicate_pairs_found: 0,
        thresholds: {}
      });

    if (error) {
      console.log(`  Error creating analysis ${analysisId}: ${error.message}`);
    } else {
      console.log(`  Created ${analysisId}`);
    }
  }

  // Verify analyses created
  const { count: analysisCount } = await supabase
    .from("deduplication_analyses")
    .select("*", { count: "exact", head: true });
  console.log(`  Total analysis records: ${analysisCount}`);

  console.log("\nInserting review rows...");

  // Insert in batches of 10
  const batchSize = 10;
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    const { error } = await supabase
      .from("deduplication_reviews")
      .insert(batch);

    if (error) {
      console.log(`\n  Error at batch ${i}: ${error.message}`);
      errors++;
    } else {
      inserted += batch.length;
      process.stdout.write(`\r  Inserted ${inserted}/${data.length}`);
    }
  }

  console.log("\n\nVerifying...");
  const { count } = await supabase
    .from("deduplication_reviews")
    .select("*", { count: "exact", head: true });

  console.log(`deduplication_reviews now has ${count} rows`);
  console.log(count === data.length ? "✅ Restore complete" : "⚠️ Count mismatch");
}

main().catch(console.error);
