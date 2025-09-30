// src/services/chat-orchestrator.service.js
// DEPRECATED - This service has been replaced by Python-sidecar LangGraph workflow
// All chat processing now routes through chat-proxy.service.js -> Python LangGraph

export async function processUserMessage(userQuery, options = {}) {
  throw new Error('DEPRECATED: chat-orchestrator.service has been replaced by Python-sidecar LangGraph. Use chat-proxy.service.js instead.');
}

export const handleUserQuery = () => {
  throw new Error('DEPRECATED: chat-orchestrator.service has been replaced by Python-sidecar LangGraph. Use chat-proxy.service.js instead.');
};