/**
 * Guardianage Supabase Repository
 * Reuses the main app's Supabase client — same DB, same credentials.
 */

import { getSupabaseClient } from '../../src/repositories/supabaseClient.js';

export { getSupabaseClient };
