/**
 * Document Upload section controller
 * Handles file uploads, form management, and job processing
 */
export function init({ router, adminState }) {
    // Doc Upload controller initialized - using logger would require server-side context
    // console.log('Doc Upload controller initialized');
    
    // Load manufacturers on init
    loadManufacturers();
    
    // Set up file drop zone
    setupFileDropZone();
    
    // Set up form event listeners
    setupFormListeners();
}

async function loadManufacturers() {
    try {
        const response = await window.adminFetch('/admin/api/manufacturers');
        const data = await response.json();
        
        if (data.success) {
            const select = document.getElementById('manufacturer');
            select.innerHTML = '<option value="">Select Manufacturer</option>';
            
            data.data.forEach(manufacturer => {
                const option = document.createElement('option');
                option.value = manufacturer;
                option.textContent = manufacturer;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Failed to load manufacturers:', error);
    }
}

async function loadModels() {
    const manufacturer = document.getElementById('manufacturer').value;
    if (!manufacturer) return;
    
    try {
        const response = await window.adminFetch(`/admin/api/models?manufacturer=${encodeURIComponent(manufacturer)}`);
        const data = await response.json();
        
        if (data.success) {
            const select = document.getElementById('model');
            select.innerHTML = '<option value="">Select Model</option>';
            
            data.data.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Failed to load models:', error);
    }
}

function setupFileDropZone() {
    const dropZone = document.getElementById('file-drop-zone');
    const fileInput = document.getElementById('file-input');
    
    if (!dropZone || !fileInput) return;
    
    // Click to browse
    dropZone.addEventListener('click', () => fileInput.click());
    
    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
    
    // File input change
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });
}

function setupFormListeners() {
    // Set today's date as default
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('revision-date');
    if (dateInput) {
        dateInput.value = today;
    }
}

function handleFiles(files) {
    const queue = document.getElementById('upload-queue');
    const queueItems = document.getElementById('queue-items');
    
    if (!queue || !queueItems) return;
    
    Array.from(files).forEach(file => {
        if (isValidFile(file)) {
            addToQueue(file);
        }
    });
    
    if (queueItems.children.length > 0) {
        queue.style.display = 'block';
    }
}

function isValidFile(file) {
    const validTypes = ['.pdf', '.doc', '.docx', '.txt'];
    const extension = '.' + file.name.split('.').pop().toLowerCase();
    return validTypes.includes(extension);
}

function addToQueue(file) {
    const queueItems = document.getElementById('queue-items');
    if (!queueItems) return;
    
    const item = document.createElement('div');
    item.className = 'queue-item';
    item.innerHTML = `
        <div class="file-info">
            <span class="file-name">${file.name}</span>
            <span class="file-size">${formatFileSize(file.size)}</span>
        </div>
        <button class="btn secondary" onclick="removeFromQueue(this)">Remove</button>
    `;
    
    queueItems.appendChild(item);
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function processUploadQueue() {
    const queueItems = document.getElementById('queue-items');
    if (!queueItems || queueItems.children.length === 0) return;
    
    const files = Array.from(queueItems.children).map(item => {
        const fileName = item.querySelector('.file-name').textContent;
        // This is a simplified version - in reality, you'd need to store file references
        return fileName;
    });
    
    if (files.length === 0) return;
    
    // For now, process the first file
    const firstFile = files[0];
    await uploadDocument(firstFile);
}

async function uploadDocument(fileName) {
    try {
        const formData = new FormData();
        
        // Get form data
        const docId = document.getElementById('doc-id').value;
        const manufacturer = document.getElementById('manufacturer').value;
        const model = document.getElementById('model').value;
        const revisionDate = document.getElementById('revision-date').value;
        const ocrEnabled = document.getElementById('ocr-enabled').checked;
        
        // Add form fields
        if (docId) formData.append('docId', docId);
        if (manufacturer) formData.append('manufacturer', manufacturer);
        if (model) formData.append('model', model);
        if (revisionDate) formData.append('revisionDate', revisionDate);
        formData.append('ocrEnabled', ocrEnabled);
        
        // Note: In a real implementation, you'd need to handle the actual file upload
        // For now, we'll simulate with a mock file name
        formData.append('file', new Blob(['mock content'], { type: 'text/plain' }), fileName);
        
        const response = await fetch('/admin/api/docs/upload', {
            method: 'POST',
            headers: {
                'x-admin-token': window.AdminState.ADMIN_TOKEN
            },
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            alert(`Upload successful! Job ID: ${result.data.jobId}`);
            pollJobStatus(result.data.jobId);
            clearUploadQueue();
        } else {
            const errorMsg = result.error?.message || result.error || 'Unknown error';
            alert(`Upload failed: ${errorMsg}`);
        }
    } catch (error) {
        console.error('Upload error:', error);
        alert(`Upload failed: ${error.message}`);
    }
}

function pollJobStatus(jobId) {
    const progressDiv = document.getElementById('job-progress');
    if (progressDiv) {
        progressDiv.style.display = 'block';
    }
    
    const interval = setInterval(async () => {
        try {
            const response = await window.adminFetch(`/admin/api/docs/jobs?limit=1`);
            const data = await response.json();
            
            if (data.success && data.data.jobs.length > 0) {
                const job = data.data.jobs[0];
                updateJobProgress(job);
                
                if (job.status === 'completed' || job.status === 'failed') {
                    clearInterval(interval);
                    showJobCompletion(job);
                }
            }
        } catch (error) {
            console.error('Failed to poll job status:', error);
        }
    }, 2000);
}

function updateJobProgress(job) {
    document.getElementById('current-job-id').textContent = `Job: ${job.id}`;
    document.getElementById('current-job-status').textContent = job.status;
    document.getElementById('current-job-status').className = `job-status ${job.status}`;
    
    const progressFill = document.getElementById('progress-fill');
    if (progressFill) {
        const progress = job.counters ? 
            (job.counters.uploaded / Math.max(job.counters.total, 1)) * 100 : 0;
        progressFill.style.width = `${progress}%`;
    }
    
    // Update metrics
    if (job.counters) {
        document.getElementById('progress-pages').textContent = job.counters.pages || 0;
        document.getElementById('progress-chunks').textContent = job.counters.chunks || 0;
        document.getElementById('progress-uploaded').textContent = job.counters.uploaded || 0;
    }
    
    // Update message
    const message = job.message || `Processing... ${job.status}`;
    updateProgressMessage(message, job.status === 'failed' ? 'error' : '');
}

function updateProgressMessage(message, type = '') {
    const messageEl = document.getElementById('progress-message');
    if (messageEl) {
        messageEl.textContent = message;
        messageEl.className = `progress-message ${type}`;
    }
}

function showJobCompletion(job) {
    setTimeout(() => {
        showResultsModal(job);
        addToUploadHistory(job);
    }, 1000);
}

function showResultsModal(job) {
    const modal = document.getElementById('results-modal');
    if (modal) {
        modal.style.display = 'flex';
        
        // Update summary metrics
        if (job.counters) {
            document.getElementById('result-pages').textContent = job.counters.pages || 0;
            document.getElementById('result-chunks').textContent = job.counters.chunks || 0;
            document.getElementById('result-vectors').textContent = job.counters.uploaded || 0;
            document.getElementById('result-time').textContent = job.processingTime || '0s';
        }
        
        // Load chunks
        if (job.documentId) {
            loadDocumentChunks(job.documentId);
        }
    }
}

function addToUploadHistory(job) {
    const historyDiv = document.getElementById('upload-history');
    if (!historyDiv) return;
    
    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';
    historyItem.innerHTML = `
        <div class="history-item-header">
            <span class="history-job-id">Job: ${job.id}</span>
            <span class="history-status ${job.status}">${job.status}</span>
        </div>
        <div class="history-item-details">
            <span>Pages: ${job.counters?.pages || 0}</span>
            <span>Chunks: ${job.counters?.chunks || 0}</span>
            <span>Vectors: ${job.counters?.uploaded || 0}</span>
        </div>
    `;
    
    // Remove empty state if present
    const emptyState = historyDiv.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }
    
    historyDiv.insertBefore(historyItem, historyDiv.firstChild);
}

// Global functions for backward compatibility
window.loadManufacturers = loadManufacturers;
window.loadModels = loadModels;
window.resetUploadForm = () => {
    document.getElementById('doc-id').value = '';
    document.getElementById('manufacturer').value = '';
    document.getElementById('model').value = '';
    document.getElementById('revision-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('ocr-enabled').checked = true;
};

window.clearUploadQueue = () => {
    const queue = document.getElementById('upload-queue');
    const queueItems = document.getElementById('queue-items');
    if (queue) queue.style.display = 'none';
    if (queueItems) queueItems.innerHTML = '';
};

window.processUploadQueue = processUploadQueue;
window.removeFromQueue = (button) => {
    button.parentElement.remove();
    const queueItems = document.getElementById('queue-items');
    const queue = document.getElementById('upload-queue');
    if (queueItems.children.length === 0 && queue) {
        queue.style.display = 'none';
    }
};
