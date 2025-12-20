/**
 * Anchorages Manager
 * Frontend for anchorage and mooring tracking
 */
class AnchoragesManager {
  constructor() {
    this.anchorages = [];
    this.init();
  }

  async init() {
    this.bindElements();
    this.bindEvents();
    await this.loadAnchorages();
  }

  bindElements() {
    this.container = document.getElementById('anchoragesContainer');
    this.detectBtn = document.getElementById('detectBtn');
    this.detectionResult = document.getElementById('detectionResult');
    this.toast = document.getElementById('toast');
  }

  bindEvents() {
    this.detectBtn.addEventListener('click', () => this.detectNewAnchorages());
  }

  /**
   * Load all anchorages from API
   */
  async loadAnchorages() {
    try {
      const response = await fetch('/api/anchorages');
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to load anchorages');
      }

      this.anchorages = result.data || [];
      this.renderAnchorages();
    } catch (error) {
      console.error('Error loading anchorages:', error);
      this.container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&#9888;</div>
          <div class="empty-state-title">Error Loading</div>
          <div class="empty-state-text">${error.message}</div>
        </div>
      `;
    }
  }

  /**
   * Detect new anchorages from GPS history
   */
  async detectNewAnchorages() {
    this.detectBtn.disabled = true;
    this.detectBtn.textContent = 'Detecting...';
    this.detectionResult.innerHTML = '';

    try {
      const response = await fetch('/api/anchorages/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minHours: 4 })
      });
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Detection failed');
      }

      const { detected, inserted } = result.data;

      if (inserted > 0) {
        this.detectionResult.innerHTML = `
          <div class="detection-result">
            Found ${detected} candidates, added ${inserted} new anchorage${inserted > 1 ? 's' : ''}.
          </div>
        `;
        this.showToast(`${inserted} new anchorage${inserted > 1 ? 's' : ''} added`, 'success');
        await this.loadAnchorages();
      } else if (detected > 0) {
        this.detectionResult.innerHTML = `
          <div class="detection-result empty">
            Found ${detected} candidates, but all already recorded.
          </div>
        `;
      } else {
        this.detectionResult.innerHTML = `
          <div class="detection-result empty">
            No new anchorages detected in GPS history.
          </div>
        `;
      }
    } catch (error) {
      console.error('Error detecting anchorages:', error);
      this.showToast(error.message, 'error');
    } finally {
      this.detectBtn.disabled = false;
      this.detectBtn.textContent = 'Refresh New Anchorages';
    }
  }

  /**
   * Save anchorage updates
   */
  async saveAnchorage(id) {
    const card = document.querySelector(`[data-anchorage-id="${id}"]`);
    if (!card) return;

    const locationName = card.querySelector('.location-name-input')?.value || '';
    const anchorageType = card.querySelector('.type-select')?.value || 'anchor';
    const scopeMeters = parseFloat(card.querySelector('.scope-input')?.value) || null;
    const notes = card.querySelector('.notes-input')?.value || '';

    try {
      const response = await fetch(`/api/anchorages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location_name: locationName || null,
          anchorage_type: anchorageType,
          scope_meters: scopeMeters,
          notes: notes || null
        })
      });
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to save');
      }

      // Update anchor position display if scope was set
      if (result.data.anchor_position_formatted) {
        const anchorPosEl = card.querySelector('.anchor-position');
        if (anchorPosEl) {
          anchorPosEl.textContent = `${result.data.anchor_position_formatted.lat}  ${result.data.anchor_position_formatted.lon}`;
          anchorPosEl.classList.remove('muted');
        }
      }

      this.showToast('Saved', 'success');
    } catch (error) {
      console.error('Error saving anchorage:', error);
      this.showToast(error.message, 'error');
    }
  }

  /**
   * Delete anchorage
   */
  async deleteAnchorage(id) {
    if (!confirm('Delete this anchorage?')) return;

    try {
      const response = await fetch(`/api/anchorages/${id}`, {
        method: 'DELETE'
      });
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete');
      }

      this.showToast('Deleted', 'success');
      await this.loadAnchorages();
    } catch (error) {
      console.error('Error deleting anchorage:', error);
      this.showToast(error.message, 'error');
    }
  }

  /**
   * Render all anchorage cards
   */
  renderAnchorages() {
    if (this.anchorages.length === 0) {
      this.container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&#9875;</div>
          <div class="empty-state-title">No Anchorages Yet</div>
          <div class="empty-state-text">
            Tap "Refresh New Anchorages" to detect from GPS history,
            or they'll be added automatically when you anchor for 4+ hours.
          </div>
        </div>
      `;
      return;
    }

    this.container.innerHTML = this.anchorages.map(a => this.renderCard(a)).join('');

    // Bind save/delete buttons
    this.container.querySelectorAll('.save-btn').forEach(btn => {
      btn.addEventListener('click', () => this.saveAnchorage(btn.dataset.id));
    });
    this.container.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => this.deleteAnchorage(btn.dataset.id));
    });
  }

  /**
   * Render single anchorage card
   */
  renderCard(a) {
    const arrivedDate = this.formatDate(a.arrived_at);
    const departedDate = a.departed_at ? this.formatDate(a.departed_at) : 'Still here';
    const typeClass = a.anchorage_type || 'anchor';
    const typeLabels = { anchor: 'Anchor', mooring: 'Mooring', marina: 'Marina' };
    const typeLabel = typeLabels[a.anchorage_type] || 'Anchor';

    return `
      <div class="anchorage-card" data-anchorage-id="${a.id}">
        <div class="anchorage-header">
          <span class="anchorage-type-badge ${typeClass}">${typeLabel}</span>
        </div>

        <div class="field-group">
          <div class="field-label">Location Name</div>
          <input type="text" class="input-field location-name-input"
                 value="${this.escapeHtml(a.location_name || '')}"
                 placeholder="Enter location name...">
        </div>

        <div class="field-group">
          <div class="field-label">Boat Position</div>
          <div class="field-value coordinates">
            ${a.position_formatted?.lat || ''}  ${a.position_formatted?.lon || ''}
          </div>
        </div>

        <div class="time-grid">
          <div class="field-group">
            <div class="field-label">Arrived</div>
            <div class="field-value">${arrivedDate}</div>
            ${a.arrival_trip ? `<a href="/trips/detail?id=${a.arrival_trip.id}" class="trip-link">via: ${this.escapeHtml(a.arrival_trip.title || 'Trip')}</a>` : ''}
          </div>
          <div class="field-group">
            <div class="field-label">Departed</div>
            <div class="field-value">${departedDate}</div>
            ${a.departure_trip ? `<a href="/trips/detail?id=${a.departure_trip.id}" class="trip-link">via: ${this.escapeHtml(a.departure_trip.title || 'Trip')}</a>` : ''}
          </div>
        </div>

        <div class="field-group">
          <div class="field-label">Duration</div>
          <div class="field-value">${a.duration_formatted || 'In progress'}</div>
        </div>

        ${a.wind_formatted ? `
        <div class="field-group">
          <div class="field-label">Avg Wind</div>
          <div class="field-value">${a.wind_formatted}</div>
        </div>
        ` : ''}

        <div class="input-row">
          <div class="field-group">
            <div class="field-label">Type</div>
            <select class="select-field type-select">
              <option value="anchor" ${a.anchorage_type === 'anchor' || !a.anchorage_type ? 'selected' : ''}>Anchor</option>
              <option value="mooring" ${a.anchorage_type === 'mooring' ? 'selected' : ''}>Mooring</option>
              <option value="marina" ${a.anchorage_type === 'marina' ? 'selected' : ''}>Marina</option>
            </select>
          </div>
          <div class="field-group">
            <div class="field-label">Scope (meters)</div>
            <input type="number" class="input-field scope-input"
                   value="${a.scope_meters || ''}"
                   placeholder="e.g., 50"
                   min="1" max="200" step="1">
          </div>
        </div>

        <div class="field-group">
          <div class="field-label">Anchor/Mooring Position (computed)</div>
          <div class="field-value coordinates anchor-position ${a.anchor_lat ? '' : 'muted'}">
            ${a.anchor_position_formatted
              ? `${a.anchor_position_formatted.lat}  ${a.anchor_position_formatted.lon}`
              : 'Set scope to compute'}
          </div>
        </div>

        <div class="field-group">
          <div class="field-label">Notes</div>
          <textarea class="textarea-field notes-input" placeholder="Optional notes...">${this.escapeHtml(a.notes || '')}</textarea>
        </div>

        <div class="anchorage-footer">
          <button class="button button-primary button-small save-btn" data-id="${a.id}">Save</button>
          <button class="button button-danger button-small delete-btn" data-id="${a.id}">Delete</button>
        </div>
      </div>
    `;
  }

  /**
   * Format date for display (AST timezone)
   */
  formatDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      timeZone: 'America/Puerto_Rico',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }) + ' AST';
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Show toast notification
   */
  showToast(message, type = '') {
    this.toast.textContent = message;
    this.toast.className = 'toast visible' + (type ? ` ${type}` : '');

    setTimeout(() => {
      this.toast.classList.remove('visible');
    }, 2500);
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.anchoragesManager = new AnchoragesManager();
});
