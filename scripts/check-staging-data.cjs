/**
 * check-staging-data.cjs
 * 
 * Analyzes staging_systems and staging_instances tables to find items
 * that are NOT already in production (systems/instances tables).
 * 
 * Usage: node scripts/check-staging-data.cjs
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function getAllRows(table, selectCols = "*") {
  let all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(selectCols)
      .range(offset, offset + 999);
    if (error) {
      console.error("Error fetching " + table + ":", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    all = all.concat(data);
    offset += 1000;
    if (data.length < 1000) break;
  }
  return all;
}

function normalizeKey(manufacturer, model) {
  const mfr = (manufacturer || "").toLowerCase().trim();
  const mdl = (model || "").toLowerCase().trim();
  return mfr + "|" + mdl;
}

(async () => {
  console.log("======================================================================");
  console.log("STAGING DATA ANALYSIS");
  console.log("======================================================================");
  console.log();

  // =========================================================================
  // STAGING SYSTEMS ANALYSIS
  // =========================================================================
  console.log("1. STAGING_SYSTEMS ANALYSIS");
  console.log("--------------------------------------------------");

  const stagingSystems = await getAllRows("staging_systems");
  const prodSystems = await getAllRows("systems", "asset_uid, manufacturer_norm, model_norm");

  console.log("   Total staging_systems: " + stagingSystems.length);
  console.log("   Total production systems: " + prodSystems.length);

  // Build production lookup sets
  const prodSystemsByUid = new Set(prodSystems.map(s => s.asset_uid));
  const prodSystemsByKey = new Set(prodSystems.map(s => normalizeKey(s.manufacturer_norm, s.model_norm)));

  // Find staging systems not in production
  const newSystemsByUid = stagingSystems.filter(s => !prodSystemsByUid.has(s.asset_uid));
  const newSystemsByKey = stagingSystems.filter(s => !prodSystemsByKey.has(normalizeKey(s.manufacturer_norm, s.model_norm)));

  console.log("   Staging NOT in production (by asset_uid): " + newSystemsByUid.length);
  console.log("   Staging NOT in production (by mfr+model): " + newSystemsByKey.length);

  if (newSystemsByUid.length > 0) {
    console.log("\n   NEW SYSTEMS (not in production by asset_uid):");
    console.log("   ----------------------------------------------");
    newSystemsByUid.slice(0, 20).forEach(s => {
      console.log("   - " + s.asset_uid);
      console.log("     " + s.manufacturer_norm + " | " + s.model_norm);
      console.log("     System: " + s.system_norm + " / Subsystem: " + s.subsystem_norm);
    });
    if (newSystemsByUid.length > 20) {
      console.log("   ... and " + (newSystemsByUid.length - 20) + " more");
    }
  }

  // =========================================================================
  // STAGING INSTANCES ANALYSIS
  // =========================================================================
  console.log("\n======================================================================");
  console.log("2. STAGING_INSTANCES ANALYSIS");
  console.log("--------------------------------------------------");

  const stagingInstances = await getAllRows("staging_instances");
  const prodInstances = await getAllRows("instances", "instance_uid, asset_uid, serial_number, location");

  console.log("   Total staging_instances: " + stagingInstances.length);
  console.log("   Total production instances: " + prodInstances.length);

  // Build production lookup sets
  const prodInstancesByUid = new Set(prodInstances.map(i => i.instance_uid));
  const prodInstancesByAsset = new Set(prodInstances.map(i => i.asset_uid));

  // Find staging instances not in production
  const newInstancesByUid = stagingInstances.filter(i => !prodInstancesByUid.has(i.instance_uid));
  const newAssets = [...new Set(newInstancesByUid.map(i => i.asset_uid))];

  console.log("   Staging NOT in production (by instance_uid): " + newInstancesByUid.length);
  console.log("   Unique asset_uids in new instances: " + newAssets.length);

  // Check if the asset_uids exist in production systems
  const newAssetsNotInProdSystems = newAssets.filter(a => !prodSystemsByUid.has(a));
  console.log("   New instances with asset_uid NOT in production systems: " + newAssetsNotInProdSystems.length);

  if (newInstancesByUid.length > 0) {
    console.log("\n   NEW INSTANCES (not in production):");
    console.log("   ----------------------------------------------");
    newInstancesByUid.slice(0, 20).forEach(i => {
      console.log("   - " + i.instance_uid);
      console.log("     Asset: " + i.asset_uid);
      console.log("     " + i.manufacturer_norm + " | " + i.model_norm);
      console.log("     Serial: " + (i.serial_number || "(none)") + " | Location: " + (i.location || "(none)"));
    });
    if (newInstancesByUid.length > 20) {
      console.log("   ... and " + (newInstancesByUid.length - 20) + " more");
    }
  }

  // =========================================================================
  // SAMPLE DATA INSPECTION
  // =========================================================================
  console.log("\n======================================================================");
  console.log("3. SAMPLE DATA INSPECTION");
  console.log("--------------------------------------------------");

  if (stagingSystems.length > 0) {
    console.log("\n   Sample staging_systems row:");
    const sample = stagingSystems[0];
    Object.entries(sample).forEach(([key, val]) => {
      let displayVal;
      if (val === null) {
        displayVal = "(null)";
      } else if (typeof val === "string" && val.length > 60) {
        displayVal = val.substring(0, 60) + "...";
      } else {
        displayVal = val;
      }
      console.log("     " + key + ": " + displayVal);
    });
  }

  if (stagingInstances.length > 0) {
    console.log("\n   Sample staging_instances row:");
    const sample = stagingInstances[0];
    Object.entries(sample).forEach(([key, val]) => {
      let displayVal;
      if (val === null) {
        displayVal = "(null)";
      } else if (typeof val === "string" && val.length > 60) {
        displayVal = val.substring(0, 60) + "...";
      } else {
        displayVal = val;
      }
      console.log("     " + key + ": " + displayVal);
    });
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log("\n======================================================================");
  console.log("SUMMARY - ITEMS NEEDING REVIEW");
  console.log("======================================================================");
  
  console.log("");
  console.log("  STAGING SYSTEMS:");
  console.log("    - Total in staging: " + stagingSystems.length);
  console.log("    - NEW (not in production): " + newSystemsByUid.length);
  console.log("    - Already in production: " + (stagingSystems.length - newSystemsByUid.length));
  console.log("");
  console.log("  STAGING INSTANCES:");
  console.log("    - Total in staging: " + stagingInstances.length);
  console.log("    - NEW (not in production): " + newInstancesByUid.length);
  console.log("    - Already in production: " + (stagingInstances.length - newInstancesByUid.length));
  console.log("    - New instances referencing missing systems: " + newAssetsNotInProdSystems.length);
  console.log("");

  if (newSystemsByUid.length > 0 || newInstancesByUid.length > 0) {
    console.log("  ACTION NEEDED:");
    if (newSystemsByUid.length > 0) {
      console.log("    - Review " + newSystemsByUid.length + " new systems before promoting to production");
    }
    if (newInstancesByUid.length > 0) {
      console.log("    - Review " + newInstancesByUid.length + " new instances before promoting to production");
    }
    if (newAssetsNotInProdSystems.length > 0) {
      console.log("    - WARNING: " + newAssetsNotInProdSystems.length + " instances reference systems not in production");
    }
  } else {
    console.log("  All staging data already exists in production tables.");
  }

  console.log();
})();
