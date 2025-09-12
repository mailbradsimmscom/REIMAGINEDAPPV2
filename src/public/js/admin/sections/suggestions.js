/**
 * Suggestions section controller
 * Handles AI-generated suggestions management and approval workflow
 * Now supports all four DIP table types: spec_suggestions, playbook_hints, intent_router, golden_tests
 */

let allSuggestions = [];
let currentFilter = 'all';

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
        allSuggestions = data.data?.suggestions || [];
        const counts = data.data?.counts || {};
        
        updateStatistics(counts);
        renderSuggestions();
        
    } catch (error) {
        console.error('Failed to load suggestions:', error);
        showError(`Failed to load suggestions: ${error.message}`);
    }
}

function updateStatistics(counts) {
    const elements = {
        'total-suggestions': counts.total || 0,
        'spec-count': counts.spec_suggestions || 0,
        'playbook-count': counts.playbook_hints || 0,
        'intent-count': counts.intent_router || 0,
        'test-count': counts.golden_tests || 0
    };
    
    Object.entries(elements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    });
}

function renderSuggestions() {
    const container = document.getElementById('suggestions-list');
    const loadingDiv = document.getElementById('loading');
    const contentDiv = document.getElementById('content');
    
    if (!container || !loadingDiv || !contentDiv) {
        console.warn('suggestions.js: Required DOM elements not found');
        return;
    }
    
    // Hide loading, show content
    loadingDiv.style.display = 'none';
    contentDiv.style.display = 'block';
    
    // Filter suggestions based on current filter
    const filteredSuggestions = currentFilter === 'all' 
        ? allSuggestions 
        : allSuggestions.filter(s => s.type === currentFilter);
    
    if (filteredSuggestions.length === 0) {
        container.innerHTML = '<div class="empty">No suggestions available for the selected filter.</div>';
        return;
    }

    container.innerHTML = '';
    
    filteredSuggestions.forEach((suggestion, index) => {
        const suggestionElement = createSuggestionElement(suggestion, index);
        container.appendChild(suggestionElement);
    });
}

function createSuggestionElement(suggestion, index) {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.dataset.docId = suggestion.doc_id;
    div.dataset.suggestionId = suggestion.id;
    div.dataset.type = suggestion.type;
    
    const typeLabel = getTypeLabel(suggestion.type);
    const confidence = suggestion.confidence || 0;
    const page = suggestion.page || 'N/A';
    
    div.innerHTML = `
        <div class="suggestion-header">
            <input type="checkbox" 
                   data-type="${suggestion.type}" 
                   data-index="${index}"
                   data-suggestion-id="${suggestion.id}"
                   class="suggestion-checkbox">
            <span class="suggestion-type">${escapeHtml(typeLabel)}</span>
            <span class="suggestion-confidence">${(confidence * 100).toFixed(1)}%</span>
            <span class="suggestion-page">Page ${page}</span>
        </div>
        <div class="suggestion-content">
            <div class="suggestion-value">${escapeHtml(suggestion.display_value || 'No content')}</div>
            ${suggestion.context ? `<div class="suggestion-context">${escapeHtml(suggestion.context)}</div>` : ''}
        </div>
    `;
    
    return div;
}

function getTypeLabel(type) {
    const labels = {
        'spec': 'Spec Suggestion',
        'playbook': 'Playbook Hint',
        'intent': 'Intent Router',
        'test': 'Golden Test'
    };
    return labels[type] || 'Unknown';
}

function setupEventListeners() {
    // Filter tabs
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Update active tab
            tabButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            // Update filter and re-render
            currentFilter = e.target.dataset.filter;
            renderSuggestions();
        });
    });
    
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
        spec_suggestions: [],
        playbook_hints: [],
        intent_router: [],
        golden_tests: []
    };
    
    let currentDocId = null;
    
    checkboxes.forEach(checkbox => {
        const type = checkbox.dataset.type;
        const docId = checkbox.closest('.suggestion-item').dataset.docId;
        
        if (!currentDocId) currentDocId = docId;
        
        // Get the suggestion data from the DOM
        const suggestionElement = checkbox.closest('.suggestion-item');
        const value = suggestionElement.querySelector('.suggestion-value').textContent;
        const confidence = parseFloat(suggestionElement.querySelector('.suggestion-confidence').textContent) / 100;
        const page = suggestionElement.querySelector('.suggestion-page').textContent.replace('Page ', '');
        const context = suggestionElement.querySelector('.suggestion-context')?.textContent || '';
        
        const suggestion = {
            value: value,
            confidence: confidence,
            page: page === 'N/A' ? null : parseInt(page),
            context: context
        };
        
        // Add type-specific fields
        switch (type) {
            case 'spec':
                suggestion.spec_name = value.split(':')[0] || value;
                suggestion.spec_value = value.split(':')[1]?.trim() || null;
                approvedSuggestions.spec_suggestions.push(suggestion);
                break;
            case 'playbook':
                suggestion.test_name = 'Playbook Hint';
                suggestion.test_type = 'procedure';
                suggestion.description = value;
                suggestion.steps = [];
                suggestion.expected_result = 'See documentation';
                approvedSuggestions.playbook_hints.push(suggestion);
                break;
            case 'intent':
                suggestion.intent = value.split(' → ')[0] || value;
                suggestion.route_to = value.split(' → ')[1] || 'general';
                approvedSuggestions.intent_router.push(suggestion);
                break;
            case 'test':
                suggestion.test_name = value;
                suggestion.test_type = 'maintenance';
                suggestion.description = value;
                suggestion.steps = [];
                suggestion.expected_result = 'See documentation';
                approvedSuggestions.golden_tests.push(suggestion);
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
        
        showSuccess(`Successfully approved ${totalInserted} suggestions`);
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
