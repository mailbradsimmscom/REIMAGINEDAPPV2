/**
 * Dashboard section controller
 * Handles system health, database status, and logs
 */
export function init({ router, adminState }) {
    // Dashboard controller initialized - using logger would require server-side context
    // console.log('Dashboard controller initialized');
    
    // Load initial data
    loadHealthMetrics();
    loadDatabaseMetrics();
    loadVectorMetrics();
    loadPerformanceMetrics();
    refreshLogs();
    
    // Set up auto-refresh
    adminState.refreshInterval = setInterval(() => {
        loadHealthMetrics();
        loadDatabaseMetrics();
        loadVectorMetrics();
        loadPerformanceMetrics();
    }, 30000); // Refresh every 30 seconds
}

async function loadHealthMetrics() {
    try {
        const response = await window.adminFetch('/admin/api/health');
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('uptime').textContent = data.data.uptime || 'Unknown';
            document.getElementById('memory').textContent = data.data.memory || 'Unknown';
            document.getElementById('environment').textContent = data.data.environment || 'Unknown';
        }
    } catch (error) {
        console.error('Failed to load health metrics:', error);
    }
}

async function loadDatabaseMetrics() {
    try {
        // Get Supabase connectivity status
        const connectivityResponse = await window.adminFetch('/admin/api/health/connectivity');
        const connectivityData = await connectivityResponse.json();
        
        if (connectivityData.success) {
            const dbStatus = connectivityData.data.checks.database.status;
            const storageStatus = connectivityData.data.checks.storage.status;
            const overallStatus = connectivityData.data.status;
            
            document.getElementById('supabase-status').textContent = 
                overallStatus === 'healthy' ? 'Connected' : 'Disconnected';
        }
        
        // Get real counts from systems endpoint
        const systemsResponse = await window.adminFetch('/admin/api/systems');
        const systemsData = await systemsResponse.json();
        
        if (systemsData.success) {
            document.getElementById('documents-count').textContent = systemsData.data.documentsCount || '0';
            document.getElementById('jobs-count').textContent = systemsData.data.jobsCount || '0';
            document.getElementById('total-systems').textContent = systemsData.data.totalSystems || '0';
        }
        
    } catch (error) {
        console.error('Failed to load database metrics:', error);
        document.getElementById('supabase-status').textContent = 'Error';
    }
}

async function loadVectorMetrics() {
    try {
        const response = await window.adminFetch('/admin/api/pinecone');
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('pinecone-status').textContent = data.data.status || 'Unknown';
            document.getElementById('sidecar-status').textContent = data.data.sidecarHealth?.status || 'Unknown';
            document.getElementById('sidecar-version').textContent = data.data.sidecarHealth?.version || 'Unknown';
            document.getElementById('pinecone-index').textContent = data.data.index || 'Unknown';
            document.getElementById('pinecone-namespace').textContent = data.data.namespace || 'Unknown';
            document.getElementById('pinecone-vectors').textContent = data.data.vectors || '0';
            document.getElementById('pinecone-dimension').textContent = data.data.dimension || 'Unknown';
            document.getElementById('pinecone-fullness').textContent = data.data.indexFullness || 'Unknown';
        }
    } catch (error) {
        console.error('Failed to load vector metrics:', error);
    }
}

async function loadPerformanceMetrics() {
    try {
        const response = await window.adminFetch('/admin/api/metrics');
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('active-sessions').textContent = data.data.chatHealth?.totalRequests || '0';
            document.getElementById('avg-response').textContent = `${data.data.chatHealth?.p95Latency || 0}ms`;
            document.getElementById('error-rate').textContent = `${(data.data.chatHealth?.errorRate || 0) * 100}%`;
        }
    } catch (error) {
        console.error('Failed to load performance metrics:', error);
    }
}

async function refreshLogs() {
    try {
        const response = await window.adminFetch('/admin/api/logs');
        const data = await response.json();
        
        if (data.success) {
            displayLogs(data.data.logs || []);
        }
    } catch (error) {
        console.error('Failed to refresh logs:', error);
    }
}

function displayLogs(logs) {
    const container = document.getElementById('logs-container');
    
    if (!logs || logs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No logs available yet.</p>
                <p>Logs will appear here when the system generates them.</p>
            </div>
        `;
        return;
    }
    
    const logsHtml = logs.map(log => `
        <div class="log-entry ${log.level}">
            <strong>[${log.timestamp}] ${log.level.toUpperCase()}:</strong> ${log.message}
        </div>
    `).join('');
    
    container.innerHTML = logsHtml;
}

// Global functions for backward compatibility
window.refreshLogs = refreshLogs;
window.clearLogs = () => {
    document.getElementById('logs-container').innerHTML = `
        <div class="empty-state">
            <p>Logs cleared.</p>
        </div>
    `;
};
