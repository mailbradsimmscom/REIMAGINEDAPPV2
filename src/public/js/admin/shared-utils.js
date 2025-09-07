/**
 * Shared utilities and global functions for the admin interface
 * These functions are referenced in HTML and need to be available globally
 */

// Results Modal Functions
window.closeResultsModal = function() {
    const modal = document.getElementById('results-modal');
    if (modal) {
        modal.style.display = 'none';
    }
};

window.switchResultsTab = function(tabName) {
    // Hide all tabs
    document.querySelectorAll('.results-content .tab-content').forEach(tab => {
        tab.classList.add('hidden');
        tab.classList.remove('active');
    });
    
    // Remove active class from all tab buttons
    document.querySelectorAll('.results-tabs .tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    const targetTab = document.getElementById(`${tabName}-tab`);
    const targetBtn = document.querySelector(`[onclick="switchResultsTab('${tabName}')"]`);
    
    if (targetTab) {
        targetTab.classList.remove('hidden');
        targetTab.classList.add('active');
    }
    
    if (targetBtn) {
        targetBtn.classList.add('active');
    }
};

window.loadDocumentChunks = async function(docId) {
    try {
        const response = await window.adminFetch(`/admin/api/chunks/${docId}`);
        const data = await response.json();
        
        if (data.success) {
            displayChunks(data.data.chunks || []);
        }
    } catch (error) {
        console.error('Failed to load document chunks:', error);
    }
};

window.displayChunks = function(chunks) {
    const chunksList = document.getElementById('chunks-list');
    if (!chunksList) return;
    
    if (!chunks || chunks.length === 0) {
        chunksList.innerHTML = '<div class="empty-state"><p>No chunks found.</p></div>';
        return;
    }
    
    const chunksHtml = chunks.map((chunk, index) => `
        <div class="chunk-item">
            <div class="chunk-header">
                <span class="chunk-type ${chunk.type || 'text'}">${chunk.type || 'text'}</span>
                <span>Page ${chunk.page_start || '?'}</span>
            </div>
            <div class="chunk-content" id="chunk-${index}">
                ${chunk.content || 'No content'}
                <div class="chunk-expand">
                    <button onclick="toggleChunk(${index})">Show More</button>
                </div>
            </div>
        </div>
    `).join('');
    
    chunksList.innerHTML = chunksHtml;
};

window.toggleChunk = function(index) {
    const chunkContent = document.getElementById(`chunk-${index}`);
    if (chunkContent) {
        chunkContent.classList.toggle('expanded');
        const button = chunkContent.querySelector('button');
        if (button) {
            button.textContent = chunkContent.classList.contains('expanded') ? 'Show Less' : 'Show More';
        }
    }
};

window.filterChunks = function() {
    const searchTerm = document.getElementById('chunk-search')?.value.toLowerCase() || '';
    const filterType = document.getElementById('chunk-filter')?.value || 'all';
    
    const chunkItems = document.querySelectorAll('.chunk-item');
    chunkItems.forEach(item => {
        const content = item.textContent.toLowerCase();
        const type = item.querySelector('.chunk-type')?.textContent.toLowerCase() || '';
        
        const matchesSearch = content.includes(searchTerm);
        const matchesFilter = filterType === 'all' || type.includes(filterType);
        
        item.style.display = matchesSearch && matchesFilter ? 'block' : 'none';
    });
};

window.checkDIPStatus = async function(docId) {
    try {
        const response = await window.adminFetch(`/admin/api/dip/status/${docId}`);
        const data = await response.json();
        
        if (data.success) {
            updateDIPStatus(data.data.status);
        }
    } catch (error) {
        console.error('Failed to check DIP status:', error);
    }
};

window.updateDIPStatus = function(status) {
    const statusDiv = document.getElementById('dip-status');
    if (!statusDiv) return;
    
    const statusText = statusDiv.querySelector('.status-text');
    const statusIcon = statusDiv.querySelector('.status-icon');
    
    if (statusText) {
        statusText.textContent = status === 'completed' ? 'DIP Generated' : 'Ready to generate DIP';
    }
    
    if (statusIcon) {
        statusIcon.textContent = status === 'completed' ? '✅' : '⏳';
    }
    
    // Show/hide buttons based on status
    const generateBtn = document.getElementById('generate-dip-btn');
    const downloadBtn = document.getElementById('download-dip-btn');
    const suggestionsBtn = document.getElementById('download-suggestions-btn');
    
    if (generateBtn) generateBtn.style.display = status === 'completed' ? 'none' : 'inline-block';
    if (downloadBtn) downloadBtn.style.display = status === 'completed' ? 'inline-block' : 'none';
    if (suggestionsBtn) suggestionsBtn.style.display = status === 'completed' ? 'inline-block' : 'none';
};

window.generateDIP = async function() {
    // This would trigger DIP generation
    // console.log('Generating DIP...'); // Using logger would require server-side context
    alert('DIP generation functionality coming soon!');
};

window.showDIPPreview = function(dipData) {
    const preview = document.getElementById('dip-preview');
    const content = document.getElementById('dip-preview-content');
    
    if (preview && content) {
        content.textContent = JSON.stringify(dipData, null, 2);
        preview.style.display = 'block';
    }
};

window.downloadDIP = function() {
    // console.log('Downloading DIP...'); // Using logger would require server-side context
    alert('DIP download functionality coming soon!');
};

window.downloadSuggestions = function() {
    // console.log('Downloading suggestions...'); // Using logger would require server-side context
    alert('Suggestions download functionality coming soon!');
};

window.exportChunks = function() {
    // console.log('Exporting chunks...'); // Using logger would require server-side context
    alert('Chunk export functionality coming soon!');
};

window.exportReport = function() {
    // console.log('Exporting report...'); // Using logger would require server-side context
    alert('Report export functionality coming soon!');
};
