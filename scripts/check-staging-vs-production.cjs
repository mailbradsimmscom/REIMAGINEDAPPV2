const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  console.log("=== STAGING vs PRODUCTION COMPARISON ===\n");

  // Get production systems
  const { data: prodSystems } = await supabase
    .from("systems")
    .select("asset_uid, manufacturer_norm, model_norm");

  const prodAssetIds = new Set(prodSystems?.map(s => s.asset_uid) || []);
  const prodModels = new Set(prodSystems?.map(s => `${s.manufacturer_norm}|${s.model_norm}`) || []);

  console.log(`Production systems: ${prodSystems?.length || 0}`);

  // Get staging systems
  const { data: stagingSystems } = await supabase
    .from("staging_systems")
    .select("asset_uid, manufacturer_norm, model_norm");

  console.log(`Staging systems: ${stagingSystems?.length || 0}`);

  // Find staging items NOT in production
  const notInProd = stagingSystems?.filter(s => !prodAssetIds.has(s.asset_uid)) || [];
  const modelNotInProd = stagingSystems?.filter(s =>
    !prodModels.has(`${s.manufacturer_norm}|${s.model_norm}`)
  ) || [];

  console.log(`\nStaging items NOT in production (by asset_uid): ${notInProd.length}`);
  console.log(`Staging items NOT in production (by manufacturer|model): ${modelNotInProd.length}`);

  if (notInProd.length > 0) {
    console.log("\nItems in staging but NOT in production:");
    notInProd.slice(0, 20).forEach(s => {
      console.log(`  - ${s.manufacturer_norm} | ${s.model_norm}`);
    });
    if (notInProd.length > 20) {
      console.log(`  ... and ${notInProd.length - 20} more`);
    }
  }

  // Same for instances
  console.log("\n\n=== INSTANCES ===");
  const { data: prodInstances } = await supabase
    .from("instances")
    .select("instance_uid, asset_uid, serial_number");

  const prodInstanceIds = new Set(prodInstances?.map(i => i.instance_uid) || []);

  console.log(`Production instances: ${prodInstances?.length || 0}`);

  const { data: stagingInstances } = await supabase
    .from("staging_instances")
    .select("instance_uid, asset_uid, serial_number, manufacturer_norm, model_norm");

  console.log(`Staging instances: ${stagingInstances?.length || 0}`);

  const instNotInProd = stagingInstances?.filter(i => !prodInstanceIds.has(i.instance_uid)) || [];
  console.log(`Staging instances NOT in production: ${instNotInProd.length}`);

  if (instNotInProd.length > 0) {
    console.log("\nSample instances in staging but NOT in production:");
    instNotInProd.slice(0, 15).forEach(i => {
      console.log(`  - ${i.manufacturer_norm} | ${i.model_norm} | serial: ${i.serial_number || "none"}`);
    });
  }
}

main();
