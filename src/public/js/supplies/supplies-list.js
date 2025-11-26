/**
 * Supplies List Component
 * Handles list view, search, filters, and pagination
 */

import { SuppliesAPI } from './supplies-api.js';

export class SuppliesList {
  constructor() {
    this.supplies = [];
    this.categories = [];
    this.locations = [];
    this.currentPage = 0;
    this.pageSize = 50;
    this.totalCount = 0;
    this.currentView = 'table';
    this.filters = {
      search: '',
      categoryId: '',
      location: '',
      lowStock: false,
      itemType: '', // 'supply', 'tool', 'item', or '' for all
    };

    this.init();
  }

  async init() {
    try {
      // Load initial data
      await this.loadFiltersData();
      await this.loadSupplies();
      await this.loadStats();

      // Setup event listeners
      this.setupEventListeners();
    } catch (error) {
      this.showError('Failed to initialize: ' + error.message);
    }
  }

  setupEventListeners() {
    // Search
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;
    searchInput?.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.filters.search = e.target.value.trim();
        this.currentPage = 0;
        this.loadSupplies();
      }, 300); // Debounce
    });

    // Category filter
    document.getElementById('categoryFilter')?.addEventListener('change', (e) => {
      this.filters.categoryId = e.target.value;
      this.currentPage = 0;
      this.loadSupplies();
    });

    // Location filter
    document.getElementById('locationFilter')?.addEventListener('change', (e) => {
      this.filters.location = e.target.value;
      this.currentPage = 0;
      this.loadSupplies();
    });

    // Low stock filter
    document.getElementById('lowStockFilter')?.addEventListener('change', (e) => {
      this.filters.lowStock = e.target.checked;
      this.currentPage = 0;
      this.loadSupplies();
    });

    // Type filter tabs
    document.querySelectorAll('.type-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const type = e.currentTarget.dataset.type;
        this.filters.itemType = type;
        this.currentPage = 0;

        // Update active state
        document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');

        this.loadSupplies();
      });
    });

    // Clear filters
    document.getElementById('clearFilters')?.addEventListener('click', () => {
      this.clearFilters();
    });

    // Pagination
    document.getElementById('prevBtn')?.addEventListener('click', () => {
      if (this.currentPage > 0) {
        this.currentPage--;
        this.loadSupplies();
      }
    });

    document.getElementById('nextBtn')?.addEventListener('click', () => {
      if ((this.currentPage + 1) * this.pageSize < this.totalCount) {
        this.currentPage++;
        this.loadSupplies();
      }
    });

    // View toggle
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const view = e.currentTarget.dataset.view;
        this.switchView(view);
      });
    });

    // Sort headers
    document.querySelectorAll('.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const sortBy = th.dataset.sort;
        this.sortBy(sortBy);
      });
    });
  }

  async loadFiltersData() {
    try {
      // Load categories
      this.categories = await SuppliesAPI.getCategories();
      this.populateCategoryFilter();

      // Load locations
      this.locations = await SuppliesAPI.getLocations();
      this.populateLocationFilter();
    } catch (error) {
      console.error('Error loading filters:', error);
    }
  }

  populateCategoryFilter() {
    const select = document.getElementById('categoryFilter');
    if (!select) return;

    // Group by root category
    const grouped = {};
    this.categories.forEach(cat => {
      const parts = cat.path.split('/');
      const root = parts[0];
      if (!grouped[root]) grouped[root] = [];
      grouped[root].push(cat);
    });

    // Build options
    let html = '<option value="">All Categories</option>';
    Object.keys(grouped).sort().forEach(root => {
      html += `<optgroup label="${root}">`;
      grouped[root].forEach(cat => {
        const indent = '  '.repeat((cat.path.split('/').length - 1));
        html += `<option value="${cat.id}">${indent}${cat.name}</option>`;
      });
      html += '</optgroup>';
    });

    select.innerHTML = html;
  }

  populateLocationFilter() {
    const select = document.getElementById('locationFilter');
    if (!select) return;

    let html = '<option value="">All Locations</option>';
    this.locations.forEach(loc => {
      html += `<option value="${loc}">${loc}</option>`;
    });

    select.innerHTML = html;
  }

  async loadSupplies() {
    try {
      this.showLoading(true);

      let response;

      // If lowStock filter is active, use dedicated endpoint
      if (this.filters.lowStock) {
        response = await SuppliesAPI.getLowStock();

        // Apply client-side filters on low stock results
        let filteredData = response.data || [];

        if (this.filters.itemType) {
          filteredData = filteredData.filter(item => item.item_type === this.filters.itemType);
        }
        if (this.filters.categoryId) {
          filteredData = filteredData.filter(item => item.category_id === this.filters.categoryId);
        }
        if (this.filters.location) {
          filteredData = filteredData.filter(item =>
            item.location?.toLowerCase().includes(this.filters.location.toLowerCase())
          );
        }
        if (this.filters.search) {
          const searchLower = this.filters.search.toLowerCase();
          filteredData = filteredData.filter(item =>
            item.item_name?.toLowerCase().includes(searchLower) ||
            item.brand?.toLowerCase().includes(searchLower) ||
            item.part_number?.toLowerCase().includes(searchLower)
          );
        }

        // Manual pagination
        const start = this.currentPage * this.pageSize;
        const end = start + this.pageSize;
        this.supplies = filteredData.slice(start, end);
        this.totalCount = filteredData.length;

      } else {
        // Normal endpoint with server-side filtering
        const params = {
          limit: this.pageSize,
          offset: this.currentPage * this.pageSize,
          categoryId: this.filters.categoryId || undefined,
          location: this.filters.location || undefined,
          search: this.filters.search || undefined,
          itemType: this.filters.itemType || undefined,
        };

        response = await SuppliesAPI.list(params);
        this.supplies = response.data || [];
        this.totalCount = response.pagination?.total || 0;
      }

      this.render();
      this.updatePagination();
      this.updateResultsSummary();

      this.showLoading(false);
    } catch (error) {
      this.showError('Failed to load supplies: ' + error.message);
      this.showLoading(false);
    }
  }

  async loadStats() {
    try {
      // Build filter params for type counts (respects active filters except itemType and lowStock)
      const filterParams = {
        categoryId: this.filters.categoryId || undefined,
        location: this.filters.location || undefined,
        search: this.filters.search || undefined,
        // Don't include itemType (we're counting BY type)
        // Don't include lowStock (count all types regardless of stock level)
      };

      // Load type counts WITH active filters applied
      const [allResponse, suppliesResponse, toolsResponse, itemsResponse] = await Promise.all([
        SuppliesAPI.list({ ...filterParams, limit: 1 }),
        SuppliesAPI.list({ ...filterParams, limit: 1, itemType: 'supply' }),
        SuppliesAPI.list({ ...filterParams, limit: 1, itemType: 'tool' }),
        SuppliesAPI.list({ ...filterParams, limit: 1, itemType: 'item' })
      ]);

      document.getElementById('countAll').textContent = allResponse.pagination?.total || 0;
      document.getElementById('countSupplies').textContent = suppliesResponse.pagination?.total || 0;
      document.getElementById('countTools').textContent = toolsResponse.pagination?.total || 0;
      document.getElementById('countItems').textContent = itemsResponse.pagination?.total || 0;
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }

  render() {
    if (this.supplies.length === 0) {
      this.showEmptyState();
      return;
    }

    this.hideEmptyState();

    if (this.currentView === 'table') {
      this.renderTable();
    } else {
      this.renderGrid();
    }
  }

  renderTable() {
    const tbody = document.getElementById('suppliesTableBody');
    if (!tbody) return;

    tbody.innerHTML = this.supplies.map(supply => {
      const typeIcons = { supply: '🔄', tool: '🔧', item: '📌' };
      const typeLabels = { supply: 'Supply', tool: 'Tool', item: 'Item' };
      const itemType = supply.item_type || 'supply';

      return `
      <tr data-id="${supply.id}">
        <td class="type">
          <span class="type-badge type-badge-${itemType}">
            <span class="type-icon">${typeIcons[itemType]}</span>
            ${typeLabels[itemType]}
          </span>
        </td>
        <td class="item-name">
          <div class="item-name-content" style="display: flex; align-items: center; gap: 0.5rem;">
            ${supply.photos && supply.photos.length > 0 ? `
              <img
                src="${supply.photos[0]}"
                alt="${this.escapeHtml(supply.item_name)}"
                class="photo-thumbnail"
                onclick="window.suppliesPhotos?.viewPhoto('${supply.photos[0]}')"
              >
            ` : ''}
            <div>
              <strong>${this.escapeHtml(supply.item_name)}</strong>
              ${supply.brand ? `<small>${this.escapeHtml(supply.brand)}</small>` : ''}
            </div>
          </div>
        </td>
        <td class="category">
          <span class="category-badge" title="${this.escapeHtml(supply.supply_categories?.category_path || '')}">
            ${this.escapeHtml(supply.supply_categories?.category_name || '-')}
          </span>
        </td>
        <td class="location">${this.escapeHtml(supply.location || '-')}</td>
        <td class="stock ${supply.current_stock <= (supply.reorder_threshold || 0) ? 'low' : ''}">
          ${supply.current_stock}
        </td>
        <td class="unit">${this.escapeHtml(supply.supply_units?.abbreviation || '-')}</td>
        <td class="status">
          ${this.getStatusBadge(supply)}
        </td>
        <td class="actions">
          <button class="btn-icon" onclick="window.suppliesForm.openModal('${supply.id}')" title="Edit">
            ✏️
          </button>
          <button class="btn-icon" onclick="window.suppliesList.deleteSupply('${supply.id}')" title="Delete">
            🗑️
          </button>
        </td>
      </tr>
      `;
    }).join('');
  }

  renderGrid() {
    const grid = document.getElementById('suppliesGrid');
    if (!grid) return;

    grid.innerHTML = this.supplies.map(supply => `
      <div class="supply-card" data-id="${supply.id}">
        ${supply.photos && supply.photos.length > 0 ? `
          <img
            src="${supply.photos[0]}"
            alt="${this.escapeHtml(supply.item_name)}"
            class="photo-thumbnail"
            onclick="window.suppliesPhotos?.viewPhoto('${supply.photos[0]}')"
            style="width: 100%; height: 150px; object-fit: cover; border-radius: var(--border-radius); margin-bottom: var(--spacing-md); cursor: pointer;"
          >
        ` : ''}
        <div class="card-header">
          <h3>${this.escapeHtml(supply.item_name)}</h3>
          ${this.getStatusBadge(supply)}
        </div>
        <div class="card-body">
          <div class="card-field">
            <span class="field-label">Category:</span>
            <span class="field-value">${this.escapeHtml(supply.supply_categories?.category_name || '-')}</span>
          </div>
          <div class="card-field">
            <span class="field-label">Location:</span>
            <span class="field-value">${this.escapeHtml(supply.location || '-')}</span>
          </div>
          <div class="card-field">
            <span class="field-label">Stock:</span>
            <span class="field-value ${supply.current_stock <= (supply.reorder_threshold || 0) ? 'low' : ''}">
              ${supply.current_stock} ${this.escapeHtml(supply.supply_units?.abbreviation || '')}
            </span>
          </div>
          ${supply.brand ? `
            <div class="card-field">
              <span class="field-label">Brand:</span>
              <span class="field-value">${this.escapeHtml(supply.brand)}</span>
            </div>
          ` : ''}
        </div>
        <div class="card-actions">
          <button class="btn btn-secondary btn-sm" onclick="window.suppliesForm.openModal('${supply.id}')">
            Edit
          </button>
          <button class="btn btn-danger btn-sm" onclick="window.suppliesList.deleteSupply('${supply.id}')">
            Delete
          </button>
        </div>
      </div>
    `).join('');
  }

  getStatusBadge(supply) {
    if (supply.current_stock === 0) {
      return '<span class="badge badge-danger">Out of Stock</span>';
    } else if (supply.current_stock <= (supply.reorder_threshold || 0)) {
      return '<span class="badge badge-warning">Low Stock</span>';
    } else {
      return '<span class="badge badge-success">In Stock</span>';
    }
  }

  updatePagination() {
    const totalPages = Math.ceil(this.totalCount / this.pageSize);
    const currentPageNum = this.currentPage + 1;

    document.getElementById('paginationInfo').textContent =
      `Page ${currentPageNum} of ${totalPages || 1}`;

    document.getElementById('prevBtn').disabled = this.currentPage === 0;
    document.getElementById('nextBtn').disabled =
      (this.currentPage + 1) * this.pageSize >= this.totalCount;
  }

  updateResultsSummary() {
    const start = this.currentPage * this.pageSize + 1;
    const end = Math.min((this.currentPage + 1) * this.pageSize, this.totalCount);

    const summary = this.totalCount === 0
      ? 'No supplies found'
      : `Showing ${start}-${end} of ${this.totalCount} supplies`;

    document.getElementById('resultsCount').textContent = summary;
  }

  switchView(view) {
    this.currentView = view;

    // Update active button
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Show/hide views
    document.getElementById('tableView').style.display =
      view === 'table' ? 'block' : 'none';
    document.getElementById('gridView').style.display =
      view === 'grid' ? 'block' : 'none';

    this.render();
  }

  clearFilters() {
    this.filters = {
      search: '',
      categoryId: '',
      location: '',
      lowStock: false,
      itemType: '',
    };

    document.getElementById('searchInput').value = '';
    document.getElementById('categoryFilter').value = '';
    document.getElementById('locationFilter').value = '';
    document.getElementById('lowStockFilter').checked = false;

    // Reset type tabs to "All"
    document.querySelectorAll('.type-tab').forEach(tab => {
      tab.classList.remove('active');
      if (tab.dataset.type === '') {
        tab.classList.add('active');
      }
    });

    this.currentPage = 0;
    this.loadSupplies();
  }

  async deleteSupply(id) {
    if (!confirm('Are you sure you want to delete this supply item?')) {
      return;
    }

    try {
      await SuppliesAPI.delete(id);
      this.showToast('Supply deleted successfully', 'success');
      await this.loadSupplies();
      await this.loadStats();
    } catch (error) {
      this.showToast('Failed to delete supply: ' + error.message, 'error');
    }
  }

  sortBy(field) {
    // Simple client-side sort for now
    // TODO: Could implement server-side sorting via API
    const multiplier = this.sortDirection === 'asc' ? 1 : -1;

    this.supplies.sort((a, b) => {
      let aVal = a[field];
      let bVal = b[field];

      // Handle nested fields
      if (field === 'category') {
        aVal = a.supply_categories?.category_name || '';
        bVal = b.supply_categories?.category_name || '';
      } else if (field === 'unit') {
        aVal = a.supply_units?.unit_name || '';
        bVal = b.supply_units?.unit_name || '';
      }

      if (typeof aVal === 'string') {
        return aVal.localeCompare(bVal) * multiplier;
      }
      return (aVal - bVal) * multiplier;
    });

    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    this.render();
  }

  showLoading(show) {
    const loadingEl = document.getElementById('loadingState');
    const tableView = document.getElementById('tableView');
    const gridView = document.getElementById('gridView');

    if (show) {
      loadingEl?.style.setProperty('display', 'flex');
      tableView?.style.setProperty('display', 'none');
      gridView?.style.setProperty('display', 'none');
    } else {
      loadingEl?.style.setProperty('display', 'none');
      if (this.currentView === 'table') {
        tableView?.style.setProperty('display', 'block');
      } else {
        gridView?.style.setProperty('display', 'block');
      }
    }
  }

  showEmptyState() {
    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('tableView').style.display = 'none';
    document.getElementById('gridView').style.display = 'none';
  }

  hideEmptyState() {
    document.getElementById('emptyState').style.display = 'none';
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  showError(message) {
    this.showToast(message, 'error');
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Make it globally accessible
window.SuppliesList = SuppliesList;
