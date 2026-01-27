const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  console.log("=== CHECKING TABLES FOR PURGE DECISIONS ===\n");

  // 1. deduplication_reviews - the key one
  console.log("1. DEDUPLICATION_REVIEWS");
  console.log("   Purpose: Human decisions on duplicate maintenance tasks");
  const { data: dedupReviews, error: e1 } = await supabase
    .from("deduplication_reviews")
    .select("*")
    .limit(10);

  if (e1) {
    console.log("   Error:", e1.message);
  } else {
    const { count } = await supabase.from("deduplication_reviews").select("*", { count: "exact", head: true });
    console.log("   Total rows:", count);
    if (dedupReviews && dedupReviews.length > 0) {
      console.log("   Columns:", Object.keys(dedupReviews[0]).join(", "));
      console.log("   Sample decisions:");
      dedupReviews.slice(0, 5).forEach(r => {
        console.log(`     - Decision: ${r.decision || r.action || r.status} | ${r.reason || r.notes || ""}`);
      });
    }
  }
  console.log("");

  // 2. deduplication_analyses
  console.log("2. DEDUPLICATION_ANALYSES");
  const { data: dedupAnalyses, error: e2 } = await supabase
    .from("deduplication_analyses")
    .select("*");

  if (e2) {
    console.log("   Error:", e2.message);
  } else {
    console.log("   Total rows:", dedupAnalyses?.length || 0);
    if (dedupAnalyses && dedupAnalyses.length > 0) {
      console.log("   Columns:", Object.keys(dedupAnalyses[0]).join(", "));
      console.log("   Sample:");
      dedupAnalyses.slice(0, 3).forEach(r => {
        console.log("    ", JSON.stringify(r).substring(0, 200));
      });
    }
  }
  console.log("");

  // 3. spec_lexicon
  console.log("3. SPEC_LEXICON");
  console.log("   Purpose: Unit reference table for boat specs");
  const { data: lexicon, error: e3 } = await supabase
    .from("spec_lexicon")
    .select("*");

  if (e3) {
    console.log("   Error:", e3.message);
  } else {
    console.log("   Total rows:", lexicon?.length || 0);
    if (lexicon && lexicon.length > 0) {
      console.log("   Columns:", Object.keys(lexicon[0]).join(", "));
      console.log("   All entries:");
      lexicon.forEach(r => {
        console.log("    ", JSON.stringify(r));
      });
    }
  }
  console.log("");

  // 4. staging_systems
  console.log("4. STAGING_SYSTEMS");
  console.log("   Purpose: Excel staging table for systems");
  const { data: stagingSys, error: e4 } = await supabase
    .from("staging_systems")
    .select("*")
    .limit(10);

  if (e4) {
    console.log("   Error:", e4.message);
  } else {
    const { count: sysCount } = await supabase.from("staging_systems").select("*", { count: "exact", head: true });
    console.log("   Total rows:", sysCount);
    if (stagingSys && stagingSys.length > 0) {
      console.log("   Columns:", Object.keys(stagingSys[0]).join(", "));
      console.log("   Sample (first 5):");
      stagingSys.slice(0, 5).forEach(r => {
        console.log(`     - ${r.manufacturer_norm || r.manufacturer} | ${r.model_norm || r.model} | ${r.system_norm || r.system}`);
      });
    }
  }
  console.log("");

  // 5. staging_instances
  console.log("5. STAGING_INSTANCES");
  const { data: stagingInst, error: e5 } = await supabase
    .from("staging_instances")
    .select("*")
    .limit(10);

  if (e5) {
    console.log("   Error:", e5.message);
  } else {
    const { count: instCount } = await supabase.from("staging_instances").select("*", { count: "exact", head: true });
    console.log("   Total rows:", instCount);
    if (stagingInst && stagingInst.length > 0) {
      console.log("   Columns:", Object.keys(stagingInst[0]).join(", "));
      console.log("   Sample (first 5):");
      stagingInst.slice(0, 5).forEach(r => {
        console.log(`     - ${r.serial_number || "no serial"} | ${r.location || "no location"}`);
      });
    }
  }
  console.log("");

  // 6. jobs
  console.log("6. JOBS");
  const { data: jobs, error: e6 } = await supabase
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5);

  if (e6) {
    console.log("   Error:", e6.message);
  } else {
    const { count: jobCount } = await supabase.from("jobs").select("*", { count: "exact", head: true });
    console.log("   Total rows:", jobCount);
    if (jobs && jobs.length > 0) {
      console.log("   Columns:", Object.keys(jobs[0]).join(", "));
      console.log("   Recent jobs:");
      jobs.forEach(r => {
        console.log(`     - ${r.type || r.job_type} | ${r.status} | ${r.created_at}`);
      });
    }
  }
  console.log("");

  // 7. merge_audit
  console.log("7. MERGE_AUDIT");
  const { data: mergeAudit, error: e7 } = await supabase
    .from("merge_audit")
    .select("*")
    .limit(5);

  if (e7) {
    console.log("   Error:", e7.message);
  } else {
    const { count: mergeCount } = await supabase.from("merge_audit").select("*", { count: "exact", head: true });
    console.log("   Total rows:", mergeCount);
    if (mergeAudit && mergeAudit.length > 0) {
      console.log("   Columns:", Object.keys(mergeAudit[0]).join(", "));
    }
  }
  console.log("");

  console.log("=== DONE ===");
}

main();
