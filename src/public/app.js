const input = document.getElementById('messageInput');
const send = document.getElementById('sendBtn');
const chat = document.querySelector('.chat');
const newChatBtn = document.getElementById('newChatBtn');
const chatList = document.getElementById('chatList');
const currentChatName = document.getElementById('currentChatName');
const currentChatDescription = document.getElementById('currentChatDescription');
const modelSelect = document.getElementById('modelSelect');

let currentThreadId = null;
let currentMessageSequence = 0;

// Model selection handling
const MODEL_STORAGE_KEY = 'selectedSynthesisModel';

function initializeModelSelector() {
  // Load saved model preference (default to gpt-5)
  const savedModel = localStorage.getItem(MODEL_STORAGE_KEY) || 'gpt-5';
  modelSelect.value = savedModel;

  // Save model selection when changed
  modelSelect.addEventListener('change', (e) => {
    const selectedModel = e.target.value;
    localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
    console.log('🔵 Synthesis model changed to:', selectedModel);
  });
}

function getSelectedModel() {
  return localStorage.getItem(MODEL_STORAGE_KEY) || 'gpt-5';
}

// Debug: expose to window for console access
window.debugThreadId = () => currentThreadId;

// Helper function to scroll messages container properly (respects padding-bottom)
function scrollToBottom() {
  const messagesContainer = document.querySelector('.messages');
  if (!messagesContainer) return;

  const lastMessage = messagesContainer.lastElementChild;
  if (lastMessage) {
    lastMessage.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
}

function generateThreadId() {
  return crypto.randomUUID();
}

function getThreadIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get('thread');
}

function updateURL(threadId) {
  const url = new URL(window.location);
  if (threadId) {
    url.searchParams.set('thread', threadId);
  } else {
    url.searchParams.delete('thread');
  }
  window.history.replaceState({}, '', url);
}

async function initializeChat() {
  try {
    // Initialize model selector
    initializeModelSelector();

    const urlThreadId = getThreadIdFromURL();

    // Always load the chat sessions list for the sidebar
    await loadChatSessions();

    if (urlThreadId) {
      currentThreadId = urlThreadId;
      console.log('🔵 Loaded thread from URL:', currentThreadId);

      const thread = await fetch(`/chat/threads/${currentThreadId}`).then(r => r.json());
      currentMessageSequence = thread.thread?.max_sequence_number || 0;
      await loadChatHistory();
      updateChatHeader(thread.thread?.name || 'Active Conversation');
    } else {
      console.log('🔵 No thread in URL, starting fresh');
      updateChatHeader('New Thread');
    }
  } catch (error) {
    console.error('🔴 initializeChat error:', error);
  }
}

// Load chat sessions for sidebar
async function loadChatSessions() {
  try {
    console.log('🔵 Loading chat sessions...');
    const response = await fetch('/chat/list?limit=10');
    console.log('🔵 Chat list response status:', response.status);

    if (response.ok) {
      const data = await response.json();
      console.log('🔵 Chat list data:', data);

      if (data.data && data.data.chats) {
        console.log('🔵 Found', data.data.chats.length, 'chat sessions');
        renderChatSessions(data.data.chats);
      } else {
        console.warn('⚠️ No chats found in response data structure');
      }
    } else {
      const errorText = await response.text();
      console.error('🔴 Failed to load chat sessions:', response.status, errorText);
    }
  } catch (error) {
    console.error('🔴 Error loading chat sessions:', error);
  }
}

// Render chat sessions in sidebar
function renderChatSessions(chats) {
  console.log('🔵 renderChatSessions called with', chats.length, 'chats');

  if (!chatList) {
    console.error('🔴 chatList element not found!');
    return;
  }

  chatList.innerHTML = '';

  if (!chats || chats.length === 0) {
    console.warn('⚠️ No chats to render');
    chatList.innerHTML = '<div style="padding: 16px; text-align: center; color: #8E8E93;">No chat history</div>';
    return;
  }

  chats.forEach((chat, index) => {
    const chatItem = document.createElement('div');
    chatItem.className = 'chat-item';
    chatItem.setAttribute('data-chat-id', chat.id);
    if (chat.id === currentThreadId) {
      chatItem.classList.add('active');
    }
    
    const chatName = chat.name || 'New Thread';
    const chatSummary = chat.description || '';
    
    chatItem.innerHTML = `
      <div class="chat-content">
        <div class="chat-name">${chatName}</div>
        <div class="chat-sub">${chatSummary}</div>
      </div>
      <button class="delete-chat-btn" aria-label="Delete chat">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    `;
    
    // Click handler for chat selection
    chatItem.addEventListener('click', (e) => {
      // Don't trigger if clicking delete button
      if (e.target.classList.contains('delete-chat-btn') || e.target.closest('.delete-chat-btn')) {
        return;
      }

      if (chat.latestThread?.id) {
        loadChatThread(chat.latestThread.id, chat.name);
      }
    });
    
    // Add click handler for delete button
    const deleteBtn = chatItem.querySelector('.delete-chat-btn');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent chat selection when clicking delete
      const threadId = chat.latestThread?.id;
      if (threadId) {
        deleteChatThread(threadId);
      } else {
        console.error('🔴 No thread ID found for chat:', chat);
      }
    });
    
    chatList.appendChild(chatItem);
  });
}

// Load a chat thread by ID
async function loadChatThread(threadId, threadName) {
  try {

    currentThreadId = threadId;
    updateURL(threadId);
    await loadChatHistory();
    updateChatHeader(threadName || 'Chat Thread');

    // Update active state in sidebar
    document.querySelectorAll('.chat-item').forEach(item => {
      item.classList.remove('active');
    });

    const clickedItem = document.querySelector(`[data-chat-id*="${threadId}"]`);
    if (clickedItem) {
      clickedItem.classList.add('active');
    }
  } catch (error) {
    console.error('Failed to load chat thread:', error);
  }
}

// Delete a chat thread
async function deleteChatThread(threadId) {
  console.log('🔵 deleteChatThread called with threadId:', threadId);

  // Show confirmation dialog
  if (!confirm('Delete this chat thread?')) {
    console.log('⚠️ Delete cancelled by user');
    return;
  }

  try {
    console.log('🔵 Sending DELETE request to /chat/enhanced/delete with threadId:', threadId);
    const response = await fetch(`/chat/enhanced/delete`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sessionId: threadId  // Backend expects 'sessionId' parameter but we're passing thread ID
      })
    });

    console.log('🔵 Delete response status:', response.status);

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Delete successful:', data);

      // If we deleted the currently active thread, clear the display
      if (threadId === currentThreadId) {
        currentThreadId = null;
        const messagesContainer = document.getElementById('messages');
        if (messagesContainer) {
          messagesContainer.innerHTML = '';
        }
        updateChatHeader('Start a New Conversation');
        updateURL(null);
      }

      // Reload chat sessions to update the sidebar
      await loadChatSessions();
    } else {
      const errorText = await response.text();
      console.error('🔴 Delete failed:', response.status, errorText);
      alert('Failed to delete chat: ' + errorText);
    }
  } catch (error) {
    console.error('🔴 Delete error:', error);
    alert('Error deleting chat: ' + error.message);
  }
}

// Load chat history
async function loadChatHistory() {
  if (!currentThreadId) return;

  try {
    const response = await fetch(`/chat/enhanced/history?threadId=${currentThreadId}&limit=50`);
    if (response.ok) {
      const data = await response.json();
      // Clear existing messages
      const messagesContainer = document.getElementById('messages');
      if (messagesContainer) {
        messagesContainer.innerHTML = '';
        // Add messages to chat (without scrolling each time)
        data.data.messages.forEach(msg => {
          addMessage(msg.content, msg.role === 'user' ? 'outbound' : 'inbound', msg.metadata || {}, false);
        });
        // Don't manipulate scroll - let natural padding work
      }
    }
  } catch (error) {
    // Failed to load chat history
  }
}

async function createNewChat() {
  try {
    currentThreadId = null;
    currentMessageSequence = 0;
    updateURL(null);
    
    // Clear the chat display
    const messagesContainer = document.getElementById('messages');
    if (messagesContainer) {
      messagesContainer.innerHTML = `
        <div class="message system">
          <div class="message-content">
            <p>Start typing to begin...</p>
          </div>
        </div>
      `;
    }
    
    // Update chat header
    updateChatHeader('Start a New Conversation', 'Ask questions about your systems and get intelligent responses');
    
    // Clear input
    input.value = '';
    input.focus();
    
    // Update active state in sidebar
    document.querySelectorAll('.chat-item').forEach(item => {
      item.classList.remove('active');
    });
    
    // Reload chat sessions to refresh the list
    await loadChatSessions();
  } catch (error) {
    // Failed to create new chat
  }
}

// Update chat header
function updateChatHeader(title, description = '') {
  if (currentChatName) currentChatName.textContent = title;
  if (currentChatDescription) currentChatDescription.textContent = description;
}

// Format message content (handle markdown-like formatting)
function formatMessageContent(text) {
  // Escape HTML
  let formatted = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // Convert line breaks to <br>
  formatted = formatted.replace(/\n/g, '<br>');

  // Convert **bold** to <strong>
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Convert *italic* to <em>
  formatted = formatted.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Convert `code` to <code>
  formatted = formatted.replace(/`(.+?)`/g, '<code>$1</code>');

  return formatted;
}

// Add message to chat
function addMessage(text, type, metadata = {}, autoScroll = true) {
  const messagesContainer = document.getElementById('messages');
  if (!messagesContainer) return;

  // Clear empty state if it exists
  const emptyState = messagesContainer.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  const wrapper = document.createElement('div');
  wrapper.className = `message ${type === 'outbound' ? 'user' : 'assistant'}`;

  // Use parseMarkdown for consistent formatting (same as addEnhancedMessage)
  const formattedContent = type === 'outbound' ? formatMessageContent(text) : parseMarkdown(text);

  // Create message bubble
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = `
    <div class="message-content">${formattedContent}</div>
    ${metadata.sources && metadata.sources.length > 0 ? `
      <div class="message-meta">
        <div class="message-sources">
          ${metadata.sources.map(s => `<span class="source-badge">${s.title || 'Source'}</span>`).join('')}
        </div>
      </div>
    ` : ''}
  `;

  wrapper.appendChild(bubble);

  messagesContainer.appendChild(wrapper);

  if (autoScroll) {
    scrollToBottom();
  }
}

// Markdown parser using marked.js
function parseMarkdown(text) {
  if (!text) return '';

  // Configure marked for security and formatting
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,          // Convert \n to <br>
      gfm: true,            // GitHub Flavored Markdown
      headerIds: false,     // Don't add IDs to headers
      mangle: false,        // Don't escape email addresses
      sanitize: false,      // We trust our LLM output
      smartLists: true,     // Use smarter list behavior
      smartypants: false    // Don't convert quotes/dashes
    });

    try {
      return marked.parse(text);
    } catch (error) {
      console.error('Markdown parsing error:', error);
      // Fallback to escaped text
      return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    }
  }

  // Fallback if marked.js not loaded
  console.warn('marked.js not loaded, using basic text rendering');
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

// Add enhanced message with source bubbles
function addEnhancedMessage(text, sources = []) {
  const messagesContainer = document.getElementById('messages');
  if (!messagesContainer) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'message inbound';

  // Parse the response to remove the "## Detailed Documentation" section
  const mainContent = parseMainContent(text);

  // Parse markdown to HTML
  const htmlContent = parseMarkdown(mainContent);

  // Generate source tag based on source types
  let sourceTag = '';
  if (sources.length > 0) {
    const sourceTypes = [...new Set(sources.map(s => s.type))];
    const hasDIP = sourceTypes.some(t => t !== 'PINECONE');
    const hasPinecone = sourceTypes.includes('PINECONE');

    let icon, label;
    if (hasDIP && hasPinecone) {
      icon = '📚';
      label = 'Manuals (DIP + Semantic)';
    } else if (hasDIP) {
      icon = '⚙️';
      label = 'Manuals (DIP)';
    } else if (hasPinecone) {
      icon = '📘';
      label = 'Manuals (Semantic)';
    }

    sourceTag = `<div class="source-tag"><span class="source-icon">${icon}</span> <span class="source-text">${label}</span></div>`;
  } else {
    // No sources - red warning
    sourceTag = `<div class="source-tag source-warning"><span class="source-icon">⚠️</span> <span class="source-text">No source data found</span></div>`;
  }

  // Create main content with source tag at top
  let content = `<div class="bubble">${sourceTag}<div class="content">${htmlContent}</div>`;
  
  // Add source bubbles if sources exist
  if (sources.length > 0) {
    content += `<div class="source-bubbles">`;
    sources.forEach((source, index) => {
      const sourceType = detectSourceType(source);
      const bubbleClass = getSourceBubbleClass(sourceType);
      const sourceLabel = getSourceLabel(source);
      content += `<span class="source-bubble ${bubbleClass}" data-source-index="${index}" title="${sourceLabel}">${index + 1}</span>`;
    });
    content += `</div>`;
  }
  
  content += `<div class="timestamp">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div>`;
  
  wrapper.innerHTML = content;
  
  // Add click handlers for source bubbles
  wrapper.querySelectorAll('.source-bubble').forEach(bubble => {
    bubble.addEventListener('click', () => {
      const sourceIndex = parseInt(bubble.dataset.sourceIndex);
      const source = sources[sourceIndex];
      showSourceDetails(source, sourceIndex + 1);
    });
  });

  messagesContainer.appendChild(wrapper);
  scrollToBottom();
}

// Parse main content by removing the detailed documentation section
function parseMainContent(text) {
  // Split by "## Detailed Documentation" and take only the first part
  const parts = text.split('## Detailed Documentation');
  const mainContent = parts[0].trim();
  
  // Also remove any trailing "## Conversation Context" section
  const contextParts = mainContent.split('## Conversation Context');
  return contextParts[0].trim();
}

// Get CSS class for source bubble based on type
function getSourceBubbleClass(sourceType) {
  switch (sourceType) {
    case 'pinecone':
    case 'PINECONE':
      return 'source-pinecone';
    case 'system':
      return 'source-system';
    default:
      return 'source-unknown';
  }
}

// Detect source type by structure
function detectSourceType(source) {
  return source.type || (source.pages && source.score ? 'pinecone' : source.id ? 'system' : 'unknown');
}

// Get display label for source
function getSourceLabel(source) {
  if (source.type === 'pinecone' || source.type === 'PINECONE') {
    // For PINECONE sources, extract manufacturer/model from data array
    if (source.data && source.data.length > 0) {
      const firstChunk = source.data[0];
      const manufacturer = firstChunk.manufacturer || '';
      const model = firstChunk.model || '';
      return `${manufacturer} ${model}`.trim() || 'Pinecone Semantic Search';
    }
    return 'Pinecone Semantic Search';
  } else if (source.type === 'system') {
    return `${source.manufacturer} ${source.model}`;
  }
  return 'Unknown source';
}

// Show source details in modal
function showSourceDetails(source, sourceNumber) {
  let content = '';

  const sourceType = source.type || 'unknown';

  if (sourceType === 'pinecone' || sourceType === 'PINECONE') {
    // Handle Pinecone sources - data is in source.data array
    const chunks = source.data || [];
    const equipment = source.equipment || {};
    const equipmentNames = equipment.names || [];

    // Get equipment info from first chunk if available
    const firstChunk = chunks[0] || {};
    const manufacturer = firstChunk.manufacturer || 'Unknown';
    const model = firstChunk.model || 'Unknown';

    content = `<h3>Source ${sourceNumber}: Pinecone Semantic Search</h3>`;
    content += `<p><strong>Equipment:</strong> ${manufacturer} ${model}</p>`;
    content += `<p><strong>Total Matches:</strong> ${source.count || chunks.length}</p>`;
    content += `<p><strong>Chunks Shown:</strong> ${chunks.length}</p>`;

    if (chunks.length > 0) {
      content += `<div class="source-content">`;
      chunks.forEach((chunk, idx) => {
        content += `<div class="source-chunk">`;
        content += `<p><strong>Chunk ${idx + 1}</strong></p>`;
        content += `<p><strong>Score:</strong> ${typeof chunk.score === 'number' ? chunk.score.toFixed(3) : 'N/A'}</p>`;
        content += `<p><strong>Equipment:</strong> ${chunk.manufacturer || ''} ${chunk.model || ''}</p>`;
        if (chunk.doc_type && chunk.doc_type !== 'unknown') {
          content += `<p><strong>Type:</strong> ${chunk.doc_type}</p>`;
        }
        if (chunk.text_preview) {
          content += `<p><strong>Preview:</strong> ${chunk.text_preview}</p>`;
        }
        content += `</div>`;
      });
      content += `</div>`;
    }
  } else if (sourceType === 'procedure' || sourceType === 'spec' || sourceType === 'troubleshooting' || sourceType === 'routing') {
    // Handle DIP table sources
    content = `<h3>Source ${sourceNumber}: DIP Table (${sourceType})</h3>`;
    content += `<p><strong>Table Type:</strong> ${sourceType}</p>`;
    content += `<p><strong>Total Entries:</strong> ${source.count || 0}</p>`;

    const equipment = source.equipment || {};
    if (equipment.manufacturer && equipment.model) {
      content += `<p><strong>Equipment:</strong> ${equipment.manufacturer} ${equipment.model}</p>`;
    }

    const data = source.data || [];
    if (data.length > 0) {
      content += `<div class="source-content">`;
      content += `<p><strong>Sample Entries (top ${data.length}):</strong></p>`;
      data.forEach((entry, idx) => {
        content += `<div class="source-chunk">`;
        content += `<p><strong>Entry ${idx + 1}</strong></p>`;
        content += `<pre>${JSON.stringify(entry, null, 2)}</pre>`;
        content += `</div>`;
      });
      content += `</div>`;
    }
  } else if (sourceType === 'PERPLEXITY') {
    // Handle Perplexity web search citations
    content = `<h3>Source ${sourceNumber}: Real-World Resources 🌐</h3>`;
    content += `<p><strong>Web Search Results:</strong> ${source.count || 0} sources from marine forums and troubleshooting communities</p>`;

    const citations = source.data || [];
    if (citations.length > 0) {
      content += `<div class="source-content">`;
      content += `<div class="perplexity-links">`;
      citations.forEach((citation, idx) => {
        const url = citation.url || '';
        content += `<a href="${url}" target="_blank" rel="noopener noreferrer" class="perplexity-link">`;
        content += `<span class="link-number">${idx + 1}.</span>`;
        content += `<span class="link-url">${url}</span>`;
        content += `<span class="link-icon">🔗</span>`;
        content += `</a>`;
      });
      content += `</div>`;
      content += `<p class="perplexity-note"><em>(Links open in new tab)</em></p>`;
      content += `</div>`;
    }
  } else {
    // Unknown source type - show debug info
    content = `<h3>Source ${sourceNumber}: ${sourceType}</h3>`;
    content += `<p><strong>Type:</strong> ${sourceType}</p>`;
    content += `<p><strong>Count:</strong> ${source.count || 'N/A'}</p>`;
    content += `<div class="source-content">`;
    content += `<div class="source-chunk">`;
    content += `<p><strong>Debug Info:</strong></p>`;
    content += `<pre>${JSON.stringify(source, null, 2)}</pre>`;
    content += `</div>`;
    content += `</div>`;
  }

  // Create and show modal
  const modal = document.createElement('div');
  modal.className = 'source-modal';
  modal.innerHTML = `
    <div class="source-modal-content">
      <span class="source-modal-close">&times;</span>
      ${content}
    </div>
  `;

  document.body.appendChild(modal);

  // Close modal functionality
  modal.querySelector('.source-modal-close').addEventListener('click', () => {
    modal.remove();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// Add loading animation
function addLoadingAnimation() {
  const messagesContainer = document.getElementById('messages');
  if (!messagesContainer) return;

  // Clear empty state if it exists
  const emptyState = messagesContainer.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  const loadingWrapper = document.createElement('div');
  loadingWrapper.className = 'message assistant';
  loadingWrapper.id = 'loading-animation';

  loadingWrapper.innerHTML = `
    <div class="message-bubble">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;

  messagesContainer.appendChild(loadingWrapper);
  scrollToBottom();
  return loadingWrapper;
}

// Remove loading animation
function removeLoadingAnimation() {
  const loadingAnimation = document.getElementById('loading-animation');
  if (loadingAnimation) {
    loadingAnimation.remove();
  }
}

async function saveUserMessage(threadId, message, sequenceNumber) {
  const response = await fetch('/chat/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      threadId,
      role: 'user',
      content: message,
      sequenceNumber,
      metadata: { timestamp: new Date().toISOString() }
    })
  });
  if (!response.ok) {
    throw new Error(`Failed to save user message: ${response.status}`);
  }
  return await response.json();
}

async function saveAssistantMessage(threadId, message, sequenceNumber, metadata = {}) {
  const response = await fetch('/chat/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      threadId,
      role: 'assistant',
      content: message,
      sequenceNumber,
      metadata
    })
  });
  if (!response.ok) {
    throw new Error(`Failed to save assistant message: ${response.status}`);
  }
  return await response.json();
}

async function processMessage(message) {
  let userSequence = null;
  let assistantSequence = null;

  try {
    if (!currentThreadId) {
      currentThreadId = generateThreadId();
      currentMessageSequence = 0;

      const threadResponse = await fetch('/chat/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentThreadId,
          name: 'New Thread',
          metadata: { created_at: new Date().toISOString() }
        })
      });
      if (!threadResponse.ok) {
        throw new Error('Failed to create thread');
      }

      updateURL(currentThreadId);
    }

    addMessage(message, 'outbound');

    userSequence = ++currentMessageSequence;
    await saveUserMessage(currentThreadId, message, userSequence);

    addLoadingAnimation();

    const selectedModel = getSelectedModel();
    console.log('🔵 Sending message with model:', selectedModel);

    const response = await fetch('/chat/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: message,
        thread_id: currentThreadId,
        synthesis_model: selectedModel
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Chat request failed: ${response.status} ${errorText}`);
    }

    removeLoadingAnimation();
    const data = await response.json();

    if (data.success && data.data) {
      const responseData = data.data;
      const assistantMessage = responseData.assistantMessage.content || 'No response generated';
      const sources = responseData.sources || [];

      assistantSequence = ++currentMessageSequence;
      await saveAssistantMessage(currentThreadId, assistantMessage, assistantSequence, {
        sources: sources,
        processing_time_ms: responseData.telemetry?.processing_time_ms
      });

      const formattedSources = sources.map(source => ({
        type: source.type,
        content: source.data,
        data: source.data,  // Keep original data field for modal
        count: source.count,
        equipment: source.equipment,  // Keep equipment field for modal
        icon: getSourceIcon(source.type)
      }));

      addEnhancedMessage(assistantMessage, formattedSources);

      // Update stats panel with detailed metrics
      if (responseData.detailed_metrics) {
        window.lastMetrics = responseData.detailed_metrics;
        updateStatsPanel(responseData.detailed_metrics);

        // Auto-show stats panel if not visible
        const chatSection = document.getElementById('chatSection');
        const appContainer = document.querySelector('.app');
        if (chatSection && !chatSection.classList.contains('show-stats')) {
          setTimeout(() => {
            chatSection.classList.add('show-stats');
            if (appContainer) appContainer.classList.add('show-stats');
          }, 500); // Small delay to let message render first
        }
      }

      if (responseData.telemetry && responseData.telemetry.score) {
        const score = responseData.telemetry.score;
        const scoreIndicator = document.createElement('div');
        scoreIndicator.className = 'python-service-indicator';
        scoreIndicator.innerHTML = `
          <div style="font-size: 12px; color: #666; margin-top: 8px;">
            🐍 Python Service ${score.confidence_emoji} Score: ${score.total_score}/100
            (${responseData.telemetry.processing_time_ms}ms)
          </div>
        `;
        document.querySelector('.messages').appendChild(scoreIndicator);
      }

      await loadChatSessions();
    } else {
      addMessage(`Error: ${data.error || 'Unknown error'}`, 'inbound');
    }
  } catch (error) {
    removeLoadingAnimation();
    addMessage(`Error: ${error.message}`, 'inbound');

    if (assistantSequence) {
      await fetch(`/chat/messages/${currentThreadId}/${assistantSequence}`, { method: 'DELETE' });
      currentMessageSequence--;
    }
    if (userSequence && !assistantSequence) {
      await fetch(`/chat/messages/${currentThreadId}/${userSequence}`, { method: 'DELETE' });
      currentMessageSequence--;
    }
  }
}

// Handle send button click
function handleSend() {
  const value = input.value.trim();
  if (!value) return;
  
  processMessage(value);
  input.value = '';
}

// Event listeners
send.addEventListener('click', handleSend);
newChatBtn.addEventListener('click', createNewChat);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSend();
});

// Helper function to get source icons for DIP tables
function getSourceIcon(sourceType) {
  const iconMap = {
    'spec_suggestions': '📋',
    'playbook_hints': '📖',
    'intent_router': '🎯',
    'golden_tests': '🧪',
    'pinecone': '🔍',
    'web': '🌐',
    'default': '📄'
  };
  return iconMap[sourceType] || iconMap.default;
}

// Stats Panel Functions
function initializeStatsPanel() {
  const toggleBtn = document.getElementById('toggleStatsBtn');
  const closeBtn = document.getElementById('closeStatsBtn');
  const chatSection = document.getElementById('chatSection');
  const appContainer = document.querySelector('.app');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      chatSection.classList.toggle('show-stats');
      if (appContainer) appContainer.classList.toggle('show-stats');
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      chatSection.classList.remove('show-stats');
      if (appContainer) appContainer.classList.remove('show-stats');
    });
  }
}

function updateStatsPanel(metrics) {
  if (!metrics) return;

  // Helper to convert ms to seconds with 2 decimals
  const msToSec = (ms) => ms ? `${(ms / 1000).toFixed(2)}s` : '-';

  // Classification stats
  if (metrics.classification) {
    const c = metrics.classification;
    updateStatValue('stat-intent', c.intent || '-');
    updateStatValue('stat-confidence', c.confidence ? `${(c.confidence * 100).toFixed(1)}%` : '-');
    updateStatValue('stat-complexity', `${c.complexity || '-'} (${(c.complexity_score || 0).toFixed(2)})`);
    updateStatValue('stat-class-duration', msToSec(c.duration_ms));
  }

  // Pinecone stats
  if (metrics.pinecone) {
    const p = metrics.pinecone;
    updateStatValue('stat-total-matches', p.total_matches || 0);
    updateStatValue('stat-filtered-matches', p.filtered_matches || 0);
    updateStatValue('stat-pinecone-duration', msToSec(p.duration_ms));

    // Update chunks list - show ALL chunks with scores, not just selected ones
    const chunksList = document.getElementById('chunks-list');
    if (chunksList && p.chunks) {
      // Show all chunks with their scores
      const allChunks = p.chunks.slice(0, 10); // Show up to 10 chunks
      chunksList.innerHTML = allChunks.map((chunk, index) => `
        <div class="chunk-item ${index < p.filtered_matches ? 'selected-chunk' : 'unselected-chunk'}">
          <span class="chunk-score">${chunk.score.toFixed(3)}</span>
          <span class="chunk-content">${chunk.content_preview}</span>
          ${index < p.filtered_matches ? '<span class="chunk-badge">✓ Used</span>' : '<span class="chunk-badge-excluded">✗ Not used</span>'}
        </div>
      `).join('');
    }
  }

  // Synthesis stats
  if (metrics.synthesis) {
    const s = metrics.synthesis;
    updateStatValue('stat-model', s.model_used || '-');
    updateStatValue('stat-reasoning', s.reasoning_effort || '-');
    updateStatValue('stat-dip-tables', s.dip_tables_sent || 0);
    updateStatValue('stat-dip-entries', s.dip_entries_sent || 0);
    updateStatValue('stat-chunks-sent', s.pinecone_chunks_sent || 0);
    updateStatValue('stat-synth-duration', msToSec(s.duration_ms));

    // Update equipment list
    const equipmentList = document.getElementById('equipment-list');
    if (equipmentList && s.equipment_context) {
      equipmentList.innerHTML = s.equipment_context.map(eq => `
        <div class="equipment-item">
          <div class="equipment-name">${eq.manufacturer} ${eq.model}</div>
          <div class="equipment-rank">Confidence: ${(eq.rank * 100).toFixed(1)}%</div>
        </div>
      `).join('');
    }
  }
}

function updateStatValue(elementId, value) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = value;
  }
}

// Store last metrics globally for debugging
window.lastMetrics = null;

// Initialize chat on page load
document.addEventListener('DOMContentLoaded', () => {
  initializeChat();
  initializeStatsPanel();
});


