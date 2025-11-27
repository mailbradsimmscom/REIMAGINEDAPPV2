/**
 * Supplies API Client
 * Wrapper for all supplies-related API calls
 */

const API_BASE = '/api/supplies';

/**
 * Make API request with error handling
 */
async function apiRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Request failed with status ${response.status}`);
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

/**
 * Supplies API
 */
export const SuppliesAPI = {

  /**
   * List supplies with filters and pagination
   */
  async list({ limit = 50, offset = 0, categoryId, location, lowStock, search, itemType } = {}) {
    const params = new URLSearchParams();
    if (limit) params.set('limit', limit);
    if (offset) params.set('offset', offset);
    if (categoryId) params.set('categoryId', categoryId);
    if (location) params.set('location', location);
    if (lowStock) params.set('lowStock', 'true');
    if (itemType) params.set('itemType', itemType);

    const url = search
      ? `${API_BASE}/search?q=${encodeURIComponent(search)}&${params}`
      : `${API_BASE}?${params}`;

    return apiRequest(url);
  },

  /**
   * Get single supply by ID
   */
  async getById(id) {
    return apiRequest(`${API_BASE}/${id}`);
  },

  /**
   * Create new supply
   */
  async create(supplyData) {
    return apiRequest(API_BASE, {
      method: 'POST',
      body: JSON.stringify(supplyData),
    });
  },

  /**
   * Update existing supply
   */
  async update(id, supplyData) {
    return apiRequest(`${API_BASE}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(supplyData),
    });
  },

  /**
   * Delete supply
   */
  async delete(id) {
    return apiRequest(`${API_BASE}/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * Search supplies
   */
  async search(query, { limit = 20, offset = 0 } = {}) {
    const params = new URLSearchParams({ q: query, limit, offset });
    return apiRequest(`${API_BASE}/search?${params}`);
  },

  /**
   * Get low stock supplies
   */
  async getLowStock() {
    return apiRequest(`${API_BASE}/low-stock`);
  },

  /**
   * Get supplies by category
   */
  async getByCategory(categoryId) {
    return apiRequest(`${API_BASE}/category/${categoryId}`);
  },

  /**
   * Get supplies by system
   */
  async getBySystem(systemUid) {
    return apiRequest(`${API_BASE}/system/${systemUid}`);
  },

  /**
   * Get all categories
   */
  async getCategories() {
    // Use helper endpoint if available, otherwise build from supplies
    try {
      const response = await fetch('/api/supplies-categories');
      if (response.ok) {
        return response.json();
      }
    } catch (e) {
      // Fallback: no dedicated endpoint yet
    }

    // Fallback: extract from supplies (less efficient but works)
    const { data } = await this.list({ limit: 1000 });
    const categories = new Map();

    data.forEach(supply => {
      if (supply.supply_categories) {
        const cat = supply.supply_categories;
        if (!categories.has(supply.category_id)) {
          categories.set(supply.category_id, {
            id: supply.category_id,
            name: cat.category_name,
            path: cat.category_path,
          });
        }
      }
    });

    return Array.from(categories.values()).sort((a, b) =>
      a.path.localeCompare(b.path)
    );
  },

  /**
   * Get all units
   */
  async getUnits() {
    // Use helper endpoint if available
    try {
      const response = await fetch('/api/supplies-units');
      if (response.ok) {
        return response.json();
      }
    } catch (e) {
      // Fallback
    }

    // Fallback: extract from supplies
    const { data } = await this.list({ limit: 1000 });
    const units = new Map();

    data.forEach(supply => {
      if (supply.supply_units) {
        const unit = supply.supply_units;
        if (!units.has(supply.unit_id)) {
          units.set(supply.unit_id, {
            id: supply.unit_id,
            name: unit.unit_name,
            abbreviation: unit.abbreviation,
          });
        }
      }
    });

    return Array.from(units.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  },

  /**
   * Get all locations from supply_locations table
   */
  async getLocations() {
    try {
      const response = await fetch('/api/supplies/config/locations');
      if (response.ok) {
        const result = await response.json();
        return result.data || [];
      }
    } catch (e) {
      console.error('Error fetching locations:', e);
    }

    // Fallback: return empty array
    return [];
  },

  /**
   * Get statistics
   */
  async getStats() {
    const [allSupplies, lowStock] = await Promise.all([
      this.list({ limit: 1 }), // Just get count
      this.getLowStock(),
    ]);

    return {
      total: allSupplies.pagination?.total || 0,
      lowStock: lowStock.count || 0,
    };
  },
};

export default SuppliesAPI;
