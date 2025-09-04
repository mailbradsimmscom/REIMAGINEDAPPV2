import { listSystems, getSystemByAssetUid, searchSystems } from '../repositories/systems.repository.js';
import { isSupabaseConfigured } from '../services/guards/index.js';

function validateLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return 25;
  return Math.min(n, 100);
}

// Helper function to check if Supabase is available
async function checkSupabaseAvailability() {
  if (!isSupabaseConfigured()) {
    const error = new Error('Supabase not configured');
    error.code = 'SUPABASE_DISABLED';
    throw error;
  }
}

export async function listSystemsSvc({ limit, cursor } = {}) {
  try {
    // Check Supabase availability before listing systems
    await checkSupabaseAvailability();
    
    const safeLimit = validateLimit(limit);
    const rows = await listSystems({ limit: safeLimit, cursor });
    const nextCursor = rows.length > 0 ? rows[rows.length - 1].asset_uid : null;
    return { systems: rows, nextCursor };
  } catch (error) {
    // Enhance error with service context
    error.context = { 
      ...error.context, 
      service: 'listSystemsSvc',
      input: { limit, cursor }
    };
    throw error;
  }
}

export async function getSystemSvc(assetUid) {
  try {
    // Check Supabase availability before getting system
    await checkSupabaseAvailability();
    
    if (!assetUid || String(assetUid).trim() === '') {
      throw new Error('asset_uid is required');
    }
    return await getSystemByAssetUid(assetUid);
  } catch (error) {
    // Enhance error with service context
    error.context = { 
      ...error.context, 
      service: 'getSystemSvc',
      input: { assetUid }
    };
    throw error;
  }
}

function validateQuery(q) {
  const s = (q ?? '').trim();
  if (s.length < 2) throw new Error('query must be at least 2 characters');
  if (s.length > 100) throw new Error('query too long (max 100 characters)');
  
  // Basic character validation - allow alphanumeric, spaces, hyphens, underscores, ampersands
  if (!/^[a-zA-Z0-9\s\-_&]+$/.test(s)) {
    throw new Error('query contains invalid characters (only letters, numbers, spaces, hyphens, underscores, and ampersands allowed)');
  }
  
  return s;
}

export async function searchSystemsSvc(q, { limit } = {}) {
  try {
    // Check Supabase availability before searching systems
    await checkSupabaseAvailability();
    
    const safeQ = validateQuery(q);
    const { getEnv } = await import('../config/env.js');
    const { searchMaxRows = 8, searchRankFloor = 0.05 } = getEnv();
    // Use explicit limit if provided, otherwise use env default
    const maxRows = limit ? Math.min(Math.max(Number(limit), 1), searchMaxRows) : searchMaxRows;
    
    const raw = await searchSystems(safeQ, { limit: maxRows });
    const filtered = raw.filter((r) => Number(r.rank) >= searchRankFloor).slice(0, maxRows);
    
    return { 
      systems: filtered, 
      meta: { 
        floor: searchRankFloor, 
        maxRows: searchMaxRows, 
        rawCount: raw.length,
        filteredCount: filtered.length,
        query: safeQ
      } 
    };
  } catch (error) {
    // Enhance error with service context
    const { getEnv } = await import('../config/env.js');
    const { searchRankFloor = 0, searchMaxRows = 8 } = getEnv();
    error.context = { 
      ...error.context, 
      service: 'searchSystemsSvc',
      input: { query: q, limit },
      config: { 
        searchRankFloor, 
        searchMaxRows 
      }
    };
    throw error;
  }
}

export const systemsService = { listSystemsSvc, getSystemSvc, searchSystemsSvc };
