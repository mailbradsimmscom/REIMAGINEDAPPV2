// Playbooks Admin UI JavaScript
// Handles CRUD operations for playbooks and generation

let currentPlaybooks = [];
let currentPlaybook = null;

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Playbooks page loaded, starting initialization...');
    loadStats();
    loadPlaybooks();
    setupEventHandlers();
});

// Load statistics
async function loadStats() {
    try {
        const response = await fetch('/admin/api/playbooks/stats', {
            headers: {
                'x-admin-token': getAdminToken()
            }
        });
        if (!response.ok) throw new Error('Failed to load stats');
        
        const result = await response.json();
        if (result.success) {
            const stats = result.data;
            document.getElementById('totalPlaybooks').textContent = stats.totalPlaybooks;
            document.getElementById('totalSteps').textContent = stats.totalSteps;
            document.getElementById('systemCount').textContent = Object.keys(stats.bySystem).length;
            
            // Populate system filter dropdown
            const systemSelect = document.getElementById('systemFilterSelect');
            systemSelect.innerHTML = '<option value="">All Systems</option>';
            Object.keys(stats.bySystem).forEach(system => {
                const option = document.createElement('option');
                option.value = system;
                option.textContent = `${system} (${stats.bySystem[system]})`;
                systemSelect.appendChild(option);
            });
            
            // Populate subsystem filter dropdown
            const subsystemSelect = document.getElementById('subsystemFilterSelect');
            subsystemSelect.innerHTML = '<option value="">All Subsystems</option>';
            Object.keys(stats.bySubsystem).forEach(subsystem => {
                const option = document.createElement('option');
                option.value = subsystem;
                option.textContent = `${subsystem} (${stats.bySubsystem[subsystem]})`;
                subsystemSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load all playbooks
async function loadPlaybooks() {
    try {
        console.log('📡 Loading playbooks from API...');
        const token = getAdminToken();
        console.log('🔑 Admin token:', token ? 'Present' : 'Missing');
        
        const response = await fetch('/admin/api/playbooks', {
            headers: {
                'x-admin-token': token
            }
        });
        
        console.log('📊 API Response status:', response.status);
        if (!response.ok) throw new Error('Failed to load playbooks');
        
        const result = await response.json();
        if (result.success) {
            currentPlaybooks = result.data;
            renderPlaybooksTable();
        } else {
            showError('Failed to load playbooks: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error loading playbooks:', error);
        showError('Error loading playbooks: ' + error.message);
    }
}

// Render playbooks table
function renderPlaybooksTable(playbooks = currentPlaybooks) {
    const tbody = document.getElementById('playbooksTableBody');
    
    if (!playbooks || playbooks.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="empty-state">
                    <div class="empty-state-icon">📋</div>
                    <div>No playbooks found</div>
                    <div style="margin-top: 10px; font-size: 0.9rem; color: #999;">
                        Try generating playbooks from approved hints or adjust your filters
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = playbooks.map(playbook => `
        <tr>
            <td>
                <code>${escapeHtml(playbook.id || 'N/A')}</code>
            </td>
            <td>
                <code>${escapeHtml(playbook.doc_id || 'N/A')}</code>
            </td>
            <td>
                <strong>${escapeHtml(playbook.test_name || 'N/A')}</strong>
            </td>
            <td>
                <span class="type-badge">${escapeHtml(playbook.test_type || 'N/A')}</span>
            </td>
            <td>
                <div class="description">${escapeHtml(playbook.description || 'N/A')}</div>
            </td>
            <td>
                <span class="steps-count">${Array.isArray(playbook.steps) ? playbook.steps.length : 0} steps</span>
            </td>
            <td>
                <div class="expected-result">${escapeHtml(playbook.expected_result || 'N/A')}</div>
            </td>
            <td>
                <span class="page-number">${playbook.page || 'N/A'}</span>
            </td>
            <td>
                <span class="confidence-score">${playbook.confidence ? (playbook.confidence * 100).toFixed(1) + '%' : 'N/A'}</span>
            </td>
            <td>${formatDate(playbook.created_at)}</td>
            <td class="actions-cell">
                <button class="action-btn view-btn" onclick="viewPlaybook('${playbook.id}')">
                    View
                </button>
            </td>
        </tr>
    `).join('');
}

// Apply filters
function applyFilters() {
    const titleFilter = document.getElementById('titleFilter').value.toLowerCase();
    const systemFilter = document.getElementById('systemFilterSelect').value;
    const subsystemFilter = document.getElementById('subsystemFilterSelect').value;
    
    let filteredPlaybooks = currentPlaybooks;
    
    if (titleFilter) {
        filteredPlaybooks = filteredPlaybooks.filter(playbook => 
            playbook.title.toLowerCase().includes(titleFilter)
        );
    }
    
    if (systemFilter) {
        filteredPlaybooks = filteredPlaybooks.filter(playbook => 
            playbook.system_norm === systemFilter
        );
    }
    
    if (subsystemFilter) {
        filteredPlaybooks = filteredPlaybooks.filter(playbook => 
            playbook.subsystem_norm === subsystemFilter
        );
    }
    
    renderPlaybooksTable(filteredPlaybooks);
}

// View playbook details
async function viewPlaybook(playbookId) {
    try {
        const response = await fetch(`/admin/api/playbooks/${playbookId}`);
        if (!response.ok) throw new Error('Failed to load playbook');
        
        const result = await response.json();
        if (result.success) {
            currentPlaybook = result.data;
            showPlaybookDetails(result.data);
        } else {
            showError('Failed to load playbook: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error loading playbook:', error);
        showError('Error loading playbook: ' + error.message);
    }
}

// Show playbook details in modal
function showPlaybookDetails(playbook) {
    const modal = document.getElementById('playbookModal');
    const title = document.getElementById('modalTitle');
    const details = document.getElementById('playbookDetails');
    
    title.textContent = playbook.title;
    
    details.innerHTML = `
        <div class="playbook-info">
            <h3>${escapeHtml(playbook.title)}</h3>
            <div class="playbook-meta">
                <div><strong>System:</strong> ${escapeHtml(playbook.system_norm || 'Unknown')}</div>
                <div><strong>Subsystem:</strong> ${escapeHtml(playbook.subsystem_norm || 'General')}</div>
                <div><strong>Created By:</strong> ${escapeHtml(playbook.created_by)}</div>
                <div><strong>Created At:</strong> ${formatDate(playbook.created_at)}</div>
                <div><strong>Updated At:</strong> ${formatDate(playbook.updated_at)}</div>
                <div><strong>Document ID:</strong> ${escapeHtml(playbook.doc_id || 'N/A')}</div>
            </div>
        </div>
        
        <div class="steps-section">
            <h4>Steps (${playbook.playbook_steps?.length || 0})</h4>
            ${playbook.playbook_steps?.map(step => `
                <div class="step-item">
                    <div class="step-number">${step.step_number}</div>
                    <div class="step-content">
                        <div class="step-instruction">${escapeHtml(step.instruction)}</div>
                        <div class="step-meta">
                            Source Hint ID: ${step.source_hint_id || 'N/A'} | 
                            Document ID: ${step.doc_id || 'N/A'}
                        </div>
                    </div>
                </div>
            `).join('') || '<p>No steps found.</p>'}
        </div>
    `;
    
    modal.style.display = 'block';
}

// Edit playbook
function editPlaybook(playbookId) {
    // TODO: Implement edit functionality
    showError('Edit functionality not yet implemented');
}

// Delete playbook
async function deletePlaybook(playbookId) {
    if (!confirm('Are you sure you want to delete this playbook? This action cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/api/playbooks/${playbookId}`, {
            method: 'DELETE',
            headers: {
                'x-admin-token': getAdminToken()
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('Playbook deleted successfully!');
            loadPlaybooks();
            loadStats();
        } else {
            showError('Failed to delete playbook: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error deleting playbook:', error);
        showError('Error deleting playbook: ' + error.message);
    }
}

// Open generation modal
function openGenerationModal() {
    document.getElementById('generationModal').style.display = 'block';
    clearModalMessages('generationMessages');
}

// Close generation modal
function closeGenerationModal() {
    document.getElementById('generationModal').style.display = 'none';
}

// Close playbook modal
function closePlaybookModal() {
    document.getElementById('playbookModal').style.display = 'none';
    currentPlaybook = null;
}

// Generate playbooks with options
async function generatePlaybooksWithOptions() {
    const system = document.getElementById('systemFilter').value.trim();
    const subsystem = document.getElementById('subsystemFilter').value.trim();
    const docId = document.getElementById('docIdFilter').value.trim();
    
    await executeGeneration(system, subsystem, docId);
}

// Dry run generation
async function dryRunGeneration() {
    const system = document.getElementById('systemFilter').value.trim();
    const subsystem = document.getElementById('subsystemFilter').value.trim();
    const docId = document.getElementById('docIdFilter').value.trim();
    
    await executeDryRun(system, subsystem, docId);
}

// Generation functions removed - playbook_hints is now final destination

// Dry run function removed - playbook generation disabled

// Setup event handlers
function setupEventHandlers() {
    // Close modals when clicking outside
    document.getElementById('playbookModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closePlaybookModal();
        }
    });
    
    document.getElementById('generationModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeGenerationModal();
        }
    });
}

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString() + ' ' + 
           new Date(dateString).toLocaleTimeString();
}

function getAdminToken() {
    // Get admin token from localStorage or prompt
    let token = localStorage.getItem('adminToken');
    if (!token) {
        token = prompt('Enter admin token:');
        if (token) {
            localStorage.setItem('adminToken', token);
        }
    }
    return token;
}

function showError(message) {
    // Create or update error message in the page
    let errorDiv = document.getElementById('errorMessage');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.id = 'errorMessage';
        errorDiv.className = 'error-message';
        errorDiv.style.position = 'fixed';
        errorDiv.style.top = '20px';
        errorDiv.style.right = '20px';
        errorDiv.style.zIndex = '1001';
        errorDiv.style.maxWidth = '400px';
        document.body.appendChild(errorDiv);
    }
    
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

function showSuccess(message) {
    // Create or update success message in the page
    let successDiv = document.getElementById('successMessage');
    if (!successDiv) {
        successDiv = document.createElement('div');
        successDiv.id = 'successMessage';
        successDiv.className = 'success-message';
        successDiv.style.position = 'fixed';
        successDiv.style.top = '20px';
        successDiv.style.right = '20px';
        successDiv.style.zIndex = '1001';
        successDiv.style.maxWidth = '400px';
        document.body.appendChild(successDiv);
    }
    
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    
    setTimeout(() => {
        successDiv.style.display = 'none';
    }, 3000);
}

function showModalError(containerId, message) {
    const container = document.getElementById(containerId);
    container.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
}

function showModalSuccess(containerId, message) {
    const container = document.getElementById(containerId);
    container.innerHTML = `<div class="success-message">${escapeHtml(message)}</div>`;
}

function clearModalMessages(containerId) {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = '';
    }
}
