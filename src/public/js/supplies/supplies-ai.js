/**
 * Supplies AI Component
 * Handles AI photo analysis and system recommendations
 */

export class SuppliesAI {
  constructor() {
    this.selectedSystems = [];
    this.currentSuggestions = [];
    this.init();
  }

  init() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    // System recommendations modal close button
    document.getElementById('systemRecsClose')?.addEventListener('click', () => {
      this.closeSystemRecommendationsModal();
    });

    // Accept selected systems button
    document.getElementById('acceptSystemsBtn')?.addEventListener('click', () => {
      this.acceptSelectedSystems();
    });

    // ESC key to close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const modal = document.getElementById('systemRecommendationsModal');
        if (modal && modal.classList.contains('active')) {
          this.closeSystemRecommendationsModal();
        }
      }
    });
  }

  /**
   * Analyze a photo using GPT-4V
   */
  async analyzePhoto(photoUrl) {
    try {
      this.showToast('Analyzing photo...', 'info');

      const response = await fetch('/api/supplies/analyze-photo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ photoUrl })
      });

      if (!response.ok) {
        throw new Error(`Analysis failed: ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Analysis failed');
      }

      this.showToast('Photo analyzed successfully!', 'success');

      return result.data;

    } catch (error) {
      console.error('Error analyzing photo:', error);
      this.showToast(`Failed to analyze photo: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Get system recommendations for a supply item
   */
  async getSystemRecommendations(itemData) {
    try {
      this.showToast('Finding relevant systems...', 'info');

      const response = await fetch('/api/supplies/suggest-systems', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(itemData)
      });

      if (!response.ok) {
        throw new Error(`Recommendations failed: ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Recommendations failed');
      }

      return result.data;

    } catch (error) {
      console.error('Error getting system recommendations:', error);
      this.showToast(`Failed to get recommendations: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Show system recommendations modal
   */
  async showSystemRecommendationsModal(itemData) {
    try {
      const modal = document.getElementById('systemRecommendationsModal');
      const container = document.getElementById('systemRecsContainer');

      if (!modal || !container) {
        console.error('System recommendations modal not found');
        return;
      }

      // Show loading state
      container.innerHTML = `
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Searching documentation for relevant systems...</p>
        </div>
      `;
      modal.classList.add('active');

      // Get recommendations from API
      const data = await this.getSystemRecommendations(itemData);

      this.currentSuggestions = data.suggestions || [];

      if (this.currentSuggestions.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <p>No relevant systems found in documentation.</p>
            <p class="text-secondary">Try adding more details about this item.</p>
          </div>
        `;
        return;
      }

      // Render suggestions
      container.innerHTML = this.currentSuggestions.map((suggestion, index) => `
        <div class="system-recommendation-item">
          <div class="system-rec-header">
            <label class="system-rec-checkbox">
              <input
                type="checkbox"
                data-index="${index}"
                data-asset-uid="${suggestion.asset_uid}"
                onchange="window.suppliesAI.toggleSystemSelection('${suggestion.asset_uid}')"
              >
              <span class="system-rec-title">
                <strong>${this.escapeHtml(suggestion.manufacturer)} ${this.escapeHtml(suggestion.model)}</strong>
                <span class="system-rec-badge">${this.escapeHtml(suggestion.system)}</span>
              </span>
            </label>
            <span class="system-rec-confidence">${Math.round(suggestion.confidence * 100)}% match</span>
          </div>
          <div class="system-rec-body">
            <div class="system-rec-details">
              <span class="detail-label">Subsystem:</span>
              <span>${this.escapeHtml(suggestion.subsystem)}</span>
            </div>
            ${suggestion.reason ? `
              <div class="system-rec-reason">
                <span class="detail-label">Found in manual:</span>
                <p>${this.escapeHtml(suggestion.reason)}</p>
              </div>
            ` : ''}
          </div>
        </div>
      `).join('');

      this.showToast(`Found ${this.currentSuggestions.length} relevant system${this.currentSuggestions.length !== 1 ? 's' : ''}`, 'success');

    } catch (error) {
      const container = document.getElementById('systemRecsContainer');
      if (container) {
        container.innerHTML = `
          <div class="error-state">
            <p>Failed to load system recommendations</p>
            <p class="text-secondary">${this.escapeHtml(error.message)}</p>
          </div>
        `;
      }
    }
  }

  /**
   * Close system recommendations modal
   */
  closeSystemRecommendationsModal() {
    const modal = document.getElementById('systemRecommendationsModal');
    if (modal) {
      modal.classList.remove('active');
    }
    this.selectedSystems = [];
  }

  /**
   * Toggle system selection
   */
  toggleSystemSelection(assetUid) {
    const index = this.selectedSystems.indexOf(assetUid);
    if (index > -1) {
      this.selectedSystems.splice(index, 1);
    } else {
      this.selectedSystems.push(assetUid);
    }
  }

  /**
   * Accept selected systems and close modal
   */
  acceptSelectedSystems() {
    this.closeSystemRecommendationsModal();

    // Notify form that systems were selected
    if (this.selectedSystems.length > 0 && window.suppliesForm) {
      window.suppliesForm.setAISuggestedSystems(this.selectedSystems);
      this.showToast(`${this.selectedSystems.length} system${this.selectedSystems.length !== 1 ? 's' : ''} selected`, 'success');
    } else {
      this.showToast('No systems selected', 'info');
    }
  }

  /**
   * Get selected systems (for external access)
   */
  getSelectedSystems() {
    return this.selectedSystems;
  }

  /**
   * Show toast notification
   */
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

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Make it globally accessible
window.SuppliesAI = SuppliesAI;
