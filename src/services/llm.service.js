import { env } from '../config/env.js';

export async function enhanceQuery(userQuery, systemsContext = []) {
  try {
    const prompt = buildQueryEnhancementPrompt(userQuery, systemsContext);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.openaiModel,
        messages: [
          {
            role: 'system',
            content: 'You are an expert assistant that helps enhance user queries by incorporating relevant context from systems data. Return only the enhanced query, nothing else.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 200,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    throw new Error(`Failed to enhance query: ${error.message}`);
  }
}

export async function summarizeConversation(messages, systemsContext = []) {
  try {
    const prompt = buildSummarizationPrompt(messages, systemsContext);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.openaiModel,
        messages: [
          {
            role: 'system',
            content: 'You are an expert at summarizing conversations. Provide a concise summary that captures the key points and context. Return only the summary, nothing else.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 300,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    throw new Error(`Failed to summarize conversation: ${error.message}`);
  }
}

export async function generateChatName(messages, systemsContext = []) {
  try {
    const prompt = buildNamingPrompt(messages, systemsContext);
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.openaiModel,
        messages: [
          {
            role: 'system',
            content: 'You are an expert at creating concise, descriptive names for chat conversations. Create a 2-6 word summary that captures the main topic or question. Return only the name, nothing else. Examples: "Watermaker Installation", "GPS System Troubleshooting", "Navigation Equipment Setup".'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 50,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const name = data.choices[0].message.content.trim();
    
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

function buildNamingPrompt(messages, systemsContext) {
  let prompt = `Create a descriptive name for this chat conversation:\n\n`;
  
  // Use last few messages for context
  const recentMessages = messages.slice(-3);
  recentMessages.forEach((msg, index) => {
    prompt += `${msg.role}: ${msg.content}\n`;
  });
  
  if (systemsContext.length > 0) {
    prompt += `\nSystems discussed: ${systemsContext.map(s => s.id).join(', ')}`;
  }
  
  prompt += `\nGenerate a concise, descriptive name that captures the main topic or question.`;
  
  return prompt;
}

export default {
  enhanceQuery,
  summarizeConversation,
  generateChatName
};
