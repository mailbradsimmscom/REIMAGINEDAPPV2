// Quick script to fetch all supply units from database
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';

async function getAllUnits() {
  const supabase = await getSupabaseClient();

  const { data, error } = await supabase
    .from('supply_units')
    .select('id, unit_name, abbreviation')
    .order('unit_name', { ascending: true });

  if (error) {
    console.error('Error fetching units:', error);
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));
}

getAllUnits();
