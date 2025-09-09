// /js/admin/sections/systems.js
// Loads system data into the systems.html table
// Independent module - initializes itself when DOM is ready

export function init() {
  // This function is called by the boot system
  initializeSystemsSection();
}

function initializeSystemsSection() {
  const tableBody = document.getElementById('systems-table-body');

  if (!tableBody) {
    console.warn('systems.js: #systems-table-body not found - section may not be loaded yet');
    return;
  }

  loadSystems();
}

async function loadSystems() {
  const tableBody = document.getElementById('systems-table-body');
  if (!tableBody) return;

  try {
    const res = await window.adminFetch('/admin/api/systems');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.success || !Array.isArray(data.data)) {
      throw new Error('Invalid systems response');
    }

    tableBody.innerHTML = data.data.map(system => {
      const uid = escapeHtml(system.uid || '');
      const name = escapeHtml(system.name || '');
      const subsystem = escapeHtml(system.subsystem_normalized || '');
      return `<tr><td>${uid}</td><td>${name}</td><td>${subsystem}</td></tr>`;
    }).join('');
  } catch (err) {
    console.error('Failed to load systems:', err);
    tableBody.innerHTML = `<tr><td colspan="3">⚠️ Failed to load systems</td></tr>`;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Auto-initialize if this script is loaded directly (for development)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeSystemsSection);
} else {
  initializeSystemsSection();
}