// src/services/assistant-response.service.js
// Assistant response generation service extracted from enhanced-chat.service.js

import { synthesizeAnswer } from './llm.service.js';
import { decideStyle } from '../utils/intent-style.js';
import { logger } from '../utils/logger.js';

/**
 * Generate enhanced assistant response from Pinecone results
 * @param {string} userQuery - Original user query
 * @param {string} enhancedQuery - Enhanced query with context
 * @param {Array} systemsContext - Systems context array
 * @param {Array} pineconeResults - Pinecone search results
 * @param {Error|null} pineconeError - Any Pinecone error
 * @param {Array} recentMessages - Recent conversation messages
 * @returns {Promise<Object>} - Generated response with content and sources
 */
export async function generateEnhancedAssistantResponse(userQuery, enhancedQuery, systemsContext, pineconeResults, pineconeError, recentMessages) {
  const requestLogger = logger.createRequestLogger();
  
  try {
    let response = '';
    let sources = [];
    let styleDetected = null;
    
    // Build sources array from pinecone results
    if (pineconeResults.length > 0) {
      sources = pineconeResults.map(result => ({
        type: 'pinecone',
        manufacturer: result.manufacturer,
        model: result.model,
        filename: result.filename,
        documentId: result.documentId,
        pages: result.chunks?.map(chunk => chunk.page).filter(Boolean) || [],
        score: result.bestScore
      }));
    }
    
    // Check if this is a pressure-related question and extract specific pressure data
    const isPressureQuestion = userQuery.toLowerCase().includes('pressure');
    let pressureSpecs = [];
    
    if (isPressureQuestion && pineconeResults.length > 0) {
      pressureSpecs = extractPressureSpecs(pineconeResults);
    }
    
    requestLogger.info('🔍 [ASSISTANT RESPONSE] Processing response', { 
      isPressureQuestion,
      pressureSpecsCount: pressureSpecs.length,
      pineconeResultsCount: pineconeResults.length
    });
    
    // If we found specific pressure data, present it directly
    if (isPressureQuestion && pressureSpecs.length > 0) {
      response = generatePressureResponse(pressureSpecs);
    } else {
      // Generate standard response
      response = await generateStandardResponse(userQuery, systemsContext, pineconeResults, sources);
      styleDetected = await detectResponseStyle(userQuery);
    }
    
    requestLogger.info('✅ [ASSISTANT RESPONSE] Response generated', { 
      responseLength: response.length,
      sourcesCount: sources.length,
      styleDetected
    });
    
    return {
      content: response,
      sources,
      styleDetected
    };
  } catch (error) {
    requestLogger.error('❌ [ASSISTANT RESPONSE] Response generation failed', { 
      error: error.message,
      userQuery: userQuery.substring(0, 100)
    });
    
    // Fallback response
    return {
      content: `I apologize, but I encountered an error while processing your request. Please try again or rephrase your question.`,
      sources: [],
      styleDetected: null
    };
  }
}

/**
 * Extract pressure specifications from Pinecone results
 * @param {Array} pineconeResults - Pinecone search results
 * @returns {Array} - Pressure specifications
 */
function extractPressureSpecs(pineconeResults) {
  const pressureSpecs = [];
  
  pineconeResults.forEach((result) => {
    if (result.chunks) {
      result.chunks.forEach((chunk) => {
        const content = chunk.content.toLowerCase();
        // Look for pressure-related content with specific values
        if (content.includes('pressure') && (
          content.includes('bar') || 
          content.includes('psi') || 
          content.includes('working pressure') ||
          content.includes('operating pressure') ||
          content.includes('pressure range') ||
          content.includes('pressure switch') ||
          content.includes('manometer')
        )) {
          pressureSpecs.push({
            content: chunk.content,
            page: chunk.page,
            score: chunk.score
          });
        }
      });
    }
  });
  
  return pressureSpecs;
}

/**
 * Generate pressure-specific response
 * @param {Array} pressureSpecs - Pressure specifications
 * @returns {string} - Formatted pressure response
 */
function generatePressureResponse(pressureSpecs) {
  let response = `## Pressure Specifications\n\n`;
  response += `Based on the technical documentation, here are the specific pressure specifications for your watermaker:\n\n`;
  
  pressureSpecs.forEach((spec, index) => {
    const cleanContent = spec.content.replace(/\s+/g, ' ').trim();
    response += `**${index + 1}.** ${cleanContent}\n\n`;
  });
  
  response += `These specifications provide the exact operating pressures for your equipment. `;
  response += `The manometer on your watermaker will show the current working pressure, which should be within the specified ranges.\n\n`;
  
  return response;
}

/**
 * Generate standard response from Pinecone results
 * @param {string} userQuery - User query
 * @param {Array} systemsContext - Systems context
 * @param {Array} pineconeResults - Pinecone results
 * @param {Array} sources - Sources array
 * @returns {Promise<string>} - Generated response
 */
async function generateStandardResponse(userQuery, systemsContext, pineconeResults, sources) {
  let response = '';
  
  // Add systems context
  if (systemsContext.length > 0) {
    systemsContext.forEach((system) => {
      const systemSource = {
        id: system.asset_uid,
        type: 'system',
        rank: system.rank,
        manufacturer: system.manufacturer || system.asset_uid.split('_')[0],
        model: system.model || system.asset_uid
      };
      sources.push(systemSource);
    });
  } else {
    response += `I understand you're asking about: **"${userQuery}"**\n\n`;
    response += `I couldn't find specific systems matching your query in your database. `;
    response += `Could you provide more details or try a different search term?\n\n`;
  }
  
  // Add Pinecone documentation results
  if (pineconeResults.length > 0) {
    // Generate synthesized answer using LLM
    try {
      const synthesizedAnswer = await synthesizeAnswer(userQuery, pineconeResults, 'brief');
      response += `${synthesizedAnswer}\n\n`;
    } catch (synthesisError) {
      // Fallback to categorized content if synthesis fails
      console.warn('Synthesis failed, using categorized content:', synthesisError.message);
    }
    
    response += `## Detailed Documentation\n`;
    response += `I found relevant documentation for your question:\n\n`;
    
    // Add structured content for each result
    pineconeResults.forEach((result, index) => {
      response += `### ${result.manufacturer} ${result.model}\n`;
      response += generateStructuredContent(result);
      response += `\n`;
    });
    
    // Add relevance scores
    response += `\n**Relevance Scores:**\n`;
    pineconeResults.forEach((result, index) => {
      response += `• ${result.manufacturer} ${result.model}: ${(result.bestScore * 100).toFixed(1)}%\n`;
    });
  }
  
  return response;
}

/**
 * Generate structured content from Pinecone result
 * @param {Object} result - Pinecone result
 * @returns {string} - Structured content
 */
function generateStructuredContent(result) {
  if (!result.chunks || result.chunks.length === 0) {
    return '';
  }
  
  // Group content by type
  const specifications = [];
  const operation = [];
  const safety = [];
  const installation = [];
  const general = [];
  
  result.chunks.forEach((chunk) => {
    if (chunk.content && chunk.content.trim()) {
      const content = chunk.content.toLowerCase();
      if (content.includes('specification') || content.includes('voltage') || content.includes('amp') || content.includes('watt') || content.includes('model')) {
        specifications.push(chunk);
      } else if (content.includes('operation') || content.includes('use') || content.includes('cook') || content.includes('timer')) {
        operation.push(chunk);
      } else if (content.includes('safety') || content.includes('warning') || content.includes('danger') || content.includes('fire')) {
        safety.push(chunk);
      } else if (content.includes('install') || content.includes('unpack') || content.includes('setup')) {
        installation.push(chunk);
      } else {
        general.push(chunk);
      }
    }
  });
  
  let content = '';
  
  // Add structured sections
  if (specifications.length > 0) {
    content += `**📋 Specifications:**\n`;
    specifications.forEach((chunk) => {
      const cleanContent = chunk.content.replace(/\s+/g, ' ').trim();
      content += `• ${cleanContent.substring(0, 150)}${cleanContent.length > 150 ? '...' : ''}\n`;
    });
    content += `\n`;
  }
  
  if (operation.length > 0) {
    content += `**🔧 Operation & Usage:**\n`;
    operation.forEach((chunk) => {
      const cleanContent = chunk.content.replace(/\s+/g, ' ').trim();
      content += `• ${cleanContent.substring(0, 150)}${cleanContent.length > 150 ? '...' : ''}\n`;
    });
    content += `\n`;
  }
  
  if (safety.length > 0) {
    content += `**⚠️ Safety Information:**\n`;
    safety.forEach((chunk) => {
      const cleanContent = chunk.content.replace(/\s+/g, ' ').trim();
      content += `• ${cleanContent.substring(0, 150)}${cleanContent.length > 150 ? '...' : ''}\n`;
    });
    content += `\n`;
  }
  
  if (installation.length > 0) {
    content += `**🔨 Installation & Setup:**\n`;
    installation.forEach((chunk) => {
      const cleanContent = chunk.content.replace(/\s+/g, ' ').trim();
      content += `• ${cleanContent.substring(0, 150)}${cleanContent.length > 150 ? '...' : ''}\n`;
    });
    content += `\n`;
  }
  
  if (general.length > 0 && specifications.length === 0 && operation.length === 0 && safety.length === 0 && installation.length === 0) {
    content += `**📄 Document Information:**\n`;
    general.forEach((chunk) => {
      const cleanContent = chunk.content.replace(/\s+/g, ' ').trim();
      content += `• ${cleanContent.substring(0, 150)}${cleanContent.length > 150 ? '...' : ''}\n`;
    });
    content += `\n`;
  }
  
  return content;
}

/**
 * Detect response style for the query
 * @param {string} userQuery - User query
 * @returns {string|null} - Detected style
 */
async function detectResponseStyle(userQuery) {
  try {
    return decideStyle(userQuery);
  } catch (error) {
    return null;
  }
}
