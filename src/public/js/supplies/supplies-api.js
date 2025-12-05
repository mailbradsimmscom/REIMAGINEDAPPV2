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
   * Get all categories (flat list)
   * @param {boolean} withCounts - include item counts (for admin)
   */
  async getCategories(withCounts = false) {
    const url = withCounts
      ? '/api/supplies/config/categories?withCounts=true'
      : '/api/supplies/config/categories';

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to fetch categories');
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch categories');
    }

    // Map to consistent frontend format
    return (result.data || []).map(cat => ({
      id: cat.id,
      name: cat.category_name,
      displayOrder: cat.display_order,
      icon: cat.icon,
      itemCount: cat.item_count // only present if withCounts=true
    }));
  },

  /**
   * Create a new category
   * @param {string} name - category name
   */
  async createCategory(name) {
    const response = await fetch('/api/supplies/config/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_name: name })
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to create category');
    }

    return {
      id: result.data.id,
      name: result.data.category_name,
      displayOrder: result.data.display_order
    };
  },

  /**
   * Delete a category (only if no items use it)
   * @param {string} id - category UUID
   */
  async deleteCategory(id) {
    const response = await fetch(`/api/supplies/config/categories/${id}`, {
      method: 'DELETE'
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to delete category');
    }

    return true;
  },

  /**
   * Get all units
   */
  async getUnits() {
    const response = await fetch('/api/supplies/config/units');
    if (!response.ok) {
      throw new Error('Failed to fetch units');
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch units');
    }

    // Map to consistent frontend format
    return (result.data || []).map(unit => ({
      id: unit.id,
      name: unit.unit_name,
      abbreviation: unit.abbreviation
    }));
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
