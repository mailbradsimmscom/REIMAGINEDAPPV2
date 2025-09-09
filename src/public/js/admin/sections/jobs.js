// /js/admin/sections/jobs.js
// Loads job data into the jobs.html table
// Independent module - initializes itself when DOM is ready

export function init() {
  // This function is called by the boot system
  initializeJobsSection();
}

function initializeJobsSection() {
  const jobsTableBody = document.getElementById('jobs-table-body');

  if (!jobsTableBody) {
    console.warn('jobs.js: #jobs-table-body not found - section may not be loaded yet');
    return;
  }

  loadJobs();
}

async function loadJobs() {
  const jobsTableBody = document.getElementById('jobs-table-body');
  if (!jobsTableBody) return;

  try {
    const res = await window.adminFetch('/admin/api/jobs');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.success || !Array.isArray(data.data.jobs)) {
      throw new Error('Invalid jobs response');
    }

    jobsTableBody.innerHTML = data.data.jobs.map(job => {
      const jobId = escapeHtml(job.job_id || '');
      const status = escapeHtml(job.status || '');
      const docId = escapeHtml(job.doc_id || '');
      const createdAt = escapeHtml(job.created_at || '');
      const updatedAt = escapeHtml(job.updated_at || '');
      
      return `<tr>
        <td>${jobId}</td>
        <td><span class="status-${status}">${status}</span></td>
        <td>${docId}</td>
        <td>${createdAt}</td>
        <td>${updatedAt}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('Failed to load jobs:', err);
    jobsTableBody.innerHTML = `<tr><td colspan="5">⚠️ Failed to load jobs</td></tr>`;
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
  document.addEventListener('DOMContentLoaded', initializeJobsSection);
} else {
  initializeJobsSection();
}