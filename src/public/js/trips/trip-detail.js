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
    // Bind elements first so showError works
    this.bindElements();

    // Get trip ID from URL
    const params = new URLSearchParams(window.location.search);
    this.tripId = params.get('id');

    if (!this.tripId) {
      this.showError('No trip ID provided');
      return;
    }

    this.bindEvents();
    this.loadTripData();
  }

  bindElements() {
    this.loadingState = document.getElementById('loadingState');
    this.contentContainer = document.getElementById('contentContainer');
    this.tripTitle = document.getElementById('tripTitle');
    this.deleteBtn = document.getElementById('deleteBtn');
    this.editBtn = document.getElementById('editBtn');

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

    // Telemetry table
    this.telemetryTableContainer = document.getElementById('telemetryTableContainer');
    this.signalkJsonContainer = document.getElementById('signalkJsonContainer');

    // Delete modal
    this.deleteModal = document.getElementById('deleteModal');
    this.cancelDelete = document.getElementById('cancelDelete');
    this.confirmDelete = document.getElementById('confirmDelete');

    // Toast
    this.toast = document.getElementById('toast');
  }

  bindEvents() {
    this.deleteBtn?.addEventListener('click', () => this.showDeleteModal());
    this.editBtn?.addEventListener('click', () => this.editTrip());
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

    // Show edit button for completed trips
    if (trip.status === 'completed' && this.editBtn) {
      this.editBtn.style.display = 'inline-block';
    }

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

    // Load telemetry samples for table
    this.loadTelemetrySamples();
  }

  async loadTelemetrySamples() {
    try {
      const response = await fetch(`/api/trips/${this.tripId}/telemetry-samples?interval=15`);
      const result = await response.json();

      if (result.success && result.data) {
        this.renderTelemetryTable(result.data.samples, result.data.columns, result.data.units || {});
      } else {
        this.telemetryTableContainer.innerHTML = '<div class="empty-state">Failed to load data</div>';
      }
    } catch (error) {
      console.error('Failed to load telemetry samples:', error);
      this.telemetryTableContainer.innerHTML = '<div class="empty-state">Error loading data</div>';
    }
  }

  renderTelemetryTable(samples, columns, units = {}) {
    if (!samples || samples.length === 0) {
      this.telemetryTableContainer.innerHTML = '<div class="empty-state">No telemetry data</div>';
      return;
    }

    this.telemetrySamples = samples;
    this.columnUnits = units;

    // Filter out internal fields
    const displayColumns = columns.filter(c => !c.startsWith('_'));

    // Build table header
    const headerCells = displayColumns.map(col => {
      const displayName = this.generateColumnName(col);
      return `<th title="${col}">${displayName}</th>`;
    }).join('') + '<th>JSON</th>';

    // Build table rows
    const rows = samples.map((sample, index) => {
      const cells = displayColumns.map(col => {
        const val = sample[col];
        const unit = units[col] || null;
        return `<td class="number">${this.formatValueWithUnit(col, val, unit)}</td>`;
      }).join('');
      return `<tr>${cells}<td><button class="expand-btn" onclick="tripDetail.showSignalkJson(${index})">View</button></td></tr>`;
    }).join('');

    this.telemetryTableContainer.innerHTML = `
      <table class="telemetry-table">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  /**
   * Generate a readable column name from a dot-notation path
   * Algorithmic - no hardcoding
   */
  generateColumnName(path) {
    // Split path into segments
    const segments = path.split('.');

    // Process each segment
    const processed = segments.map((seg, idx) => {
      // Handle numeric indices (array elements)
      if (/^\d+$/.test(seg)) {
        return seg; // Keep as number
      }

      // Split camelCase: "rudderAngle" -> "Rudder Angle"
      let words = seg.replace(/([a-z])([A-Z])/g, '$1 $2');

      // Split underscores: "wind_speed" -> "wind speed"
      words = words.replace(/_/g, ' ');

      // Capitalize first letter of each word
      words = words.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      return words;
    });

    // Filter out common redundant words
    const filtered = processed.filter((seg, idx) => {
      // Remove 'value' as it's always the value
      if (seg.toLowerCase() === 'value') return false;
      return true;
    });

    // Collapse path intelligently
    // If path is like "Propulsion Port Revolutions", keep key parts
    if (filtered.length <= 2) {
      return filtered.join(' ');
    }

    // For longer paths, try to create concise name
    // e.g., "Electrical Batteries 0 Voltage" -> "Batteries 0 Voltage"
    // e.g., "Navigation Gnss Satellites" -> "Gnss Satellites"
    const skipFirst = ['electrical', 'navigation', 'environment', 'sensors', 'propulsion', 'steering'];
    if (skipFirst.includes(filtered[0].toLowerCase()) && filtered.length > 2) {
      return filtered.slice(1).join(' ');
    }

    return filtered.join(' ');
  }

  /**
   * Format a value based on its SI unit
   * Converts from SI to display units algorithmically
   */
  formatValueWithUnit(col, val, unit) {
    if (val === null || val === undefined) return '--';

    // Special handling for timestamp
    if (col === 'recorded_at') {
      return this.formatTimeShort(val);
    }

    // Lat/lon formatting
    if (col === 'latitude' || col === 'longitude') {
      return typeof val === 'number' ? val.toFixed(4) : val;
    }

    // If no unit or non-numeric, return as-is
    if (typeof val !== 'number') {
      if (typeof val === 'string' && val.length > 12) {
        return val.substring(0, 10) + '...';
      }
      return val;
    }

    // Unit-based conversions (SI to display)
    if (unit) {
      switch (unit) {
        // Angular measurements
        case 'rad':
          // Radians to degrees
          return Math.round(val * 180 / Math.PI) + '°';
        case 'deg':
          return Math.round(val) + '°';

        // Temperature
        case 'K':
          // Kelvin to Celsius
          return Math.round(val - 273.15) + '°C';
        case 'C':
          return Math.round(val) + '°C';

        // Pressure
        case 'Pa':
          // Pascal to PSI
          return (val / 6894.76).toFixed(1) + ' psi';
        case 'hPa':
          return Math.round(val) + ' hPa';

        // Speed
        case 'm/s':
          // m/s to knots
          return (val * 1.94384).toFixed(1) + ' kts';
        case 'kn':
          return val.toFixed(1) + ' kts';

        // Distance
        case 'm':
          if (val > 10000) {
            // Large distances in km
            return (val / 1000).toFixed(1) + ' km';
          } else if (val > 1852) {
            // Nautical miles for sea distances
            return (val / 1852).toFixed(1) + ' nm';
          }
          return val.toFixed(1) + ' m';

        // Time
        case 's':
          if (val > 3600) {
            // Hours for large time values
            return Math.round(val / 3600) + ' h';
          }
          return val.toFixed(1) + ' s';

        // Electrical
        case 'V':
          return val.toFixed(1) + ' V';
        case 'A':
          return val.toFixed(1) + ' A';

        // Frequency (revolutions)
        case 'Hz':
          // Hz to RPM
          return Math.round(val * 60) + ' RPM';

        // Volume rate
        case 'm3/s':
          // m³/s to L/hr
          return (val * 3600000).toFixed(1) + ' L/h';

        // Ratio/percentage
        case 'ratio':
          return Math.round(val * 100) + '%';
        case '%':
          return Math.round(val) + '%';

        default:
          // Unknown unit - show value with unit
          return val.toFixed(2) + ' ' + unit;
      }
    }

    // No unit - format based on value characteristics
    if (Number.isInteger(val)) {
      return val.toString();
    }
    return val.toFixed(2);
  }

  showSignalkJson(index) {
    const sample = this.telemetrySamples[index];
    if (!sample || !sample._raw) {
      this.signalkJsonContainer.innerHTML = '<div class="signalk-json show">No SignalK data available</div>';
      return;
    }

    const jsonStr = JSON.stringify(sample._raw, null, 2);
    this.signalkJsonContainer.innerHTML = `
      <div class="signalk-json show">
        <strong>Full SignalK Data @ ${this.formatTimeShort(sample.recorded_at)}</strong>
        <hr style="border-color:#444;margin:8px 0;">
        ${this.escapeHtml(jsonStr)}
      </div>
    `;
  }

  formatTimeShort(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
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
    if (event.staysail) parts.push('Staysail');

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

  editTrip() {
    window.location.href = `/trips/edit?id=${this.tripId}`;
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
