import { getSupabaseClient } from './supabaseClient.js';

const TABLE = 'systems';

export async function listSystems({ limit = 25, cursor } = {}) {
  const supabase = await getSupabaseClient();
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
  const supabase = await getSupabaseClient();
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
  const supabase = await getSupabaseClient();
  
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
      
      if (!row.id || typeof row.id !== 'string') {
        const err = new Error(`Missing or invalid id at index ${index}`);
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
      
      return { id: row.id, rank: row.rank };
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

export default { listSystems, getSystemByAssetUid, searchSystems };
