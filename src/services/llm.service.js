import { personality } from '../config/personality.js';

export async function enhanceQuery(userQuery, systemsContext = []) {
  try {
    const prompt = buildQueryEnhancementPrompt(userQuery, systemsContext);
    const { getEnv } = await import('../config/env.js');
    const { OPENAI_API_KEY: openaiApiKey, OPENAI_MODEL: openaiModel = 'gpt-4', LLM_TEMPERATURE: openaiTemperature = '0.7' } = getEnv({ loose: true });
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: openaiModel,
        messages: [
          {
            role: 'system',
            content: `${personality.systemPrompt}

You are enhancing a user query by incorporating relevant context from systems data. Return only the enhanced query, nothing else.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 200,
        temperature: Number(openaiTemperature)
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
    const { getEnv } = await import('../config/env.js');
    const { OPENAI_API_KEY: openaiApiKey, OPENAI_MODEL: openaiModel = 'gpt-4', LLM_TEMPERATURE: openaiTemperature = '0.7' } = getEnv({ loose: true });
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: openaiModel,
        messages: [
          {
            role: 'system',
            content: `${personality.systemPrompt}

You are summarizing a conversation. Provide a concise summary that captures the key points and context. Return only the summary, nothing else.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 300,
        temperature: Number(openaiTemperature)
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

export async function synthesizeAnswer(userQuery, categorizedResults) {
  try {
    const prompt = buildSynthesisPrompt(userQuery, categorizedResults);
    const { getEnv } = await import('../config/env.js');
    const { OPENAI_API_KEY: openaiApiKey, OPENAI_MODEL: openaiModel = 'gpt-4', LLM_TEMPERATURE: openaiTemperature = '0.7' } = getEnv({ loose: true });
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: openaiModel,
        messages: [
          {
            role: 'system',
            content: `${personality.systemPrompt}

You are providing clear, direct answers to user questions about equipment and systems. Based on the provided categorized information, synthesize a comprehensive answer that directly addresses the user's question.

IMPORTANT: Always maintain the optimistic, curious, people-person tone throughout your response. Start with an encouraging opening, show genuine interest in helping the user, and end with an optimistic note about how this information can help them.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 800,
        temperature: Number(openaiTemperature)
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    throw new Error(`Failed to synthesize answer: ${error.message}`);
  }
}

export async function generateChatName(messages, systemsContext = []) {
  try {
    const prompt = buildNamingPrompt(messages, systemsContext);
    const { getEnv } = await import('../config/env.js');
    const { OPENAI_API_KEY: openaiApiKey, OPENAI_MODEL: openaiModel = 'gpt-4', LLM_TEMPERATURE: openaiTemperature = '0.7' } = getEnv({ loose: true });
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: openaiModel,
        messages: [
          {
            role: 'system',
            content: `${personality.systemPrompt}

You are creating a concise, descriptive name for a chat conversation. Create a 2-6 word summary that captures the main topic or question. Return only the name, nothing else. Examples: "Watermaker Installation", "GPS System Troubleshooting", "Navigation Equipment Setup".`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 50,
        temperature: Number(openaiTemperature)
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

function buildSynthesisPrompt(userQuery, categorizedResults) {
  let prompt = `User Question: "${userQuery}"\n\n`;
  
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
          prompt += `• ${spec.substring(0, 200)}${spec.length > 200 ? '...' : ''}\n`;
        });
        prompt += `\n`;
      }
      
      if (operation.length > 0) {
        prompt += `🔧 Operation & Usage:\n`;
        operation.forEach((op, i) => {
          prompt += `• ${op.substring(0, 200)}${op.length > 200 ? '...' : ''}\n`;
        });
        prompt += `\n`;
      }
      
      if (safety.length > 0) {
        prompt += `⚠️ Safety Information:\n`;
        safety.forEach((safe, i) => {
          prompt += `• ${safe.substring(0, 200)}${safe.length > 200 ? '...' : ''}\n`;
        });
        prompt += `\n`;
      }
      
      if (installation.length > 0) {
        prompt += `🔨 Installation & Setup:\n`;
        installation.forEach((inst, i) => {
          prompt += `• ${inst.substring(0, 200)}${inst.length > 200 ? '...' : ''}\n`;
        });
        prompt += `\n`;
      }
      
      if (general.length > 0 && specifications.length === 0 && operation.length === 0 && safety.length === 0 && installation.length === 0) {
        prompt += `📄 General Information:\n`;
        general.forEach((gen, i) => {
          prompt += `• ${gen.substring(0, 200)}${gen.length > 200 ? '...' : ''}\n`;
        });
        prompt += `\n`;
      }
    }
  });
  
  prompt += `\nBased on this categorized technical information, provide a clear, direct answer to the user's question. Focus on the most relevant information and provide specific details when available. Be professional, accurate, and helpful.`;
  
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
  generateChatName,
  synthesizeAnswer
};
