const input = document.getElementById('messageInput');
const send = document.getElementById('sendBtn');
const chat = document.querySelector('.chat');
const newChatBtn = document.getElementById('newChatBtn');
const chatList = document.getElementById('chatList');
const currentChatName = document.getElementById('currentChatName');
const currentChatDescription = document.getElementById('currentChatDescription');

let currentThreadId = null;
let currentMessageSequence = 0;

// Debug: expose to window for console access
window.debugThreadId = () => currentThreadId;

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
    const urlThreadId = getThreadIdFromURL();

    if (urlThreadId) {
      currentThreadId = urlThreadId;
      console.log('🔵 Loaded thread from URL:', currentThreadId);

      const thread = await fetch(`/chat/threads/${currentThreadId}`).then(r => r.json());
      currentMessageSequence = thread.thread?.message_count || 0;
      await loadChatHistory();
      updateChatHeader(thread.thread?.name || 'Active Conversation');
    } else {
      console.log('🔵 No thread in URL, starting fresh');
      // Start fresh with no thread loaded
      await loadChatSessions();
      updateChatHeader('New Thread');
    }
  } catch (error) {
    console.error('🔴 initializeChat error:', error);
  }
}

// Load chat sessions for sidebar
async function loadChatSessions() {
  try {
    const response = await fetch('/chat/list?limit=10');
    if (response.ok) {
      const data = await response.json();
      renderChatSessions(data.data.chats);
    } else {
      // Failed to load chat sessions
    }
  } catch (error) {
    // Failed to load chat sessions
  }
}

// Render chat sessions in sidebar
function renderChatSessions(chats) {
  if (!chatList) {
    return;
  }

  chatList.innerHTML = '';

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
      deleteChatSession(chat.id);
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

// Delete a chat session
async function deleteChatSession(sessionId) {
  // Show confirmation dialog
  if (!confirm('Delete this chat?')) {
    return;
  }
  
  try {
    const response = await fetch(`/chat/enhanced/delete`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sessionId: sessionId
      })
    });
    
    if (response.ok) {
      // If we deleted the currently active chat, clear the current session
      if (sessionId === currentSessionId) {
        currentSessionId = null;
        currentThreadId = null;
        const messagesContainer = document.getElementById('messages');
        if (messagesContainer) {
          messagesContainer.innerHTML = '';
        }
        updateChatHeader('Start a New Conversation');
      }
      
      // Reload chat sessions to update the sidebar
      await loadChatSessions();
    } else {
      alert('Failed to delete chat');
    }
  } catch (error) {
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
        // Add messages to chat
        data.data.messages.forEach(msg => {
          addMessage(msg.content, msg.role === 'user' ? 'outbound' : 'inbound', msg.metadata || {});
        });
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
function addMessage(text, type, metadata = {}) {
  const messagesContainer = document.getElementById('messages');
  if (!messagesContainer) return;

  // Clear empty state if it exists
  const emptyState = messagesContainer.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  const wrapper = document.createElement('div');
  wrapper.className = `message ${type === 'outbound' ? 'user' : 'assistant'}`;

  // Format message content with proper HTML
  const formattedContent = formatMessageContent(text);

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
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Simple markdown parser for chat messages
function parseMarkdown(text) {
  if (!text) return '';

  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Line breaks - convert double newlines to paragraphs
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs.map(p => {
    // Don't wrap if already a heading
    if (p.trim().startsWith('<h')) return p;

    // Handle lists (numbered or bulleted)
    const lines = p.split('\n');
    let inList = false;
    let listType = null;
    let result = [];

    for (let line of lines) {
      const numberedMatch = line.match(/^(\d+)\.\s+(.+)$/);
      const bulletMatch = line.match(/^[-*]\s+(.+)$/);

      if (numberedMatch) {
        if (!inList || listType !== 'ol') {
          if (inList) result.push(`</${listType}>`);
          result.push('<ol>');
          listType = 'ol';
          inList = true;
        }
        result.push(`<li>${numberedMatch[2]}</li>`);
      } else if (bulletMatch) {
        if (!inList || listType !== 'ul') {
          if (inList) result.push(`</${listType}>`);
          result.push('<ul>');
          listType = 'ul';
          inList = true;
        }
        result.push(`<li>${bulletMatch[1]}</li>`);
      } else {
        if (inList) {
          result.push(`</${listType}>`);
          inList = false;
          listType = null;
        }
        if (line.trim()) result.push(line);
      }
    }

    if (inList) result.push(`</${listType}>`);

    return result.length ? result.join('\n') : `<p>${p}</p>`;
  }).join('\n');

  // Single line breaks become <br>
  html = html.replace(/\n/g, '<br>');

  return html;
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

  // Create main content
  let content = `<div class="bubble"><div class="content">${htmlContent}</div>`;
  
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
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
  if (source.type === 'pinecone') {
    const pages = source.pages && source.pages.length > 0 ? ` (Pages: ${source.pages.join(', ')})` : '';
    return `${source.manufacturer} ${source.model}${pages}`;
  } else if (source.type === 'system') {
    return `${source.manufacturer} ${source.model}`;
  }
  return 'Unknown source';
}

// Show source details in modal
function showSourceDetails(source, sourceNumber) {
  let content = '';
  
  // Detect source type by structure if type is missing
  const sourceType = source.type || (source.pages && source.score ? 'pinecone' : source.id ? 'system' : 'unknown');
  
  if (sourceType === 'pinecone') {
    content = `<h3>Source ${sourceNumber}: ${source.manufacturer} ${source.model}</h3>`;
    content += `<p><strong>Relevance Score:</strong> ${typeof source.score === 'number' ? source.score.toFixed(3) : 'N/A'}</p>`;
    if (source.pages && source.pages.length > 0) {
      content += `<p><strong>Pages:</strong> ${source.pages.join(', ')}</p>`;
    }
    if (source.filename) {
      content += `<p><strong>Document:</strong> ${source.filename}</p>`;
    }
    // Note: source.content is not available in the current response, so we show basic info
    content += `<div class="source-content">`;
    content += `<div class="source-chunk">`;
    content += `<p><strong>Document Information:</strong></p>`;
    content += `<p>This source contains ${source.pages.length} pages from the ${source.manufacturer} ${source.model} documentation.</p>`;
    content += `<p>Relevance score: ${typeof source.score === 'number' ? source.score.toFixed(3) : 'N/A'}</p>`;
    content += `</div>`;
    content += `</div>`;
  } else if (sourceType === 'system') {
    content = `<h3>Source ${sourceNumber}: System Information</h3>`;
    content += `<p><strong>System ID:</strong> ${source.id}</p>`;
    content += `<p><strong>Manufacturer:</strong> ${source.manufacturer}</p>`;
    content += `<p><strong>Model:</strong> ${source.model}</p>`;
    content += `<p><strong>Relevance Rank:</strong> ${typeof source.rank === 'number' ? source.rank.toFixed(2) : 'N/A'}</p>`;
  } else {
    content = `<h3>Source ${sourceNumber}: Unknown Source</h3>`;
    content += `<p>Source type: ${sourceType}</p>`;
    content += `<p>Source object: ${JSON.stringify(source, null, 2)}</p>`;
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
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
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

    const response = await fetch('/chat/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: message,
        thread_id: currentThreadId
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
        count: source.count,
        icon: getSourceIcon(source.type)
      }));

      addEnhancedMessage(assistantMessage, formattedSources);

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

// Initialize chat on page load
document.addEventListener('DOMContentLoaded', initializeChat);


