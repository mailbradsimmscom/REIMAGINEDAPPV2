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

// ============================================================================
// Ingest Timing Visualization
// ============================================================================

const STEP_LABELS = {
  upload: 'Upload',
  parse: 'Parse',
  detect: 'Detect',
  document: 'Document',
  vision: 'Vision',
  indexing: 'Indexing',
  dip_specs: 'DIP Specs',
  dip_troubleshooting: 'DIP Troubleshooting',
  dip_procedures: 'DIP Procedures',
  dip_golden_rules: 'DIP Golden Rules',
  dip_intent_router: 'DIP Intent Router'
};

// Map step names to CSS segment classes
function getSegmentClass(stepName) {
  if (stepName.startsWith('dip_')) return 'seg-dip';
  return `seg-${stepName}`;
}

// Map step names to dot colors for the detail rows
const STEP_COLORS = {
  upload: '#4a90d9',
  parse: '#38ef7d',
  detect: '#a8edea',
  document: '#764ba2',
  vision: '#4facfe',
  indexing: '#f5a623',
  dip_specs: '#fa709a',
  dip_troubleshooting: '#fa709a',
  dip_procedures: '#fa709a',
  dip_golden_rules: '#fa709a',
  dip_intent_router: '#fa709a'
};

function formatDurationMs(ms) {
  if (ms == null) return '--';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${mins}m ${secs}s`;
}

function renderTimingLegend() {
  const items = [
    { label: 'Upload', cls: 'seg-upload' },
    { label: 'Parse', cls: 'seg-parse' },
    { label: 'Document', cls: 'seg-document' },
    { label: 'Vision', cls: 'seg-vision' },
    { label: 'Indexing', cls: 'seg-indexing' },
    { label: 'DIP', cls: 'seg-dip' }
  ];
  return `
    <div class="timing-legend">
      ${items.map(i => `
        <div class="timing-legend-item">
          <div class="timing-legend-dot timing-seg ${i.cls}" style="width:8px;height:8px;border-radius:50%;"></div>
          ${i.label}
        </div>
      `).join('')}
    </div>
  `;
}

function renderTimingBar(steps, totalMs) {
  if (!totalMs || totalMs === 0) return '';
  return `
    <div class="timing-stacked-bar">
      ${steps.map(s => {
        const pct = totalMs > 0 ? ((s.duration_ms || 0) / totalMs * 100) : 0;
        if (pct < 0.5) return '';
        return `<div class="timing-seg ${getSegmentClass(s.step_name)}" style="flex:${s.duration_ms || 0}" title="${STEP_LABELS[s.step_name] || s.step_name}: ${formatDurationMs(s.duration_ms)}"></div>`;
      }).join('')}
    </div>
  `;
}

// Keys to skip in metadata display (noise or redundant)
const META_SKIP = new Set(['doc_id', 'manifest_path', 'processing_time']);

function formatMetaVal(val) {
  if (val === true) return 'yes';
  if (val === false) return 'no';
  if (val === null || val === undefined) return '--';
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return val.toLocaleString();
    return val.toFixed(1);
  }
  if (Array.isArray(val)) return val.length === 0 ? 'none' : val.join(', ');
  return String(val);
}

function renderMetaBlock(meta) {
  if (!meta || typeof meta !== 'object' || Object.keys(meta).length === 0) return '';

  let html = '<div class="timing-step-meta">';

  for (const [key, val] of Object.entries(meta)) {
    if (META_SKIP.has(key)) continue;

    if (val && typeof val === 'object' && !Array.isArray(val)) {
      // Nested object → section header + items
      const label = key.replace(/_/g, ' ');
      html += `<div class="timing-meta-section">${label}</div>`;
      for (const [k2, v2] of Object.entries(val)) {
        if (META_SKIP.has(k2)) continue;
        if (v2 && typeof v2 === 'object' && !Array.isArray(v2)) continue; // skip 2+ deep
        const label2 = k2.replace(/_/g, ' ');
        html += `<div class="timing-meta-item"><span class="timing-meta-key">${label2}</span><span class="timing-meta-val">${formatMetaVal(v2)}</span></div>`;
      }
    } else {
      const label = key.replace(/_/g, ' ');
      html += `<div class="timing-meta-item"><span class="timing-meta-key">${label}</span><span class="timing-meta-val">${formatMetaVal(val)}</span></div>`;
    }
  }

  html += '</div>';
  return html;
}

function renderStepRow(s, extraClass) {
  const cls = extraClass ? ` ${extraClass}` : '';
  return `
    <div class="timing-step-row${cls}">
      <div class="timing-step-dot" style="background:${STEP_COLORS[s.step_name] || '#888'}"></div>
      <div class="timing-step-name">${STEP_LABELS[s.step_name] || s.step_name}</div>
      <div class="timing-step-duration">${formatDurationMs(s.duration_ms)}</div>
      <span class="timing-step-status ${s.status || 'complete'}">${s.status || 'complete'}</span>
    </div>
    ${renderMetaBlock(s.metadata)}
  `;
}

function renderTimingStepRows(steps, runId) {
  if (!steps || !Array.isArray(steps)) return '';
  const mainSteps = steps.filter(s => !s.step_name.startsWith('dip_'));
  const dipSteps = steps.filter(s => s.step_name.startsWith('dip_'));

  // Calculate wall clock time for parallel DIP modes (max end - min start)
  let dipTotalMs = 0;
  if (dipSteps.length > 0) {
    const startTimes = dipSteps.map(s => s.started_at ? new Date(s.started_at).getTime() : Infinity);
    const endTimes = dipSteps.map(s => s.ended_at ? new Date(s.ended_at).getTime() : 0);
    const minStart = Math.min(...startTimes);
    const maxEnd = Math.max(...endTimes);
    if (minStart !== Infinity && maxEnd !== 0) {
      dipTotalMs = maxEnd - minStart;
    }
  }

  let html = '';

  // Render main steps
  for (const s of mainSteps) {
    html += renderStepRow(s, '');
  }

  // Render DIP parent + sub-steps
  if (dipSteps.length > 0) {
    html += `
      <div class="timing-step-row dip-parent">
        <div class="timing-step-dot" style="background:${STEP_COLORS.dip_specs}"></div>
        <div class="timing-step-name">DIP Extraction (${dipSteps.length} modes)</div>
        <div class="timing-step-duration">${formatDurationMs(dipTotalMs)}</div>
        <span class="timing-step-status complete">${dipSteps.every(s => s.status === 'complete') ? 'complete' : 'partial'}</span>
      </div>
    `;
    for (const s of dipSteps) {
      html += renderStepRow(s, 'timing-dip-sub');
    }
  }

  return `<div class="timing-run-detail" id="timing-detail-${runId}">${html}</div>`;
}

function renderTimingRun(run, index) {
  const date = new Date(run.created_at);
  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const docShort = run.system_name || (run.doc_id ? run.doc_id.substring(0, 12) + '...' : 'unknown');
  const safeId = `run-${index}`;
  // First run expanded, rest collapsed
  const collapsed = index > 0;

  return `
    <div class="timing-run${collapsed ? ' is-collapsed' : ''}">
      <div class="timing-run-header" onclick="toggleTimingDetail('timing-body-${safeId}')">
        <div class="timing-run-left">
          <div class="timing-run-date">${dateStr} ${timeStr}</div>
          <div class="timing-run-doc" title="${run.system_name || run.doc_id}">${docShort}</div>
        </div>
        <div class="timing-run-right">
          <span class="timing-run-steps-count">${run.step_count} steps</span>
          <span class="timing-run-total">${formatDurationMs(run.total_duration_ms)}</span>
          <span class="timing-run-chevron">▼</span>
        </div>
      </div>
      <div class="timing-run-body${collapsed ? ' collapsed' : ''}" id="timing-body-${safeId}">
        ${renderTimingBar(run.steps, run.total_duration_ms)}
        ${renderTimingStepRows(run.steps, safeId)}
      </div>
    </div>
  `;
}

function renderIngestTiming(runs) {
  if (!runs || runs.length === 0) {
    return `
      <div class="timing-section">
        <h3>Ingest Timing History</h3>
        <div class="timing-empty">No ingest timing data yet. Run an ingest through the v2 page to populate.</div>
      </div>
    `;
  }

  return `
    <div class="timing-section">
      <h3>Ingest Timing History (${runs.length} run${runs.length !== 1 ? 's' : ''})</h3>
      ${renderTimingLegend()}
      ${runs.map((run, i) => renderTimingRun(run, i)).join('')}
    </div>
  `;
}

function toggleTimingDetail(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('collapsed');
  // Toggle chevron rotation on parent .timing-run
  const run = el.closest('.timing-run');
  if (run) run.classList.toggle('is-collapsed');
}

async function loadIngestTiming() {
  const container = document.getElementById('timingContainer');
  if (!container) return;

  try {
    const response = await fetch('/api/funnel/stats/ingest-timing');
    const result = await response.json();

    if (!result.success) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = renderIngestTiming(result.data.runs);
  } catch (_) {
    // Non-critical — silently skip if timing fetch fails
    container.innerHTML = '';
  }
}

// Make functions available globally
window.toggleBreakdown = toggleBreakdown;
window.toggleTimingDetail = toggleTimingDetail;

// Load on page ready — funnel + timing in parallel
document.addEventListener('DOMContentLoaded', () => {
  loadFunnel();
  loadIngestTiming();
});
