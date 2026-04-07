/**
 * Trip Tracking Frontend
 * Handles trip start/stop, live stats, and trip history
 */

class TripsManager {
  constructor() {
    this.activeTrip = null;
    this.statsInterval = null;
    this.durationInterval = null;
    this.selectedTrip = null; // Trip selected for options
    this.tripToDelete = null;
    this.resumeTrip = null; // Trip that can be resumed
    this.currentSailConfig = {
      main_sail: null,
      jib: false,
      code_zero: false,
      asym_spinnaker: false,
      staysail: false
    };
    this.tripOffset = 0;
    this.tripLimit = 10;
    this.allTripsLoaded = false;

    this.init();
  }

  async init() {
    this.bindElements();
    this.bindEvents();
    await this.loadActiveTrip();
    await this.loadTripHistory();
  }

  bindElements() {
    // Cards
    this.startTripCard = document.getElementById('startTripCard');
    this.activeTripCard = document.getElementById('activeTripCard');
    this.historyCard = document.getElementById('historyCard');

    // Buttons
    this.startTripBtn = document.getElementById('startTripBtn');
    this.stopTripBtn = document.getElementById('stopTripBtn');
    this.saveTitleBtn = document.getElementById('saveTitleBtn');

    // Stats display
    this.durationEl = document.getElementById('duration');
    this.distanceEl = document.getElementById('distance');
    this.avgSpeedEl = document.getElementById('avgSpeed');
    this.tripTitleEl = document.getElementById('tripTitle');
    this.statusBadge = document.getElementById('statusBadge');

    // History
    this.tripList = document.getElementById('tripList');
    this.historyLoading = document.getElementById('historyLoading');
    this.noTrips = document.getElementById('noTrips');

    // Resume banner
    this.resumeBanner = document.getElementById('resumeBanner');
    this.resumeText = document.getElementById('resumeText');
    this.resumeYes = document.getElementById('resumeYes');
    this.resumeNo = document.getElementById('resumeNo');

    // Sail configuration
    this.mainSailOptions = document.getElementById('mainSailOptions');
    this.sailJib = document.getElementById('sailJib');
    this.sailCodeZero = document.getElementById('sailCodeZero');
    this.sailAsym = document.getElementById('sailAsym');
    this.sailStaysail = document.getElementById('sailStaysail');
    this.saveSailConfigBtn = document.getElementById('saveSailConfigBtn');
    this.sailConfigStatus = document.getElementById('sailConfigStatus');

    // Trip options modal
    this.tripOptionsModal = document.getElementById('tripOptionsModal');
    this.tripOptionsTitle = document.getElementById('tripOptionsTitle');
    this.tripOptionsMeta = document.getElementById('tripOptionsMeta');
    this.viewDetailsBtn = document.getElementById('viewDetailsBtn');
    this.deleteTripBtn = document.getElementById('deleteTripBtn');
    this.cancelOptions = document.getElementById('cancelOptions');

    // Delete modal
    this.deleteModal = document.getElementById('deleteModal');
    this.cancelDelete = document.getElementById('cancelDelete');
    this.confirmDelete = document.getElementById('confirmDelete');

    // Toast
    this.toast = document.getElementById('toast');
  }

  bindEvents() {
    this.startTripBtn?.addEventListener('click', () => this.startTrip());
    this.stopTripBtn?.addEventListener('click', () => this.stopTrip());
    this.saveTitleBtn?.addEventListener('click', () => this.saveTitle());

    // Resume
    this.resumeYes?.addEventListener('click', () => this.handleResume());
    this.resumeNo?.addEventListener('click', () => this.hideResumeBanner());

    // Sail configuration
    this.mainSailOptions?.querySelectorAll('.sail-btn').forEach(btn => {
      btn.addEventListener('click', () => this.selectMainSail(btn.dataset.value));
    });
    this.saveSailConfigBtn?.addEventListener('click', () => this.saveSailConfig());

    // Trip options modal
    this.viewDetailsBtn?.addEventListener('click', () => this.viewTripDetails());
    this.deleteTripBtn?.addEventListener('click', () => this.showDeleteConfirmation());
    this.cancelOptions?.addEventListener('click', () => this.hideOptionsModal());

    // Delete modal
    this.cancelDelete?.addEventListener('click', () => this.hideDeleteModal());
    this.confirmDelete?.addEventListener('click', () => this.deleteTrip());
  }

  async loadActiveTrip() {
    try {
      const response = await fetch('/api/trips/active');
      const result = await response.json();

      if (result.success && result.data) {
        this.activeTrip = result.data;
        this.showActiveTrip();
        this.startStatsPolling();
      } else {
        this.showStartCard();
      }
    } catch (error) {
      console.error('Failed to load active trip:', error);
      this.showToast('Failed to load trip status');
      this.showStartCard();
    }
  }

  async loadTripHistory(append = false) {
    try {
      if (!append) {
        this.tripOffset = 0;
        this.allTripsLoaded = false;
        this.historyLoading.style.display = 'block';
        this.tripList.style.display = 'none';
        this.noTrips.style.display = 'none';
      }

      const response = await fetch(`/api/trips?limit=${this.tripLimit}&offset=${this.tripOffset}`);
      const result = await response.json();

      this.historyLoading.style.display = 'none';

      if (result.success && result.data.length > 0) {
        const completedTrips = result.data.filter(t => t.status === 'completed');

        if (completedTrips.length > 0 || append) {
          this.renderTripList(completedTrips, append);
          this.tripList.style.display = 'block';

          if (!append) {
            this.checkResumableTrip(completedTrips[0]);
          }

          // Check if there are more trips
          if (result.data.length < this.tripLimit) {
            this.allTripsLoaded = true;
            this.removeLoadMoreBtn();
          } else {
            this.tripOffset += this.tripLimit;
            this.showLoadMoreBtn();
          }
        } else {
          this.noTrips.style.display = 'block';
        }
      } else {
        if (!append) {
          this.noTrips.style.display = 'block';
        }
        this.allTripsLoaded = true;
        this.removeLoadMoreBtn();
      }
    } catch (error) {
      console.error('Failed to load trip history:', error);
      this.historyLoading.style.display = 'none';
      if (!append) this.noTrips.style.display = 'block';
    }
  }

  showLoadMoreBtn() {
    this.removeLoadMoreBtn();
    const btn = document.createElement('button');
    btn.id = 'loadMoreBtn';
    btn.className = 'button button-secondary';
    btn.textContent = 'Load More Trips';
    btn.style.marginTop = '12px';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Loading...';
      this.loadTripHistory(true);
    });
    this.tripList.parentElement.appendChild(btn);
  }

  removeLoadMoreBtn() {
    document.getElementById('loadMoreBtn')?.remove();
  }

  checkResumableTrip(trip) {
    if (!trip || !trip.ended_at || this.activeTrip) {
      this.hideResumeBanner();
      return;
    }

    const endedAt = new Date(trip.ended_at);
    const now = new Date();
    const minutesAgo = Math.floor((now - endedAt) / 60000);

    if (minutesAgo <= 30) {
      this.resumeTrip = trip;
      this.resumeText.textContent = `Your trip ended ${minutesAgo} minute${minutesAgo !== 1 ? 's' : ''} ago`;
      this.resumeBanner.classList.add('show');
    } else {
      this.hideResumeBanner();
    }
  }

  hideResumeBanner() {
    this.resumeBanner.classList.remove('show');
    this.resumeTrip = null;
  }

  async handleResume() {
    if (!this.resumeTrip) return;

    try {
      this.resumeYes.disabled = true;
      this.resumeYes.textContent = 'Resuming...';

      const response = await fetch(`/api/trips/${this.resumeTrip.id}/resume`, {
        method: 'POST'
      });
      const result = await response.json();

      if (result.success) {
        this.activeTrip = result.data;
        this.hideResumeBanner();
        this.showActiveTrip();
        this.startStatsPolling();
        this.showToast('Trip resumed');
        await this.loadTripHistory();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Failed to resume trip:', error);
      this.showToast(error.message || 'Failed to resume trip');
    } finally {
      this.resumeYes.disabled = false;
      this.resumeYes.textContent = 'Resume Trip';
    }
  }

  renderTripList(trips, append = false) {
    // Store trips for later reference
    if (!append) this.tripsData = {};
    trips.forEach(t => this.tripsData[t.id] = t);

    const html = trips.map(trip => `
      <li class="trip-item" data-trip-id="${trip.id}">
        <div class="trip-info">
          <div class="trip-name">${this.escapeHtml(trip.title || 'Untitled Trip')}</div>
          <div class="trip-meta">${this.formatDate(trip.started_at)}</div>
        </div>
        <div class="trip-stats-mini">
          <div class="trip-distance">${trip.distance_nm?.toFixed(1) || '0.0'} nm</div>
          <div class="trip-duration">${this.formatMinutes(trip.duration_minutes)}</div>
        </div>
        <span class="trip-chevron">&#8250;</span>
      </li>
    `).join('');

    if (append) {
      this.tripList.insertAdjacentHTML('beforeend', html);
    } else {
      this.tripList.innerHTML = html;
    }

    // Add click handlers
    this.tripList.querySelectorAll('.trip-item').forEach(item => {
      item.addEventListener('click', () => {
        const tripId = item.dataset.tripId;
        const tripData = this.tripsData[tripId];
        this.showTripDetails(tripId, tripData);
      });
    });
  }

  showTripDetails(tripId, tripData) {
    this.selectedTrip = { id: tripId, ...tripData };

    // Update modal content
    this.tripOptionsTitle.textContent = tripData.title || 'Untitled Trip';
    this.tripOptionsMeta.textContent = `${this.formatDate(tripData.started_at)} • ${tripData.distance_nm?.toFixed(1) || '0.0'} nm`;

    this.tripOptionsModal.classList.add('show');
  }

  hideOptionsModal() {
    this.tripOptionsModal.classList.remove('show');
    this.selectedTrip = null;
  }

  viewTripDetails() {
    if (!this.selectedTrip) return;

    // Navigate to trip detail page
    window.location.href = `/trips/detail?id=${this.selectedTrip.id}`;
  }

  showDeleteConfirmation() {
    if (!this.selectedTrip) return;
    this.tripToDelete = this.selectedTrip.id;
    this.hideOptionsModal();
    this.showDeleteModal();
  }

  showDeleteModal() {
    this.deleteModal.classList.add('show');
  }

  hideDeleteModal() {
    this.deleteModal.classList.remove('show');
    this.tripToDelete = null;
  }

  async deleteTrip() {
    if (!this.tripToDelete) return;

    try {
      this.confirmDelete.disabled = true;
      this.confirmDelete.textContent = 'Deleting...';

      const response = await fetch(`/api/trips/${this.tripToDelete}`, {
        method: 'DELETE'
      });
      const result = await response.json();

      if (result.success) {
        this.showToast('Trip deleted');
        this.hideDeleteModal();
        await this.loadTripHistory();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Failed to delete trip:', error);
      this.showToast(error.message || 'Failed to delete trip');
    } finally {
      this.confirmDelete.disabled = false;
      this.confirmDelete.textContent = 'Delete';
    }
  }

  showStartCard() {
    this.startTripCard.style.display = 'block';
    this.activeTripCard.style.display = 'none';
    this.statusBadge.textContent = 'No Trip';
    this.statusBadge.className = 'status-badge inactive';
    this.stopStatsPolling();
  }

  showActiveTrip() {
    this.startTripCard.style.display = 'none';
    this.activeTripCard.style.display = 'block';
    this.statusBadge.textContent = 'Active';
    this.statusBadge.className = 'status-badge active';
    this.tripTitleEl.value = this.activeTrip.title || '';
    this.hideResumeBanner();

    // Load current sail configuration
    this.loadSailConfig();
  }

  async startTrip() {
    try {
      this.startTripBtn.disabled = true;
      this.startTripBtn.textContent = 'Starting...';

      // Check for planning journeys (non-blocking — if agent is down, skip)
      let journeys = [];
      try {
        this.startTripBtn.textContent = 'Checking journeys...';
        journeys = await this.fetchPlanningJourneys();
      } catch (err) {
        console.warn('Journey check failed, starting trip directly:', err.message);
      }

      if (journeys.length > 0) {
        // Show journey selection modal
        this.startTripBtn.textContent = 'Start Trip';
        this.startTripBtn.disabled = false;
        this.showJourneyModal(journeys);
        return;
      }

      // No journeys — start trip directly
      await this.executeStartTrip(null, null, null);
    } catch (error) {
      console.error('Failed to start trip:', error);
      this.showToast(error.message || 'Failed to start trip');
      this.startTripBtn.disabled = false;
      this.startTripBtn.textContent = 'Start Trip';
    }
  }

  async executeStartTrip(journeyId, routeId, departureTime) {
    try {
      this.startTripBtn.disabled = true;
      this.startTripBtn.textContent = 'Starting...';

      const response = await fetch('/api/trips/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ journey_id: journeyId }),
      });
      const result = await response.json();

      if (!result.success) throw new Error(result.error);

      this.activeTrip = result.data;

      // If journey selected, begin the journey (planning → sailing)
      if (journeyId && routeId) {
        try {
          const journeyBase = this.getJourneyApiBase();
          const beginRes = await fetch(`${journeyBase}/${journeyId}/begin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              route_id: routeId,
              departure_time: departureTime || new Date().toISOString(),
              trip_id: this.activeTrip.id,
            }),
          });
          const beginResult = await beginRes.json();
          if (!beginResult.success) {
            console.error('Journey begin failed:', beginResult.error);
            this.showToast('Trip started but journey begin failed: ' + beginResult.error);
          }
        } catch (err) {
          console.error('Journey begin error:', err);
          this.showToast('Trip started but journey transition failed');
        }
      }

      this.showActiveTrip();
      this.startStatsPolling();
      this.showToast(journeyId ? 'Trip started — journey is active' : 'Trip started');
    } catch (error) {
      console.error('Failed to start trip:', error);
      this.showToast(error.message || 'Failed to start trip');
    } finally {
      this.startTripBtn.disabled = false;
      this.startTripBtn.textContent = 'Start Trip';
      this.hideJourneyModal();
    }
  }

  getJourneyApiBase() {
    return window.location.hostname === 'localhost' || window.location.hostname.startsWith('192.168')
      ? 'http://localhost:3001/api/journey'
      : 'https://boatos-maintenance.onrender.com/api/journey';
  }

  async fetchPlanningJourneys() {
    try {
      const base = this.getJourneyApiBase();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${base}?status=planning`, { signal: controller.signal });
      clearTimeout(timeout);
      const data = await res.json();
      if (!data.success) return [];
      return (data.data || []).filter(j => j.status === 'planning');
    } catch (err) {
      console.warn('Journey check unavailable:', err.message);
      return [];
    }
  }

  showJourneyModal(journeys) {
    const modal = document.getElementById('journeyModal');
    const list = document.getElementById('journeySelectList');

    list.innerHTML = journeys.map(j => `
      <div class="journey-select-item" data-journey-id="${j.id}" onclick="window.tripsManager.selectJourneyForTrip('${j.id}')">
        <div style="font-weight:600; font-size:15px">${j.title}</div>
        <div style="font-size:12px; color:#8E8E93; margin-top:2px">
          ${j.start_name || 'Start'} \u2192 ${j.end_name || 'End'}
        </div>
      </div>
    `).join('');

    modal.classList.add('show');
  }

  hideJourneyModal() {
    const modal = document.getElementById('journeyModal');
    if (modal) modal.classList.remove('show');
    const routeModal = document.getElementById('routeSelectModal');
    if (routeModal) routeModal.classList.remove('show');
  }

  async selectJourneyForTrip(journeyId) {
    // Fetch full journey to get routes
    try {
      const base = this.getJourneyApiBase();
      const res = await fetch(`${base}/${journeyId}`);
      const data = await res.json();
      if (!data.success) {
        this.showToast('Failed to load journey details');
        return;
      }

      const journey = data.data;
      const selectedRoutes = (journey.routes || []).filter(r => r.is_selected);

      if (selectedRoutes.length === 0) {
        this.showToast('No routes selected in this journey');
        return;
      }

      // If only one selected route, use it directly
      if (selectedRoutes.length === 1) {
        this.hideJourneyModal();
        const route = selectedRoutes[0];
        await this.executeStartTrip(journeyId, route.id, journey.selected_departure || journey.earliest_departure);
        return;
      }

      // Multiple routes — show route selection
      this.showRouteSelectModal(journey, selectedRoutes);
    } catch (err) {
      console.error('Failed to load journey:', err);
      this.showToast('Failed to load journey');
    }
  }

  showRouteSelectModal(journey, routes) {
    document.getElementById('journeyModal').classList.remove('show');
    const modal = document.getElementById('routeSelectModal');
    const list = document.getElementById('routeSelectList');

    list.innerHTML = routes.map(r => {
      const dur = r.estimated_duration_hrs < 24
        ? `${r.estimated_duration_hrs}hrs`
        : `${Math.floor(r.estimated_duration_hrs / 24)}d ${Math.round(r.estimated_duration_hrs % 24)}h`;
      return `
        <div class="journey-select-item" onclick="window.tripsManager.executeStartTrip('${journey.id}', '${r.id}', '${journey.earliest_departure || new Date().toISOString()}')">
          <div style="font-weight:600; font-size:15px">${r.name}</div>
          <div style="font-size:12px; color:#8E8E93; margin-top:2px">${r.distance_nm}nm | ${dur}</div>
          ${r.ai_description ? `<div style="font-size:11px; color:#8E8E93; margin-top:2px">${r.ai_description}</div>` : ''}
        </div>
      `;
    }).join('');

    modal.classList.add('show');
  }

  async stopTrip() {
    if (!this.activeTrip) return;

    try {
      this.stopTripBtn.disabled = true;
      this.stopTripBtn.textContent = 'Stopping...';

      const response = await fetch(`/api/trips/${this.activeTrip.id}/stop`, {
        method: 'POST'
      });
      const result = await response.json();

      if (result.success) {
        this.activeTrip = null;
        this.showStartCard();
        this.showToast('Trip stopped');
        await this.loadTripHistory();
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Failed to stop trip:', error);
      this.showToast(error.message || 'Failed to stop trip');
    } finally {
      this.stopTripBtn.disabled = false;
      this.stopTripBtn.textContent = 'Stop Trip';
    }
  }

  async saveTitle() {
    if (!this.activeTrip) return;

    const title = this.tripTitleEl.value.trim();
    if (!title) {
      this.showToast('Please enter a title');
      return;
    }

    try {
      this.saveTitleBtn.disabled = true;
      this.saveTitleBtn.textContent = 'Saving...';

      const response = await fetch(`/api/trips/${this.activeTrip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      const result = await response.json();

      if (result.success) {
        this.activeTrip.title = title;
        this.showToast('Title saved');
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Failed to save title:', error);
      this.showToast(error.message || 'Failed to save title');
    } finally {
      this.saveTitleBtn.disabled = false;
      this.saveTitleBtn.textContent = 'Save';
    }
  }

  // Sail Configuration Methods
  selectMainSail(value) {
    this.currentSailConfig.main_sail = value || null;

    // Update UI
    this.mainSailOptions?.querySelectorAll('.sail-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === value);
    });
  }

  getSailConfigFromUI() {
    return {
      main_sail: this.currentSailConfig.main_sail,
      jib: this.sailJib?.checked || false,
      code_zero: this.sailCodeZero?.checked || false,
      asym_spinnaker: this.sailAsym?.checked || false,
      staysail: this.sailStaysail?.checked || false
    };
  }

  updateSailConfigUI(config) {
    this.currentSailConfig = { ...config };

    // Update main sail buttons
    this.mainSailOptions?.querySelectorAll('.sail-btn').forEach(btn => {
      const btnValue = btn.dataset.value || null;
      btn.classList.toggle('selected', btnValue === config.main_sail);
    });

    // Update checkboxes
    if (this.sailJib) this.sailJib.checked = config.jib || false;
    if (this.sailCodeZero) this.sailCodeZero.checked = config.code_zero || false;
    if (this.sailAsym) this.sailAsym.checked = config.asym_spinnaker || false;
    if (this.sailStaysail) this.sailStaysail.checked = config.staysail || false;

    // Update status text
    this.updateSailConfigStatus(config);
  }

  updateSailConfigStatus(config) {
    if (!this.sailConfigStatus) return;

    const parts = [];
    if (config.main_sail) {
      const mainLabels = { full: 'Full Main', '1reef': '1 Reef', '2reef': '2 Reef', '3reef': '3 Reef' };
      parts.push(mainLabels[config.main_sail] || config.main_sail);
    }
    if (config.jib) parts.push('Jib');
    if (config.code_zero) parts.push('Code 0');
    if (config.asym_spinnaker) parts.push('Asym');
    if (config.staysail) parts.push('Staysail');

    this.sailConfigStatus.textContent = parts.length > 0 ? parts.join(' + ') : 'Not set';
  }

  async loadSailConfig() {
    if (!this.activeTrip) return;

    try {
      const response = await fetch(`/api/trips/${this.activeTrip.id}/sail-config`);
      const result = await response.json();

      if (result.success && result.data) {
        this.updateSailConfigUI(result.data);
      }
    } catch (error) {
      console.error('Failed to load sail config:', error);
    }
  }

  async saveSailConfig() {
    if (!this.activeTrip) return;

    const config = this.getSailConfigFromUI();

    try {
      this.saveSailConfigBtn.disabled = true;
      this.saveSailConfigBtn.textContent = 'Saving...';

      const response = await fetch(`/api/trips/${this.activeTrip.id}/sail-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const result = await response.json();

      if (result.success) {
        this.updateSailConfigStatus(config);
        this.showToast('Sail configuration saved');
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Failed to save sail config:', error);
      this.showToast(error.message || 'Failed to save sail config');
    } finally {
      this.saveSailConfigBtn.disabled = false;
      this.saveSailConfigBtn.textContent = 'Save Sail Configuration';
    }
  }

  startStatsPolling() {
    // Update stats every 10 seconds
    this.updateStats();
    this.statsInterval = setInterval(() => this.updateStats(), 10000);

    // Update duration every second
    this.startDurationTimer();
  }

  stopStatsPolling() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }
  }

  startDurationTimer() {
    this.updateDuration();
    this.durationInterval = setInterval(() => this.updateDuration(), 1000);
  }

  updateDuration() {
    if (!this.activeTrip) return;

    const started = new Date(this.activeTrip.started_at);
    const now = new Date();
    const ms = now - started;

    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);

    this.durationEl.textContent =
      `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  async updateStats() {
    if (!this.activeTrip) return;

    try {
      const response = await fetch(`/api/trips/${this.activeTrip.id}/stats`);
      const result = await response.json();

      if (result.success && result.data) {
        const stats = result.data;
        this.distanceEl.innerHTML = `${(stats.distance_nm || 0).toFixed(2)} <span class="stat-unit">nm</span>`;
        this.avgSpeedEl.innerHTML = `${(stats.avg_sog || 0).toFixed(1)} <span class="stat-unit">kts</span>`;
      }
    } catch (error) {
      console.error('Failed to update stats:', error);
    }
  }

  formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  formatMinutes(minutes) {
    if (!minutes) return '0h 0m';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showToast(message) {
    this.toast.textContent = message;
    this.toast.classList.add('show');
    setTimeout(() => {
      this.toast.classList.remove('show');
    }, 3000);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.tripsManager = new TripsManager();
});
