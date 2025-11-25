// Quick script to fetch all supply categories from database
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

async function getAllCategories() {
  const supabase = await getSupabaseClient();

  const { data, error } = await supabase
    .from('supply_categories')
    .select('id, category_name, category_path, level, parent_id')
    .order('level', { ascending: true })
    .order('category_path', { ascending: true });

  if (error) {
    console.error('Error fetching categories:', error);
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));
}

getAllCategories();
