/**
 * Trip Detail Page
 * Shows trip map, stats, sail events, weather, and comments
 */

class TripDetail {
  constructor() {
    this.tripId = null;
    this.tripData = null;
    this.map = null;
    this.trackLine = null;

    this.init();
  }

  init() {
    // Get trip ID from URL
    const params = new URLSearchParams(window.location.search);
    this.tripId = params.get('id');

    if (!this.tripId) {
      this.showError('No trip ID provided');
      return;
    }

    this.bindElements();
    this.bindEvents();
    this.loadTripData();
  }

  bindElements() {
    this.loadingState = document.getElementById('loadingState');
    this.contentContainer = document.getElementById('contentContainer');
    this.tripTitle = document.getElementById('tripTitle');
    this.deleteBtn = document.getElementById('deleteBtn');

    // Stats
    this.statDistance = document.getElementById('statDistance');
    this.statDuration = document.getElementById('statDuration');
    this.statAvgSpeed = document.getElementById('statAvgSpeed');
    this.statMaxSpeed = document.getElementById('statMaxSpeed');

    // Sail events
    this.sailEventsTimeline = document.getElementById('sailEventsTimeline');

    // Weather
    this.weatherWind = document.getElementById('weatherWind');
    this.weatherWaves = document.getElementById('weatherWaves');
    this.weatherTemp = document.getElementById('weatherTemp');

    // Comments
    this.commentsList = document.getElementById('commentsList');
    this.commentInput = document.getElementById('commentInput');
    this.addCommentBtn = document.getElementById('addCommentBtn');

    // Delete modal
    this.deleteModal = document.getElementById('deleteModal');
    this.cancelDelete = document.getElementById('cancelDelete');
    this.confirmDelete = document.getElementById('confirmDelete');

    // Toast
    this.toast = document.getElementById('toast');
  }

  bindEvents() {
    this.deleteBtn?.addEventListener('click', () => this.showDeleteModal());
    this.cancelDelete?.addEventListener('click', () => this.hideDeleteModal());
    this.confirmDelete?.addEventListener('click', () => this.deleteTrip());
    this.addCommentBtn?.addEventListener('click', () => this.addComment());

    this.commentInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.addComment();
    });
  }

  async loadTripData() {
    try {
      const response = await fetch(`/api/trips/${this.tripId}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to load trip');
      }

      this.tripData = result.data;
      this.renderTrip();

    } catch (error) {
      console.error('Failed to load trip:', error);
      this.showError(error.message);
    }
  }

  renderTrip() {
    const { trip, track, sail_events, weather_summary, comments } = this.tripData;

    // Hide loading, show content
    this.loadingState.style.display = 'none';
    this.contentContainer.style.display = 'block';

    // Title
    this.tripTitle.textContent = trip.title || 'Untitled Trip';

    // Stats
    this.statDistance.innerHTML = `${trip.distance_nm?.toFixed(1) || '0.0'} <span class="stat-unit">nm</span>`;
    this.statDuration.textContent = this.formatDuration(trip.duration_minutes);
    this.statAvgSpeed.innerHTML = `${trip.avg_sog?.toFixed(1) || '0.0'} <span class="stat-unit">kts</span>`;
    this.statMaxSpeed.innerHTML = `${trip.max_sog?.toFixed(1) || '0.0'} <span class="stat-unit">kts</span>`;

    // Map
    this.initMap(track, trip);

    // Sail events
    this.renderSailEvents(sail_events);

    // Weather
    this.renderWeather(weather_summary);

    // Comments
    this.renderComments(comments);
  }

  initMap(track, trip) {
    // Initialize map
    this.map = L.map('map');

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(this.map);

    if (!track || track.length === 0) {
      // No track data - center on default or trip start
      if (trip.start_lat && trip.start_lon) {
        this.map.setView([trip.start_lat, trip.start_lon], 12);
      } else {
        this.map.setView([12.5, -61.5], 10); // Default Caribbean
      }
      return;
    }

    // Create track polyline
    const latlngs = track.map(p => [p.lat, p.lon]);
    this.trackLine = L.polyline(latlngs, {
      color: '#007AFF',
      weight: 3,
      opacity: 0.8
    }).addTo(this.map);

    // Add start marker
    const startMarker = L.marker(latlngs[0], {
      icon: L.divIcon({
        className: 'track-marker start',
        html: '<div style="background:#34C759;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      })
    }).addTo(this.map);
    startMarker.bindPopup('Start');

    // Add end marker
    const endMarker = L.marker(latlngs[latlngs.length - 1], {
      icon: L.divIcon({
        className: 'track-marker end',
        html: '<div style="background:#FF3B30;width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      })
    }).addTo(this.map);
    endMarker.bindPopup('End');

    // Fit map to track
    this.map.fitBounds(this.trackLine.getBounds(), { padding: [20, 20] });
  }

  renderSailEvents(events) {
    if (!events || events.length === 0) {
      this.sailEventsTimeline.innerHTML = '<div class="empty-state">No sail events recorded</div>';
      return;
    }

    this.sailEventsTimeline.innerHTML = events.map(event => {
      const time = this.formatTime(event.recorded_at);
      const config = this.formatSailConfig(event);
      return `
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="timeline-time">${time}</div>
          <div class="timeline-content">${config}</div>
        </div>
      `;
    }).join('');
  }

  formatSailConfig(event) {
    const parts = [];

    if (event.main_sail) {
      const labels = { full: 'Full Main', '1reef': '1 Reef', '2reef': '2 Reef', '3reef': '3 Reef' };
      parts.push(labels[event.main_sail] || event.main_sail);
    } else {
      parts.push('Main Down');
    }

    if (event.jib) parts.push('Jib');
    if (event.code_zero) parts.push('Code Zero');
    if (event.asym_spinnaker) parts.push('Asymmetric');

    if (parts.length === 1 && parts[0] === 'Main Down') {
      return 'Sails down (motoring)';
    }

    return parts.join(' + ');
  }

  renderWeather(summary) {
    if (!summary) {
      this.weatherWind.textContent = '--';
      this.weatherWaves.textContent = '--';
      this.weatherTemp.textContent = '--';
      return;
    }

    this.weatherWind.textContent = summary.avg_wind_kts ? `${Math.round(summary.avg_wind_kts)} kts` : '--';
    this.weatherWaves.textContent = summary.avg_wave_height_m ? `${summary.avg_wave_height_m.toFixed(1)} m` : '--';
    this.weatherTemp.textContent = summary.avg_temp_c ? `${Math.round(summary.avg_temp_c)}°C` : '--';
  }

  renderComments(comments) {
    if (!comments || comments.length === 0) {
      this.commentsList.innerHTML = '<div class="empty-state">No notes yet</div>';
      return;
    }

    this.commentsList.innerHTML = comments.map(comment => `
      <div class="comment-item">
        <div class="comment-text">${this.escapeHtml(comment.comment)}</div>
        <div class="comment-time">${this.formatTime(comment.created_at)}</div>
      </div>
    `).join('');
  }

  async addComment() {
    const text = this.commentInput.value.trim();
    if (!text) return;

    try {
      this.addCommentBtn.disabled = true;

      const response = await fetch(`/api/trips/${this.tripId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: text })
      });
      const result = await response.json();

      if (result.success) {
        this.commentInput.value = '';
        // Reload comments
        await this.loadTripData();
        this.showToast('Note added');
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Failed to add comment:', error);
      this.showToast(error.message || 'Failed to add note');
    } finally {
      this.addCommentBtn.disabled = false;
    }
  }

  showDeleteModal() {
    this.deleteModal.classList.add('show');
  }

  hideDeleteModal() {
    this.deleteModal.classList.remove('show');
  }

  async deleteTrip() {
    try {
      this.confirmDelete.disabled = true;
      this.confirmDelete.textContent = 'Deleting...';

      const response = await fetch(`/api/trips/${this.tripId}`, {
        method: 'DELETE'
      });
      const result = await response.json();

      if (result.success) {
        window.location.href = '/trips';
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Failed to delete trip:', error);
      this.showToast(error.message || 'Failed to delete trip');
      this.hideDeleteModal();
    } finally {
      this.confirmDelete.disabled = false;
      this.confirmDelete.textContent = 'Delete';
    }
  }

  formatDuration(minutes) {
    if (!minutes) return '0h 0m';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  }

  formatTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showError(message) {
    this.loadingState.innerHTML = `
      <div style="color: #FF3B30; font-size: 16px; margin-bottom: 8px;">Error</div>
      <div>${message}</div>
      <a href="/trips" style="color: #007AFF; margin-top: 16px; display: inline-block;">Back to Trips</a>
    `;
  }

  showToast(message) {
    this.toast.textContent = message;
    this.toast.classList.add('show');
    setTimeout(() => {
      this.toast.classList.remove('show');
    }, 3000);
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.tripDetail = new TripDetail();
});
