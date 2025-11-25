import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

async function main() {
  const supabase = await getSupabaseClient();

  const { data, error } = await supabase
    .from('supply_categories')
    .select('*')
    .order('category_name');

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  console.log(`Found ${data.length} categories:\n`);
  data.forEach(cat => {
    console.log(`${cat.id}: ${cat.category_name}`);
    console.log(`   Path: ${cat.category_path}\n`);
  });
}

main();
