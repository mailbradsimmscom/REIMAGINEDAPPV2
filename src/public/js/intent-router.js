// Intent Router Admin UI JavaScript
// Handles CRUD operations for intent routes

let currentRoutes = [];
let editingRouteId = null;

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    loadStats();
    loadRoutes();
    setupFormHandlers();
});

// Load statistics
async function loadStats() {
    try {
        const response = await fetch('/admin/intent-router/stats');
        if (!response.ok) throw new Error('Failed to load stats');
        
        const result = await response.json();
        if (result.success) {
            const stats = result.data;
            document.getElementById('totalRoutes').textContent = stats.total;
            document.getElementById('intentTypes').textContent = Object.keys(stats.byIntent).length;
            document.getElementById('systemRoutes').textContent = stats.byCreator.system || 0;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load all routes
async function loadRoutes() {
    try {
        const response = await fetch('/admin/intent-router');
        if (!response.ok) throw new Error('Failed to load routes');
        
        const result = await response.json();
        if (result.success) {
            currentRoutes = result.data;
            renderRoutesTable();
        } else {
            showError('Failed to load routes: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error loading routes:', error);
        showError('Error loading routes: ' + error.message);
    }
}

// Render routes table
function renderRoutesTable(routes = currentRoutes) {
    const tbody = document.getElementById('routesTableBody');
    
    if (!routes || routes.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <div class="empty-state-icon">🔍</div>
                    <div>No routes found</div>
                    <div style="margin-top: 10px; font-size: 0.9rem; color: #999;">
                        Try adjusting your filters or add a new route
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = routes.map(route => `
        <tr>
            <td>
                <span class="pattern-cell">${escapeHtml(route.pattern)}</span>
            </td>
            <td>
                <span class="intent-badge intent-${getIntentClass(route.intent)}">
                    ${escapeHtml(route.intent)}
                </span>
            </td>
            <td>
                <a href="${escapeHtml(route.route_to)}" class="route-link" target="_blank">
                    ${escapeHtml(route.route_to)}
                </a>
            </td>
            <td>${escapeHtml(route.created_by)}</td>
            <td>${formatDate(route.created_at)}</td>
            <td class="actions-cell">
                <button class="action-btn edit-btn" onclick="editRoute('${route.id}')">
                    Edit
                </button>
                <button class="action-btn delete-btn" onclick="deleteRoute('${route.id}')">
                    Delete
                </button>
            </td>
        </tr>
    `).join('');
}

// Get CSS class for intent type
function getIntentClass(intent) {
    if (intent.includes('maintenance')) return 'maintenance';
    if (intent.includes('pressure')) return 'pressure';
    if (intent.includes('flush')) return 'flush';
    return 'general';
}

// Apply filters
function applyFilters() {
    const patternFilter = document.getElementById('patternFilter').value.toLowerCase();
    const intentFilter = document.getElementById('intentFilter').value;
    
    let filteredRoutes = currentRoutes;
    
    if (patternFilter) {
        filteredRoutes = filteredRoutes.filter(route => 
            route.pattern.toLowerCase().includes(patternFilter)
        );
    }
    
    if (intentFilter) {
        filteredRoutes = filteredRoutes.filter(route => 
            route.intent === intentFilter
        );
    }
    
    renderRoutesTable(filteredRoutes);
}

// Open add route modal
function openAddRouteModal() {
    editingRouteId = null;
    document.getElementById('modalTitle').textContent = 'Add Intent Route';
    document.getElementById('submitBtn').textContent = 'Add Route';
    document.getElementById('routeForm').reset();
    clearModalMessages();
    document.getElementById('routeModal').style.display = 'block';
}

// Edit route
function editRoute(routeId) {
    const route = currentRoutes.find(r => r.id === routeId);
    if (!route) return;
    
    editingRouteId = routeId;
    document.getElementById('modalTitle').textContent = 'Edit Intent Route';
    document.getElementById('submitBtn').textContent = 'Update Route';
    
    // Populate form
    document.getElementById('patternInput').value = route.pattern;
    document.getElementById('intentInput').value = route.intent;
    document.getElementById('routeToInput').value = route.route_to;
    document.getElementById('intentHintIdInput').value = route.intent_hint_id || '';
    
    clearModalMessages();
    document.getElementById('routeModal').style.display = 'block';
}

// Close modal
function closeRouteModal() {
    document.getElementById('routeModal').style.display = 'none';
    editingRouteId = null;
}

// Setup form handlers
function setupFormHandlers() {
    document.getElementById('routeForm').addEventListener('submit', handleFormSubmit);
    
    // Close modal when clicking outside
    document.getElementById('routeModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeRouteModal();
        }
    });
}

// Handle form submission
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const formData = {
        pattern: document.getElementById('patternInput').value.trim(),
        intent: document.getElementById('intentInput').value,
        route_to: document.getElementById('routeToInput').value.trim(),
        intent_hint_id: document.getElementById('intentHintIdInput').value.trim() || null
    };
    
    // Validate required fields
    if (!formData.pattern || !formData.intent || !formData.route_to) {
        showModalError('Please fill in all required fields');
        return;
    }
    
    try {
        const url = editingRouteId 
            ? `/admin/intent-router/${editingRouteId}`
            : '/admin/intent-router';
        
        const method = editingRouteId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'x-admin-token': getAdminToken()
            },
            body: JSON.stringify(formData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showModalSuccess(editingRouteId ? 'Route updated successfully!' : 'Route created successfully!');
            setTimeout(() => {
                closeRouteModal();
                loadRoutes();
                loadStats();
            }, 1500);
        } else {
            showModalError('Failed to save route: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving route:', error);
        showModalError('Error saving route: ' + error.message);
    }
}

// Delete route
async function deleteRoute(routeId) {
    if (!confirm('Are you sure you want to delete this route? This action cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/intent-router/${routeId}`, {
            method: 'DELETE',
            headers: {
                'x-admin-token': getAdminToken()
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSuccess('Route deleted successfully!');
            loadRoutes();
            loadStats();
        } else {
            showError('Failed to delete route: ' + (result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error deleting route:', error);
        showError('Error deleting route: ' + error.message);
    }
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

function showModalError(message) {
    const messagesDiv = document.getElementById('modalMessages');
    messagesDiv.innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
}

function showModalSuccess(message) {
    const messagesDiv = document.getElementById('modalMessages');
    messagesDiv.innerHTML = `<div class="success-message">${escapeHtml(message)}</div>`;
}

function clearModalMessages() {
    document.getElementById('modalMessages').innerHTML = '';
}
