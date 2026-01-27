const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  // Use a raw SQL query to get column info
  const { data, error } = await supabase.rpc('get_table_columns', { table_name: 'deduplication_analyses' });

  if (error) {
    console.log("Error:", error.message);

    // Alternative: try to insert empty and see what columns error
    console.log("\nTrying insert to discover columns...");
    const { error: insertError } = await supabase
      .from("deduplication_analyses")
      .insert({});
    console.log("Insert error:", insertError?.message);
  } else {
    console.log(data);
  }
}

main();
