import { getSupabaseClient } from './supabaseClient.js';

// Lists table names from the public schema using the service role key
export async function listPublicTables() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('information_schema.tables')
    .select('table_name')
    .eq('table_schema', 'public')
    .order('table_name');

  if (error) {
    const err = new Error(`Failed to list tables: ${error.message}`);
    err.cause = error;
    throw err;
  }

  return (data ?? []).map((r) => r.table_name);
}

export default { listPublicTables };


