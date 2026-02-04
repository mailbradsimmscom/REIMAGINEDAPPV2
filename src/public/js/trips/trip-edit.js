/**
 * Trip Edit Page
 * Edit trip details, sail events, and comments for completed trips
 */

class TripEditor {
  constructor() {
    this.tripId = null;
    this.tripData = null;
    this.editingEventId = null; // null = adding new, string = editing existing
    this.editingCommentId = null;
    this.pendingDeleteType = null; // 'sail-event' or 'comment'
    this.pendingDeleteId = null;
    this.selectedMainSail = null;
    this.selectedHeadsails = { jib: false, code_zero: false, asym_spinnaker: false, staysail: false };

    this.init();
  }

  init() {
    this.bindElements();

    const params = new URLSearchParams(window.location.search);
    this.tripId = params.get('id');

    if (!this.tripId) {
      this.showError('No trip ID provided');
      return;
    }

    // Set back button to trip detail
    this.backBtn.href = `/trips/detail?id=${this.tripId}`;

    this.bindEvents();
    this.loadTripData();
  }

  bindElements() {
    this.backBtn = document.getElementById('backBtn');
    this.loadingState = document.getElementById('loadingState');
    this.errorState = document.getElementById('errorState');
    this.contentContainer = document.getElementById('contentContainer');

    // Trip details
    this.titleInput = document.getElementById('titleInput');
    this.startedAtInput = document.getElementById('startedAtInput');
    this.endedAtInput = document.getElementById('endedAtInput');
    this.durationDisplay = document.getElementById('durationDisplay');
    this.saveTripBtn = document.getElementById('saveTripBtn');

    // Sail events
    this.sailEventsList = document.getElementById('sailEventsList');
    this.sailEventsEmpty = document.getElementById('sailEventsEmpty');
    this.addSailEventBtn = document.getElementById('addSailEventBtn');

    // Sail event modal
    this.sailEventModal = document.getElementById('sailEventModal');
    this.sailModalTitle = document.getElementById('sailModalTitle');
    this.sailStartInput = document.getElementById('sailStartInput');
    this.sailEndInput = document.getElementById('sailEndInput');
    this.mainSailBtns = document.getElementById('mainSailBtns');
    this.headsailBtns = document.getElementById('headsailBtns');
    this.sailNotesInput = document.getElementById('sailNotesInput');
    this.sailModalCancel = document.getElementById('sailModalCancel');
    this.sailModalSave = document.getElementById('sailModalSave');

    // Comments
    this.commentsList = document.getElementById('commentsList');
    this.commentsEmpty = document.getElementById('commentsEmpty');
    this.commentInput = document.getElementById('commentInput');
    this.addCommentBtn = document.getElementById('addCommentBtn');

    // Delete modal
    this.deleteModal = document.getElementById('deleteModal');
    this.deleteModalTitle = document.getElementById('deleteModalTitle');
    this.deleteModalText = document.getElementById('deleteModalText');
    this.deleteCancelBtn = document.getElementById('deleteCancelBtn');
    this.deleteConfirmBtn = document.getElementById('deleteConfirmBtn');

    // Toast
    this.toast = document.getElementById('toast');
  }

  bindEvents() {
    // Trip details
    this.saveTripBtn.addEventListener('click', () => this.saveTripDetails());
    this.startedAtInput.addEventListener('change', () => this.updateDurationDisplay());
    this.endedAtInput.addEventListener('change', () => this.updateDurationDisplay());

    // Sail events
    this.addSailEventBtn.addEventListener('click', () => this.showSailEventModal());
    this.sailModalCancel.addEventListener('click', () => this.hideSailEventModal());
    this.sailModalSave.addEventListener('click', () => this.saveSailEvent());

    // Main sail buttons (radio-style)
    this.mainSailBtns.querySelectorAll('.sail-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.mainSailBtns.querySelectorAll('.sail-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.selectedMainSail = btn.dataset.value || null;
      });
    });

    // Headsail buttons (toggle-style)
    this.headsailBtns.querySelectorAll('.sail-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        this.selectedHeadsails[btn.dataset.sail] = btn.classList.contains('active');
      });
    });

    // Comments
    this.addCommentBtn.addEventListener('click', () => this.addComment());
    this.commentInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.addComment();
    });

    // Delete modal
    this.deleteCancelBtn.addEventListener('click', () => this.hideDeleteModal());
    this.deleteConfirmBtn.addEventListener('click', () => this.confirmDelete());

    // Close modals on backdrop click
    this.sailEventModal.addEventListener('click', (e) => {
      if (e.target === this.sailEventModal) this.hideSailEventModal();
    });
    this.deleteModal.addEventListener('click', (e) => {
      if (e.target === this.deleteModal) this.hideDeleteModal();
    });

    // Escape key closes modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideSailEventModal();
        this.hideDeleteModal();
      }
    });
  }

  // ─── Data Loading ───

  async loadTripData() {
    try {
      const response = await fetch(`/api/trips/${this.tripId}`);
      const result = await response.json();

      if (!result.success) throw new Error(result.error || 'Failed to load trip');

      this.tripData = result.data;
      this.render();
    } catch (error) {
      console.error('Failed to load trip:', error);
      this.showError(error.message);
    }
  }

  render() {
    this.loadingState.style.display = 'none';
    this.contentContainer.style.display = 'block';

    this.renderTripDetails();
    this.renderSailEvents();
    this.renderComments();
  }

  // ─── Trip Details ───

  renderTripDetails() {
    const { trip } = this.tripData;
    this.titleInput.value = trip.title || '';
    this.startedAtInput.value = this.isoToDatetimeLocal(trip.started_at);
    this.endedAtInput.value = this.isoToDatetimeLocal(trip.ended_at);
    this.updateDurationDisplay();
  }

  updateDurationDisplay() {
    const start = this.startedAtInput.value;
    const end = this.endedAtInput.value;

    if (start && end) {
      const ms = new Date(end) - new Date(start);
      if (ms > 0) {
        this.durationDisplay.value = this.formatDuration(Math.round(ms / 60000));
      } else {
        this.durationDisplay.value = 'Invalid (end before start)';
      }
    } else {
      this.durationDisplay.value = '--';
    }
  }

  async saveTripDetails() {
    const title = this.titleInput.value.trim();
    const started_at = this.datetimeLocalToIso(this.startedAtInput.value);
    const ended_at = this.datetimeLocalToIso(this.endedAtInput.value);

    if (!title && !started_at && !ended_at) {
      this.showToast('No changes to save');
      return;
    }

    // Client-side validation
    if (started_at && ended_at && new Date(ended_at) <= new Date(started_at)) {
      this.showToast('End time must be after start time');
      return;
    }

    this.saveTripBtn.disabled = true;
    this.saveTripBtn.textContent = 'Saving...';

    try {
      const body = {};
      if (title) body.title = title;
      if (started_at) body.started_at = started_at;
      if (ended_at) body.ended_at = ended_at;

      const response = await fetch(`/api/trips/${this.tripId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error);

      // Update local data
      this.tripData.trip = result.data;
      this.renderTripDetails();
      this.showToast('Trip details saved');
    } catch (error) {
      this.showToast('Error: ' + error.message);
    } finally {
      this.saveTripBtn.disabled = false;
      this.saveTripBtn.textContent = 'Save Trip Details';
    }
  }

  // ─── Sail Events ───

  renderSailEvents() {
    const events = this.tripData.sail_events || [];

    if (events.length === 0) {
      this.sailEventsList.innerHTML = '';
      this.sailEventsEmpty.style.display = 'block';
      return;
    }

    this.sailEventsEmpty.style.display = 'none';
    this.sailEventsList.innerHTML = events.map(event => {
      const timeRange = this.formatEventTimeRange(event);
      const config = this.formatSailConfig(event);
      const notes = event.notes ? `<div class="event-notes">${this.escapeHtml(event.notes)}</div>` : '';

      return `
        <li class="event-item">
          <div class="event-info">
            <div class="event-time">${timeRange}</div>
            <div class="event-config">${config}</div>
            ${notes}
          </div>
          <div class="event-actions">
            <button class="btn btn-small btn-secondary" onclick="tripEditor.showSailEventModal('${event.id}')">Edit</button>
            <button class="btn btn-danger" onclick="tripEditor.showDeleteConfirm('sail-event', '${event.id}')">Delete</button>
          </div>
        </li>
      `;
    }).join('');
  }

  showSailEventModal(eventId) {
    if (eventId) {
      // Edit mode
      this.editingEventId = eventId;
      this.sailModalTitle.textContent = 'Edit Sail Event';
      const event = this.tripData.sail_events.find(e => e.id === eventId);
      if (!event) return;

      this.sailStartInput.value = this.isoToDatetimeLocal(event.started_at || event.recorded_at);
      this.sailEndInput.value = this.isoToDatetimeLocal(event.ended_at);
      this.selectedMainSail = event.main_sail || null;
      this.selectedHeadsails = {
        jib: event.jib || false,
        code_zero: event.code_zero || false,
        asym_spinnaker: event.asym_spinnaker || false,
        staysail: event.staysail || false
      };
      this.sailNotesInput.value = event.notes || '';
    } else {
      // Add mode
      this.editingEventId = null;
      this.sailModalTitle.textContent = 'Add Sail Event';
      this.sailStartInput.value = '';
      this.sailEndInput.value = '';
      this.selectedMainSail = null;
      this.selectedHeadsails = { jib: false, code_zero: false, asym_spinnaker: false, staysail: false };
      this.sailNotesInput.value = '';
    }

    // Update button states
    this.mainSailBtns.querySelectorAll('.sail-btn').forEach(btn => {
      const val = btn.dataset.value || null;
      btn.classList.toggle('active', val === this.selectedMainSail);
    });
    this.headsailBtns.querySelectorAll('.sail-btn').forEach(btn => {
      btn.classList.toggle('active', this.selectedHeadsails[btn.dataset.sail]);
    });

    this.sailEventModal.classList.add('show');
  }

  hideSailEventModal() {
    this.sailEventModal.classList.remove('show');
    this.editingEventId = null;
  }

  async saveSailEvent() {
    const started_at = this.datetimeLocalToIso(this.sailStartInput.value);
    const ended_at = this.datetimeLocalToIso(this.sailEndInput.value);

    // Validate times
    if (started_at && ended_at && new Date(ended_at) <= new Date(started_at)) {
      this.showToast('End time must be after start time');
      return;
    }

    const data = {
      main_sail: this.selectedMainSail,
      jib: this.selectedHeadsails.jib,
      code_zero: this.selectedHeadsails.code_zero,
      asym_spinnaker: this.selectedHeadsails.asym_spinnaker,
      staysail: this.selectedHeadsails.staysail,
      notes: this.sailNotesInput.value.trim() || null,
      started_at: started_at,
      ended_at: ended_at
    };

    this.sailModalSave.disabled = true;
    this.sailModalSave.textContent = 'Saving...';

    try {
      let response;
      if (this.editingEventId) {
        // Update existing
        response = await fetch(`/api/trips/${this.tripId}/sail-events/${this.editingEventId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      } else {
        // Create new
        response = await fetch(`/api/trips/${this.tripId}/sail-event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, allow_completed: true })
        });
      }

      const result = await response.json();
      if (!result.success) throw new Error(result.error);

      this.hideSailEventModal();
      this.showToast(this.editingEventId ? 'Sail event updated' : 'Sail event added');
      await this.loadTripData();
    } catch (error) {
      this.showToast('Error: ' + error.message);
    } finally {
      this.sailModalSave.disabled = false;
      this.sailModalSave.textContent = 'Save';
    }
  }

  // ─── Comments ───

  renderComments() {
    const comments = this.tripData.comments || [];

    if (comments.length === 0) {
      this.commentsList.innerHTML = '';
      this.commentsEmpty.style.display = 'block';
      return;
    }

    this.commentsEmpty.style.display = 'none';
    this.commentsList.innerHTML = comments.map(c => `
      <div class="comment-item" id="comment-${c.id}">
        <div class="comment-header">
          <span class="comment-time">${this.formatTime(c.created_at)}</span>
          <div class="event-actions">
            <button class="btn btn-small btn-secondary" onclick="tripEditor.startEditComment('${c.id}')">Edit</button>
            <button class="btn btn-danger" onclick="tripEditor.showDeleteConfirm('comment', '${c.id}')">Delete</button>
          </div>
        </div>
        <div class="comment-text">${this.escapeHtml(c.comment)}</div>
      </div>
    `).join('');
  }

  startEditComment(commentId) {
    const comment = this.tripData.comments.find(c => c.id === commentId);
    if (!comment) return;

    const el = document.getElementById(`comment-${commentId}`);
    if (!el) return;

    el.innerHTML = `
      <input type="text" class="comment-edit-input" id="editCommentInput-${commentId}" value="${this.escapeHtml(comment.comment)}">
      <div class="comment-edit-actions">
        <button class="btn btn-small btn-secondary" onclick="tripEditor.cancelEditComment()">Cancel</button>
        <button class="btn btn-small btn-primary" onclick="tripEditor.saveComment('${commentId}')">Save</button>
      </div>
    `;

    const input = document.getElementById(`editCommentInput-${commentId}`);
    input.focus();
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.saveComment(commentId);
    });
  }

  cancelEditComment() {
    this.renderComments();
  }

  async saveComment(commentId) {
    const input = document.getElementById(`editCommentInput-${commentId}`);
    if (!input) return;

    const text = input.value.trim();
    if (!text) {
      this.showToast('Comment cannot be empty');
      return;
    }

    try {
      const response = await fetch(`/api/trips/${this.tripId}/comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: text })
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error);

      this.showToast('Note updated');
      await this.loadTripData();
    } catch (error) {
      this.showToast('Error: ' + error.message);
    }
  }

  async addComment() {
    const text = this.commentInput.value.trim();
    if (!text) return;

    this.addCommentBtn.disabled = true;

    try {
      const response = await fetch(`/api/trips/${this.tripId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: text })
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error);

      this.commentInput.value = '';
      this.showToast('Note added');
      await this.loadTripData();
    } catch (error) {
      this.showToast('Error: ' + error.message);
    } finally {
      this.addCommentBtn.disabled = false;
    }
  }

  // ─── Delete Confirmation ───

  showDeleteConfirm(type, id) {
    this.pendingDeleteType = type;
    this.pendingDeleteId = id;

    if (type === 'sail-event') {
      this.deleteModalTitle.textContent = 'Delete Sail Event?';
      this.deleteModalText.textContent = 'This sail event will be permanently removed.';
    } else {
      this.deleteModalTitle.textContent = 'Delete Note?';
      this.deleteModalText.textContent = 'This note will be permanently removed.';
    }

    this.deleteModal.classList.add('show');
  }

  hideDeleteModal() {
    this.deleteModal.classList.remove('show');
    this.pendingDeleteType = null;
    this.pendingDeleteId = null;
  }

  async confirmDelete() {
    const type = this.pendingDeleteType;
    const id = this.pendingDeleteId;
    this.hideDeleteModal();

    try {
      let url;
      if (type === 'sail-event') {
        url = `/api/trips/${this.tripId}/sail-events/${id}`;
      } else {
        url = `/api/trips/${this.tripId}/comments/${id}`;
      }

      const response = await fetch(url, { method: 'DELETE' });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);

      this.showToast(type === 'sail-event' ? 'Sail event deleted' : 'Note deleted');
      await this.loadTripData();
    } catch (error) {
      this.showToast('Error: ' + error.message);
    }
  }

  // ─── Utilities ───

  isoToDatetimeLocal(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  }

  datetimeLocalToIso(dtLocal) {
    if (!dtLocal) return null;
    return new Date(dtLocal).toISOString();
  }

  formatDuration(minutes) {
    if (!minutes || minutes <= 0) return '--';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  formatTime(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
           ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  formatTimeShort(dateStr) {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  formatEventTimeRange(event) {
    const start = event.started_at || event.recorded_at;
    const end = event.ended_at;
    if (start && end) {
      return `${this.formatTimeShort(start)} - ${this.formatTimeShort(end)}`;
    }
    return this.formatTime(start);
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
    if (event.asym_spinnaker) parts.push('Asym');
    if (event.staysail) parts.push('Staysail');

    return parts.join(' + ');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showToast(message) {
    this.toast.textContent = message;
    this.toast.classList.add('show');
    setTimeout(() => this.toast.classList.remove('show'), 3000);
  }

  showError(message) {
    this.loadingState.style.display = 'none';
    this.errorState.textContent = message;
    this.errorState.style.display = 'block';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.tripEditor = new TripEditor();
});
