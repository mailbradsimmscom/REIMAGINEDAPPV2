/**
 * Supplies Admin Page
 * Manages categories, units, and locations
 */

const API_BASE = '/api/supplies/config';

// State
let categories = [];
let units = [];
let locations = [];
let editingId = null;

// ============================================
// API Helpers
// ============================================

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

// ============================================
// Toast Notifications
// ============================================

function showToast(message, type = 'info') {
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

// ============================================
// Tab Switching
// ============================================

function setupTabs() {
  const tabs = document.querySelectorAll('.admin-tab');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show corresponding content
      const tabId = tab.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(`tab-${tabId}`).classList.add('active');

      // Clear any editing state
      editingId = null;
    });
  });
}

// ============================================
// Categories
// ============================================

async function loadCategories() {
  try {
    const result = await apiRequest(`${API_BASE}/categories`);
    categories = result.data || [];
    renderCategories();
  } catch (error) {
    showToast('Failed to load categories', 'error');
  }
}

function renderCategories() {
  const container = document.getElementById('categoriesList');

  if (categories.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📁</div>
        <p>No categories yet. Add one above.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = categories.map(cat => `
    <div class="item-row" data-id="${cat.id}">
      ${editingId === cat.id ? `
        <div class="edit-inputs">
          <input type="text" value="${escapeHtml(cat.category_name)}" data-field="category_name" placeholder="Name">
          <input type="text" value="${escapeHtml(cat.category_path || '')}" data-field="category_path" placeholder="Path">
        </div>
        <div class="item-actions">
          <button class="btn-save" onclick="saveCategory('${cat.id}')">Save</button>
          <button class="btn-cancel" onclick="cancelEdit()">Cancel</button>
        </div>
      ` : `
        <div class="item-info">
          <div class="item-name">${escapeHtml(cat.category_name)}</div>
          <div class="item-meta">${escapeHtml(cat.category_path || '')}</div>
        </div>
        <div class="item-actions">
          <button class="btn-edit" onclick="editCategory('${cat.id}')">Edit</button>
          <button class="btn-delete" onclick="deleteCategory('${cat.id}')">Delete</button>
        </div>
      `}
    </div>
  `).join('');
}

async function addCategory(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  try {
    await apiRequest(`${API_BASE}/categories`, {
      method: 'POST',
      body: JSON.stringify({
        category_name: formData.get('category_name'),
        category_path: formData.get('category_path') || formData.get('category_name')
      })
    });

    form.reset();
    showToast('Category added', 'success');
    loadCategories();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

window.editCategory = function(id) {
  editingId = id;
  renderCategories();
};

window.saveCategory = async function(id) {
  const row = document.querySelector(`[data-id="${id}"]`);
  const nameInput = row.querySelector('[data-field="category_name"]');
  const pathInput = row.querySelector('[data-field="category_path"]');

  try {
    await apiRequest(`${API_BASE}/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        category_name: nameInput.value,
        category_path: pathInput.value || nameInput.value
      })
    });

    editingId = null;
    showToast('Category updated', 'success');
    loadCategories();
  } catch (error) {
    showToast(error.message, 'error');
  }
};

window.deleteCategory = async function(id) {
  if (!confirm('Delete this category?')) return;

  try {
    await apiRequest(`${API_BASE}/categories/${id}`, { method: 'DELETE' });
    showToast('Category deleted', 'success');
    loadCategories();
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// ============================================
// Units
// ============================================

async function loadUnits() {
  try {
    const result = await apiRequest(`${API_BASE}/units`);
    units = result.data || [];
    renderUnits();
  } catch (error) {
    showToast('Failed to load units', 'error');
  }
}

function renderUnits() {
  const container = document.getElementById('unitsList');

  if (units.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📏</div>
        <p>No units yet. Add one above.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = units.map(unit => `
    <div class="item-row" data-id="${unit.id}">
      ${editingId === unit.id ? `
        <div class="edit-inputs">
          <input type="text" value="${escapeHtml(unit.unit_name)}" data-field="unit_name" placeholder="Name">
          <input type="text" value="${escapeHtml(unit.abbreviation)}" data-field="abbreviation" placeholder="Abbr">
        </div>
        <div class="item-actions">
          <button class="btn-save" onclick="saveUnit('${unit.id}')">Save</button>
          <button class="btn-cancel" onclick="cancelEdit()">Cancel</button>
        </div>
      ` : `
        <div class="item-info">
          <div class="item-name">${escapeHtml(unit.unit_name)}</div>
          <div class="item-meta">${escapeHtml(unit.abbreviation)}</div>
        </div>
        <div class="item-actions">
          <button class="btn-edit" onclick="editUnit('${unit.id}')">Edit</button>
          <button class="btn-delete" onclick="deleteUnit('${unit.id}')">Delete</button>
        </div>
      `}
    </div>
  `).join('');
}

async function addUnit(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  try {
    await apiRequest(`${API_BASE}/units`, {
      method: 'POST',
      body: JSON.stringify({
        unit_name: formData.get('unit_name'),
        abbreviation: formData.get('abbreviation')
      })
    });

    form.reset();
    showToast('Unit added', 'success');
    loadUnits();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

window.editUnit = function(id) {
  editingId = id;
  renderUnits();
};

window.saveUnit = async function(id) {
  const row = document.querySelector(`[data-id="${id}"]`);
  const nameInput = row.querySelector('[data-field="unit_name"]');
  const abbrInput = row.querySelector('[data-field="abbreviation"]');

  try {
    await apiRequest(`${API_BASE}/units/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        unit_name: nameInput.value,
        abbreviation: abbrInput.value
      })
    });

    editingId = null;
    showToast('Unit updated', 'success');
    loadUnits();
  } catch (error) {
    showToast(error.message, 'error');
  }
};

window.deleteUnit = async function(id) {
  if (!confirm('Delete this unit?')) return;

  try {
    await apiRequest(`${API_BASE}/units/${id}`, { method: 'DELETE' });
    showToast('Unit deleted', 'success');
    loadUnits();
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// ============================================
// Locations
// ============================================

async function loadLocations() {
  try {
    const result = await apiRequest(`${API_BASE}/locations`);
    locations = result.data || [];
    renderLocations();
  } catch (error) {
    showToast('Failed to load locations', 'error');
  }
}

function renderLocations() {
  const container = document.getElementById('locationsList');

  if (locations.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📍</div>
        <p>No locations yet. Add one above.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = locations.map(loc => `
    <div class="item-row" data-id="${loc.id}">
      ${editingId === loc.id ? `
        <div class="edit-inputs">
          <input type="text" value="${escapeHtml(loc.name)}" data-field="name" placeholder="Name">
          <input type="text" value="${escapeHtml(loc.description || '')}" data-field="description" placeholder="Description">
        </div>
        <div class="item-actions">
          <button class="btn-save" onclick="saveLocation('${loc.id}')">Save</button>
          <button class="btn-cancel" onclick="cancelEdit()">Cancel</button>
        </div>
      ` : `
        <div class="item-info">
          <div class="item-name">${escapeHtml(loc.name)}</div>
          ${loc.description ? `<div class="item-meta">${escapeHtml(loc.description)}</div>` : ''}
        </div>
        <div class="item-actions">
          <button class="btn-edit" onclick="editLocation('${loc.id}')">Edit</button>
          <button class="btn-delete" onclick="deleteLocation('${loc.id}')">Delete</button>
        </div>
      `}
    </div>
  `).join('');
}

async function addLocation(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);

  try {
    await apiRequest(`${API_BASE}/locations`, {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name'),
        description: formData.get('description') || null
      })
    });

    form.reset();
    showToast('Location added', 'success');
    loadLocations();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

window.editLocation = function(id) {
  editingId = id;
  renderLocations();
};

window.saveLocation = async function(id) {
  const row = document.querySelector(`[data-id="${id}"]`);
  const nameInput = row.querySelector('[data-field="name"]');
  const descInput = row.querySelector('[data-field="description"]');

  try {
    await apiRequest(`${API_BASE}/locations/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: nameInput.value,
        description: descInput.value || null
      })
    });

    editingId = null;
    showToast('Location updated', 'success');
    loadLocations();
  } catch (error) {
    showToast(error.message, 'error');
  }
};

window.deleteLocation = async function(id) {
  if (!confirm('Delete this location?')) return;

  try {
    await apiRequest(`${API_BASE}/locations/${id}`, { method: 'DELETE' });
    showToast('Location deleted', 'success');
    loadLocations();
  } catch (error) {
    showToast(error.message, 'error');
  }
};

// ============================================
// Utilities
// ============================================

window.cancelEdit = function() {
  editingId = null;
  renderCategories();
  renderUnits();
  renderLocations();
};

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();

  // Form handlers
  document.getElementById('addCategoryForm').addEventListener('submit', addCategory);
  document.getElementById('addUnitForm').addEventListener('submit', addUnit);
  document.getElementById('addLocationForm').addEventListener('submit', addLocation);

  // Load all data
  loadCategories();
  loadUnits();
  loadLocations();
});
