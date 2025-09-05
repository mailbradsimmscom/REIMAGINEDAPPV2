const input = document.getElementById('messageInput');
const send = document.getElementById('sendBtn');
const chat = document.querySelector('.chat');
const newChatBtn = document.getElementById('newChatBtn');
const chatList = document.getElementById('chatList');
const currentChatName = document.getElementById('currentChatName');
const currentChatDescription = document.getElementById('currentChatDescription');

let currentSessionId = null;
let currentThreadId = null;

// Initialize chat
async function initializeChat() {
  try {
    // Load existing chat sessions
    await loadChatSessions();
    
    // Try to get the most recent chat session
    const response = await fetch('/chat/enhanced/list?limit=1');
    if (response.ok) {
      const data = await response.json();
      if (data.data.chats.length > 0) {
        const latestChat = data.data.chats[0];
        currentSessionId = latestChat.id;
        if (latestChat.latestThread) {
          currentThreadId = latestChat.latestThread.id;
          // Load chat history
          await loadChatHistory();
          // Update UI to show current session
          updateChatHeader(latestChat.latestThread.name || 'Active Conversation');
        }
      }
    }
  } catch (error) {
    // Failed to initialize chat
  }
}

// Load chat sessions for sidebar
async function loadChatSessions() {
  try {
    const response = await fetch('/chat/enhanced/list?limit=10');
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
    if (chat.id === currentSessionId) {
      chatItem.classList.add('active');
    }
    
    const chatName = chat.latestThread?.name || 'Untitled Chat';
    const lastMessage = chat.latestThread?.updated_at ? 
      new Date(chat.latestThread.updated_at).toLocaleDateString() : 'No messages';
    
    chatItem.innerHTML = `
      <div class="chat-content">
        <div class="chat-name">${chatName}</div>
        <div class="chat-sub">${lastMessage}</div>
      </div>
      <button class="delete-chat-btn" aria-label="Delete chat">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    `;
    
    // Add click handler for selecting chat
    const chatContent = chatItem.querySelector('.chat-content');
    chatContent.addEventListener('click', () => {
      selectChatSession(chat);
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

// Select a chat session
async function selectChatSession(chat) {
  try {
    currentSessionId = chat.id;
    if (chat.latestThread) {
      currentThreadId = chat.latestThread.id;
      await loadChatHistory();
      updateChatHeader(chat.latestThread.name || 'Active Conversation');
    }
    
    // Update active state in sidebar
    document.querySelectorAll('.chat-item').forEach(item => {
      item.classList.remove('active');
    });
    event.target.closest('.chat-item').classList.add('active');
  } catch (error) {
    // Failed to select chat session
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
          addMessage(msg.content, msg.role === 'user' ? 'outbound' : 'inbound');
        });
      }
    }
  } catch (error) {
    // Failed to load chat history
  }
}

// Create new chat session
async function createNewChat() {
  try {
    // Clear current session
    currentSessionId = null;
    currentThreadId = null;
    
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

// Add message to chat
function addMessage(text, type) {
  const messagesContainer = document.getElementById('messages');
  if (!messagesContainer) return;
  
  const wrapper = document.createElement('div');
  wrapper.className = `message ${type}`;
  
  if (type === 'outbound') {
    wrapper.innerHTML = `
      <div class="bubble">
        <div class="content">${text}</div>
        <div class="timestamp">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    `;
  } else {
    wrapper.innerHTML = `
      <div class="bubble">
        <div class="content">${text}</div>
        <div class="timestamp">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
    `;
  }
  
  messagesContainer.appendChild(wrapper);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Add enhanced message with source bubbles
function addEnhancedMessage(text, sources = []) {
  const messagesContainer = document.getElementById('messages');
  if (!messagesContainer) return;
  
  const wrapper = document.createElement('div');
  wrapper.className = 'message inbound';
  
  // Parse the response to remove the "## Detailed Documentation" section
  const mainContent = parseMainContent(text);
  
  // Create main content
  let content = `<div class="bubble"><div class="content">${mainContent}</div>`;
  
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
    content += `<p><strong>Relevance Score:</strong> ${source.score.toFixed(3)}</p>`;
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
    content += `<p>Relevance score: ${source.score.toFixed(3)}</p>`;
    content += `</div>`;
    content += `</div>`;
  } else if (sourceType === 'system') {
    content = `<h3>Source ${sourceNumber}: System Information</h3>`;
    content += `<p><strong>System ID:</strong> ${source.id}</p>`;
    content += `<p><strong>Manufacturer:</strong> ${source.manufacturer}</p>`;
    content += `<p><strong>Model:</strong> ${source.model}</p>`;
    content += `<p><strong>Relevance Rank:</strong> ${source.rank.toFixed(2)}</p>`;
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
  
  const loadingWrapper = document.createElement('div');
  loadingWrapper.className = 'loading-message';
  loadingWrapper.id = 'loading-animation';
  
  loadingWrapper.innerHTML = `
    <div class="loading-bubble">
      <div class="loading-dot"></div>
      <div class="loading-dot"></div>
      <div class="loading-dot"></div>
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

// Process user message
async function processMessage(message) {
  try {
    // Add user message to chat
    addMessage(message, 'outbound');
    
    // Add loading animation
    addLoadingAnimation();
    
    // Send to chat API
    const requestBody = { message };
    if (currentSessionId) requestBody.sessionId = currentSessionId;
    if (currentThreadId) requestBody.threadId = currentThreadId;
    
    const response = await fetch('/chat/enhanced/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    // Remove loading animation
    removeLoadingAnimation();
    
    if (response.ok) {
      const data = await response.json();
      
      // Update session and thread IDs
      if (data.data.sessionId) currentSessionId = data.data.sessionId;
      if (data.data.threadId) currentThreadId = data.data.threadId;
      
      // Add assistant response to chat with enhanced source display
      addEnhancedMessage(data.data.assistantMessage.content, data.data.sources || []);
      
      // Reload chat sessions to show new session
      await loadChatSessions();
      
    } else {
      const errorData = await response.json();
      const errorMessage = errorData.error?.message || errorData.error || 'Unknown error';
      addMessage(`Error: ${errorMessage}`, 'inbound');
    }
  } catch (error) {
    // Remove loading animation on error
    removeLoadingAnimation();
    addMessage(`Error: ${error.message}`, 'inbound');
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

// Initialize chat on page load
document.addEventListener('DOMContentLoaded', initializeChat);


