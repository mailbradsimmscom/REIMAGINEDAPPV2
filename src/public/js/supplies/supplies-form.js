/**
 * Supplies Form Component
 * Handles add/edit modal for supplies
 */

import { SuppliesAPI } from './supplies-api.js';

export class SuppliesForm {
  constructor() {
    this.isEditMode = false;
    this.currentSupplyId = null;
    this.categories = [];
    this.units = [];
    this.locations = [];
    this.aiSuggestedSystems = []; // Store AI-recommended systems

    this.init();
  }

  async init() {
    try {
      // Load form data
      await this.loadFormData();

      // Setup event listeners
      this.setupEventListeners();
    } catch (error) {
      console.error('Failed to initialize form:', error);
    }
  }

  async loadFormData() {
    try {
      // Load categories, units, locations
      [this.categories, this.units, this.locations] = await Promise.all([
        SuppliesAPI.getCategories(),
        SuppliesAPI.getUnits(),
        SuppliesAPI.getLocations(),
      ]);

      this.populateCategorySelect();
      this.populateUnitSelect();
      this.populateLocationSelect();
    } catch (error) {
      console.error('Error loading form data:', error);
    }
  }

  setupEventListeners() {
    const form = document.getElementById('supplyForm');
    const modalClose = document.getElementById('modalClose');
    const cancelBtn = document.getElementById('cancelBtn');

    // Form submit
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSubmit();
    });

    // Close modal
    modalClose?.addEventListener('click', () => this.closeModal());
    cancelBtn?.addEventListener('click', () => this.closeModal());

    // Item type change - show/hide reorder threshold
    const itemTypeSelect = document.getElementById('itemType');
    itemTypeSelect?.addEventListener('change', (e) => {
      this.updateReorderThresholdVisibility(e.target.value);
    });

    // ESC key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('supplyModal').classList.contains('active')) {
        this.closeModal();
      }
    });
  }

  updateReorderThresholdVisibility(itemType) {
    const reorderGroup = document.getElementById('reorderThresholdGroup');
    if (!reorderGroup) return;

    // Only show reorder threshold for supplies
    if (itemType === 'supply') {
      reorderGroup.style.display = 'block';
    } else {
      reorderGroup.style.display = 'none';
    }
  }

  populateCategorySelect() {
    const select = document.getElementById('category');
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
    let html = '<option value="">Select category...</option>';
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

  populateUnitSelect() {
    const select = document.getElementById('unit');
    if (!select) return;

    let html = '<option value="">Select unit...</option>';
    this.units.forEach(unit => {
      html += `<option value="${unit.id}">${unit.name} (${unit.abbreviation})</option>`;
    });

    select.innerHTML = html;
  }

  populateLocationSelect() {
    const select = document.getElementById('location');
    if (!select) return;

    let html = '<option value="">Select location...</option>';
    this.locations.forEach(loc => {
      // loc is now an object with id, name, description
      const name = typeof loc === 'string' ? loc : loc.name;
      html += `<option value="${this.escapeHtml(name)}">${this.escapeHtml(name)}</option>`;
    });

    select.innerHTML = html;
  }

  async openModal(supplyId = null) {
    this.isEditMode = !!supplyId;
    this.currentSupplyId = supplyId;

    // Update modal title
    document.getElementById('modalTitle').textContent =
      this.isEditMode ? 'Edit Supply' : 'Add Supply';

    document.getElementById('saveBtn').querySelector('.btn-text').textContent =
      this.isEditMode ? 'Update Supply' : 'Save Supply';

    // Reset form
    document.getElementById('supplyForm').reset();

    // Clear photos and set supply ID for edit mode
    if (window.suppliesPhotos) {
      window.suppliesPhotos.clearPhotos();
      window.suppliesPhotos.setSupplyId(supplyId); // null for new, ID for edit
    }

    if (this.isEditMode) {
      await this.loadSupplyData(supplyId);
    } else {
      // For new items, default to supply and show reorder threshold
      document.getElementById('itemType').value = 'supply';
      this.updateReorderThresholdVisibility('supply');
    }

    // Show modal
    document.getElementById('supplyModal').classList.add('active');
    document.getElementById('overlay').classList.add('active');

    // Focus first field
    document.getElementById('itemName')?.focus();
  }

  closeModal() {
    document.getElementById('supplyModal').classList.remove('active');
    document.getElementById('overlay').classList.remove('active');
    document.getElementById('supplyForm').reset();
    this.isEditMode = false;
    this.currentSupplyId = null;
    this.aiSuggestedSystems = []; // Clear AI suggestions
  }

  async loadSupplyData(id) {
    try {
      const response = await SuppliesAPI.getById(id);
      const supply = response.data;

      // Populate form fields
      document.getElementById('supplyId').value = supply.id;
      document.getElementById('itemName').value = supply.item_name || '';
      document.getElementById('itemType').value = supply.item_type || 'supply';
      document.getElementById('category').value = supply.category_id || '';
      document.getElementById('unit').value = supply.unit_id || '';

      // Update reorder threshold visibility based on type
      this.updateReorderThresholdVisibility(supply.item_type || 'supply');
      document.getElementById('currentStock').value = supply.current_stock ?? '';
      document.getElementById('reorderThreshold').value = supply.reorder_threshold ?? '';
      document.getElementById('location').value = supply.location || '';
      document.getElementById('locationDetails').value = supply.location_details || '';
      document.getElementById('brand').value = supply.brand || '';
      document.getElementById('partNumber').value = supply.part_number || '';
      document.getElementById('supplier').value = supply.supplier || '';
      document.getElementById('notes').value = supply.notes || '';

      // Load photos
      if (window.suppliesPhotos && supply.photos) {
        window.suppliesPhotos.loadPhotos(supply.photos);
      }
    } catch (error) {
      this.showToast('Failed to load supply data: ' + error.message, 'error');
      this.closeModal();
    }
  }

  async handleSubmit() {
    try {
      const saveBtn = document.getElementById('saveBtn');
      saveBtn.disabled = true;
      saveBtn.querySelector('.btn-text').textContent = 'Saving...';

      const formData = this.getFormData();

      if (this.isEditMode) {
        await SuppliesAPI.update(this.currentSupplyId, formData);
        this.showToast('Supply updated successfully', 'success');
      } else {
        // Create the supply first
        const result = await SuppliesAPI.create(formData);
        const newSupplyId = result.data.id;

        // Upload any pending photos to Supabase Storage
        if (window.suppliesPhotos) {
          const pendingPhotos = window.suppliesPhotos.getPendingPhotos();
          if (pendingPhotos.length > 0) {
            saveBtn.querySelector('.btn-text').textContent = 'Uploading photos...';
            await window.suppliesPhotos.uploadPendingPhotos(newSupplyId);
          }
        }

        this.showToast('Supply created successfully', 'success');
      }

      // Refresh list
      if (window.suppliesList) {
        await window.suppliesList.loadSupplies();
        await window.suppliesList.loadStats();
      }

      this.closeModal();
    } catch (error) {
      this.showToast('Failed to save supply: ' + error.message, 'error');
    } finally {
      const saveBtn = document.getElementById('saveBtn');
      saveBtn.disabled = false;
      saveBtn.querySelector('.btn-text').textContent =
        this.isEditMode ? 'Update Supply' : 'Save Supply';
    }
  }

  getFormData() {
    const itemType = document.getElementById('itemType').value || 'supply';
    const data = {
      item_name: document.getElementById('itemName').value.trim(),
      item_type: itemType,
      category_id: document.getElementById('category').value || null,
      unit_id: document.getElementById('unit').value || null,
      current_stock: parseFloat(document.getElementById('currentStock').value) || 0,
      reorder_threshold: itemType === 'supply' ? (parseFloat(document.getElementById('reorderThreshold').value) || 0) : null,
      location: document.getElementById('location').value.trim() || null,
      location_details: document.getElementById('locationDetails').value.trim() || null,
      brand: document.getElementById('brand').value.trim() || null,
      part_number: document.getElementById('partNumber').value.trim() || null,
      supplier: document.getElementById('supplier').value.trim() || null,
      notes: document.getElementById('notes').value.trim() || null,
    };

    // Add photos if available
    if (window.suppliesPhotos) {
      data.photos = window.suppliesPhotos.getPhotos();
    }

    // Add AI suggested systems
    if (this.aiSuggestedSystems && this.aiSuggestedSystems.length > 0) {
      data.ai_suggested_systems = this.aiSuggestedSystems;
      data.ai_analysis_timestamp = new Date().toISOString();
    }

    return data;
  }

  /**
   * Auto-fill form fields from AI photo analysis
   */
  autoFillFromAI(analysisResult) {
    if (!analysisResult) return;

    // Fill in item name if provided and field is empty
    if (analysisResult.item_name && !document.getElementById('itemName').value) {
      document.getElementById('itemName').value = analysisResult.item_name;
    }

    // Fill in brand if provided and field is empty
    if (analysisResult.brand && !document.getElementById('brand').value) {
      document.getElementById('brand').value = analysisResult.brand;
    }

    // Fill in part number if provided and field is empty
    if (analysisResult.part_number && !document.getElementById('partNumber').value) {
      document.getElementById('partNumber').value = analysisResult.part_number;
    }

    // Try to match category if suggested_category is provided
    if (analysisResult.suggested_category) {
      const categorySelect = document.getElementById('category');
      const options = categorySelect.querySelectorAll('option');
      for (const option of options) {
        const optionText = option.textContent.trim().toLowerCase();
        const suggestedCategory = analysisResult.suggested_category.toLowerCase();
        if (optionText.includes(suggestedCategory) || suggestedCategory.includes(optionText)) {
          categorySelect.value = option.value;
          break;
        }
      }
    }

    // Try to match unit if suggested_unit is provided
    if (analysisResult.suggested_unit) {
      const unitSelect = document.getElementById('unit');
      const options = unitSelect.querySelectorAll('option');
      const suggestedUnit = analysisResult.suggested_unit.toLowerCase();
      for (const option of options) {
        const optionText = option.textContent.trim().toLowerCase();
        // Match on unit name (e.g., "Each" matches "Each (ea)")
        if (optionText.includes(suggestedUnit) || suggestedUnit.includes(optionText.split(' ')[0])) {
          unitSelect.value = option.value;
          break;
        }
      }
    }

    // Show analysis notes if provided
    if (analysisResult.notes) {
      this.showToast(`AI analysis: ${analysisResult.notes}`, 'info');
    }

    // Show confidence score
    if (analysisResult.confidence) {
      const confidence = Math.round(analysisResult.confidence * 100);
      this.showToast(`Confidence: ${confidence}%`, 'info');
    }
  }

  /**
   * Open system recommendations modal
   */
  async openSystemRecommendations() {
    if (!window.suppliesAI) {
      this.showToast('AI module not loaded', 'error');
      return;
    }

    // Get current form data for recommendations
    const itemData = {
      item_name: document.getElementById('itemName').value.trim(),
      brand: document.getElementById('brand').value.trim(),
      part_number: document.getElementById('partNumber').value.trim(),
      category: document.getElementById('category').selectedOptions[0]?.textContent.trim()
    };

    // Validate that we have at least some data
    if (!itemData.item_name && !itemData.brand && !itemData.part_number) {
      this.showToast('Please fill in at least item name, brand, or part number first', 'warning');
      return;
    }

    // Show system recommendations modal
    await window.suppliesAI.showSystemRecommendationsModal(itemData);
  }

  /**
   * Set AI suggested systems (called from AI module)
   */
  setAISuggestedSystems(systemUids) {
    this.aiSuggestedSystems = systemUids || [];
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

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Make it globally accessible
window.SuppliesForm = SuppliesForm;
