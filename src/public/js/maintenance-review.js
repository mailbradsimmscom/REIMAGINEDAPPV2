// Maintenance Task Review - Frontend JavaScript

const API_BASE = '/admin/api/maintenance';
let currentTasks = [];
let currentTaskForReject = null;
let allSystems = new Set();

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadTasks();

  // Set up filter listeners
  document.getElementById('filter-status').addEventListener('change', loadTasks);
  document.getElementById('filter-system').addEventListener('change', filterTasksBySystem);
});

// Load statistics
async function loadStats() {
  try {
    const response = await fetch(`${API_BASE}/stats`, {
      headers: {
        'x-admin-token': localStorage.getItem('admin-token') || ''
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load stats');
    }

    const { data } = await response.json();

    // Update stat cards
    document.getElementById('stat-pending').textContent = data.byStatus.pending || 0;
    document.getElementById('stat-approved').textContent = data.byStatus.approved || 0;
    document.getElementById('stat-rejected').textContent = data.byStatus.rejected || 0;
    document.getElementById('stat-total').textContent = data.byStatus.total || 0;

    // Populate system filter
    const systemFilter = document.getElementById('filter-system');
    allSystems = new Set(Object.keys(data.bySystem || {}));

    // Clear existing options except "All Systems"
    systemFilter.innerHTML = '<option value="">All Systems</option>';

    // Add system options
    Array.from(allSystems).sort().forEach(system => {
      const option = document.createElement('option');
      option.value = system;
      option.textContent = `${system} (${data.bySystem[system]})`;
      systemFilter.appendChild(option);
    });

  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// Load tasks
async function loadTasks() {
  const taskList = document.getElementById('task-list');
  taskList.innerHTML = '<div class="loading">Loading tasks...</div>';

  const status = document.getElementById('filter-status').value;

  try {
    const response = await fetch(`${API_BASE}/tasks?status=${status}&limit=100`, {
      headers: {
        'x-admin-token': localStorage.getItem('admin-token') || ''
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load tasks');
    }

    const { data } = await response.json();
    currentTasks = data.tasks;

    if (currentTasks.length === 0) {
      taskList.innerHTML = `
        <div class="empty-state">
          <h2>No ${status} tasks</h2>
          <p>All caught up! 🎉</p>
        </div>
      `;
      return;
    }

    renderTasks(currentTasks);

  } catch (error) {
    console.error('Error loading tasks:', error);
    taskList.innerHTML = `
      <div class="empty-state">
        <h2>Error loading tasks</h2>
        <p>${error.message}</p>
      </div>
    `;
  }
}

// Convert frequency to hours for sorting
function frequencyToHours(task) {
  if (!task.frequency_type || !task.frequency_value) {
    return 999999; // Unknown goes last
  }

  if (task.frequency_type === 'hours') {
    return task.frequency_value;
  } else if (task.frequency_type === 'days') {
    return task.frequency_value * 24;
  } else if (task.frequency_type === 'months') {
    return task.frequency_value * 30 * 24;
  } else if (task.frequency_type === 'condition_based') {
    return 999998; // Condition-based goes near the end
  }

  return 999999; // Unknown goes last
}

// Render tasks
function renderTasks(tasks) {
  const taskList = document.getElementById('task-list');

  // Sort by frequency (shortest first)
  const sortedTasks = [...tasks].sort((a, b) => {
    return frequencyToHours(a) - frequencyToHours(b);
  });

  taskList.innerHTML = sortedTasks.map(task => `
    <div class="task-card" data-task-id="${task.id}">
      <div class="task-header">
        <div class="task-title">
          <div class="task-system">${escapeHtml(task.system_name || 'Unknown System')}</div>
          <div class="task-description">${escapeHtml(task.description)}</div>
          <div class="task-badges">
            <span class="badge ${task.criticality}">${task.criticality || 'routine'}</span>
            <span class="confidence-badge">
              Confidence: ${Math.round((task.confidence || 0) * 100)}%
              <div class="confidence-bar">
                <div class="confidence-fill" style="width: ${(task.confidence || 0) * 100}%"></div>
              </div>
            </span>
          </div>
        </div>
      </div>

      <div class="task-details">
        <div class="detail-item">
          <div class="detail-label">Frequency</div>
          <div class="detail-value">${formatFrequency(task)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Duration</div>
          <div class="detail-value">${task.estimated_duration_hours || 'Unknown'} hours</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Parts Required</div>
          <div class="detail-value">${formatParts(task.parts_required)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-label">Source</div>
          <div class="detail-value">${task.source || 'manual'} (Score: ${task.source_details?.relevance_score?.toFixed(2) || 'N/A'})</div>
        </div>
      </div>

      ${task.status === 'pending' ? `
        <div class="task-actions">
          <button class="btn btn-approve" onclick="approveTask('${task.id}')">✓ Approve</button>
          <button class="btn btn-reject" onclick="openRejectModal('${task.id}')">✗ Reject</button>
          <button class="btn btn-view" onclick="viewTaskDetails('${task.id}')">View Details</button>
        </div>
      ` : `
        <div class="task-details">
          <div class="detail-item">
            <div class="detail-label">Reviewed By</div>
            <div class="detail-value">${task.reviewed_by || 'Unknown'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Reviewed At</div>
            <div class="detail-value">${formatDate(task.reviewed_at)}</div>
          </div>
          ${task.review_notes ? `
            <div class="detail-item">
              <div class="detail-label">Notes</div>
              <div class="detail-value">${escapeHtml(task.review_notes)}</div>
            </div>
          ` : ''}
        </div>
      `}
    </div>
  `).join('');
}

// Filter tasks by system (client-side)
function filterTasksBySystem() {
  const systemFilter = document.getElementById('filter-system').value;

  if (!systemFilter) {
    renderTasks(currentTasks);
    return;
  }

  const filtered = currentTasks.filter(task => task.system_name === systemFilter);
  renderTasks(filtered);
}

// Approve task
async function approveTask(taskId) {
  if (!confirm('Approve this maintenance task?')) {
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/tasks/${taskId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': localStorage.getItem('admin-token') || ''
      },
      body: JSON.stringify({ notes: '' })
    });

    if (!response.ok) {
      throw new Error('Failed to approve task');
    }

    // Reload data
    await loadStats();
    await loadTasks();

  } catch (error) {
    console.error('Error approving task:', error);
    alert('Failed to approve task: ' + error.message);
  }
}

// Open reject modal
function openRejectModal(taskId) {
  currentTaskForReject = taskId;
  document.getElementById('reject-reason').value = '';
  document.getElementById('reject-modal').classList.add('active');
}

// Close reject modal
function closeRejectModal() {
  currentTaskForReject = null;
  document.getElementById('reject-modal').classList.remove('active');
}

// Confirm reject
async function confirmReject() {
  const reason = document.getElementById('reject-reason').value.trim();

  if (!reason) {
    alert('Please provide a reason for rejection');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/tasks/${currentTaskForReject}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': localStorage.getItem('admin-token') || ''
      },
      body: JSON.stringify({ reason })
    });

    if (!response.ok) {
      throw new Error('Failed to reject task');
    }

    // Close modal and reload data
    closeRejectModal();
    await loadStats();
    await loadTasks();

  } catch (error) {
    console.error('Error rejecting task:', error);
    alert('Failed to reject task: ' + error.message);
  }
}

// View task details
function viewTaskDetails(taskId) {
  const task = currentTasks.find(t => t.id === taskId);
  if (!task) return;

  const details = JSON.stringify(task, null, 2);
  alert('Task Details:\n\n' + details);
  console.log('Task Details:', task);
}

// Helper functions
function formatFrequency(task) {
  if (!task.frequency_type || !task.frequency_value) {
    return 'Unknown';
  }

  if (task.frequency_type === 'hours') {
    return `Every ${task.frequency_value} hours`;
  } else if (task.frequency_type === 'days') {
    return `Every ${task.frequency_value} days`;
  } else if (task.frequency_type === 'months') {
    return `Every ${task.frequency_value} months`;
  } else if (task.frequency_type === 'condition_based') {
    return 'Condition-based';
  }

  return `${task.frequency_value} ${task.frequency_type}`;
}

function formatParts(parts) {
  if (!parts || parts.length === 0) {
    return 'None';
  }

  return parts.join(', ');
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';

  const date = new Date(dateString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Close modal when clicking outside
document.addEventListener('click', (e) => {
  const modal = document.getElementById('reject-modal');
  if (e.target === modal) {
    closeRejectModal();
  }
});
