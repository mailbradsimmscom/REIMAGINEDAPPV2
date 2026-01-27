const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { data, error } = await supabase
    .from("systems")
    .select("manufacturer_norm, model_norm, system_norm, subsystem_norm")
    .order("manufacturer_norm");

  if (error) {
    console.log("Error:", error.message);
    return;
  }

  // Group by manufacturer
  const byMfr = {};
  data.forEach(row => {
    const mfr = row.manufacturer_norm || "UNKNOWN";
    if (!byMfr[mfr]) byMfr[mfr] = [];
    byMfr[mfr].push(row);
  });

  console.log("MANUFACTURERS (" + Object.keys(byMfr).length + " total):\n");

  Object.keys(byMfr).sort().forEach(mfr => {
    console.log(mfr + " (" + byMfr[mfr].length + " items):");
    byMfr[mfr].forEach(item => {
      console.log("    " + item.model_norm + " [" + item.system_norm + " / " + item.subsystem_norm + "]");
    });
    console.log("");
  });
}

main();
