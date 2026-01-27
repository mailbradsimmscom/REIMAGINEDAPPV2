const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  console.log("=== DEDUPLICATION_REVIEWS DETAIL ===\n");

  const { data, error } = await supabase
    .from("deduplication_reviews")
    .select("*")
    .limit(10);

  if (error) {
    console.log("Error:", error.message);
    return;
  }

  // Count by review_status
  const { data: statusCounts } = await supabase
    .from("deduplication_reviews")
    .select("review_status");

  const statusMap = {};
  statusCounts?.forEach(r => {
    statusMap[r.review_status || "null"] = (statusMap[r.review_status || "null"] || 0) + 1;
  });

  console.log("Review Status Distribution:");
  Object.entries(statusMap).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}`);
  });
  console.log("");

  console.log("Sample Rows (showing key fields):");
  data?.forEach((r, i) => {
    console.log(`\n--- Row ${i + 1} ---`);
    console.log(`  review_status: ${r.review_status}`);
    console.log(`  reviewed_by: ${r.reviewed_by}`);
    console.log(`  review_notes: ${r.review_notes}`);
    console.log(`  executed: ${r.executed}`);
    console.log(`  similarity_score: ${r.similarity_score}`);
    console.log(`  match_reason: ${r.match_reason?.substring(0, 100)}...`);
    console.log(`  task1_description: ${r.task1_description?.substring(0, 80)}...`);
    console.log(`  task2_description: ${r.task2_description?.substring(0, 80)}...`);
  });

  // Check for reviewed ones
  const { data: reviewed } = await supabase
    .from("deduplication_reviews")
    .select("review_status, reviewed_by, review_notes")
    .not("review_status", "is", null)
    .limit(20);

  console.log("\n\n=== REVIEWED ENTRIES ===");
  console.log("Count:", reviewed?.length);
  reviewed?.forEach((r, i) => {
    console.log(`  ${i + 1}. status=${r.review_status} | by=${r.reviewed_by} | notes=${r.review_notes}`);
  });
}

main();
