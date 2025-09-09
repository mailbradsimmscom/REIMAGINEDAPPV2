import { getSupabaseClient } from './supabaseClient.js';
import { isSupabaseConfigured } from '../services/guards/index.js';

const TABLE = 'systems';

// Helper function to check if Supabase is available
async function checkSupabaseAvailability() {
  if (!isSupabaseConfigured()) {
    const error = new Error('Supabase not configured');
    error.code = 'SUPABASE_DISABLED';
    throw error;
  }
  
  const supabase = await getSupabaseClient();
  if (!supabase) {
    const error = new Error('Supabase client not available');
    error.code = 'SUPABASE_DISABLED';
    throw error;
  }
  
  return supabase;
}

export async function listSystems({ limit = 25, cursor } = {}) {
  const supabase = await checkSupabaseAvailability();
  let query = supabase.from(TABLE).select('*').order('asset_uid', { ascending: true }).limit(limit);
  if (cursor) {
    query = query.gt('asset_uid', cursor);
  }
  const { data, error } = await query;
  if (error) {
    const err = new Error(`Failed to list systems: ${error.message}`);
    err.cause = error;
    err.context = { operation: 'list', limit, cursor, table: TABLE };
    throw err;
  }
  return data ?? [];
}

export async function getSystemByAssetUid(assetUid) {
  const supabase = await checkSupabaseAvailability();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('asset_uid', assetUid)
    .limit(1)
    .single();
  if (error) {
    const err = new Error(`Failed to get system: ${error.message}`);
    err.cause = error;
    err.context = { operation: 'get_by_asset_uid', assetUid, table: TABLE };
    throw err;
  }
  return data ?? null;
}

export async function searchSystems(query, { limit = 10 } = {}) {
  const supabase = await checkSupabaseAvailability();
  
  try {
    const { data, error } = await supabase.rpc('search_systems', { q: query, top_n: limit });
    
    if (error) {
      const err = new Error(`RPC search_systems failed: ${error.message}`);
      err.cause = error;
      err.context = { 
        operation: 'search_rpc', 
        query, 
        limit, 
        rpcFunction: 'search_systems',
        table: TABLE 
      };
      throw err;
    }
    
    // Validate RPC response structure
    if (!Array.isArray(data)) {
      const err = new Error('RPC search_systems returned invalid data structure');
      err.context = { 
        operation: 'search_rpc', 
        query, 
        limit, 
        expectedType: 'array',
        actualType: typeof data,
        data 
      };
      throw err;
    }
    
    // Transform and validate each result
    const results = data.map((row, index) => {
      if (!row || typeof row !== 'object') {
        const err = new Error(`Invalid row structure at index ${index}`);
        err.context = { 
          operation: 'search_rpc', 
          query, 
          limit, 
          rowIndex: index,
          row 
        };
        throw err;
      }
      
      // Expect full system object with rank
      if (!row.asset_uid || typeof row.asset_uid !== 'string') {
        const err = new Error(`Missing or invalid asset_uid at index ${index}`);
        err.context = { 
          operation: 'search_rpc', 
          query, 
          limit, 
          rowIndex: index,
          row 
        };
        throw err;
      }
      
      if (typeof row.rank !== 'number' || !Number.isFinite(row.rank)) {
        const err = new Error(`Missing or invalid rank at index ${index}`);
        err.context = { 
          operation: 'search_rpc', 
          query, 
          limit, 
          rowIndex: index,
          row 
        };
        throw err;
      }
      
      // Return the full system object with rank
      return row;
    });
    
    return results;
    
  } catch (error) {
    // Re-throw with additional context if it's not already enhanced
    if (!error.context) {
      error.context = { 
        operation: 'search_rpc', 
        query, 
        limit, 
        rpcFunction: 'search_systems',
        table: TABLE 
      };
    }
    throw error;
  }
}

/**
 * Lookup system metadata by normalized manufacturer and model names
 * Used during document upload to resolve asset_uid and system metadata
 * 
 * @param {string} manufacturerNorm - Normalized manufacturer name
 * @param {string} modelNorm - Normalized model name
 * @returns {Promise<Object>} System metadata with asset_uid, system_norm, subsystem_norm
 * @throws {Error} If system not found or database error
 */
export async function lookupSystemByManufacturerAndModel(manufacturerNorm, modelNorm) {
  const supabase = await checkSupabaseAvailability();
  
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('asset_uid, system_norm, subsystem_norm')
      .eq('manufacturer_norm', manufacturerNorm)
      .eq('model_norm', modelNorm)
      .limit(1)
      .single();

    if (error) {
      // Handle "not found" case specifically
      if (error.code === 'PGRST116') {
        const err = new Error(`No system found for manufacturer "${manufacturerNorm}" and model "${modelNorm}"`);
        err.code = 'SYSTEM_NOT_FOUND';
        err.status = 400;
        err.context = { 
          operation: 'lookup_by_manufacturer_model', 
          manufacturerNorm, 
          modelNorm, 
          table: TABLE 
        };
        throw err;
      }
      
      // Handle other database errors
      const err = new Error(`Failed to lookup system: ${error.message}`);
      err.cause = error;
      err.context = { 
        operation: 'lookup_by_manufacturer_model', 
        manufacturerNorm, 
        modelNorm, 
        table: TABLE 
      };
      throw err;
    }

    // Validate required fields are present
    if (!data || !data.asset_uid || !data.system_norm || !data.subsystem_norm) {
      const err = new Error(`Incomplete system data for manufacturer "${manufacturerNorm}" and model "${modelNorm}"`);
      err.code = 'INCOMPLETE_SYSTEM_DATA';
      err.status = 500;
      err.context = { 
        operation: 'lookup_by_manufacturer_model', 
        manufacturerNorm, 
        modelNorm, 
        data,
        table: TABLE 
      };
      throw err;
    }

    return {
      asset_uid: data.asset_uid,
      system_norm: data.system_norm,
      subsystem_norm: data.subsystem_norm
    };
    
  } catch (error) {
    // Re-throw with additional context if it's not already enhanced
    if (!error.context) {
      error.context = { 
        operation: 'lookup_by_manufacturer_model', 
        manufacturerNorm, 
        modelNorm, 
        table: TABLE 
      };
    }
    throw error;
  }
}

/**
 * Get system by UUID with spec_keywords
 */
async function getSystemByUid(systemUid) {
  const supabase = await checkSupabaseAvailability();
  const { data, error } = await supabase
    .from(TABLE)
    .select('asset_uid, spec_keywords_jsonb')
    .eq('asset_uid', systemUid)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Update spec keywords for a system
 */
async function updateSpecKeywords(systemUid, next) {
  const supabase = await checkSupabaseAvailability();
  const { error } = await supabase
    .from(TABLE)
    .update({ spec_keywords_jsonb: next })
    .eq('asset_uid', systemUid);
  if (error) throw error;
}

/**
 * List minimal system data for admin dropdowns
 */
async function listMinimal() {
  const supabase = await checkSupabaseAvailability();
  const { data, error } = await supabase
    .from(TABLE)
    .select('asset_uid, manufacturer_norm, model_norm, system_norm')
    .order('manufacturer_norm')
    .limit(5000);
  if (error) throw error;
  return data ?? [];
}

export {
  getSystemByUid,
  updateSpecKeywords,
  listMinimal
};

export default { 
  listSystems, 
  getSystemByAssetUid, 
  searchSystems, 
  lookupSystemByManufacturerAndModel
};
