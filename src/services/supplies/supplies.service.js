// src/services/supplies/supplies.service.js
import * as suppliesRepository from '../../repositories/supplies/supplies.repository.js';
import { logger } from '../../utils/logger.js';

/**
 * List supplies with filtering and pagination
 */
export async function listSupplies(options = {}) {
  try {
    // Validate pagination params
    const limit = Math.min(Math.max(parseInt(options.limit) || 50, 1), 100); // Max 100
    const offset = Math.max(parseInt(options.offset) || 0, 0);

    const result = await suppliesRepository.listSupplies({
      ...options,
      limit,
      offset
    });

    return {
      success: true,
      data: result.data,
      pagination: {
        total: result.count,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.offset + result.limit < result.count
      }
    };
  } catch (error) {
    logger.error('Service error in listSupplies', { error: error.message });
    throw error;
  }
}

/**
 * Get single supply by ID
 */
export async function getSupplyById(id) {
  try {
    if (!id) {
      const error = new Error('Supply ID is required');
      error.status = 400;
      throw error;
    }

    const supply = await suppliesRepository.getSupplyById(id);

    return {
      success: true,
      data: supply
    };
  } catch (error) {
    logger.error('Service error in getSupplyById', { error: error.message, id });
    throw error;
  }
}

/**
 * Create new supply item
 */
export async function createSupply(supplyData) {
  try {
    // Validate required fields
    if (!supplyData.item_name) {
      const error = new Error('item_name is required');
      error.status = 400;
      throw error;
    }

    if (!supplyData.category_id) {
      const error = new Error('category_id is required');
      error.status = 400;
      throw error;
    }

    // Validate numeric fields
    if (supplyData.current_stock !== undefined && supplyData.current_stock < 0) {
      const error = new Error('current_stock cannot be negative');
      error.status = 400;
      throw error;
    }

    if (supplyData.reorder_threshold !== undefined && supplyData.reorder_threshold < 0) {
      const error = new Error('reorder_threshold cannot be negative');
      error.status = 400;
      throw error;
    }

    // Sanitize data
    const sanitizedData = {
      item_name: supplyData.item_name.trim(),
      category_id: supplyData.category_id,
      current_stock: supplyData.current_stock ?? 0,
      unit_id: supplyData.unit_id || null,
      location: supplyData.location?.trim() || null,
      location_details: supplyData.location_details?.trim() || null,
      system_asset_uid: supplyData.system_asset_uid || null,
      reorder_threshold: supplyData.reorder_threshold || null,
      reorder_quantity: supplyData.reorder_quantity || null,
      auto_reorder_enabled: supplyData.auto_reorder_enabled ?? false,
      brand: supplyData.brand?.trim() || null,
      supplier: supplyData.supplier?.trim() || null,
      part_number: supplyData.part_number?.trim() || null,
      barcode: supplyData.barcode?.trim() || null,
      purchase_url: supplyData.purchase_url?.trim() || null,
      typical_price: supplyData.typical_price || null,
      currency: supplyData.currency || 'USD',
      colloquial_names: supplyData.colloquial_names || [],
      keywords: supplyData.keywords || [],
      photos: supplyData.photos || [],
      notes: supplyData.notes?.trim() || null,
      is_critical: supplyData.is_critical ?? false,
      is_hazmat: supplyData.is_hazmat ?? false,
      best_before: supplyData.best_before || null,
      date_opened: supplyData.date_opened || null,
      shelf_life_days: supplyData.shelf_life_days || null
    };

    const supply = await suppliesRepository.createSupply(sanitizedData);

    return {
      success: true,
      data: supply
    };
  } catch (error) {
    logger.error('Service error in createSupply', { error: error.message });
    throw error;
  }
}

/**
 * Update supply item
 */
export async function updateSupply(id, updates) {
  try {
    if (!id) {
      const error = new Error('Supply ID is required');
      error.status = 400;
      throw error;
    }

    // Validate numeric fields if present
    if (updates.current_stock !== undefined && updates.current_stock < 0) {
      const error = new Error('current_stock cannot be negative');
      error.status = 400;
      throw error;
    }

    if (updates.reorder_threshold !== undefined && updates.reorder_threshold < 0) {
      const error = new Error('reorder_threshold cannot be negative');
      error.status = 400;
      throw error;
    }

    // Sanitize string fields
    const sanitizedUpdates = { ...updates };
    if (updates.item_name) sanitizedUpdates.item_name = updates.item_name.trim();
    if (updates.location) sanitizedUpdates.location = updates.location.trim();
    if (updates.brand) sanitizedUpdates.brand = updates.brand.trim();
    if (updates.supplier) sanitizedUpdates.supplier = updates.supplier.trim();
    if (updates.notes) sanitizedUpdates.notes = updates.notes.trim();

    const supply = await suppliesRepository.updateSupply(id, sanitizedUpdates);

    return {
      success: true,
      data: supply
    };
  } catch (error) {
    logger.error('Service error in updateSupply', { error: error.message, id });
    throw error;
  }
}

/**
 * Delete supply item
 */
export async function deleteSupply(id) {
  try {
    if (!id) {
      const error = new Error('Supply ID is required');
      error.status = 400;
      throw error;
    }

    await suppliesRepository.deleteSupply(id);

    return {
      success: true,
      message: 'Supply deleted successfully'
    };
  } catch (error) {
    logger.error('Service error in deleteSupply', { error: error.message, id });
    throw error;
  }
}

/**
 * Search supplies using full-text search
 */
export async function searchSupplies(query, options = {}) {
  try {
    if (!query || query.trim().length === 0) {
      const error = new Error('Search query is required');
      error.status = 400;
      throw error;
    }

    const limit = Math.min(Math.max(parseInt(options.limit) || 20, 1), 100);
    const offset = Math.max(parseInt(options.offset) || 0, 0);

    const result = await suppliesRepository.searchSupplies(query.trim(), { limit, offset });

    return {
      success: true,
      data: result.data,
      query: result.query,
      pagination: {
        total: result.count,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.offset + result.limit < result.count
      }
    };
  } catch (error) {
    logger.error('Service error in searchSupplies', { error: error.message, query });
    throw error;
  }
}

/**
 * Get supplies at or below reorder threshold
 */
export async function getLowStockSupplies(autoReorderOnly = false) {
  try {
    const supplies = await suppliesRepository.getLowStockSupplies(autoReorderOnly);

    return {
      success: true,
      data: supplies,
      count: supplies.length
    };
  } catch (error) {
    logger.error('Service error in getLowStockSupplies', { error: error.message });
    throw error;
  }
}

/**
 * Get supplies by category
 */
export async function getSuppliesByCategory(categoryId) {
  try {
    if (!categoryId) {
      const error = new Error('Category ID is required');
      error.status = 400;
      throw error;
    }

    const supplies = await suppliesRepository.getSuppliesByCategory(categoryId);

    return {
      success: true,
      data: supplies,
      count: supplies.length
    };
  } catch (error) {
    logger.error('Service error in getSuppliesByCategory', { error: error.message, categoryId });
    throw error;
  }
}

/**
 * Get supplies by system
 */
export async function getSuppliesBySystem(assetUid) {
  try {
    if (!assetUid) {
      const error = new Error('System asset_uid is required');
      error.status = 400;
      throw error;
    }

    const supplies = await suppliesRepository.getSuppliesBySystem(assetUid);

    return {
      success: true,
      data: supplies,
      count: supplies.length
    };
  } catch (error) {
    logger.error('Service error in getSuppliesBySystem', { error: error.message, assetUid });
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
