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
    const response = await fetch('/chat/list?limit=1');
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
    if (chat.id === currentSessionId) {
      chatItem.classList.add('active');
    }
    
    const chatName = chat.latestThread?.name || 'Untitled Chat';
    const lastMessage = chat.latestThread?.updated_at ? 
      new Date(chat.latestThread.updated_at).toLocaleDateString() : 'No messages';
    
    chatItem.innerHTML = `
      <div class="chat-name">${chatName}</div>
      <div class="chat-sub">${lastMessage}</div>
    `;
    
    chatItem.addEventListener('click', () => {
      selectChatSession(chat);
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

// Load chat history
async function loadChatHistory() {
  if (!currentThreadId) return;
  
  try {
    const response = await fetch(`/chat/history?threadId=${currentThreadId}&limit=50`);
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
            <p>Welcome! I can help you with information about your systems. Try asking:</p>
            <ul>
              <li>"Tell me about my watermaker"</li>
              <li>"What GPS systems do I have?"</li>
              <li>"Show me my navigation equipment"</li>
            </ul>
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

// Process user message
async function processMessage(message) {
  try {
    // Add user message to chat
    addMessage(message, 'outbound');
    
    // Send to chat API
    const response = await fetch('/chat/process', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        sessionId: currentSessionId,
        threadId: currentThreadId
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      
      // Update session and thread IDs
      if (data.data.sessionId) currentSessionId = data.data.sessionId;
      if (data.data.threadId) currentThreadId = data.data.threadId;
      
      // Add assistant response to chat
      addMessage(data.data.assistantMessage.content, 'inbound');
      
      // Show systems context if available
      if (data.data.systemsContext && data.data.systemsContext.length > 0) {
        const contextInfo = `Found ${data.data.systemsContext.length} relevant systems. Context preserved for follow-up questions.`;
        addMessage(contextInfo, 'inbound');
      }
      
      // Reload chat sessions to show new session
      await loadChatSessions();
      
    } else {
      const errorData = await response.json();
      addMessage(`Error: ${errorData.error}`, 'inbound');
    }
  } catch (error) {
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


