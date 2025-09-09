/**
 * Suggestions section controller
 * Handles AI-generated suggestions management and approval workflow
 */

export function init({ router, adminState }) {
    initializeSuggestionsSection();
}

function initializeSuggestionsSection() {
    const suggestionsContainer = document.getElementById('suggestions-container');
    
    if (!suggestionsContainer) {
        console.warn('suggestions.js: #suggestions-container not found - section may not be loaded yet');
        return;
    }

    loadSuggestions();
    setupEventListeners();
}

async function loadSuggestions() {
    try {
        const response = await window.adminFetch('/admin/api/suggestions/pending');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        const suggestions = data.data?.suggestions || [];
        
        renderSuggestions(suggestions);
        
    } catch (error) {
        console.error('Failed to load suggestions:', error);
        showError(`Failed to load suggestions: ${error.message}`);
    }
}

function renderSuggestions(suggestions) {
    const container = document.getElementById('suggestions-list');
    const statsContainer = document.getElementById('total-suggestions');
    const loadingDiv = document.getElementById('loading');
    const contentDiv = document.getElementById('content');
    
    if (!container || !statsContainer || !loadingDiv || !contentDiv) {
        console.warn('suggestions.js: Required DOM elements not found');
        return;
    }
    
    // Hide loading, show content
    loadingDiv.style.display = 'none';
    contentDiv.style.display = 'block';
    
    statsContainer.textContent = suggestions.length;
    
    if (suggestions.length === 0) {
        container.innerHTML = '<div class="empty">No DIP suggestions available for review.</div>';
        return;
    }

    container.innerHTML = '';
    
    suggestions.forEach((suggestion, index) => {
        const suggestionElement = createSuggestionElement(suggestion, index);
        container.appendChild(suggestionElement);
    });
}

function createSuggestionElement(suggestion, index) {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.dataset.docId = suggestion.doc_id;
    
    const suggestionType = suggestion.type || 'unknown';
    const confidence = suggestion.confidence || 0;
    const page = suggestion.page || 'N/A';
    
    div.innerHTML = `
        <div class="suggestion-header">
            <input type="checkbox" 
                   data-type="${suggestionType}" 
                   data-index="${index}"
                   class="suggestion-checkbox">
            <span class="suggestion-type">${escapeHtml(suggestionType)}</span>
            <span class="suggestion-confidence">${(confidence * 100).toFixed(1)}%</span>
            <span class="suggestion-page">Page ${page}</span>
        </div>
        <div class="suggestion-content">
            <div class="suggestion-value">${escapeHtml(suggestion.value || suggestion.text || 'No content')}</div>
            ${suggestion.context ? `<div class="suggestion-context">${escapeHtml(suggestion.context)}</div>` : ''}
        </div>
    `;
    
    return div;
}

function setupEventListeners() {
    // Select all button
    const selectAllBtn = document.getElementById('select-all');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', selectAll);
    }
    
    // Deselect all button
    const deselectAllBtn = document.getElementById('deselect-all');
    if (deselectAllBtn) {
        deselectAllBtn.addEventListener('click', deselectAll);
    }
    
    // Approve selected button
    const approveBtn = document.getElementById('approve-selected');
    if (approveBtn) {
        approveBtn.addEventListener('click', approveSelected);
    }
    
    // Checkbox change listeners
    document.addEventListener('change', (e) => {
        if (e.target.classList.contains('suggestion-checkbox')) {
            updateSelectedCount();
        }
    });
}

function selectAll() {
    const checkboxes = document.querySelectorAll('.suggestion-checkbox');
    checkboxes.forEach(checkbox => checkbox.checked = true);
    updateSelectedCount();
}

function deselectAll() {
    const checkboxes = document.querySelectorAll('.suggestion-checkbox');
    checkboxes.forEach(checkbox => checkbox.checked = false);
    updateSelectedCount();
}

function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('.suggestion-checkbox:checked');
    const countElement = document.getElementById('selected-suggestions');
    const approveBtn = document.getElementById('approve-selected');
    
    if (countElement) {
        countElement.textContent = checkboxes.length;
    }
    
    if (approveBtn) {
        approveBtn.disabled = checkboxes.length === 0;
    }
}

async function approveSelected() {
    const checkboxes = document.querySelectorAll('.suggestion-checkbox:checked');
    if (checkboxes.length === 0) return;

    const approvedSuggestions = {
        entities: [],
        spec_suggestions: [],
        golden_tests: [],
        playbook_hints: []
    };
    
    let currentDocId = null;
    
    checkboxes.forEach(checkbox => {
        const type = checkbox.dataset.type;
        const index = parseInt(checkbox.dataset.index);
        const docId = checkbox.closest('.suggestion-item').dataset.docId;
        
        if (!currentDocId) currentDocId = docId;
        
        // Get the suggestion data from the DOM
        const suggestionElement = checkbox.closest('.suggestion-item');
        const value = suggestionElement.querySelector('.suggestion-value').textContent;
        const confidence = parseFloat(suggestionElement.querySelector('.suggestion-confidence').textContent) / 100;
        const page = suggestionElement.querySelector('.suggestion-page').textContent.replace('Page ', '');
        
        const suggestion = {
            value: value,
            confidence: confidence,
            page: page === 'N/A' ? null : parseInt(page),
            context: suggestionElement.querySelector('.suggestion-context')?.textContent || null
        };
        
        // Add type-specific fields
        switch (type) {
            case 'entity':
                suggestion.entity_type = 'general';
                approvedSuggestions.entities.push(suggestion);
                break;
            case 'spec':
                suggestion.hint_type = 'general';
                approvedSuggestions.spec_suggestions.push(suggestion);
                break;
            case 'test':
                suggestion.test_name = value;
                suggestion.test_type = 'maintenance';
                approvedSuggestions.golden_tests.push(suggestion);
                break;
            case 'playbook':
                suggestion.test_name = value;
                suggestion.test_type = 'maintenance';
                approvedSuggestions.playbook_hints.push(suggestion);
                break;
        }
    });

    try {
        const response = await window.adminFetch('/admin/api/suggestions/approve', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                doc_id: currentDocId,
                approved: approvedSuggestions
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        const totalInserted = result.data?.total_inserted || 0;
        const mergeResult = result.data?.merge_to_production;
        
        let message = `Successfully approved ${totalInserted} suggestions`;
        if (mergeResult) {
            if (mergeResult.total_merged > 0) {
                message += ` (${mergeResult.total_merged} merged to production tables)`;
            }
            if (mergeResult.total_errors > 0) {
                message += ` (${mergeResult.total_errors} merge errors)`;
            }
        }
        
        showSuccess(message);
        deselectAll();
        
        // Reload suggestions to show updated state
        loadSuggestions();
        
    } catch (error) {
        console.error('Failed to approve suggestions:', error);
        showError(`Failed to approve suggestions: ${error.message}`);
    }
}

function showError(message) {
    const errorDiv = document.getElementById('error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        setTimeout(() => errorDiv.style.display = 'none', 5000);
    }
}

function showSuccess(message) {
    const successDiv = document.getElementById('success');
    if (successDiv) {
        successDiv.textContent = message;
        successDiv.style.display = 'block';
        setTimeout(() => successDiv.style.display = 'none', 5000);
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
