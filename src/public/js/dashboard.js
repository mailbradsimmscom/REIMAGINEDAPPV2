// Dashboard module for system monitoring
const POLL_INTERVAL = 20000; // 20 seconds
const API_BASE = '/admin';

class Dashboard {
    constructor() {
        this.pollTimer = null;
        this.logs = [];
        this.init();
    }

    async init() {
        await this.fetchAllMetrics();
        this.startPolling();
        this.attachEventListeners();
    }

    startPolling() {
        this.pollTimer = setInterval(() => {
            this.fetchAllMetrics();
        }, POLL_INTERVAL);
    }

    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    async fetchAllMetrics() {
        try {
            const [health, database, vector, performance] = await Promise.allSettled([
                this.fetchSystemHealth(),
                this.fetchDatabaseStatus(),
                this.fetchVectorStatus(),
                this.fetchPerformance()
            ]);

            this.updateLastUpdate();
            this.updateMainStatus(health.status === 'fulfilled');
        } catch (error) {
            console.error('Error fetching metrics:', error);
            this.updateMainStatus(false);
        }
    }

    async fetchSystemHealth() {
        try {
            const response = await fetch(`${API_BASE}/health`, {
                headers: this.getHeaders()
            });
            const data = await response.json();

            if (data.success) {
                this.updateMetric('uptime', this.formatUptime(data.data?.uptime || 0));
                this.updateMetric('memory', this.formatMemory(data.data?.memory || {}));
                this.updateMetric('environment', data.data?.environment || 'Unknown');
            }
        } catch (error) {
            this.updateMetric('uptime', 'Error', 'error');
            this.updateMetric('memory', 'Error', 'error');
            this.updateMetric('environment', 'Error', 'error');
        }
    }

    async fetchDatabaseStatus() {
        try {
            // Try connectivity endpoint for database status
            const response = await fetch(`${API_BASE}/health/connectivity`, {
                headers: this.getHeaders()
            });
            const data = await response.json();

            if (data.success) {
                const dbStatus = data.data?.database?.status === 'ok';
                this.updateMetric('supabase-status', dbStatus ? 'Connected' : 'Disconnected',
                    dbStatus ? 'success' : 'error');

                // Try jobs status for counts
                try {
                    const jobsResponse = await fetch(`${API_BASE}/jobs/status`, {
                        headers: this.getHeaders()
                    });
                    const jobsData = await jobsResponse.json();
                    if (jobsData.success) {
                        this.updateMetric('jobs-count', jobsData.data?.total || 0);
                    }
                } catch {
                    this.updateMetric('jobs-count', '-');
                }

                // Set placeholder values for now
                this.updateMetric('documents-count', '-');
                this.updateMetric('total-systems', '-');
            }
        } catch (error) {
            this.updateMetric('supabase-status', 'Error', 'error');
            this.updateMetric('documents-count', '-');
            this.updateMetric('jobs-count', '-');
            this.updateMetric('total-systems', '-');
        }
    }

    async fetchVectorStatus() {
        try {
            // Try pinecone stats endpoint
            const response = await fetch(`${API_BASE}/pinecone/stats`, {
                headers: this.getHeaders()
            });
            const data = await response.json();

            if (data.success) {
                this.updateMetric('pinecone-status', 'Connected', 'success');
                this.updateMetric('sidecar-status', data.data?.sidecar ? 'Connected' : 'Unknown',
                    data.data?.sidecar ? 'success' : '');
                this.updateMetric('pinecone-vectors', this.formatNumber(data.data?.totalVectorCount || 0));
                this.updateMetric('pinecone-fullness', `${data.data?.indexFullness || 0}%`);
            }
        } catch (error) {
            this.updateMetric('pinecone-status', 'Error', 'error');
            this.updateMetric('sidecar-status', 'Error', 'error');
            this.updateMetric('pinecone-vectors', '-');
            this.updateMetric('pinecone-fullness', '-');
        }
    }

    async fetchPerformance() {
        try {
            // Try metrics endpoint
            const response = await fetch(`${API_BASE}/metrics`, {
                headers: this.getHeaders()
            });
            const data = await response.json();

            if (data.success && data.data) {
                // Use available metrics data
                this.updateMetric('active-sessions', data.data?.activeSessions || 0);
                this.updateMetric('avg-response', data.data?.avgResponseTime ? `${data.data.avgResponseTime}ms` : '-');
                const errorRate = data.data?.errorRate || 0;
                this.updateMetric('error-rate', `${errorRate}%`,
                    errorRate > 5 ? 'error' : errorRate > 1 ? 'warning' : 'success');
            }
        } catch (error) {
            this.updateMetric('active-sessions', '-');
            this.updateMetric('avg-response', '-');
            this.updateMetric('error-rate', '-');
        }
    }

    async refreshLogs() {
        try {
            const response = await fetch(`${API_BASE}/logs`, {
                headers: this.getHeaders()
            });
            const data = await response.json();

            if (data.success && data.data?.logs) {
                this.logs = data.data.logs;
                this.renderLogs();
            }
        } catch (error) {
            console.error('Error fetching logs:', error);
        }
    }

    renderLogs() {
        const container = document.getElementById('logs-container');
        const filter = document.getElementById('log-level-filter').value;

        const filteredLogs = filter === 'all' ?
            this.logs :
            this.logs.filter(log => log.level === filter);

        if (filteredLogs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No ${filter === 'all' ? '' : filter} logs available.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = filteredLogs.map(log => `
            <div class="log-entry ${log.level}">
                [${new Date(log.timestamp).toLocaleTimeString()}] ${log.message}
            </div>
        `).join('');

        container.scrollTop = container.scrollHeight;
    }

    clearLogs() {
        this.logs = [];
        this.renderLogs();
    }

    updateMetric(id, value, className = '') {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
            element.className = `metric-value ${className}`;
        }
    }

    updateLastUpdate() {
        const element = document.getElementById('last-update');
        if (element) {
            element.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
        }
    }

    updateMainStatus(isHealthy) {
        const element = document.getElementById('main-status');
        if (element) {
            element.className = `status-dot ${isHealthy ? 'active' : 'error'}`;
        }
    }

    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);

        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${mins}m`;
        return `${mins}m`;
    }

    formatMemory(memory) {
        if (!memory.used || !memory.total) return 'Unknown';
        const percentage = ((memory.used / memory.total) * 100).toFixed(1);
        const usedMB = (memory.used / 1024 / 1024).toFixed(0);
        return `${usedMB}MB (${percentage}%)`;
    }

    formatNumber(num) {
        if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
        if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
        return num.toString();
    }

    getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };

        // Add admin token if available
        const adminToken = localStorage.getItem('x-admin-token');
        if (adminToken) {
            headers['x-admin-token'] = adminToken;
        }

        return headers;
    }

    attachEventListeners() {
        // Log filter change
        document.getElementById('log-level-filter').addEventListener('change', () => {
            this.renderLogs();
        });

        // Page visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopPolling();
            } else {
                this.fetchAllMetrics();
                this.startPolling();
            }
        });
    }
}

// Initialize dashboard and expose to window for button callbacks
window.dashboard = new Dashboard();