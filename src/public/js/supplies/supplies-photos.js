/**
 * Supplies Photos Component
 * Handles photo uploads, preview, and gallery
 */

export class SuppliesPhotos {
  constructor() {
    this.uploadedPhotos = []; // Array of photo URLs
    this.currentGalleryIndex = 0;
    this.init();
  }

  init() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Take photo button
    document.getElementById('takePhotoBtn')?.addEventListener('click', () => {
      document.getElementById('photoInput').click();
    });

    // File input change
    document.getElementById('photoInput')?.addEventListener('change', (e) => {
      this.handleFileSelect(e.target.files);
    });

    // Gallery controls
    document.getElementById('galleryClose')?.addEventListener('click', () => {
      this.closeGallery();
    });

    document.getElementById('galleryPrev')?.addEventListener('click', () => {
      this.navigateGallery(-1);
    });

    document.getElementById('galleryNext')?.addEventListener('click', () => {
      this.navigateGallery(1);
    });

    // ESC key to close gallery
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('photoGallery').classList.contains('active')) {
        this.closeGallery();
      }
    });
  }

  async handleFileSelect(files) {
    if (!files || files.length === 0) return;

    for (const file of files) {
      await this.uploadPhoto(file);
    }
  }

  async uploadPhoto(file) {
    let previewId = null;  // Declare outside try block for access in catch

    try {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        this.showToast('Please select an image file', 'error');
        return;
      }

      // Validate file size (5MB max)
      const maxSize = 5 * 1024 * 1024;
      if (file.size > maxSize) {
        this.showToast('Image too large (max 5MB)', 'error');
        return;
      }

      // Create preview immediately
      previewId = `preview-${Date.now()}`;
      this.addPhotoPreview(previewId, null, true);

      // Upload to server
      const formData = new FormData();
      formData.append('photo', file);

      const response = await fetch('/api/supplies/upload-photo', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();
      const photoUrl = result.data.url;

      // Update preview with actual URL
      this.uploadedPhotos.push(photoUrl);
      this.updatePhotoPreview(previewId, photoUrl);

      this.showToast('Photo uploaded successfully', 'success');
    } catch (error) {
      console.error('Error uploading photo:', error);
      this.showToast('Failed to upload photo: ' + error.message, 'error');
      // Remove loading preview
      if (previewId) {
        document.getElementById(previewId)?.remove();
      }
    }
  }

  addPhotoPreview(id, url, loading = false) {
    const container = document.getElementById('photoPreviewContainer');
    if (!container) return;

    const preview = document.createElement('div');
    preview.className = 'photo-preview';
    preview.id = id;

    if (loading) {
      preview.innerHTML = `
        <div class="photo-preview-loading">
          <div class="spinner"></div>
        </div>
      `;
    } else {
      preview.innerHTML = `
        <img src="${url}" alt="Supply photo">
        <div class="photo-preview-actions">
          <button type="button" class="photo-preview-btn" onclick="window.suppliesPhotos.viewPhoto('${url}')" title="View photo">
            👁️
          </button>
          <button type="button" class="photo-preview-btn" onclick="window.suppliesPhotos.analyzePhoto('${url}')" title="Analyze with AI">
            🤖
          </button>
          <button type="button" class="photo-preview-btn" onclick="window.suppliesPhotos.removePhoto('${url}', '${id}')" title="Remove photo">
            🗑️
          </button>
        </div>
      `;
    }

    container.appendChild(preview);
  }

  updatePhotoPreview(id, url) {
    const preview = document.getElementById(id);
    if (!preview) return;

    preview.innerHTML = `
      <img src="${url}" alt="Supply photo">
      <div class="photo-preview-actions">
        <button type="button" class="photo-preview-btn" onclick="window.suppliesPhotos.viewPhoto('${url}')" title="View photo">
          👁️
        </button>
        <button type="button" class="photo-preview-btn" onclick="window.suppliesPhotos.analyzePhoto('${url}')" title="Analyze with AI">
          🤖
        </button>
        <button type="button" class="photo-preview-btn" onclick="window.suppliesPhotos.removePhoto('${url}', '${id}')" title="Remove photo">
          🗑️
        </button>
      </div>
    `;
  }

  async analyzePhoto(url) {
    try {
      if (!window.suppliesAI) {
        this.showToast('AI module not loaded', 'error');
        return;
      }

      // Show loading state
      this.showToast('Analyzing photo with AI...', 'info');

      // Call AI analysis
      const result = await window.suppliesAI.analyzePhoto(url);

      // Pass results to form to auto-fill fields
      if (window.suppliesForm && result) {
        window.suppliesForm.autoFillFromAI(result);
      }

    } catch (error) {
      console.error('Error analyzing photo:', error);
      this.showToast('Failed to analyze photo: ' + error.message, 'error');
    }
  }

  removePhoto(url, previewId) {
    // Remove from array
    const index = this.uploadedPhotos.indexOf(url);
    if (index > -1) {
      this.uploadedPhotos.splice(index, 1);
    }

    // Remove preview
    document.getElementById(previewId)?.remove();

    this.showToast('Photo removed', 'info');
  }

  viewPhoto(url, allPhotos = null) {
    // If viewing from list (with all photos provided), use those
    if (allPhotos) {
      this.tempGalleryPhotos = allPhotos;
      this.currentGalleryIndex = allPhotos.indexOf(url);
    } else {
      // Viewing from form (use uploaded photos)
      this.tempGalleryPhotos = null;
      this.currentGalleryIndex = this.uploadedPhotos.indexOf(url);
    }
    this.openGallery();
  }

  openGallery() {
    const photos = this.tempGalleryPhotos || this.uploadedPhotos;
    if (photos.length === 0) return;

    document.getElementById('photoGallery').classList.add('active');
    this.updateGalleryImage();
  }

  closeGallery() {
    document.getElementById('photoGallery').classList.remove('active');
  }

  navigateGallery(direction) {
    const photos = this.tempGalleryPhotos || this.uploadedPhotos;
    this.currentGalleryIndex += direction;

    if (this.currentGalleryIndex < 0) {
      this.currentGalleryIndex = photos.length - 1;
    } else if (this.currentGalleryIndex >= photos.length) {
      this.currentGalleryIndex = 0;
    }

    this.updateGalleryImage();
  }

  updateGalleryImage() {
    const photos = this.tempGalleryPhotos || this.uploadedPhotos;
    const img = document.getElementById('galleryImage');
    const prevBtn = document.getElementById('galleryPrev');
    const nextBtn = document.getElementById('galleryNext');

    if (img) {
      img.src = photos[this.currentGalleryIndex];
    }

    // Show/hide nav buttons
    const hasMultiple = photos.length > 1;
    if (prevBtn) prevBtn.style.display = hasMultiple ? 'flex' : 'none';
    if (nextBtn) nextBtn.style.display = hasMultiple ? 'flex' : 'none';
  }

  loadPhotos(photos) {
    // Load existing photos (when editing)
    this.uploadedPhotos = photos || [];
    this.renderPhotos();
  }

  renderPhotos() {
    const container = document.getElementById('photoPreviewContainer');
    if (!container) return;

    container.innerHTML = '';

    this.uploadedPhotos.forEach((url, index) => {
      const previewId = `preview-existing-${index}`;
      this.addPhotoPreview(previewId, url, false);
    });
  }

  getPhotos() {
    return this.uploadedPhotos;
  }

  clearPhotos() {
    this.uploadedPhotos = [];
    const container = document.getElementById('photoPreviewContainer');
    if (container) {
      container.innerHTML = '';
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
}

// Make it globally accessible
window.SuppliesPhotos = SuppliesPhotos;
