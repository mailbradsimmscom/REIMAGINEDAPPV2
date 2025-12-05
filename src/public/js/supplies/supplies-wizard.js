/**
 * Supplies Wizard Controller
 * Mobile-first 3-screen wizard for adding new supplies
 */

import { SuppliesAPI } from './supplies-api.js';

export class SuppliesWizard {
  constructor() {
    this.currentStep = 1;
    this.totalSteps = 3;
    this.state = {
      photo: {
        url: null,
        file: null
      },
      aiAnalysis: {
        item_name: null,
        brand: null,
        part_number: null,
        suggested_category: null,
        confidence: null,
        notes: null
      },
      formData: {},
      selectedSystems: []
    };

    this.init();
  }

  init() {
    this.cacheElements();
    this.setupEventListeners();
    this.loadCategories();
    this.loadUnits();
    this.loadLocations();
  }

  cacheElements() {
    // Wizard container
    this.wizard = document.getElementById('supplyWizard');
    this.container = this.wizard?.querySelector('.wizard-container');

    // Header
    this.stepIndicator = document.getElementById('wizardStepIndicator');
    this.backBtn = document.getElementById('wizardBackBtn');
    this.closeBtn = document.getElementById('wizardCloseBtn');

    // Screens
    this.screens = {
      1: document.getElementById('wizardScreen1'),
      2: document.getElementById('wizardScreen2'),
      3: document.getElementById('wizardScreen3')
    };

    // Screen 1 elements
    this.photoArea = document.getElementById('wizardPhotoArea');
    this.photoPlaceholder = document.getElementById('wizardPhotoPlaceholder');
    this.photoPreview = document.getElementById('wizardPhotoPreview');
    this.photoInput = document.getElementById('wizardPhotoInput');
    this.aiStatus = document.getElementById('wizardAiStatus');
    this.aiDetected = document.getElementById('wizardAiDetected');
    this.skipPhotoBtn = document.getElementById('wizardSkipPhoto');
    this.cancel1Btn = document.getElementById('wizardCancel1');
    this.next1Btn = document.getElementById('wizardNext1');

    // Screen 2 elements
    this.wizardForm = document.getElementById('wizardForm');
    this.back2Btn = document.getElementById('wizardBack2');
    this.next2Btn = document.getElementById('wizardNext2');

    // Screen 3 elements
    this.systemsLoading = document.getElementById('wizardSystemsLoading');
    this.systemsEmpty = document.getElementById('wizardSystemsEmpty');
    this.systemsList = document.getElementById('wizardSystemsList');
    this.back3Btn = document.getElementById('wizardBack3');
    this.saveBtn = document.getElementById('wizardSave');
  }

  setupEventListeners() {
    // Header buttons
    this.backBtn?.addEventListener('click', () => this.goBack());
    this.closeBtn?.addEventListener('click', () => this.close());

    // Screen 1
    this.photoArea?.addEventListener('click', () => this.triggerPhotoCapture());
    this.photoInput?.addEventListener('change', (e) => this.handlePhotoSelected(e));
    this.skipPhotoBtn?.addEventListener('click', () => this.skipPhoto());
    this.cancel1Btn?.addEventListener('click', () => this.close());
    this.next1Btn?.addEventListener('click', () => this.goToStep(2));

    // Screen 2
    this.back2Btn?.addEventListener('click', () => this.goToStep(1));
    this.next2Btn?.addEventListener('click', () => this.validateAndGoToStep3());

    // Item type change - show/hide reorder threshold
    document.getElementById('wizardItemType')?.addEventListener('change', (e) => {
      const reorderGroup = document.getElementById('wizardReorderGroup');
      if (reorderGroup) {
        reorderGroup.style.display = e.target.value === 'supply' ? 'block' : 'none';
      }
    });

    // Screen 3
    this.back3Btn?.addEventListener('click', () => this.goToStep(2));
    this.saveBtn?.addEventListener('click', () => this.saveSupply());

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });
  }

  // ===== Navigation =====

  open() {
    this.reset();
    this.wizard?.classList.add('active');
    document.body.style.overflow = 'hidden';
    this.updateStepIndicator();
    this.updateBackButton();
  }

  close() {
    this.wizard?.classList.remove('active');
    document.body.style.overflow = '';
    this.reset();
  }

  isOpen() {
    return this.wizard?.classList.contains('active');
  }

  goToStep(step) {
    if (step < 1 || step > this.totalSteps) return;

    const direction = step > this.currentStep ? 'left' : 'right';

    // Hide current screen with animation
    const currentScreen = this.screens[this.currentStep];
    currentScreen?.classList.remove('active');
    currentScreen?.classList.add(`slide-out-${direction}`);

    // Show new screen with animation
    setTimeout(() => {
      currentScreen?.classList.remove(`slide-out-${direction}`);

      this.currentStep = step;
      const newScreen = this.screens[step];
      newScreen?.classList.add('active', `slide-in-${direction === 'left' ? 'right' : 'left'}`);

      setTimeout(() => {
        newScreen?.classList.remove(`slide-in-${direction === 'left' ? 'right' : 'left'}`);
      }, 300);

      this.updateStepIndicator();
      this.updateBackButton();

      // Screen-specific actions
      if (step === 2) {
        this.prefillFormFromAI();
      } else if (step === 3) {
        this.loadSystemRecommendations();
      }
    }, 150);
  }

  goBack() {
    if (this.currentStep > 1) {
      this.goToStep(this.currentStep - 1);
    } else {
      this.close();
    }
  }

  updateStepIndicator() {
    if (this.stepIndicator) {
      this.stepIndicator.textContent = `Step ${this.currentStep} of ${this.totalSteps}`;
    }
  }

  updateBackButton() {
    if (this.backBtn) {
      this.backBtn.style.visibility = this.currentStep === 1 ? 'hidden' : 'visible';
    }
  }

  reset() {
    this.currentStep = 1;
    this.state = {
      photo: { url: null, file: null },
      aiAnalysis: {
        item_name: null,
        brand: null,
        part_number: null,
        suggested_category: null,
        confidence: null,
        notes: null
      },
      formData: {},
      selectedSystems: []
    };

    // Reset screens
    Object.values(this.screens).forEach((screen, index) => {
      screen?.classList.remove('active', 'slide-out-left', 'slide-out-right', 'slide-in-left', 'slide-in-right');
      if (index === 0) screen?.classList.add('active');
    });

    // Reset Screen 1
    if (this.photoPreview) this.photoPreview.style.display = 'none';
    if (this.photoPlaceholder) this.photoPlaceholder.style.display = 'flex';
    if (this.aiStatus) this.aiStatus.style.display = 'none';
    if (this.next1Btn) this.next1Btn.disabled = true;
    if (this.photoInput) this.photoInput.value = '';

    // Reset Screen 2
    this.wizardForm?.reset();

    // Reset Screen 3
    if (this.systemsList) this.systemsList.innerHTML = '';
    if (this.systemsLoading) this.systemsLoading.style.display = 'flex';
    if (this.systemsEmpty) this.systemsEmpty.style.display = 'none';
    if (this.systemsList) this.systemsList.style.display = 'none';

    this.updateStepIndicator();
    this.updateBackButton();
  }

  // ===== Screen 1: Photo Capture =====

  triggerPhotoCapture() {
    this.photoInput?.click();
  }

  async handlePhotoSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
      this.showToast('Please select an image file', 'error');
      return;
    }

    // Show preview and get base64 for AI analysis
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target.result;

      if (this.photoPreview) {
        this.photoPreview.src = base64Data;
        this.photoPreview.style.display = 'block';
      }
      if (this.photoPlaceholder) {
        this.photoPlaceholder.style.display = 'none';
      }

      // Store file for later upload when saving
      this.state.photo.file = file;
      this.state.photo.base64 = base64Data;

      // Analyze with AI using base64 directly (no disk storage needed)
      await this.analyzePhotoWithAI(base64Data);
    };
    reader.readAsDataURL(file);
  }

  async analyzePhotoWithAI(base64Data) {
    try {
      // Show analyzing state
      if (this.aiStatus) {
        this.aiStatus.style.display = 'block';
        this.aiStatus.querySelector('.wizard-ai-analyzing').style.display = 'flex';
        this.aiStatus.querySelector('.wizard-ai-result').style.display = 'none';
      }

      // Send base64 directly to analyze endpoint
      const analyzeResponse = await fetch('/api/supplies/analyze-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64Data })
      });

      const analyzeResult = await analyzeResponse.json();

      if (analyzeResult.success && analyzeResult.data) {
        this.state.aiAnalysis = analyzeResult.data;

        // Show result
        if (this.aiStatus) {
          this.aiStatus.querySelector('.wizard-ai-analyzing').style.display = 'none';
          this.aiStatus.querySelector('.wizard-ai-result').style.display = 'block';
        }

        const detectedText = analyzeResult.data.item_name || 'Item detected';
        const confidence = analyzeResult.data.confidence
          ? ` (${Math.round(analyzeResult.data.confidence * 100)}%)`
          : '';

        if (this.aiDetected) {
          this.aiDetected.textContent = `✓ ${detectedText}${confidence}`;
        }
      } else {
        // AI analysis failed
        if (this.aiStatus) {
          this.aiStatus.style.display = 'none';
        }
        const errorMsg = analyzeResult.error || 'AI analysis unavailable';
        this.showToast('Photo ready - ' + errorMsg, 'info');
      }

      // Enable next button
      if (this.next1Btn) this.next1Btn.disabled = false;

    } catch (error) {
      console.error('Photo analysis error:', error);
      if (this.aiStatus) this.aiStatus.style.display = 'none';

      // Extract error message properly
      const errorMsg = typeof error === 'string'
        ? error
        : (error?.message || JSON.stringify(error) || 'Unknown error');
      this.showToast('Photo ready - AI analysis failed: ' + errorMsg, 'info');

      // Still enable next - photo is ready even if AI failed
      if (this.next1Btn) this.next1Btn.disabled = false;
    }
  }

  skipPhoto() {
    this.state.photo = { url: null, file: null };
    if (this.next1Btn) this.next1Btn.disabled = false;
    this.goToStep(2);
  }

  // ===== Screen 2: Item Details =====

  validateAndGoToStep3() {
    // Validate required fields
    const itemName = document.getElementById('wizardItemName')?.value?.trim();
    const category = document.getElementById('wizardCategory')?.value;
    const currentStock = document.getElementById('wizardCurrentStock')?.value;

    if (!itemName) {
      this.showToast('Item name is required', 'error');
      document.getElementById('wizardItemName')?.focus();
      return;
    }

    if (!category) {
      this.showToast('Category is required', 'error');
      document.getElementById('wizardCategory')?.focus();
      return;
    }

    if (currentStock === '' || currentStock === undefined) {
      this.showToast('Current stock is required', 'error');
      document.getElementById('wizardCurrentStock')?.focus();
      return;
    }

    // Store form data
    this.collectFormData();
    this.goToStep(3);
  }

  collectFormData() {
    const itemType = document.getElementById('wizardItemType')?.value || 'supply';

    this.state.formData = {
      item_name: document.getElementById('wizardItemName')?.value?.trim() || '',
      item_type: itemType,
      category_id: document.getElementById('wizardCategory')?.value || null,
      unit_id: document.getElementById('wizardUnit')?.value || null,
      current_stock: parseFloat(document.getElementById('wizardCurrentStock')?.value) || 0,
      reorder_threshold: itemType === 'supply'
        ? (parseFloat(document.getElementById('wizardReorderThreshold')?.value) || 0)
        : null,
      location: document.getElementById('wizardLocation')?.value?.trim() || null,
      location_details: document.getElementById('wizardLocationDetails')?.value?.trim() || null,
      brand: document.getElementById('wizardBrand')?.value?.trim() || null,
      part_number: document.getElementById('wizardPartNumber')?.value?.trim() || null,
      supplier: document.getElementById('wizardSupplier')?.value?.trim() || null,
      notes: document.getElementById('wizardNotes')?.value?.trim() || null,
      photos: this.state.photo.url ? [this.state.photo.url] : []
    };
  }

  prefillFormFromAI() {
    const ai = this.state.aiAnalysis;
    if (!ai) return;

    if (ai.item_name) {
      const itemNameInput = document.getElementById('wizardItemName');
      if (itemNameInput && !itemNameInput.value) {
        itemNameInput.value = ai.item_name;
      }
    }

    if (ai.brand) {
      const brandInput = document.getElementById('wizardBrand');
      if (brandInput && !brandInput.value) {
        brandInput.value = ai.brand;
      }
    }

    if (ai.part_number) {
      const partNumInput = document.getElementById('wizardPartNumber');
      if (partNumInput && !partNumInput.value) {
        partNumInput.value = ai.part_number;
      }
    }

    if (ai.suggested_category) {
      this.selectCategoryByName(ai.suggested_category);
    }
  }

  selectCategoryByName(categoryName) {
    const categorySelect = document.getElementById('wizardCategory');
    if (!categorySelect) return;

    const options = categorySelect.querySelectorAll('option');
    for (const option of options) {
      const optionText = option.textContent.trim().toLowerCase();
      const suggested = categoryName.toLowerCase();
      if (optionText.includes(suggested) || suggested.includes(optionText)) {
        categorySelect.value = option.value;
        break;
      }
    }
  }

  // ===== Screen 3: System Recommendations =====

  async loadSystemRecommendations() {
    // Show loading
    if (this.systemsLoading) this.systemsLoading.style.display = 'flex';
    if (this.systemsEmpty) this.systemsEmpty.style.display = 'none';
    if (this.systemsList) this.systemsList.style.display = 'none';

    try {
      const { item_name, brand, part_number } = this.state.formData;

      const response = await fetch('/api/supplies/suggest-systems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_name, brand, part_number })
      });

      const result = await response.json();

      if (this.systemsLoading) this.systemsLoading.style.display = 'none';

      if (result.success && result.data?.suggestions?.length > 0) {
        this.renderSystemCards(result.data.suggestions);
        if (this.systemsList) this.systemsList.style.display = 'block';
      } else {
        if (this.systemsEmpty) this.systemsEmpty.style.display = 'flex';
      }

    } catch (error) {
      console.error('Error loading system recommendations:', error);
      if (this.systemsLoading) this.systemsLoading.style.display = 'none';
      if (this.systemsEmpty) this.systemsEmpty.style.display = 'flex';
    }
  }

  renderSystemCards(suggestions) {
    if (!this.systemsList) return;

    this.systemsList.innerHTML = suggestions.map((s, index) => `
      <div class="wizard-system-card" data-asset-uid="${s.asset_uid}">
        <label class="wizard-system-checkbox">
          <input type="checkbox" data-index="${index}" onchange="window.suppliesWizard.toggleSystem('${s.asset_uid}')">
          <div class="wizard-system-info">
            <div class="wizard-system-name">${this.escapeHtml(s.manufacturer)} ${this.escapeHtml(s.model)}</div>
            <div class="wizard-system-path">${this.escapeHtml(s.system)} › ${this.escapeHtml(s.subsystem)}</div>
            <div class="wizard-system-confidence">${Math.round(s.confidence * 100)}% match</div>
          </div>
        </label>
      </div>
    `).join('');
  }

  toggleSystem(assetUid) {
    const index = this.state.selectedSystems.indexOf(assetUid);
    if (index > -1) {
      this.state.selectedSystems.splice(index, 1);
    } else {
      this.state.selectedSystems.push(assetUid);
    }
  }

  // ===== Save Supply =====

  async saveSupply() {
    try {
      this.saveBtn.disabled = true;
      this.saveBtn.textContent = 'Saving...';

      const data = {
        ...this.state.formData,
        ai_suggested_systems: this.state.selectedSystems,
        ai_analysis_timestamp: this.state.selectedSystems.length > 0 ? new Date().toISOString() : null
      };

      // Step 1: Create the supply
      const response = await fetch('/api/supplies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to save supply');
      }

      const supplyId = result.data.id;

      // Step 2: Upload photo if present
      if (this.state.photo.base64) {
        this.saveBtn.textContent = 'Uploading photo...';

        try {
          const photoResponse = await fetch(`/api/supplies/${supplyId}/photo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageBase64: this.state.photo.base64,
              photoIndex: 1
            })
          });

          const photoResult = await photoResponse.json();

          if (photoResult.success) {
            console.log('Photo uploaded:', photoResult.data.url);
          } else {
            // Photo upload failed but supply was created
            console.error('Photo upload failed:', photoResult.error);
            this.showToast('Supply saved, but photo upload failed', 'warning');
          }
        } catch (photoError) {
          console.error('Photo upload error:', photoError);
          this.showToast('Supply saved, but photo upload failed', 'warning');
        }
      }

      this.showToast('Supply added successfully!', 'success');
      this.close();

      // Refresh the list
      if (window.suppliesList) {
        window.suppliesList.loadSupplies();
      }

    } catch (error) {
      console.error('Error saving supply:', error);
      this.showToast('Failed to save: ' + error.message, 'error');
    } finally {
      if (this.saveBtn) {
        this.saveBtn.disabled = false;
        this.saveBtn.textContent = 'Save Supply';
      }
    }
  }

  // ===== Utilities =====

  async loadCategories() {
    try {
      const categories = await SuppliesAPI.getCategories();
      const select = document.getElementById('wizardCategory');
      if (select) {
        select.innerHTML = '<option value="">Select...</option>' +
          categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('') +
          '<option value="__new__">+ Add New Category...</option>';
      }

      // Setup change handler for "new category" option
      select?.removeEventListener('change', this._handleCategoryChange);
      this._handleCategoryChange = (e) => this.handleCategoryChange(e);
      select?.addEventListener('change', this._handleCategoryChange);
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  }

  handleCategoryChange(e) {
    const select = e.target;
    if (select.value === '__new__') {
      this.showNewCategoryInput();
    } else {
      this.hideNewCategoryInput();
    }
  }

  showNewCategoryInput() {
    let container = document.getElementById('newCategoryContainer');
    if (!container) {
      // Create the input container
      const select = document.getElementById('wizardCategory');
      container = document.createElement('div');
      container.id = 'newCategoryContainer';
      container.className = 'new-category-input';
      container.innerHTML = `
        <input type="text" id="newCategoryName" placeholder="Enter category name..." class="wizard-input">
        <button type="button" id="saveNewCategory" class="wizard-btn wizard-btn-small">Add</button>
        <button type="button" id="cancelNewCategory" class="wizard-btn wizard-btn-small wizard-btn-secondary">Cancel</button>
      `;
      select.parentNode.insertBefore(container, select.nextSibling);

      // Add event listeners
      document.getElementById('saveNewCategory')?.addEventListener('click', () => this.saveNewCategory());
      document.getElementById('cancelNewCategory')?.addEventListener('click', () => this.cancelNewCategory());
      document.getElementById('newCategoryName')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.saveNewCategory();
        }
      });
    }
    container.style.display = 'flex';
    document.getElementById('newCategoryName')?.focus();
  }

  hideNewCategoryInput() {
    const container = document.getElementById('newCategoryContainer');
    if (container) {
      container.style.display = 'none';
      document.getElementById('newCategoryName').value = '';
    }
  }

  async saveNewCategory() {
    const input = document.getElementById('newCategoryName');
    const name = input?.value?.trim();

    if (!name) {
      this.showToast('Please enter a category name', 'error');
      return;
    }

    try {
      const newCategory = await SuppliesAPI.createCategory(name);
      this.showToast(`Category "${name}" created!`, 'success');

      // Reload categories and select the new one
      await this.loadCategories();
      const select = document.getElementById('wizardCategory');
      if (select) {
        select.value = newCategory.id;
      }
      this.hideNewCategoryInput();
    } catch (error) {
      this.showToast(error.message || 'Failed to create category', 'error');
    }
  }

  cancelNewCategory() {
    const select = document.getElementById('wizardCategory');
    if (select) {
      select.value = ''; // Reset to "Select..."
    }
    this.hideNewCategoryInput();
  }

  async loadUnits() {
    try {
      const units = await SuppliesAPI.getUnits();
      const select = document.getElementById('wizardUnit');
      if (select && units.length > 0) {
        select.innerHTML = '<option value="">Select...</option>' +
          units.map(u => `<option value="${u.id}">${u.name} (${u.abbreviation})</option>`).join('');
      }
    } catch (error) {
      console.error('Error loading units:', error);
    }
  }

  async loadLocations() {
    try {
      const locations = await SuppliesAPI.getLocations();
      const select = document.getElementById('wizardLocation');
      if (select && locations.length > 0) {
        select.innerHTML = '<option value="">Select location...</option>' +
          locations.map(loc => {
            // loc is now an object with id, name, description
            const name = typeof loc === 'string' ? loc : loc.name;
            return `<option value="${this.escapeHtml(name)}">${this.escapeHtml(name)}</option>`;
          }).join('');
      }
    } catch (error) {
      console.error('Error loading locations:', error);
    }
  }

  // Refresh categories and optionally select a new one
  async refreshCategories(selectId = null) {
    await this.loadCategories();
    if (selectId) {
      const select = document.getElementById('wizardCategory');
      if (select) select.value = selectId;
    }
  }

  // Refresh locations and optionally select a new one
  async refreshLocations(selectName = null) {
    await this.loadLocations();
    if (selectName) {
      const select = document.getElementById('wizardLocation');
      const locations = await SuppliesAPI.getLocations();
      const loc = locations.find(l => l.id === selectName || l.name === selectName);
      if (select && loc) select.value = loc.name;
    }
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

// Make globally accessible
window.SuppliesWizard = SuppliesWizard;
