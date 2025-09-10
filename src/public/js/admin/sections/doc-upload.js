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

// Make functions available globally for HTML onclick handlers
window.loadModels = loadModels;
window.resetUploadForm = resetUploadForm;
window.clearUploadQueue = clearUploadQueue;
window.processUploadQueue = processUploadQueue;

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
  
  // Wire the Upload button
  const uploadBtn = document.getElementById('upload-btn');
  const fileInput = document.getElementById('file-input');

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', async () => {
      try {
        if (!fileInput.files || fileInput.files.length === 0) {
          alert('Please choose a file first.');
          return;
        }

        const docIdEl = document.getElementById('doc-id');
        const manufacturerEl = document.getElementById('manufacturer');
        const modelEl = document.getElementById('model');
        const languageEl = document.getElementById('language');        // if present
        const revEl = document.getElementById('revision-date');
        const ocrEl = document.getElementById('ocr-enabled');

        const metadata = {
          // include only if present / non-empty
          ...(docIdEl?.value ? { doc_id: docIdEl.value.trim() } : {}),
          
          // normalized fields (what server expects)
          ...(manufacturerEl?.value ? { manufacturer_norm: manufacturerEl.value.trim() } : {}),
          ...(modelEl?.value ? { model_norm: modelEl.value.trim() } : {}),
          
          // keep existing fields for backward compatibility
          ...(manufacturerEl?.value ? { manufacturer: manufacturerEl.value } : {}),
          ...(modelEl?.value ? { model: modelEl.value } : {}),
          
          language: languageEl?.value || 'en',
          ...(revEl?.value ? { revision_date: revEl.value } : {}),
          ...(typeof ocrEl?.checked === 'boolean' ? { ocr: !!ocrEl.checked } : {})
        };

        const form = new FormData();
        form.append('file', fileInput.files[0]);              // server expects "file"
        form.append('metadata', JSON.stringify(metadata));    // server expects "metadata" JSON

        const res = await window.adminFetch('/document/ingest', {
          method: 'POST',
          body: form
          // DO NOT set Content-Type here; adminFetch will skip it for FormData
        });

        if (!res.ok) {
          const err = await res.text().catch(() => '');
          throw new Error(`Upload failed (HTTP ${res.status}) ${err || ''}`);
        }

        const json = await res.json();
        // OPTIONAL: update your UI (jobs list / progress), or just alert for now:
        alert('Upload started successfully.');
      } catch (e) {
        console.error(e);
        alert(e.message || 'Upload failed.');
      }
    });
  }
}

function resetUploadForm() {
  // Reset form fields
  const docIdEl = document.getElementById('doc-id');
  const manufacturerEl = document.getElementById('manufacturer');
  const modelEl = document.getElementById('model');
  const revEl = document.getElementById('revision-date');
  const ocrEl = document.getElementById('ocr-enabled');
  const fileInput = document.getElementById('file-input');
  
  if (docIdEl) docIdEl.value = '';
  if (manufacturerEl) manufacturerEl.value = '';
  if (modelEl) modelEl.value = '';
  if (revEl) revEl.value = new Date().toISOString().split('T')[0];
  if (ocrEl) ocrEl.checked = true;
  if (fileInput) fileInput.value = '';
  
  // Reset upload queue
  clearUploadQueue();
}

function clearUploadQueue() {
  // Simple implementation - just hide the queue
  const queueEl = document.getElementById('upload-queue');
  if (queueEl) {
    queueEl.style.display = 'none';
  }
}

function processUploadQueue() {
  // For now, just trigger the upload button click
  const uploadBtn = document.getElementById('upload-btn');
  if (uploadBtn) {
    uploadBtn.click();
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