// Centralized OpenAI client for consistent API calls
// Handles timeouts, retries, and configuration management

import { logger } from '../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Makes a structured JSON API call to OpenAI
 * @param {Object} params - Configuration object
 * @param {string} params.system - System prompt
 * @param {string} params.user - User prompt
 * @param {Object} params.schema - JSON schema for structured output
 * @param {string} params.model - OpenAI model to use
 * @param {number} params.maxOutputTokens - Maximum tokens to generate
 * @param {number} params.seed - Seed for deterministic output
 * @returns {Promise<Object>} - Parsed JSON response
 */
export async function oaiJson({ system, user, schema, model, maxOutputTokens, seed }) {
  const { getEnv } = await import('../config/env.js');
  const env = getEnv();
  
  const openaiApiKey = env.OPENAI_API_KEY;
  const openaiModel = model || env.OPENAI_MODEL || 'gpt-4';
  const maxTokens = maxOutputTokens || 200;
  const temperature = 0; // Always 0 for structured JSON
  const timeoutMs = parseInt(env.OPENAI_TIMEOUT_SECONDS || '15') * 1000;
  const retryAttempts = parseInt(env.OPENAI_RETRY_ATTEMPTS || '3');

  const requestBody = {
    model: openaiModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    max_tokens: maxTokens,
    temperature,
    seed: seed || 11,
    response_format: { type: "json_object" }
  };

  return await makeOpenAICall(requestBody, openaiApiKey, timeoutMs, retryAttempts);
}

/**
 * Makes a natural language API call to OpenAI
 * @param {Object} params - Configuration object
 * @param {string} params.system - System prompt
 * @param {string} params.user - User prompt
 * @param {string} params.model - OpenAI model to use
 * @param {number} params.maxOutputTokens - Maximum tokens to generate
 * @param {number} params.seed - Seed for deterministic output
 * @param {string} params.style - Style preset for temperature control
 * @returns {Promise<string>} - Generated text response
 */
export async function oaiText({ system, user, model, maxOutputTokens, seed, style = 'brief' }) {
  const { getEnv } = await import('../config/env.js');
  const env = getEnv();
  
  const openaiApiKey = env.OPENAI_API_KEY;
  const openaiModel = model || env.OPENAI_MODEL || 'gpt-4';
  const maxTokens = maxOutputTokens || 300;
  
  // Use environment variable for temperature, with style-based overrides
  let temperature = parseFloat(env.LLM_TEMPERATURE || '0.7');
  
  // Override temperature for specific styles
  if (style === 'specBrief' || style === 'technical') {
    temperature = 0; // Deterministic for technical specs
  }
  
  const timeoutMs = parseInt(env.OPENAI_TIMEOUT_SECONDS || '15') * 1000;
  const retryAttempts = parseInt(env.OPENAI_RETRY_ATTEMPTS || '3');

  const requestBody = {
    model: openaiModel,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    max_tokens: maxTokens,
    temperature,
    seed: seed || 11
  };

  const response = await makeOpenAICall(requestBody, openaiApiKey, timeoutMs, retryAttempts);
  return response.choices[0].message.content.trim();
}

/**
 * Makes the actual OpenAI API call with retry logic
 * @param {Object} requestBody - Request body for OpenAI API
 * @param {string} openaiApiKey - API key
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {number} retryAttempts - Number of retry attempts
 * @returns {Promise<Object>} - OpenAI API response
 */
async function makeOpenAICall(requestBody, openaiApiKey, timeoutMs, retryAttempts) {
  let lastError;
  
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const data = await response.json();
      
      // Validate JSON response for structured calls
      if (requestBody.response_format?.type === 'json_object') {
        try {
          const content = data.choices[0].message.content;
          JSON.parse(content);
        } catch (jsonError) {
          throw new Error(`Invalid JSON response: ${jsonError.message}`);
        }
      }
      
      requestLogger.info('OpenAI API call successful', {
        attempt,
        model: requestBody.model,
        temperature: requestBody.temperature,
        maxTokens: requestBody.max_tokens
      });
      
      return data;
      
    } catch (error) {
      lastError = error;
      
      // Don't retry on certain errors
      if (error.name === 'AbortError' || 
          (error.message.includes('401') || error.message.includes('403'))) {
        break;
      }
      
      // Exponential backoff for retries
      if (attempt < retryAttempts) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        requestLogger.warn(`OpenAI API call failed, retrying in ${backoffMs}ms`, {
          attempt,
          error: error.message,
          backoffMs
        });
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }
  
  requestLogger.error('OpenAI API call failed after all retries', {
    attempts: retryAttempts,
    error: lastError?.message
  });
  
  throw new Error(`OpenAI API call failed after ${retryAttempts} attempts: ${lastError?.message}`);
}

/**
 * Truncates text content to specified length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} - Truncated text
 */
export function truncateContent(text, maxLength = 600) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

export default {
  oaiJson,
  oaiText,
  truncateContent
};
