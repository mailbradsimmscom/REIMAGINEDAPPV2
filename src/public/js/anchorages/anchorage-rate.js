/**
 * Anchorage Rating Manager
 * Standalone page for rating anchorages on 8 factors (1-10 scale)
 */
class AnchorageRatingManager {
  constructor() {
    this.anchorage = null;
    this.ratings = {};
    this.factors = [
      { key: 'entry_complexity', label: 'Ease of Entry', low: 'Hard', high: 'Easy' },
      { key: 'water_clarity', label: 'Water Clarity', low: 'Cloudy', high: 'Clear' },
      { key: 'swell', label: 'Swell / Sea State', low: 'Unsettled', high: 'Settled' },
      { key: 'wind', label: 'Wind / Breeze', low: 'Bad', high: 'Good' },
      { key: 'sleep', label: 'Sleep Quality', low: 'Bad', high: 'Good' },
      { key: 'swim', label: 'Swim Quality', low: 'Bad', high: 'Good' },
      { key: 'shore_landing', label: 'Ease of Landing', low: 'Bad', high: 'Good' },
      { key: 'noise', label: 'Noise Level', low: 'Loud', high: 'Quiet' }
    ];
    this.init();
  }

  async init() {
    this.bindElements();
    this.bindEvents();
    await this.loadAnchorage();
  }

  bindElements() {
    this.contextBar = document.getElementById('contextBar');
    this.overallScoreEl = document.getElementById('overallScore');
    this.factorsList = document.getElementById('factorsList');
    this.saveBtn = document.getElementById('saveBtn');
    this.toast = document.getElementById('toast');
  }

  bindEvents() {
    this.saveBtn.addEventListener('click', () => this.saveRatings());
  }

  /**
   * Get anchorage ID from URL
   */
  getAnchorageId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  /**
   * Load anchorage data + existing ratings
   */
  async loadAnchorage() {
    const id = this.getAnchorageId();
    if (!id) {
      this.factorsList.innerHTML = '<div class="loading">No anchorage ID provided</div>';
      return;
    }

    try {
      const response = await fetch(`/api/anchorages/${id}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to load anchorage');
      }

      this.anchorage = result.data;
      this.ratings = { ...(this.anchorage.ratings || {}) };

      this.renderContext();
      this.renderFactors();
      this.updateOverall();
      this.saveBtn.disabled = false;
    } catch (error) {
      console.error('Error loading anchorage:', error);
      this.factorsList.innerHTML = `<div class="loading">${error.message}</div>`;
    }
  }

  /**
   * Render context bar with location name, type, date
   */
  renderContext() {
    const a = this.anchorage;
    const name = a.location_name || 'Unnamed Anchorage';
    const type = a.anchorage_type || 'anchor';
    const typeLabels = { anchor: 'Anchor', mooring: 'Mooring', marina: 'Marina' };
    const date = a.arrived_at ? this.formatDate(a.arrived_at) : '';

    this.contextBar.style.display = 'flex';
    this.contextBar.innerHTML = `
      <span class="context-name">${this.escapeHtml(name)}</span>
      <span class="context-badge ${type}">${typeLabels[type] || 'Anchor'}</span>
      ${date ? `<span class="context-date">${date}</span>` : ''}
    `;
  }

  /**
   * Render all factor cards
   */
  renderFactors() {
    this.factorsList.innerHTML = this.factors.map(f => {
      const current = this.ratings[f.key] || null;
      const dots = [];
      for (let i = 1; i <= 10; i++) {
        let cls = 'rating-dot';
        if (current && i === current) cls += ' selected';
        else if (current && i < current) cls += ' below';
        dots.push(`<div class="${cls}" data-key="${f.key}" data-value="${i}">${i}</div>`);
      }

      return `
        <div class="factor-card">
          <div class="factor-header">
            <span class="factor-name">${f.label}</span>
            <span class="factor-value">${current || '—'}</span>
          </div>
          <div class="rating-row">${dots.join('')}</div>
          <div class="scale-labels">
            <span class="scale-label">${f.low}</span>
            <span class="scale-label">${f.high}</span>
          </div>
        </div>
      `;
    }).join('');

    // Bind tap events
    this.factorsList.querySelectorAll('.rating-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        const key = e.target.dataset.key;
        const value = parseInt(e.target.dataset.value, 10);
        this.setRating(key, value);
      });
    });
  }

  /**
   * Set a rating value and update UI
   */
  setRating(key, value) {
    // Toggle off if tapping same value
    if (this.ratings[key] === value) {
      delete this.ratings[key];
    } else {
      this.ratings[key] = value;
    }

    // Update dots for this factor
    const card = this.factorsList.querySelector(`.rating-dot[data-key="${key}"]`)?.closest('.factor-card');
    if (card) {
      const current = this.ratings[key] || null;
      card.querySelector('.factor-value').textContent = current || '—';

      card.querySelectorAll('.rating-dot').forEach(dot => {
        const v = parseInt(dot.dataset.value, 10);
        dot.className = 'rating-dot';
        if (current && v === current) dot.className += ' selected';
        else if (current && v < current) dot.className += ' below';
      });
    }

    this.updateOverall();
  }

  /**
   * Compute and display overall score
   */
  updateOverall() {
    const values = Object.values(this.ratings).filter(v => typeof v === 'number');

    if (values.length === 0) {
      this.overallScoreEl.className = 'overall-score empty';
      this.overallScoreEl.textContent = 'Tap to rate';
      return;
    }

    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    this.overallScoreEl.className = 'overall-score';
    this.overallScoreEl.innerHTML = `${avg.toFixed(1)}<span class="denominator">/10</span>`;
  }

  /**
   * Save ratings via PATCH
   */
  async saveRatings() {
    const id = this.getAnchorageId();
    if (!id) return;

    this.saveBtn.disabled = true;
    this.saveBtn.textContent = 'Saving...';

    try {
      // Send null values for unrated factors so they're cleared
      const ratingsPayload = {};
      for (const f of this.factors) {
        ratingsPayload[f.key] = this.ratings[f.key] || null;
      }

      const response = await fetch(`/api/anchorages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratings: ratingsPayload })
      });
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to save');
      }

      this.showToast('Ratings saved', 'success');
      setTimeout(() => { window.location.href = '/anchorages'; }, 1000);
    } catch (error) {
      console.error('Error saving ratings:', error);
      this.showToast(error.message, 'error');
    } finally {
      this.saveBtn.disabled = false;
      this.saveBtn.textContent = 'Save Ratings';
    }
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
      year: 'numeric'
    });
  }

  /**
   * Escape HTML
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
  window.ratingManager = new AnchorageRatingManager();
});
