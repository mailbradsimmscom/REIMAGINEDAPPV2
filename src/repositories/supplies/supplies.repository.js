// src/repositories/supplies/supplies.repository.js
import { getSupabaseClient } from '../supabaseClient.js';
import { logger } from '../../utils/logger.js';

const TABLE = 'supplies';

/**
 * Check Supabase availability
 * @throws {Error} If Supabase not configured or client unavailable
 */
async function checkSupabaseAvailability() {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    const error = new Error('Supabase client not available');
    error.code = 'SUPABASE_DISABLED';
    throw error;
  }
  return supabase;
}

/**
 * List supplies with pagination and filtering
 * @param {Object} options - Query options
 * @param {number} options.limit - Max records to return (default 50)
 * @param {number} options.offset - Skip N records (default 0)
 * @param {string} options.categoryId - Filter by category UUID
 * @param {string} options.location - Filter by location (partial match)
 * @param {string} options.systemAssetUid - Filter by system
 * @param {boolean} options.lowStock - Only show items at/below reorder threshold
 * @param {string} options.itemType - Filter by item type (supply, tool, item)
 * @param {string} options.orderBy - Column to sort by (default 'item_name')
 * @param {boolean} options.ascending - Sort direction (default true)
 */
export async function listSupplies({
  limit = 50,
  offset = 0,
  categoryId,
  location,
  systemAssetUid,
  lowStock = false,
  itemType,
  orderBy = 'item_name',
  ascending = true
} = {}) {
  const supabase = await checkSupabaseAvailability();

  try {
    let query = supabase
      .from(TABLE)
      .select('*, supply_categories(category_name, category_path), supply_units(unit_name, abbreviation)', { count: 'exact' })
      .range(offset, offset + limit - 1)
      .order(orderBy, { ascending });

    // Apply filters
    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    if (location) {
      query = query.ilike('location', `%${location}%`);
    }

    if (systemAssetUid) {
      query = query.eq('system_asset_uid', systemAssetUid);
    }

    if (itemType) {
      query = query.eq('item_type', itemType);
    }

    // Note: lowStock filter removed from list endpoint
    // Use GET /api/supplies/low-stock instead for proper column comparison

    const { data, error, count } = await query;

    if (error) {
      const err = new Error(`Failed to list supplies: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'list', limit, offset, categoryId, location, table: TABLE };
      throw err;
    }

    return {
      data: data ?? [],
      count: count ?? 0,
      limit,
      offset
    };
  } catch (error) {
    logger.error('Repository error in listSupplies', { error: error.message, context: error.context });
    throw error;
  }
}

/**
 * Get single supply by ID
 * @param {string} id - Supply UUID
 */
export async function getSupplyById(id) {
  const supabase = await checkSupabaseAvailability();

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(`
        *,
        supply_categories(id, category_name, category_path),
        supply_units(id, unit_name, abbreviation)
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        const err = new Error(`Supply not found: ${id}`);
        err.code = 'SUPPLY_NOT_FOUND';
        err.status = 404;
        err.context = { operation: 'get_by_id', id, table: TABLE };
        throw err;
      }

      const err = new Error(`Failed to get supply: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'get_by_id', id, table: TABLE };
      throw err;
    }

    return data;
  } catch (error) {
    logger.error('Repository error in getSupplyById', { error: error.message, id, context: error.context });
    throw error;
  }
}

/**
 * Create new supply item
 * @param {Object} supply - Supply data
 */
export async function createSupply(supply) {
  const supabase = await checkSupabaseAvailability();

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .insert(supply)
      .select(`
        *,
        supply_categories(id, category_name, category_path),
        supply_units(id, unit_name, abbreviation)
      `)
      .single();

    if (error) {
      const err = new Error(`Failed to create supply: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'create', supply, table: TABLE };
      throw err;
    }

    logger.info('Supply created', { supplyId: data.id, itemName: data.item_name });
    return data;
  } catch (error) {
    logger.error('Repository error in createSupply', { error: error.message, context: error.context });
    throw error;
  }
}

/**
 * Update supply item
 * @param {string} id - Supply UUID
 * @param {Object} updates - Fields to update
 */
export async function updateSupply(id, updates) {
  const supabase = await checkSupabaseAvailability();

  try {
    // Remove id from updates if present (can't update primary key)
    const { id: _, ...safeUpdates } = updates;

    const { data, error } = await supabase
      .from(TABLE)
      .update(safeUpdates)
      .eq('id', id)
      .select(`
        *,
        supply_categories(id, category_name, category_path),
        supply_units(id, unit_name, abbreviation)
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        const err = new Error(`Supply not found: ${id}`);
        err.code = 'SUPPLY_NOT_FOUND';
        err.status = 404;
        err.context = { operation: 'update', id, table: TABLE };
        throw err;
      }

      const err = new Error(`Failed to update supply: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'update', id, updates, table: TABLE };
      throw err;
    }

    logger.info('Supply updated', { supplyId: data.id, itemName: data.item_name });
    return data;
  } catch (error) {
    logger.error('Repository error in updateSupply', { error: error.message, id, context: error.context });
    throw error;
  }
}

/**
 * Delete supply item
 * @param {string} id - Supply UUID
 */
export async function deleteSupply(id) {
  const supabase = await checkSupabaseAvailability();

  try {
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq('id', id);

    if (error) {
      const err = new Error(`Failed to delete supply: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'delete', id, table: TABLE };
      throw err;
    }

    logger.info('Supply deleted', { supplyId: id });
    return { success: true };
  } catch (error) {
    logger.error('Repository error in deleteSupply', { error: error.message, id, context: error.context });
    throw error;
  }
}

/**
 * Full-text search supplies using search_vector
 * @param {string} query - Search query
 * @param {Object} options - Search options
 */
export async function searchSupplies(query, { limit = 20, offset = 0 } = {}) {
  const supabase = await checkSupabaseAvailability();

  try {
    // Use textSearch on search_vector column (updated by trigger)
    const { data, error, count } = await supabase
      .from(TABLE)
      .select(`
        *,
        supply_categories(category_name, category_path),
        supply_units(unit_name, abbreviation)
      `, { count: 'exact' })
      .textSearch('search_vector', query, {
        type: 'websearch',
        config: 'english'
      })
      .range(offset, offset + limit - 1);

    if (error) {
      const err = new Error(`Search failed: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'search', query, limit, offset, table: TABLE };
      throw err;
    }

    return {
      data: data ?? [],
      count: count ?? 0,
      query,
      limit,
      offset
    };
  } catch (error) {
    logger.error('Repository error in searchSupplies', { error: error.message, query, context: error.context });
    throw error;
  }
}

/**
 * Get supplies at or below reorder threshold
 * @param {boolean} autoReorderOnly - Only return items with auto_reorder_enabled=true
 */
export async function getLowStockSupplies(autoReorderOnly = false) {
  const supabase = await checkSupabaseAvailability();

  try {
    // Fetch all items with reorder threshold set
    let query = supabase
      .from(TABLE)
      .select(`
        *,
        supply_categories(category_name, category_path),
        supply_units(unit_name, abbreviation)
      `)
      .not('reorder_threshold', 'is', null)
      .order('current_stock', { ascending: true });

    if (autoReorderOnly) {
      query = query.eq('auto_reorder_enabled', true);
    }

    const { data, error } = await query;

    if (error) {
      const err = new Error(`Failed to get low stock supplies: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'low_stock', autoReorderOnly, table: TABLE };
      throw err;
    }

    // Filter in memory for column comparison (current_stock <= reorder_threshold)
    const lowStockItems = (data ?? []).filter(item =>
      item.current_stock <= item.reorder_threshold
    );

    return lowStockItems;
  } catch (error) {
    logger.error('Repository error in getLowStockSupplies', { error: error.message, context: error.context });
    throw error;
  }
}

/**
 * Get supplies by category (including subcategories)
 * @param {string} categoryId - Category UUID
 */
export async function getSuppliesByCategory(categoryId) {
  const supabase = await checkSupabaseAvailability();

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(`
        *,
        supply_categories(id, category_name, category_path),
        supply_units(unit_name, abbreviation)
      `)
      .eq('category_id', categoryId)
      .order('item_name');

    if (error) {
      const err = new Error(`Failed to get supplies by category: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'by_category', categoryId, table: TABLE };
      throw err;
    }

    return data ?? [];
  } catch (error) {
    logger.error('Repository error in getSuppliesByCategory', { error: error.message, categoryId, context: error.context });
    throw error;
  }
}

/**
 * Get supplies by system
 * @param {string} assetUid - System asset_uid
 */
export async function getSuppliesBySystem(assetUid) {
  const supabase = await checkSupabaseAvailability();

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(`
        *,
        supply_categories(category_name, category_path),
        supply_units(unit_name, abbreviation)
      `)
      .eq('system_asset_uid', assetUid)
      .order('item_name');

    if (error) {
      const err = new Error(`Failed to get supplies by system: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'by_system', assetUid, table: TABLE };
      throw err;
    }

    return data ?? [];
  } catch (error) {
    logger.error('Repository error in getSuppliesBySystem', { error: error.message, assetUid, context: error.context });
    throw error;
  }
}

export default {
  listSupplies,
  getSupplyById,
  createSupply,
  updateSupply,
  deleteSupply,
  searchSupplies,
  getLowStockSupplies,
  getSuppliesByCategory,
  getSuppliesBySystem
};
