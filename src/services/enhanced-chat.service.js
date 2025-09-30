// src/services/enhanced-chat.service.js
// DEPRECATED - This service has been replaced by Python-sidecar LangGraph workflow
// All chat processing now routes through chat-proxy.service.js -> Python LangGraph

export async function processUserMessage(userQuery, options = {}) {
  throw new Error('DEPRECATED: enhanced-chat.service has been replaced by Python-sidecar LangGraph. Use chat-proxy.service.js instead.');
}

export async function retrieveWithSpecBias(params) {
  throw new Error('DEPRECATED: enhanced-chat.service has been replaced by Python-sidecar LangGraph. Use chat-proxy.service.js instead.');
}

export async function listUserChats({ limit = 10, cursor } = {}) {
  throw new Error('DEPRECATED: enhanced-chat.service has been replaced by Python-sidecar LangGraph. Use chat-proxy.service.js instead.');
}

export async function getChatHistory(threadId, options = {}) {
  throw new Error('DEPRECATED: enhanced-chat.service has been replaced by Python-sidecar LangGraph. Use chat-proxy.service.js instead.');
}

export async function deleteChatSession(sessionId) {
  throw new Error('DEPRECATED: enhanced-chat.service has been replaced by Python-sidecar LangGraph. Use chat-proxy.service.js instead.');
}

export async function getChatContext(threadId) {
  throw new Error('DEPRECATED: enhanced-chat.service has been replaced by Python-sidecar LangGraph. Use chat-proxy.service.js instead.');
}

// Throw error for any import attempts
export const handleUserQuery = () => {
  throw new Error('DEPRECATED: enhanced-chat.service has been replaced by Python-sidecar LangGraph. Use chat-proxy.service.js instead.');
};