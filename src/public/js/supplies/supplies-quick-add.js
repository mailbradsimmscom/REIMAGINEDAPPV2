/**
 * Supply Audit — Quick Add
 * Self-contained frontend for rapid supply capture.
 * No imports from other supplies modules.
 */

const API = '/api/supplies/quick-add';

// ============================================================
// Image resize utility
// ============================================================

function resizeImage(base64, maxDimension = 1200, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(base64); // fallback to original
    img.src = base64;
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================
// Toast
// ============================================================

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

// ============================================================
// Location Manager
// ============================================================

class LocationManager {
  constructor() {
    this.locations = [];
    this.editingId = null;

    this.list = document.getElementById('locList');
    this.addInput = document.getElementById('locAddInput');
    this.addBtn = document.getElementById('locAddBtn');
    this.toggle = document.getElementById('locToggle');
    this.toggleIcon = document.getElementById('locToggleIcon');
    this.body = document.getElementById('locBody');

    this.addBtn.addEventListener('click', () => this.addLocation());
    this.addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.addLocation(); }
    });

    this.toggle.addEventListener('click', () => this.toggleSection());

    this.load();
  }

  toggleSection() {
    const collapsed = this.body.classList.toggle('collapsed');
    this.toggleIcon.classList.toggle('collapsed', collapsed);
  }

  async load() {
    try {
      const res = await fetch(`${API}/locations`);
      const result = await res.json();
      if (result.success) {
        this.locations = result.data || [];
        this.render();
        this.updateDropdown();
      }
    } catch (error) {
      console.error('Failed to load locations:', error);
      this.list.innerHTML = '<li class="loc-empty">Failed to load locations</li>';
    }
  }

  render() {
    if (this.locations.length === 0) {
      this.list.innerHTML = '<li class="loc-empty">No locations yet. Add one above.</li>';
      return;
    }

    this.list.innerHTML = this.locations.map(loc => {
      if (this.editingId === loc.id) {
        return `
          <li class="loc-item" data-id="${loc.id}">
            <input class="loc-edit-input" id="locEditInput" value="${this.escapeAttr(loc.name)}" autocomplete="off">
            <div class="loc-actions">
              <button class="loc-btn save" data-action="save-rename" title="Save">&#10003;</button>
              <button class="loc-btn cancel" data-action="cancel-rename" title="Cancel">&#10005;</button>
            </div>
          </li>
        `;
      }

      const hasItems = loc.item_count > 0;
      return `
        <li class="loc-item" data-id="${loc.id}">
          <span class="loc-name">${this.escapeHtml(loc.name)}</span>
          <span class="loc-count">${loc.item_count || 0}</span>
          <div class="loc-actions">
            <button class="loc-btn" data-action="edit" title="Rename">&#9998;</button>
            <button class="loc-btn delete" data-action="delete" title="Delete" ${hasItems ? 'disabled' : ''}>&#128465;</button>
          </div>
        </li>
      `;
    }).join('');

    // Wire up action buttons
    this.list.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = btn.closest('.loc-item');
        const id = item.dataset.id;
        const action = btn.dataset.action;

        if (action === 'edit') this.startEdit(id);
        else if (action === 'delete') this.deleteLocation(id);
        else if (action === 'save-rename') this.saveRename(id);
        else if (action === 'cancel-rename') this.cancelEdit();
      });
    });

    // Wire up enter key on edit input
    const editInput = document.getElementById('locEditInput');
    if (editInput) {
      editInput.focus();
      editInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.saveRename(this.editingId); }
        if (e.key === 'Escape') this.cancelEdit();
      });
    }
  }

  updateDropdown() {
    const select = document.getElementById('locationSelect');
    const currentValue = select.value;
    select.innerHTML = '<option value="">Select location...</option>' +
      this.locations
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(loc => `<option value="${this.escapeAttr(loc.name)}">${this.escapeHtml(loc.name)}</option>`)
        .join('');
    // Restore selection if still valid
    if (currentValue && this.locations.some(l => l.name === currentValue)) {
      select.value = currentValue;
    }
  }

  async addLocation() {
    const name = this.addInput.value.trim();
    if (!name) return;

    try {
      const res = await fetch(`${API}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const result = await res.json();

      if (result.success) {
        this.addInput.value = '';
        this.locations.push(result.data);
        this.render();
        this.updateDropdown();
        showToast(`Location "${name}" added`, 'success');
      } else {
        showToast(result.error || 'Failed to add location', 'error');
      }
    } catch (error) {
      showToast('Failed to add location', 'error');
    }
  }

  startEdit(id) {
    this.editingId = id;
    this.render();
  }

  cancelEdit() {
    this.editingId = null;
    this.render();
  }

  async saveRename(id) {
    const input = document.getElementById('locEditInput');
    const newName = input?.value?.trim();
    if (!newName) return;

    try {
      const res = await fetch(`${API}/locations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      const result = await res.json();

      if (result.success) {
        this.editingId = null;
        // Update local state
        const loc = this.locations.find(l => l.id === id);
        if (loc) loc.name = result.data.new_name;
        this.render();
        this.updateDropdown();
        const extra = result.data.audit_items_updated > 0
          ? ` (${result.data.audit_items_updated} item(s) updated)`
          : '';
        showToast(`Renamed to "${result.data.new_name}"${extra}`, 'success');
      } else {
        showToast(result.error || 'Rename failed', 'error');
      }
    } catch (error) {
      showToast('Rename failed', 'error');
    }
  }

  async deleteLocation(id) {
    const loc = this.locations.find(l => l.id === id);
    if (!loc) return;

    if (!confirm(`Delete location "${loc.name}"?`)) return;

    try {
      const res = await fetch(`${API}/locations/${id}`, { method: 'DELETE' });
      const result = await res.json();

      if (result.success) {
        this.locations = this.locations.filter(l => l.id !== id);
        this.render();
        this.updateDropdown();
        showToast(`Location "${loc.name}" deleted`, 'success');
      } else {
        showToast(result.error || 'Delete failed', 'error');
      }
    } catch (error) {
      showToast('Delete failed', 'error');
    }
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  escapeAttr(text) {
    if (!text) return '';
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}

// ============================================================
// Quick Add Form
// ============================================================

class QuickAddForm {
  constructor() {
    this.photos = []; // array of resized base64 strings
    this.captureCount = 0;

    this.form = document.getElementById('quickAddForm');
    this.nameInput = document.getElementById('itemName');
    this.qtyInput = document.getElementById('qtyInput');
    this.locationSelect = document.getElementById('locationSelect');
    this.notesInput = document.getElementById('notesInput');
    this.saveBtn = document.getElementById('saveBtn');
    this.photoArea = document.getElementById('photoArea');
    this.photoAddBtn = document.getElementById('photoAddBtn');
    this.photoInput = document.getElementById('photoInput');
    this.countDisplay = document.getElementById('captureCount');

    // Form submit
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.save();
    });

    // Photo capture
    this.photoAddBtn.addEventListener('click', () => this.photoInput.click());
    this.photoInput.addEventListener('change', (e) => this.handlePhotos(e));

    // Quantity buttons
    document.getElementById('qtyMinus').addEventListener('click', () => {
      const val = Math.max(0, (parseFloat(this.qtyInput.value) || 0) - 1);
      this.qtyInput.value = val;
    });
    document.getElementById('qtyPlus').addEventListener('click', () => {
      const val = (parseFloat(this.qtyInput.value) || 0) + 1;
      this.qtyInput.value = val;
    });
  }

  async handlePhotos(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      if (this.photos.length >= 5) {
        showToast('Maximum 5 photos', 'warning');
        break;
      }

      try {
        const raw = await readFileAsBase64(file);
        const resized = await resizeImage(raw);
        this.photos.push(resized);
      } catch (err) {
        console.error('Photo read error:', err);
      }
    }

    this.renderPhotos();
    this.photoInput.value = ''; // reset for next capture
  }

  renderPhotos() {
    // Clear existing thumbs (keep add button)
    this.photoArea.querySelectorAll('.photo-thumb').forEach(el => el.remove());

    // Insert thumbs before add button
    this.photos.forEach((base64, index) => {
      const thumb = document.createElement('div');
      thumb.className = 'photo-thumb';
      thumb.innerHTML = `
        <img src="${base64}" alt="Photo ${index + 1}">
        <button class="photo-remove" type="button" data-index="${index}">&times;</button>
      `;
      this.photoArea.insertBefore(thumb, this.photoAddBtn);
    });

    // Wire remove buttons
    this.photoArea.querySelectorAll('.photo-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        this.photos.splice(parseInt(btn.dataset.index), 1);
        this.renderPhotos();
      });
    });

    // Hide add button if at max
    this.photoAddBtn.style.display = this.photos.length >= 5 ? 'none' : 'flex';
  }

  async save() {
    const itemName = this.nameInput.value.trim();
    const location = this.locationSelect.value;
    const currentStock = parseFloat(this.qtyInput.value) || 0;
    const notes = this.notesInput.value.trim() || null;

    if (!itemName) {
      showToast('Item name is required', 'error');
      this.nameInput.focus();
      return;
    }

    if (!location) {
      showToast('Location is required', 'error');
      this.locationSelect.focus();
      return;
    }

    this.saveBtn.disabled = true;
    this.saveBtn.textContent = 'Saving...';

    try {
      // Step 1: Create the audit item
      const res = await fetch(`${API}/item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_name: itemName, current_stock: currentStock, location, notes })
      });
      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to save');
      }

      const itemId = result.data.id;

      // Step 2: Upload photos sequentially
      if (this.photos.length > 0) {
        let uploaded = 0;
        let failed = 0;

        for (let i = 0; i < this.photos.length; i++) {
          this.saveBtn.textContent = `Photo ${i + 1}/${this.photos.length}...`;
          try {
            const photoRes = await fetch(`${API}/item/${itemId}/photo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageBase64: this.photos[i], photoIndex: i + 1 })
            });
            const photoResult = await photoRes.json();
            if (photoResult.success) uploaded++;
            else failed++;
          } catch {
            failed++;
          }
        }

        if (failed > 0) {
          showToast(`Saved, but ${failed} photo(s) failed to upload`, 'warning');
        }
      }

      this.captureCount++;
      this.countDisplay.textContent = `${this.captureCount} captured`;
      showToast(`${itemName} saved`, 'success');
      this.reset();

    } catch (error) {
      showToast(error.message || 'Save failed', 'error');
    } finally {
      this.saveBtn.disabled = false;
      this.saveBtn.textContent = 'Save & Next';
    }
  }

  reset() {
    this.nameInput.value = '';
    this.qtyInput.value = '1';
    this.notesInput.value = '';
    this.photos = [];
    this.renderPhotos();
    // Keep location selected
    this.nameInput.focus();
  }
}

// ============================================================
// Init
// ============================================================

const locationManager = new LocationManager();
const quickAddForm = new QuickAddForm();
