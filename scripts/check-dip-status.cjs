const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function getAllRows(table) {
  let all = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from(table)
      .select("asset_uid, status")
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    offset += 1000;
    if (data.length < 1000) break;
  }
  return all;
}

(async () => {
  const tables = [
    "staging_spec_suggestions",
    "staging_playbook_hints",
    "staging_intent_router",
    "staging_golden_tests"
  ];

  // Collect all data by asset_uid
  const systemStats = {};

  for (const table of tables) {
    const rows = await getAllRows(table);

    rows.forEach(row => {
      if (!row.asset_uid) return;

      if (!systemStats[row.asset_uid]) {
        systemStats[row.asset_uid] = { pending: 0, approved: 0, declined: 0 };
      }

      const status = row.status || "pending";
      if (status === "pending") systemStats[row.asset_uid].pending++;
      else if (status === "approved") systemStats[row.asset_uid].approved++;
      else if (status === "declined") systemStats[row.asset_uid].declined++;
    });
  }

  // Get system names
  const assetUids = Object.keys(systemStats);
  const { data: systems } = await supabase
    .from("systems")
    .select("asset_uid, manufacturer_norm, model_norm")
    .in("asset_uid", assetUids);

  const sysMap = {};
  systems.forEach(s => sysMap[s.asset_uid] = s.manufacturer_norm + " / " + s.model_norm);

  // Summary
  let totalSystems = assetUids.length;
  let totalPending = 0, totalApproved = 0, totalDeclined = 0;
  let systemsFullyApproved = 0, systemsPartial = 0, systemsAllPending = 0;

  console.log("=== DIP STATUS BY SYSTEM (across all 4 staging tables) ===\n");
  console.log("System".padEnd(45) + "Pending  Approved  Declined");
  console.log("─".repeat(75));

  // Sort by approved count desc
  const sorted = assetUids.sort((a, b) => systemStats[b].approved - systemStats[a].approved);

  for (const uid of sorted) {
    const s = systemStats[uid];
    const name = (sysMap[uid] || uid).substring(0, 44);

    totalPending += s.pending;
    totalApproved += s.approved;
    totalDeclined += s.declined;

    if (s.pending === 0 && s.approved > 0) systemsFullyApproved++;
    else if (s.approved > 0 || s.declined > 0) systemsPartial++;
    else systemsAllPending++;

    // Only show systems with any approved or declined
    if (s.approved > 0 || s.declined > 0) {
      console.log(
        name.padEnd(45) +
        String(s.pending).padStart(7) +
        String(s.approved).padStart(10) +
        String(s.declined).padStart(10)
      );
    }
  }

  console.log("─".repeat(75));
  console.log("\n=== SUMMARY ===\n");
  console.log("Total systems processed:    " + totalSystems);
  console.log("  - Fully approved:         " + systemsFullyApproved);
  console.log("  - Partially reviewed:     " + systemsPartial);
  console.log("  - All pending:            " + systemsAllPending);
  console.log("");
  console.log("Total items across all staging tables:");
  console.log("  - Pending:   " + totalPending);
  console.log("  - Approved:  " + totalApproved);
  console.log("  - Declined:  " + totalDeclined);
  console.log("  - TOTAL:     " + (totalPending + totalApproved + totalDeclined));

  process.exit(0);
})();
