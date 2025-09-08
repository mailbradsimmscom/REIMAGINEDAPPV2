// src/public/chat/loadChatThread.js
// Loads chat history for a session and renders it using the existing UI functions

/**
 * Load chat thread history for a session
 * @param {string} sessionId - The session ID to load
 */
export async function loadChatThread(sessionId) {
  try {
    console.log('Loading chat thread for session:', sessionId);
    
    const response = await fetch(`/chat/enhanced/thread/${sessionId}`);
    
    if (!response.ok) {
      throw new Error(`Failed to load chat thread: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error?.message || 'Failed to load chat thread');
    }
    
    // Clear existing messages
    const messagesContainer = document.getElementById('messages');
    if (messagesContainer) {
      messagesContainer.innerHTML = '';
    }
    
    // Load all threads and their messages
    if (data.data.threads && data.data.threads.length > 0) {
      for (const thread of data.data.threads) {
        if (thread.messages && thread.messages.length > 0) {
          // Sort messages by creation time to ensure correct order
          const sortedMessages = thread.messages.sort((a, b) => 
            new Date(a.createdAt) - new Date(b.createdAt)
          );
          
          for (const message of sortedMessages) {
            addBubble(message.role, message.content, message.metadata);
          }
        }
      }
    }
    
    console.log('Chat thread loaded successfully');
    
  } catch (error) {
    console.error('Failed to load chat thread:', error);
    // Optionally show error to user
    addBubble('assistant', `Error loading chat history: ${error.message}`);
  }
}

/**
 * Add a chat bubble to the UI
 * Maps roles to the existing UI functions
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content - Message content
 * @param {object} metadata - Optional message metadata
 */
function addBubble(role, content, metadata = {}) {
  if (role === 'user') {
    // Use existing addMessage function for user messages
    addMessage(content, 'outbound');
  } else if (role === 'assistant') {
    // Use existing addEnhancedMessage function for assistant messages
    // Extract sources from metadata if available
    const sources = metadata.sources || [];
    addEnhancedMessage(content, sources);
  } else {
    console.warn('Unknown role:', role);
    // Fallback to inbound message
    addMessage(content, 'inbound');
  }
}

// Make functions available globally for compatibility
window.loadChatThread = loadChatThread;
window.addBubble = addBubble;
