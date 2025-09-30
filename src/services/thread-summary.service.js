import { updateChatThread, updateChatMessage, getChatMessages } from '../repositories/chat.repository.js';
import { logger } from '../utils/logger.js';
import { getEnv } from '../config/env.js';

/**
 * Thread Summary Service
 *
 * Generates LLM-based summaries for chat threads after the first Q&A pair
 */

/**
 * Call OpenAI API specifically for summary generation with temperature support
 * @param {string} systemPrompt - System prompt
 * @param {string} userPrompt - User prompt
 * @param {string} model - OpenAI model to use
 * @param {number} temperature - Temperature for response generation
 * @returns {Promise<Object|null>} - Parsed JSON response or null if failed
 */
async function callOpenAISummary(systemPrompt, userPrompt, model, temperature) {
  const env = getEnv();
  const requestLogger = logger.createRequestLogger();


  const openaiApiKey = env.OPENAI_API_KEY;
  const timeoutMs = parseInt(env.OPENAI_TIMEOUT_SECONDS || '15') * 1000;

  const requestBody = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_completion_tokens: 500,
    temperature: temperature,
    response_format: { type: "json_object" }
  };

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

    if (data.choices && data.choices[0] && data.choices[0].message) {
      const content = data.choices[0].message.content;
      return JSON.parse(content);
    } else {
      throw new Error('Invalid OpenAI response format');
    }

  } catch (error) {
    requestLogger.error('❌ OpenAI summary call failed', {
      error: error.message,
      errorStack: error.stack,
      model,
      temperature,
      requestBody: JSON.stringify(requestBody, null, 2)
    });
    return null;
  }
}

/**
 * Generate a summary for a thread using the first Q&A pair
 * @param {string} threadId - Thread ID to generate summary for
 * @returns {Promise<string|null>} - Generated summary or null if failed
 */
export async function generateThreadSummary(threadId) {
  const requestLogger = logger.createRequestLogger();
  const env = getEnv();


  try {
    requestLogger.info('🎯 Generating thread summary', { threadId });

    // Get the first two messages (user question + assistant answer)
    const messages = await getChatMessages(threadId, { limit: 2 });


    if (!messages || messages.length < 2) {
      requestLogger.warn('❌ Not enough messages for summary generation', {
        threadId,
        messageCount: messages?.length || 0
      });
      return null;
    }

    // Ensure we have the first Q&A pair in correct order
    const sortedMessages = messages.sort((a, b) => a.sequence_number - b.sequence_number);
    const userMessage = sortedMessages.find(m => m.role === 'user');
    const assistantMessage = sortedMessages.find(m => m.role === 'assistant');


    if (!userMessage || !assistantMessage) {
      requestLogger.warn('❌ Missing user or assistant message in first pair', {
        threadId,
        hasUser: !!userMessage,
        hasAssistant: !!assistantMessage
      });
      return null;
    }

    // Generate summary using OpenAI

    const summary = await generateSummaryFromMessages(
      userMessage.content,
      assistantMessage.content
    );


    if (!summary) {
      requestLogger.warn('❌ Failed to generate summary', { threadId });
      return null;
    }

    // Store summary in database
    await updateChatThread(threadId, { summary });

    requestLogger.info('✅ Thread summary generated and stored', {
      threadId,
      summary,
      summaryLength: summary.length
    });

    return summary;

  } catch (error) {
    requestLogger.error('❌ Error generating thread summary', {
      threadId,
      error: error.message,
      stack: error.stack
    });
    return null;
  }
}

/**
 * Generate QA summary JSON from user question and assistant answer
 * @param {string} userQuestion - User's question
 * @param {string} assistantAnswer - Assistant's answer
 * @returns {Promise<Object|null>} - Generated QA summary JSON or null if failed
 */
export async function generateQASummary(userQuestion, assistantAnswer) {
  const requestLogger = logger.createRequestLogger();
  const env = getEnv();

  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      requestLogger.info(`🔄 QA summary generation attempt ${attempt}/${maxRetries}`, {
        userQuestionLength: userQuestion.length,
        assistantAnswerLength: assistantAnswer.length
      });

      const systemPrompt = `You are a marine equipment conversation summarizer. Your task is to create a structured summary of a question and answer pair about marine equipment and procedures.

Rules:
- Focus on marine equipment, anchoring, and boat operations
- Return the result as JSON with the following structure:
  {
    "topic": "brief description (under 10 words)",
    "equipment_mentioned": ["array", "of", "equipment", "names"],
    "key_points": ["actionable points under 10 words each"],
    "user_intent": "seeking specs/troubleshooting/learning procedure/comparing options",
    "technical_details": "specific measurements, specs, procedures (under 20 words)",
    "follow_up_likely": true/false
  }
- Be specific and actionable
- Use clear, simple language
- Do not include quotes or special characters in field values`;

      const userPrompt = `Summarize this marine equipment conversation:

User Question: ${userQuestion}

Assistant Answer: ${assistantAnswer}`;

      const summaryModel = env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';
      const summaryTemperature = parseFloat(env.OPENAI_SUMMARY_MODEL_temperature || '0.3');

      // Use our custom OpenAI function for summary generation with temperature support
      const response = await callOpenAISummary(
        systemPrompt,
        userPrompt,
        summaryModel,
        summaryTemperature
      );

      if (response && typeof response === 'object') {
        // DEBUG: Log the raw response from OpenAI
        requestLogger.info('🔍 Raw OpenAI response:', {
          response: JSON.stringify(response, null, 2),
          responseType: typeof response,
          responseKeys: Object.keys(response)
        });

        // Validate the response structure
        const requiredFields = ['topic', 'equipment_mentioned', 'key_points', 'user_intent', 'technical_details', 'follow_up_likely'];
        const missingFields = requiredFields.filter(field => !(field in response));

        if (missingFields.length > 0) {
          requestLogger.error(`❌ Missing required fields in response:`, {
            missingFields,
            receivedFields: Object.keys(response),
            fullResponse: response
          });
          throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
        }

        // Validate word counts
        const topicWords = response.topic.split(/\s+/).length;
        if (topicWords > 10) {
          response.topic = response.topic.split(/\s+/).slice(0, 10).join(' ');
        }

        const techDetailWords = response.technical_details.split(/\s+/).length;
        if (techDetailWords > 20) {
          response.technical_details = response.technical_details.split(/\s+/).slice(0, 20).join(' ');
        }

        // Ensure arrays are arrays
        if (!Array.isArray(response.equipment_mentioned)) {
          response.equipment_mentioned = [];
        }
        if (!Array.isArray(response.key_points)) {
          response.key_points = [];
        }

        // Truncate key points if too long
        response.key_points = response.key_points.map(point => {
          const words = point.split(/\s+/);
          return words.length > 10 ? words.slice(0, 10).join(' ') : point;
        });

        requestLogger.info('✅ QA summary generated successfully', {
          topic: response.topic,
          equipmentCount: response.equipment_mentioned.length,
          keyPointsCount: response.key_points.length,
          attempt
        });

        return response;
      } else {
        throw new Error('Invalid response format from OpenAI');
      }

    } catch (error) {
      lastError = error;
      requestLogger.warn(`❌ QA summary generation attempt ${attempt} failed`, {
        error: error.message,
        attempt,
        maxRetries
      });

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  requestLogger.error('❌ All QA summary generation attempts failed', {
    maxRetries,
    lastError: lastError?.message
  });

  return null;
}

/**
 * Process and store QA summary for an assistant message
 * @param {string} threadId - Thread ID containing the messages
 * @param {number} assistantSequenceNumber - Sequence number of the assistant message
 * @returns {Promise<Object|null>} - Generated QA summary or null if failed
 */
export async function processQASummaryForMessage(threadId, assistantSequenceNumber) {
  const requestLogger = logger.createRequestLogger();

  try {
    requestLogger.info('🎯 Processing QA summary for message', {
      threadId,
      assistantSequenceNumber
    });

    // Get the assistant message and the previous user message
    const messages = await getChatMessages(threadId, {
      limit: 10,
      orderBy: 'sequence_number',
      orderDirection: 'DESC'
    });

    if (!messages || messages.length < 2) {
      requestLogger.warn('❌ Not enough messages for QA summary', {
        threadId,
        messageCount: messages?.length || 0
      });
      return null;
    }

    // Find the assistant message and the preceding user message
    const assistantMessage = messages.find(m =>
      m.sequence_number === assistantSequenceNumber && m.role === 'assistant'
    );

    const userMessage = messages.find(m =>
      m.sequence_number === assistantSequenceNumber - 1 && m.role === 'user'
    );

    if (!assistantMessage || !userMessage) {
      requestLogger.warn('❌ Missing required messages for QA summary', {
        threadId,
        assistantSequenceNumber,
        hasAssistant: !!assistantMessage,
        hasUser: !!userMessage
      });
      return null;
    }

    // Generate QA summary
    requestLogger.info('🔄 Generating QA summary', {
      threadId,
      userContentLength: userMessage.content?.length || 0,
      assistantContentLength: assistantMessage.content?.length || 0
    });

    const qaSummary = await generateQASummary(
      userMessage.content,
      assistantMessage.content
    );

    if (!qaSummary) {
      requestLogger.warn('❌ Failed to generate QA summary', { threadId });
      return null;
    }

    // Update the assistant message with QA summary in processing_metadata
    const existingMetadata = assistantMessage.processing_metadata || {};
    const updatedMetadata = {
      ...existingMetadata,
      qa_summary: qaSummary
    };

    await updateChatMessage(assistantMessage.id, {
      processing_metadata: updatedMetadata
    });

    requestLogger.info('✅ QA summary processed and stored', {
      threadId,
      messageId: assistantMessage.id,
      topic: qaSummary.topic,
      equipmentCount: qaSummary.equipment_mentioned?.length || 0,
      keyPointsCount: qaSummary.key_points?.length || 0
    });

    return qaSummary;

  } catch (error) {
    requestLogger.error('❌ Error processing QA summary', {
      threadId,
      assistantSequenceNumber,
      error: error.message,
      stack: error.stack
    });
    return null;
  }
}

/**
 * Check if a message needs QA summary generation and generate if needed
 * This is called after an assistant message is saved
 * @param {string} threadId - Thread ID to check
 * @param {number} sequenceNumber - Sequence number of the just-saved message
 * @param {string} role - Role of the just-saved message
 */
export async function checkAndGenerateQASummary(threadId, sequenceNumber, role) {
  const requestLogger = logger.createRequestLogger();

  try {
    // Only generate QA summary for assistant messages (even sequence numbers)
    if (role !== 'assistant' || sequenceNumber % 2 !== 0) {
      return;
    }

    requestLogger.info('🎯 Checking if message needs QA summary generation', {
      threadId,
      sequenceNumber,
      role
    });

    // Generate QA summary asynchronously (don't block the response)
    setImmediate(async () => {
      try {
        await processQASummaryForMessage(threadId, sequenceNumber);
      } catch (error) {
        requestLogger.error('❌ Failed to process QA summary', {
          threadId,
          sequenceNumber,
          error: error.message,
          stack: error.stack
        });
      }
    });

  } catch (error) {
    requestLogger.error('❌ Error in checkAndGenerateQASummary', {
      threadId,
      sequenceNumber,
      role,
      error: error.message
    });
  }
}

/**
 * Generate summary text from user question and assistant answer
 * @param {string} userQuestion - User's question
 * @param {string} assistantAnswer - Assistant's answer
 * @returns {Promise<string|null>} - Generated summary or null if failed
 */
async function generateSummaryFromMessages(userQuestion, assistantAnswer) {
  const requestLogger = logger.createRequestLogger();
  const env = getEnv();


  const maxRetries = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {

      requestLogger.info(`🔄 Summary generation attempt ${attempt}/${maxRetries}`, {
        userQuestionLength: userQuestion.length,
        assistantAnswerLength: assistantAnswer.length
      });

      const systemPrompt = `You are a conversation summarizer. Your task is to create a brief, descriptive summary of a chat conversation based on the first question and answer.

Rules:
- Generate a summary in under 7 words
- Focus on the main topic or subject matter
- Be descriptive and specific
- Use clear, simple language
- Do not include quotes or special characters
- Return the result as JSON with a "summary" field containing only the summary text`;

      const userPrompt = `Summarize this conversation in under 7 words:

User Question: ${userQuestion}

Assistant Answer: ${assistantAnswer}`;

      const summaryModel = env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini';
      const summaryTemperature = parseFloat(env.OPENAI_SUMMARY_MODEL_temperature || '0.3');


      // Use our custom OpenAI function for summary generation with temperature support
      const response = await callOpenAISummary(
        systemPrompt,
        userPrompt,
        summaryModel,
        summaryTemperature
      );


      if (response && response.summary) {
        const summary = response.summary.trim();

        // Validate summary length (under 7 words)
        const wordCount = summary.split(/\s+/).length;
        if (wordCount > 7) {
          requestLogger.warn('⚠️ Generated summary too long, truncating', {
            originalSummary: summary,
            wordCount
          });
          // Take first 6 words if too long
          const truncated = summary.split(/\s+/).slice(0, 6).join(' ');
          return truncated;
        }

        requestLogger.info('✅ Summary generated successfully', {
          summary,
          wordCount,
          attempt
        });

        return summary;
      } else {
        throw new Error('Invalid response format from OpenAI');
      }

    } catch (error) {
      lastError = error;
      requestLogger.warn(`❌ Summary generation attempt ${attempt} failed`, {
        error: error.message,
        attempt,
        maxRetries
      });

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  requestLogger.error('❌ All summary generation attempts failed', {
    maxRetries,
    lastError: lastError?.message
  });

  return null;
}

/**
 * Check if a thread needs summary generation and generate if needed
 * This is called after an assistant message is saved
 * @param {string} threadId - Thread ID to check
 * @param {number} sequenceNumber - Sequence number of the just-saved message
 * @param {string} role - Role of the just-saved message
 */
export async function checkAndGenerateSummary(threadId, sequenceNumber, role) {
  const requestLogger = logger.createRequestLogger();


  try {
    // Only generate summary after the first assistant response (sequence 2)
    if (role !== 'assistant' || sequenceNumber !== 2) {
      return;
    }

    requestLogger.info('🎯 Checking if thread needs summary generation', {
      threadId,
      sequenceNumber,
      role
    });


    // Generate summary asynchronously (don't block the response)
    setImmediate(async () => {
      try {
        await generateThreadSummary(threadId);
      } catch (error) {
        requestLogger.error('❌ Failed to generate summary', {
          threadId,
          error: error.message,
          stack: error.stack
        });
      }
    });

  } catch (error) {
    requestLogger.error('❌ Error in checkAndGenerateSummary', {
      threadId,
      sequenceNumber,
      role,
      error: error.message
    });
  }
}