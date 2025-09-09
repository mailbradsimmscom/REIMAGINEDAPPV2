// /js/admin/sections/doc-upload.js
// Handles document upload form with manufacturer/model dropdowns
// Independent module - initializes itself when DOM is ready

export function init() {
  // This function is called by the boot system
  initializeDocUploadSection();
}

function initializeDocUploadSection() {
  const manufacturerSelect = document.getElementById('manufacturer');
  const modelSelect = document.getElementById('model');

  if (!manufacturerSelect || !modelSelect) {
    console.warn('doc-upload.js: Required dropdowns not found - section may not be loaded yet');
    return;
  }

  loadManufacturers();
  setupEventListeners();
}

async function loadManufacturers() {
  const manufacturerSelect = document.getElementById('manufacturer');
  if (!manufacturerSelect) return;

  try {
    const res = await window.adminFetch('/admin/api/manufacturers');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.success || !Array.isArray(data.data.manufacturers)) {
      throw new Error('Invalid manufacturers response');
    }

    manufacturerSelect.innerHTML = '<option value="">Select Manufacturer</option>' +
      data.data.manufacturers.map(manufacturer => 
        `<option value="${escapeHtml(manufacturer)}">${escapeHtml(manufacturer)}</option>`
      ).join('');
  } catch (err) {
    console.error('Failed to load manufacturers:', err);
    manufacturerSelect.innerHTML = '<option value="">⚠️ Failed to load manufacturers</option>';
  }
}

async function loadModels() {
  const manufacturerSelect = document.getElementById('manufacturer');
  const modelSelect = document.getElementById('model');
  
  if (!manufacturerSelect || !modelSelect) return;
  
  const manufacturer = manufacturerSelect.value;
  if (!manufacturer) {
    modelSelect.innerHTML = '<option value="">Select Model</option>';
    return;
  }

  try {
    const res = await window.adminFetch(`/admin/api/models?manufacturer=${encodeURIComponent(manufacturer)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.success || !Array.isArray(data.data.models)) {
      throw new Error('Invalid models response');
    }

    modelSelect.innerHTML = '<option value="">Select Model</option>' +
      data.data.models.map(model => 
        `<option value="${escapeHtml(model.model_norm)}">${escapeHtml(model.model_norm)}</option>`
      ).join('');
  } catch (err) {
    console.error('Failed to load models:', err);
    modelSelect.innerHTML = '<option value="">⚠️ Failed to load models</option>';
  }
}

function setupEventListeners() {
  const manufacturerSelect = document.getElementById('manufacturer');
  if (manufacturerSelect) {
    manufacturerSelect.addEventListener('change', loadModels);
  }
  
  // Set default revision date to today
  const dateInput = document.getElementById('revision-date');
  if (dateInput) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Auto-initialize if this script is loaded directly (for development)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDocUploadSection);
} else {
  initializeDocUploadSection();
}