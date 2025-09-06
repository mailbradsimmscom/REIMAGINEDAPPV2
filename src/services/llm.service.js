import { personality, stylePresets } from '../config/personality.js';
import { getStyleOpening } from '../utils/intent-style.js';
import { oaiText, truncateContent } from '../clients/openai.client.js';
import { logger } from '../utils/logger.js';

export async function enhanceQuery(userQuery, systemsContext = []) {
  try {
    // DEBUG: Log input query
    console.log('🔍 [QUERY ENHANCEMENT] Input query:', userQuery);
    console.log('🔍 [QUERY ENHANCEMENT] Systems context length:', systemsContext.length);
    
    const prompt = buildQueryEnhancementPrompt(userQuery, systemsContext);
    
    // DEBUG: Log the prompt sent to LLM
    console.log('🔍 [QUERY ENHANCEMENT] Prompt sent to LLM:', prompt);
    
    const systemPrompt = `${personality.systemPrompt}

You are enhancing a user query by incorporating relevant context from systems data. Return only the enhanced query, nothing else.`;
    
    const enhancedQuery = await oaiText({
      system: systemPrompt,
      user: prompt,
      maxOutputTokens: 200,
      seed: 11
    });
    
    // DEBUG: Log enhanced query output
    console.log('🔍 [QUERY ENHANCEMENT] Enhanced query:', enhancedQuery);
    console.log('🔍 [QUERY ENHANCEMENT] Contains "pressure":', enhancedQuery.toLowerCase().includes('pressure'));
    
    return enhancedQuery;
  } catch (error) {
    throw new Error(`Failed to enhance query: ${error.message}`);
  }
}

export async function summarizeConversation(messages, systemsContext = []) {
  try {
    const prompt = buildSummarizationPrompt(messages, systemsContext);
    
    const systemPrompt = `${personality.systemPrompt}

You are summarizing a conversation. Provide a concise summary that captures the key points and context. Return only the summary, nothing else.`;
    
    return await oaiText({
      system: systemPrompt,
      user: prompt,
      maxOutputTokens: 300,
      seed: 11
    });
  } catch (error) {
    throw new Error(`Failed to summarize conversation: ${error.message}`);
  }
}

export async function synthesizeAnswer(userQuery, categorizedResults, style = 'brief') {
  try {
    const prompt = buildSynthesisPrompt(userQuery, categorizedResults, style);
    
    // Build system prompt with style rules
    const styleRule = stylePresets[style]?.rule || stylePresets.brief.rule;
    const systemPrompt = `${personality.systemPrompt}

You are providing clear, direct answers to user questions about equipment and systems. Based on the provided categorized information, synthesize a comprehensive answer that directly addresses the user's question.

CRITICAL STYLE REQUIREMENT: ${styleRule}

You MUST follow this style rule exactly. Do not exceed the specified limits. Be concise and direct.

IMPORTANT: Always maintain the optimistic, curious, people-person tone throughout your response. Start with an encouraging opening, show genuine interest in helping the user, and end with an optimistic note about how this information can help them.`;
    
    return await oaiText({
      system: systemPrompt,
      user: prompt,
      style,
      maxOutputTokens: 300,
      seed: 11
    });
  } catch (error) {
    throw new Error(`Failed to synthesize answer: ${error.message}`);
  }
}

export async function generateChatName(messages, systemsContext = []) {
  try {
    const prompt = buildNamingPrompt(messages, systemsContext);
    
    const systemPrompt = `${personality.systemPrompt}

You are creating a concise, descriptive name for a chat conversation. Create a 2-6 word summary that captures the main topic or question. Return only the name, nothing else. Examples: "Watermaker Installation", "GPS System Troubleshooting", "Navigation Equipment Setup".`;
    
    const name = await oaiText({
      system: systemPrompt,
      user: prompt,
      maxOutputTokens: 50,
      seed: 11
    });
    
    // Ensure it's 2-6 words
    const words = name.split(' ').filter(word => word.length > 0);
    if (words.length < 2) {
      return 'New Chat';
    } else if (words.length > 6) {
      return words.slice(0, 6).join(' ');
    }
    
    return name;
  } catch (error) {
    throw new Error(`Failed to generate chat name: ${error.message}`);
  }
}

function buildQueryEnhancementPrompt(userQuery, systemsContext) {
  let prompt = `User Query: "${userQuery}"\n\n`;
  
  if (systemsContext.length > 0) {
    prompt += `Relevant Systems Context:\n`;
    systemsContext.forEach((system, index) => {
      prompt += `${index + 1}. ${system.id}\n`;
    });
    prompt += `\nEnhance the user query by incorporating relevant context from the systems data. Make it more specific and actionable for searching technical documentation.`;
  } else {
    prompt += `Enhance this query to be more specific and actionable for searching technical documentation.`;
  }
  
  return prompt;
}

function buildSummarizationPrompt(messages, systemsContext) {
  let prompt = `Conversation to summarize:\n\n`;
  
  messages.forEach((msg, index) => {
    prompt += `${msg.role}: ${msg.content}\n`;
  });
  
  if (systemsContext.length > 0) {
    prompt += `\nRelevant Systems Context:\n`;
    systemsContext.forEach((system, index) => {
      prompt += `${index + 1}. ${system.id}\n`;
    });
  }
  
  prompt += `\nProvide a concise summary of this conversation, highlighting the key questions, answers, and technical context discussed.`;
  
  return prompt;
}

function buildSynthesisPrompt(userQuery, categorizedResults, style = 'brief') {
  let prompt = `User Question: "${userQuery}"\n\n`;
  
  // Add style-specific opening
  const opening = getStyleOpening(style);
  prompt += `${opening}\n\n`;
  
  prompt += `Categorized Technical Information:\n\n`;
  
  categorizedResults.forEach((result, index) => {
    prompt += `Equipment: ${result.manufacturer} ${result.model}\n`;
    prompt += `Relevance Score: ${result.bestScore.toFixed(3)}\n\n`;
    
    if (result.chunks && result.chunks.length > 0) {
      // Group content by type
      const specifications = [];
      const operation = [];
      const safety = [];
      const installation = [];
      const general = [];
      
      result.chunks.forEach((chunk) => {
        if (chunk.content && chunk.content.trim()) {
          const content = chunk.content.toLowerCase();
          if (content.includes('specification') || content.includes('voltage') || content.includes('amp') || content.includes('watt') || content.includes('model') || content.includes('pressure') || content.includes('flow') || content.includes('capacity')) {
            specifications.push(chunk.content);
          } else if (content.includes('operation') || content.includes('use') || content.includes('cook') || content.includes('timer') || content.includes('start') || content.includes('stop') || content.includes('function')) {
            operation.push(chunk.content);
          } else if (content.includes('safety') || content.includes('warning') || content.includes('danger') || content.includes('fire') || content.includes('caution')) {
            safety.push(chunk.content);
          } else if (content.includes('install') || content.includes('unpack') || content.includes('setup') || content.includes('mount')) {
            installation.push(chunk.content);
          } else {
            general.push(chunk.content);
          }
        }
      });
      
      if (specifications.length > 0) {
        prompt += `📋 Specifications:\n`;
        specifications.forEach((spec, i) => {
          const truncatedSpec = truncateContent(spec, 600);
          prompt += `• ${truncatedSpec}\n`;
        });
        prompt += `\n`;
      }
      
      if (operation.length > 0) {
        prompt += `🔧 Operation & Usage:\n`;
        operation.forEach((op, i) => {
          const truncatedOp = truncateContent(op, 600);
          prompt += `• ${truncatedOp}\n`;
        });
        prompt += `\n`;
      }
      
      if (safety.length > 0) {
        prompt += `⚠️ Safety Information:\n`;
        safety.forEach((safe, i) => {
          const truncatedSafe = truncateContent(safe, 600);
          prompt += `• ${truncatedSafe}\n`;
        });
        prompt += `\n`;
      }
      
      if (installation.length > 0) {
        prompt += `🔨 Installation & Setup:\n`;
        installation.forEach((inst, i) => {
          const truncatedInst = truncateContent(inst, 600);
          prompt += `• ${truncatedInst}\n`;
        });
        prompt += `\n`;
      }
      
      if (general.length > 0 && specifications.length === 0 && operation.length === 0 && safety.length === 0 && installation.length === 0) {
        prompt += `📄 General Information:\n`;
        general.forEach((gen, i) => {
          const truncatedGen = truncateContent(gen, 600);
          prompt += `• ${truncatedGen}\n`;
        });
        prompt += `\n`;
      }
    }
  });
  
  prompt += `\nBased on this categorized technical information, provide a clear, direct answer to the user's question. 

IMPORTANT: When the user asks for specific technical specifications (like pressure, voltage, capacity, etc.), quote the exact values from the specifications section above. Do not give generic responses - use the specific technical data provided.

Focus on the most relevant information and provide specific details when available. Be professional, accurate, and helpful.`;
  
  return prompt;
}

function buildNamingPrompt(messages, systemsContext) {
  let prompt = `Create a descriptive name for this chat conversation:\n\n`;
  
  // Use last few messages for context
  const recentMessages = messages.slice(-3);
  recentMessages.forEach((msg, index) => {
    prompt += `${msg.role}: ${msg.content}\n`;
  });
  
  if (systemsContext.length > 0) {
    prompt += `\nSystems discussed: ${systemsContext.map(s => s.asset_uid).join(', ')}`;
  }
  
  prompt += `\nGenerate a concise, descriptive name that captures the main topic or question.`;
  
  return prompt;
}

// --- Asset intent & summary helpers ---
export async function classifyQueryIntent(userQuery) {
  const requestLogger = logger.createRequestLogger();
  const messages = [
    { role: 'system', content: [
      'Classify the user query into EXACTLY one of:',
      'asset_summary | spec_question | how_to | troubleshoot | other.',
      'Reply with ONLY the single label. No extra text.'
    ].join(' ') },
    { role: 'user', content: String(userQuery || '').trim() }
  ];
  
  try {
    // Short timeout so classification can't block the pipeline
    const label = await oaiText({
      system: messages[0].content,
      user: messages[1].content,
      maxOutputTokens: 20,
      seed: 11
    });
    
    const s = String(label || '').toLowerCase().trim();
    if (s === 'asset_summary' || s === 'spec_question' || s === 'how_to' || s === 'troubleshoot' || s === 'other') {
      return s;
    }
    // If the model returns anything unexpected, don't throw—return 'other'
    requestLogger.warn({ got: s }, 'Intent classifier returned unexpected label; using "other"');
    return 'other';
  } catch (err) {
    requestLogger.error({ err: String(err) }, 'Intent classifier failed; using "other"');
    return 'other';
  }
}

export async function generateAssetSummary({ userQuery, assetHints = {}, contextBlocks = [] }) {
  try {
    // Keep the LLM on rails; no boilerplate tips, no raw dumps.
    const systemPrompt = [
      'You summarize a boat asset for an owner.',
      'Output <= 5 sentences. Be specific, concise, and practical.',
      'Cover: identity/type, purpose, 3–4 key specs, notable components, and 1 relevant usage/maintenance note ONLY if it is directly supported by the provided context.',
      'Do NOT add generic safety/warranty boilerplate. Do NOT invent details. If a fact is uncertain, omit it.',
    ].join(' ');

    const ctx = contextBlocks
      .map((c, i) => `[#${i+1}] ${c.slice(0, 800)}`) // keep tokens in check
      .join('\n\n');

    const userPrompt = [
      `User query: ${userQuery}`,
      assetHints?.manufacturer ? `Manufacturer: ${assetHints.manufacturer}` : '',
      assetHints?.model ? `Model: ${assetHints.model}` : '',
      '\nContext (extract facts ONLY from below):\n',
      ctx || '(no extra context)',
      '\nFormat: plain markdown, <= 5 sentences, no lists.'
    ].filter(Boolean).join('\n');

    return await oaiText({
      system: systemPrompt,
      user: userPrompt,
      maxOutputTokens: 300,
      seed: 11
    });
  } catch (error) {
    throw new Error(`Failed to generate asset summary: ${error.message}`);
  }
}

export default {
  enhanceQuery,
  summarizeConversation,
  generateChatName,
  synthesizeAnswer,
  classifyQueryIntent,
  generateAssetSummary
};
