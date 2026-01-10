/**
 * Funnel Visualization
 * Displays pipeline statistics as a visual funnel with branching
 */

// Stage color mapping
const stageColors = {
  systems: 'systems',
  systems_with_manual: 'systems',
  documents: 'documents',
  documents_storage: 'documents',
  ingest_jobs: 'processing',
  pinecone_vectors: 'vectors',
  dip_extractions: 'extraction',
  dip_production: 'extraction',
  maint_systems_searched: 'maintenance',
  maint_systems_with_tasks: 'maintenance',
  maint_tasks_extracted: 'maintenance',
  maint_tasks_approved: 'maintenance',
  live_tasks: 'maintenance'
};

/**
 * Format large numbers with commas
 */
function formatNumber(num) {
  return num.toLocaleString();
}

/**
 * Render a single funnel stage
 */
function renderStage(stage, index, total, inBranch = false) {
  const colorClass = inBranch ? '' : (stageColors[stage.id] || '');
  const hasBreakdown = stage.breakdown && Object.keys(stage.breakdown).length > 0;
  const hasDipDetails = stage.dipDetails != null;
  const hasMaintenanceDetails = stage.maintenanceDetails != null;
  const hasLiveTaskDetails = stage.liveTaskDetails != null;
  const breakdownId = `breakdown-${stage.id}`;

  // Determine warning state
  let warningClass = '';
  if (stage.count === 0 && !stage.id.startsWith('maint_')) {
    warningClass = 'warning';
  }

  // Build breakdown content
  let breakdownContent = '';
  if (hasBreakdown || hasDipDetails || hasMaintenanceDetails || hasLiveTaskDetails) {
    breakdownContent = `
      <div class="stage-breakdown" id="${breakdownId}">
        ${hasBreakdown ? renderBreakdown(stage.breakdown) : ''}
        ${hasDipDetails ? renderDipDetails(stage.dipDetails) : ''}
        ${hasMaintenanceDetails ? renderMaintenanceDetails(stage.maintenanceDetails) : ''}
        ${hasLiveTaskDetails ? renderLiveTaskDetails(stage.liveTaskDetails) : ''}
      </div>
    `;
  }

  const stageHtml = `
    <div class="funnel-stage">
      <div class="stage-bar ${colorClass} ${warningClass}" onclick="toggleBreakdown('${breakdownId}')">
        <div class="stage-left">
          <div class="stage-icon">${stage.icon}</div>
          <div class="stage-info">
            <h3>${stage.label}</h3>
            <div class="description">${stage.description}</div>
          </div>
        </div>
        <div class="stage-right">
          <div class="stage-count">${formatNumber(stage.count)}</div>
          ${stage.percentage !== undefined ? `<div class="stage-percentage">${stage.percentage}% of previous</div>` : ''}
        </div>
      </div>
      ${breakdownContent}
      ${index < total - 1 ? '<div class="stage-connector"></div>' : ''}
    </div>
  `;

  return stageHtml;
}

/**
 * Render breakdown items
 */
function renderBreakdown(breakdown) {
  // Check if breakdown contains nested objects
  const hasNestedObjects = Object.values(breakdown).some(v => typeof v === 'object');

  if (hasNestedObjects) {
    return Object.entries(breakdown).map(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        return `
          <div class="breakdown-section">
            <div class="breakdown-key" style="margin-bottom: 4px; font-weight: 600;">${key}</div>
            ${Object.entries(value).map(([k, v]) => `
              <div class="breakdown-item" style="padding-left: 12px;">
                <span class="breakdown-key">${k}</span>
                <span class="breakdown-value">${formatNumber(v)}</span>
              </div>
            `).join('')}
          </div>
        `;
      }
      return `
        <div class="breakdown-item">
          <span class="breakdown-key">${key}</span>
          <span class="breakdown-value">${formatNumber(value)}</span>
        </div>
      `;
    }).join('');
  }

  return Object.entries(breakdown).map(([key, value]) => `
    <div class="breakdown-item">
      <span class="breakdown-key">${key}</span>
      <span class="breakdown-value">${formatNumber(value)}</span>
    </div>
  `).join('');
}

/**
 * Render DIP details subsection
 */
function renderDipDetails(dipDetails) {
  const { systems, byTable } = dipDetails;

  return `
    <div class="dip-details">
      <div class="dip-section">
        <div class="dip-section-title">Systems Review Status</div>
        <div class="dip-grid">
          <div class="dip-stat">
            <span class="dip-stat-value">${systems.fullyApproved}</span>
            <span class="dip-stat-label">Fully Approved</span>
          </div>
          <div class="dip-stat">
            <span class="dip-stat-value">${systems.partiallyReviewed}</span>
            <span class="dip-stat-label">Partially Reviewed</span>
          </div>
          <div class="dip-stat">
            <span class="dip-stat-value">${systems.allPending}</span>
            <span class="dip-stat-label">All Pending</span>
          </div>
        </div>
      </div>
      <div class="dip-section">
        <div class="dip-section-title">By Extraction Type</div>
        <table class="dip-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Pending</th>
              <th>Approved</th>
              <th>Declined</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(byTable).map(([type, counts]) => `
              <tr>
                <td>${type}</td>
                <td>${formatNumber(counts.pending)}</td>
                <td>${formatNumber(counts.approved)}</td>
                <td>${formatNumber(counts.declined)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Render Maintenance details subsection
 */
function renderMaintenanceDetails(maintDetails) {
  const { bySystem, byCategory, byFrequencyBasis } = maintDetails;

  return `
    <div class="maint-details">
      ${Object.keys(bySystem).length > 0 ? `
        <div class="maint-section">
          <div class="maint-section-title">By System</div>
          <div class="maint-list">
            ${Object.entries(bySystem)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([name, count]) => `
                <div class="maint-list-item">
                  <span class="maint-list-key" title="${name}">${name}</span>
                  <span class="maint-list-value">${count}</span>
                </div>
              `).join('')}
          </div>
        </div>
      ` : ''}
      ${Object.keys(byCategory).length > 0 ? `
        <div class="maint-section">
          <div class="maint-section-title">By Category</div>
          <div class="maint-list">
            ${Object.entries(byCategory).map(([cat, count]) => `
              <div class="maint-list-item">
                <span class="maint-list-key">${cat}</span>
                <span class="maint-list-value">${count}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      ${Object.keys(byFrequencyBasis).length > 0 ? `
        <div class="maint-section">
          <div class="maint-section-title">By Frequency</div>
          <div class="maint-list">
            ${Object.entries(byFrequencyBasis).map(([basis, count]) => `
              <div class="maint-list-item">
                <span class="maint-list-key">${basis}</span>
                <span class="maint-list-value">${count}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Render Live Tasks details subsection
 */
function renderLiveTaskDetails(liveDetails) {
  const { boatosTasks, userTasks, completions } = liveDetails;

  return `
    <div class="maint-details">
      <div class="maint-section">
        <div class="maint-section-title">BoatOS Tasks (System-Extracted)</div>
        <div class="maint-list">
          <div class="maint-list-item">
            <span class="maint-list-key">Total</span>
            <span class="maint-list-value">${boatosTasks.total}</span>
          </div>
          <div class="maint-list-item">
            <span class="maint-list-key">Active</span>
            <span class="maint-list-value">${boatosTasks.active}</span>
          </div>
          ${Object.entries(boatosTasks.byType || {}).map(([type, count]) => `
            <div class="maint-list-item">
              <span class="maint-list-key" style="padding-left: 8px;">• ${type}</span>
              <span class="maint-list-value">${count}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="maint-section">
        <div class="maint-section-title">User Tasks (Manually Created)</div>
        <div class="maint-list">
          <div class="maint-list-item">
            <span class="maint-list-key">Total</span>
            <span class="maint-list-value">${userTasks.total}</span>
          </div>
          <div class="maint-list-item">
            <span class="maint-list-key">Active</span>
            <span class="maint-list-value">${userTasks.active}</span>
          </div>
          <div class="maint-list-item">
            <span class="maint-list-key">Recurring</span>
            <span class="maint-list-value">${userTasks.recurring}</span>
          </div>
          ${Object.entries(userTasks.byPriority || {}).map(([priority, count]) => `
            <div class="maint-list-item">
              <span class="maint-list-key" style="padding-left: 8px;">• ${priority}</span>
              <span class="maint-list-value">${count}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="maint-section">
        <div class="maint-section-title">Completions Recorded</div>
        <div class="maint-list">
          <div class="maint-list-item">
            <span class="maint-list-key">Total</span>
            <span class="maint-list-value">${completions}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Toggle breakdown visibility
 */
function toggleBreakdown(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.toggle('visible');
  }
}

/**
 * Render summary cards at the top
 */
function renderSummaryCards(data) {
  const shared = data.shared || [];
  const maintenance = data.branches?.maintenance?.stages || [];

  const systems = shared.find(s => s.id === 'systems')?.count || 0;
  const docs = shared.find(s => s.id === 'documents')?.count || 0;
  const vectors = shared.find(s => s.id === 'pinecone_vectors')?.count || 0;
  const systemsWithManual = shared.find(s => s.id === 'systems_with_manual')?.count || 0;
  const tasksApproved = maintenance.find(s => s.id === 'maint_tasks_approved')?.count || 0;

  const coverage = systems > 0 ? Math.round((systemsWithManual / systems) * 100) : 0;
  const avgChunks = docs > 0 ? Math.round(vectors / docs) : 0;

  return `
    <div class="summary-card">
      <div class="value">${formatNumber(systems)}</div>
      <div class="label">Total Systems</div>
    </div>
    <div class="summary-card">
      <div class="value">${coverage}%</div>
      <div class="label">Doc Coverage</div>
    </div>
    <div class="summary-card">
      <div class="value">${formatNumber(docs)}</div>
      <div class="label">Documents</div>
    </div>
    <div class="summary-card">
      <div class="value">${formatNumber(tasksApproved)}</div>
      <div class="label">Tasks Approved</div>
    </div>
  `;
}

/**
 * Render a branch
 */
function renderBranch(branch, branchType) {
  const icon = branchType === 'dip' ? '📊' : '🛠️';

  return `
    <div class="branch ${branchType}">
      <div class="branch-header">
        <div class="branch-header-icon">${icon}</div>
        <div class="branch-header-info">
          <h3>${branch.label}</h3>
          <div class="description">${branch.description}</div>
        </div>
      </div>
      <div class="branch-stages">
        ${branch.stages.map((stage, index) =>
          renderStage(stage, index, branch.stages.length, true)
        ).join('')}
      </div>
    </div>
  `;
}

/**
 * Load and render funnel data
 */
async function loadFunnel() {
  const container = document.getElementById('funnelContent');
  const summaryContainer = document.getElementById('summaryCards');
  const issuesContainer = document.getElementById('issuesContainer');
  const timestampEl = document.getElementById('timestamp');

  container.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div>Loading pipeline statistics...</div>
    </div>
  `;
  issuesContainer.innerHTML = '';

  try {
    const response = await fetch('/api/funnel/stats');
    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Failed to load funnel data');
    }

    const data = result.data;
    const { shared, branches, issues, generated_at, processing_time_ms } = data;

    // Render summary cards
    summaryContainer.innerHTML = renderSummaryCards(data);

    // Render shared stages (before branch point)
    let html = '';

    if (shared && shared.length > 0) {
      html += shared.map((stage, index) =>
        renderStage(stage, index, shared.length)
      ).join('');
    }

    // Render branch point
    if (branches) {
      html += `
        <div class="branch-point">
          <div class="branch-point-label">Branches into two pipelines</div>
        </div>
        <div class="branches-container">
          ${branches.dip ? renderBranch(branches.dip, 'dip') : ''}
          ${branches.maintenance ? renderBranch(branches.maintenance, 'maintenance') : ''}
        </div>
      `;
    }

    container.innerHTML = html;

    // Render issues
    issuesContainer.innerHTML = renderIssues(issues);

    // Update timestamp
    const date = new Date(generated_at);
    timestampEl.textContent = `Generated: ${date.toLocaleString()} (${processing_time_ms}ms)`;

  } catch (error) {
    container.innerHTML = `
      <div class="error">
        <h3>Error Loading Data</h3>
        <p>${error.message}</p>
        <button onclick="loadFunnel()" style="margin-top: 16px; padding: 8px 16px;">Retry</button>
      </div>
    `;
  }
}

/**
 * Render data issues section
 */
function renderIssues(issues) {
  if (!issues || issues.length === 0) {
    return '';
  }

  const typeLabels = {
    'flag_no_doc': 'Flag but no doc',
    'doc_no_flag': 'Doc but no flag'
  };

  return `
    <div class="issues-section">
      <h3>Data Issues (${issues.length})</h3>
      ${issues.map(issue => `
        <div class="issue-item">
          <span class="issue-type ${issue.type}">${typeLabels[issue.type] || issue.type}</span>
          ${issue.message}
          <div class="issue-uid">${issue.asset_uid}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// Make toggleBreakdown available globally
window.toggleBreakdown = toggleBreakdown;

// Load on page ready
document.addEventListener('DOMContentLoaded', loadFunnel);
