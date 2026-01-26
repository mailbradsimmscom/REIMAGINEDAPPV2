/**
 * AIS page JavaScript
 * Handles Around Us and Friends tabs
 */

// Get admin token from localStorage or prompt
function getAdminToken() {
  let token = localStorage.getItem('adminToken');
  if (!token) {
    token = prompt('Enter admin token:');
    if (token) {
      localStorage.setItem('adminToken', token);
    }
  }
  return token;
}

// API helper with admin auth
async function apiCall(endpoint, options = {}) {
  const token = getAdminToken();
  if (!token) {
    throw new Error('Admin token required');
  }

  const response = await fetch(endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': token,
      ...options.headers
    }
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'API request failed');
  }

  return data.data;
}

// Toast notifications
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} visible`;

  setTimeout(() => {
    toast.classList.remove('visible');
  }, 3000);
}

// Format distance
function formatDistance(nm) {
  if (nm === null || nm === undefined) return '-';
  if (nm < 0.1) return '< 0.1 nm';
  return `${nm.toFixed(1)} nm`;
}

// Format relative time
function formatTimeAgo(dateString) {
  if (!dateString) return null;

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Format coordinates for display
function formatCoords(lat, lon) {
  if (lat === null || lon === null) return '';
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(3)}°${latDir}, ${Math.abs(lon).toFixed(3)}°${lonDir}`;
}

// Get type badge class
function getTypeBadgeClass(type) {
  if (!type) return '';
  const lower = type.toLowerCase();
  if (lower.includes('sail')) return 'sailing';
  if (lower.includes('pleasure')) return 'pleasure';
  return '';
}

// Render vessel card for Around Us
function renderVesselCard(vessel) {
  const typeClass = getTypeBadgeClass(vessel.ship_type);
  const heartClass = vessel.is_friend ? 'is-friend' : '';
  const heartIcon = vessel.is_friend ? '❤️' : '🤍';

  return `
    <div class="vessel-card" data-mmsi="${vessel.mmsi}">
      <div class="vessel-info">
        <div class="vessel-name">${vessel.name || 'Unknown'}</div>
        <div class="vessel-meta">
          ${vessel.ship_type ? `<span class="vessel-type-badge ${typeClass}">${vessel.ship_type}</span>` : ''}
          ${vessel.navigation_state ? `<span style="margin-left: 4px;">${vessel.navigation_state}</span>` : ''}
        </div>
      </div>
      <div class="vessel-distance">${formatDistance(vessel.distance_nm)}</div>
      <button class="heart-btn ${heartClass}"
              onclick="toggleFriend('${vessel.mmsi}', '${(vessel.name || '').replace(/'/g, "\\'")}', '${vessel.ship_type || ''}', ${vessel.is_friend})">
        ${heartIcon}
      </button>
    </div>
  `;
}

// Render friend card
function renderFriendCard(friend) {
  const nearbyBadge = friend.is_nearby
    ? `<span class="vessel-type-badge nearby">Nearby</span>`
    : '';

  let positionInfo;
  if (friend.is_nearby) {
    positionInfo = `${formatDistance(friend.distance_nm)} away`;
  } else if (friend.last_seen_at) {
    const timeAgo = formatTimeAgo(friend.last_seen_at);
    const coords = formatCoords(friend.last_latitude, friend.last_longitude);
    positionInfo = `Last seen ${timeAgo}${coords ? ` at ${coords}` : ''}`;
  } else {
    positionInfo = 'Never seen nearby';
  }

  return `
    <div class="vessel-card" data-mmsi="${friend.mmsi}">
      <div class="vessel-info">
        <div class="vessel-name">${friend.name}</div>
        <div class="vessel-meta">
          ${nearbyBadge}
          ${friend.ship_type ? `<span class="vessel-type-badge ${getTypeBadgeClass(friend.ship_type)}">${friend.ship_type}</span>` : ''}
        </div>
        <div class="vessel-meta" style="margin-top: 4px;">
          ${positionInfo}
        </div>
      </div>
      <button class="heart-btn is-friend" onclick="removeFriend('${friend.mmsi}')">
        ❤️
      </button>
    </div>
  `;
}

// Load Around Us data
async function loadAroundUs() {
  const container = document.getElementById('aroundUsList');
  const statusBar = document.getElementById('statusBar');

  try {
    container.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading vessels...</div></div>';

    const data = await apiCall('/admin/api/ais/around-us');

    if (!data.ourPosition) {
      statusBar.innerHTML = '<strong>GPS:</strong> Not available';
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📍</div>
          <div class="empty-state-title">GPS Position Not Available</div>
          <div>Cannot calculate distances without GPS position</div>
        </div>
      `;
      return;
    }

    statusBar.innerHTML = `<strong>Your Position:</strong> ${data.ourPosition.latitude.toFixed(5)}°, ${data.ourPosition.longitude.toFixed(5)}° | <strong>Vessels:</strong> ${data.count}`;

    if (data.vessels.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🚢</div>
          <div class="empty-state-title">No Vessels Nearby</div>
          <div>No AIS vessels detected in your area</div>
        </div>
      `;
      return;
    }

    container.innerHTML = data.vessels.map(renderVesselCard).join('');

  } catch (error) {
    console.error('Error loading around us:', error);
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <div class="empty-state-title">Error Loading Data</div>
        <div>${error.message}</div>
      </div>
    `;
  }
}

// Load Friends data
async function loadFriends() {
  const container = document.getElementById('friendsList');

  try {
    container.innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading friends...</div></div>';

    const data = await apiCall('/admin/api/ais/friends');

    if (data.friends.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">❤️</div>
          <div class="empty-state-title">No Friends Yet</div>
          <div>Heart vessels in "Around Us" or add manually above</div>
        </div>
      `;
      return;
    }

    container.innerHTML = data.friends.map(renderFriendCard).join('');

  } catch (error) {
    console.error('Error loading friends:', error);
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <div class="empty-state-title">Error Loading Friends</div>
        <div>${error.message}</div>
      </div>
    `;
  }
}

// Toggle friend status (heart/unheart)
async function toggleFriend(mmsi, name, shipType, isFriend) {
  try {
    if (isFriend) {
      await apiCall(`/admin/api/ais/friends/${mmsi}`, { method: 'DELETE' });
      showToast(`${name} removed from friends`, 'success');
    } else {
      await apiCall('/admin/api/ais/friends', {
        method: 'POST',
        body: JSON.stringify({ mmsi, name, ship_type: shipType || null })
      });
      showToast(`${name} added to friends!`, 'success');
    }

    // Refresh the current view
    loadAroundUs();

  } catch (error) {
    showToast(error.message, 'error');
  }
}

// Remove friend
async function removeFriend(mmsi) {
  try {
    await apiCall(`/admin/api/ais/friends/${mmsi}`, { method: 'DELETE' });
    showToast('Friend removed', 'success');
    loadFriends();
    // Also refresh around us in case user switches tabs
    loadAroundUs();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// Add friend manually
async function addFriendManually() {
  const mmsiInput = document.getElementById('friendMmsi');
  const nameInput = document.getElementById('friendName');

  const mmsi = mmsiInput.value.trim();
  const name = nameInput.value.trim();

  if (!mmsi || !name) {
    showToast('Please enter both MMSI and name', 'error');
    return;
  }

  try {
    await apiCall('/admin/api/ais/friends', {
      method: 'POST',
      body: JSON.stringify({ mmsi, name, ship_type: null })
    });

    showToast(`${name} added to friends!`, 'success');

    // Clear inputs
    mmsiInput.value = '';
    nameInput.value = '';

    // Refresh friends list
    loadFriends();

  } catch (error) {
    showToast(error.message, 'error');
  }
}

// Tab switching
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;

      // Update active states
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`${tab}-content`).classList.add('active');

      // Load data for the tab
      if (tab === 'around-us') {
        loadAroundUs();
      } else if (tab === 'friends') {
        loadFriends();
      }
    });
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();

  // Add friend button
  document.getElementById('addFriendBtn').addEventListener('click', addFriendManually);

  // Enter key to add friend
  document.getElementById('friendName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addFriendManually();
  });

  // Load initial data
  loadAroundUs();
});

// Expose functions globally for onclick handlers
window.toggleFriend = toggleFriend;
window.removeFriend = removeFriend;
