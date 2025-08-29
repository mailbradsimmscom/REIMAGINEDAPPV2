import { getSupabaseClient } from './supabaseClient.js';

export async function listPublicItems({ limit = 20 } = {}) {
  const supabase = getSupabaseClient();
  const query = supabase.from('items').select('*').order('created_at', { ascending: false }).limit(limit);
  const { data, error } = await query;
  if (error) {
    const err = new Error(`Failed to fetch items: ${error.message}`);
    err.cause = error;
    throw err;
  }
  return data ?? [];
}

export default { listPublicItems };


