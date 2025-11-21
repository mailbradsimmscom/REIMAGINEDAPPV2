// Two-Call Chat Configuration and Implementation
// This code should be added at the beginning of app.js

// CRITICAL: This is the ONLY source of feature flag truth
let chatConfig = {
  TWO_CALL_MODE: false,  // Default to single-call (safe)
  WEB_ENRICHMENT_TIMEOUT_MS: 60000,
  PINECONE_CHUNKS_FOR_CACHE: 5,
  PINECONE_CHUNK_SIZE: 1000
};

// Flag to track if config is loaded
let configLoaded = false;

// Track pending web enrichments
const pendingEnrichments = new Map();

// Load configuration from backend - REQUIRED before processing
async function loadChatConfig() {
  try {
    const response = await fetch('/config/chat');
    if (response.ok) {
      chatConfig = await response.json();
      configLoaded = true;
      console.log('✅ Chat configuration loaded from backend:', chatConfig);

      // Update UI to show mode
      const modeIndicator = document.getElementById('chat-mode-indicator');
      if (modeIndicator) {
        modeIndicator.textContent = chatConfig.TWO_CALL_MODE ? 'Two-Call Mode' : 'Single-Call Mode';
        modeIndicator.className = chatConfig.TWO_CALL_MODE ? 'mode-indicator two-call' : 'mode-indicator single-call';
      }
    } else {
      console.error('❌ Config endpoint failed, defaulting to single-call mode');
      chatConfig.TWO_CALL_MODE = false;  // Safe fallback
      configLoaded = false;
    }
  } catch (error) {
    console.error('❌ Failed to load config, defaulting to single-call mode:', error);
    chatConfig.TWO_CALL_MODE = false;  // Safe fallback
    configLoaded = false;
  }
}

// Save original processMessage function
const processMessageOriginal = async function(message) {
  // This will be the existing processMessage function
  // We'll rename the current one to this
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
};

// NEW: Two-call mode processMessage
async function processMessageTwoCall(message) {
  let userSequence = null;
  let assistantSequence = null;
  let assistantMessageDiv = null;

  try {
    // Ensure thread exists
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

    // Display user message
    addMessage(message, 'outbound');

    // Generate session ID if needed
    const sessionId = window.sessionId || generateThreadId();
    if (!window.sessionId) {
      window.sessionId = sessionId;
    }

    // Increment sequence for user message
    userSequence = ++currentMessageSequence;

    // Increment sequence for assistant message (will be created by fast endpoint)
    assistantSequence = ++currentMessageSequence;

    const selectedModel = getSelectedModel();
    console.log('⚡ Two-Call Mode: Sending fast request with model:', selectedModel);

    // CALL 1: Fast response
    const fastResponse = await fetch('/chat/process-fast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        threadId: currentThreadId,
        sessionId: sessionId,
        sequenceNumber: userSequence,
        synthesisModel: selectedModel
      })
    });

    if (!fastResponse.ok) {
      const errorData = await fastResponse.json();
      throw new Error(errorData.error?.message || 'Fast chat request failed');
    }

    const fastData = await fastResponse.json();

    if (fastData.success && fastData.data) {
      const { userMessage, assistantMessage, cachedState } = fastData.data;

      // Display initial assistant response immediately
      assistantMessageDiv = addEnhancedMessage(assistantMessage.content, [], true); // true = isIncomplete

      // Add enrichment indicator
      const indicator = addEnrichmentIndicator(assistantMessageDiv);

      // CALL 2: Web enrichment (background)
      if (cachedState) {
        const enrichmentKey = `${currentThreadId}-${assistantSequence}`;

        // Prevent duplicate enrichments
        if (!pendingEnrichments.has(enrichmentKey)) {
          pendingEnrichments.set(enrichmentKey, true);

          // Start web enrichment in background
          enrichWithWeb(
            message,
            currentThreadId,
            assistantSequence,
            assistantMessage.id,
            assistantMessageDiv,
            indicator,
            cachedState
          ).catch(error => {
            console.error('Web enrichment failed:', error);
            removeIndicator(indicator);
          }).finally(() => {
            pendingEnrichments.delete(enrichmentKey);
          });
        }
      }

      await loadChatSessions();
    } else {
      throw new Error(fastData.error || 'Fast chat failed');
    }
  } catch (error) {
    removeLoadingAnimation();
    addMessage(`Error: ${error.message}`, 'inbound');

    // Rollback on error
    if (assistantSequence) {
      currentMessageSequence--;
    }
    if (userSequence) {
      currentMessageSequence--;
    }
  }
}

// Web enrichment function (runs in background)
async function enrichWithWeb(message, threadId, sequenceNumber, messageId, messageDiv, indicator, cachedState) {
  const enrichmentKey = `${threadId}-${sequenceNumber}`;

  // Use backend-configured timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
    console.warn(`Web enrichment timed out after ${chatConfig.WEB_ENRICHMENT_TIMEOUT_MS}ms`);
  }, chatConfig.WEB_ENRICHMENT_TIMEOUT_MS);

  try {
    console.log('🌐 Starting web enrichment for message:', messageId);

    const response = await fetch('/chat/enrich-web', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        threadId: threadId,
        sequenceNumber: sequenceNumber,
        messageId: messageId,
        cachedState: cachedState
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Web enrichment failed:', errorData);
      removeIndicator(indicator);
      return;
    }

    const enrichData = await response.json();

    if (enrichData.success && enrichData.data) {
      const { enrichedContent, webSources, isComplete } = enrichData.data;

      // Update the message content
      updateMessageContent(messageDiv, enrichedContent, webSources);

      // Remove indicator
      removeIndicator(indicator);

      // Mark message as complete
      markMessageComplete(messageDiv);

      console.log('✅ Web enrichment completed for message:', messageId);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`Web enrichment timed out (${chatConfig.WEB_ENRICHMENT_TIMEOUT_MS}ms configured)`);
      removeIndicator(indicator);
      return;
    }
    console.error('Web enrichment error:', error);
    removeIndicator(indicator);
  } finally {
    clearTimeout(timeout);
    pendingEnrichments.delete(enrichmentKey);
  }
}

// Helper functions for two-call mode
function addEnrichmentIndicator(messageDiv) {
  const indicator = document.createElement('div');
  indicator.className = 'enrichment-indicator';
  indicator.innerHTML = `
    <div class="enrichment-pulse">
      <span>🌐 Enriching with web content...</span>
    </div>
  `;
  messageDiv.appendChild(indicator);
  return indicator;
}

function removeIndicator(indicator) {
  if (indicator && indicator.parentNode) {
    indicator.style.opacity = '0';
    setTimeout(() => indicator.remove(), 300);
  }
}

function updateMessageContent(messageDiv, enrichedContent, webSources) {
  // Find the message content area
  const contentArea = messageDiv.querySelector('.message-content') || messageDiv;

  // Update with enriched content
  contentArea.innerHTML = marked.parse(enrichedContent || '');

  // Add web sources if available
  if (webSources && webSources.length > 0) {
    const sourcesDiv = document.createElement('div');
    sourcesDiv.className = 'web-sources';
    sourcesDiv.innerHTML = `
      <div class="sources-header">🌐 Web Sources</div>
      ${webSources.map(source => `
        <div class="source-item">
          <a href="${source.url}" target="_blank">${source.title || source.url}</a>
        </div>
      `).join('')}
    `;
    messageDiv.appendChild(sourcesDiv);
  }
}

function markMessageComplete(messageDiv) {
  messageDiv.classList.remove('incomplete');
  messageDiv.classList.add('complete');
}

// Main processMessage function that routes based on config
async function processMessage(message) {
  // Ensure config is loaded
  if (!configLoaded) {
    console.warn('⚠️ Config not loaded, attempting reload...');
    await loadChatConfig();
  }

  // Use backend-controlled flag ONLY - no window.TWO_CALL_MODE
  if (!chatConfig.TWO_CALL_MODE) {
    console.log('📝 Using single-call mode (backend config)');
    return processMessageOriginal(message);
  }

  console.log('⚡ Using two-call mode (backend config)');
  return processMessageTwoCall(message);
}

// Modified initialization to load config first
const originalInitializeChat = initializeChat;
async function initializeChat() {
  // Disable send button until config loaded
  const sendButton = document.getElementById('sendBtn');
  const messageInput = document.getElementById('messageInput');

  if (sendButton) sendButton.disabled = true;
  if (messageInput) messageInput.disabled = true;

  // Load configuration first
  await loadChatConfig();

  // Re-enable UI
  if (sendButton) sendButton.disabled = false;
  if (messageInput) messageInput.disabled = false;

  // Log final mode
  console.log(`🚀 Chat initialized in ${chatConfig.TWO_CALL_MODE ? 'TWO-CALL' : 'SINGLE-CALL'} mode`);

  // Continue with original initialization
  await originalInitializeChat();

  // Add mode indicator to UI
  addModeIndicator();
}

// Add visual mode indicator to UI
function addModeIndicator() {
  const existingIndicator = document.getElementById('chat-mode-indicator');
  if (!existingIndicator) {
    const indicator = document.createElement('div');
    indicator.id = 'chat-mode-indicator';
    indicator.className = chatConfig.TWO_CALL_MODE ? 'mode-indicator two-call' : 'mode-indicator single-call';
    indicator.textContent = chatConfig.TWO_CALL_MODE ? 'Two-Call Mode' : 'Single-Call Mode';
    indicator.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 8px 16px;
      background: ${chatConfig.TWO_CALL_MODE ? '#4CAF50' : '#2196F3'};
      color: white;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;
    document.body.appendChild(indicator);
  }
}

// IMPORTANT: Override window.addEventListener to ensure our init runs
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeChat);
} else {
  // DOM already loaded
  initializeChat();
}

// Export for debugging
window.chatConfig = chatConfig;
window.reloadConfig = loadChatConfig;