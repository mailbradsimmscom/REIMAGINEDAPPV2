// src/services/suggestions/intent.suggestions.js
import { logger } from '../../utils/logger.js';
import { oaiJson } from '../../clients/openai.client.js';

/**
 * Call OpenAI to extract patterns from a chunk of text.
 */
async function extractPatternsFromChunk(text, page, docId) {
  try {
    const res = await oaiJson({
      system: [
        "You are extracting critical user-facing patterns from technical manuals.",
        "Patterns should be short, self-contained facts, rules, procedures, settings, warnings, or error codes.",
        "Each pattern must be something a user could query with 'What is / How do I / Where / When'.",
        "Do not include company addresses, contact info, or legal disclaimers.",
        "Respond ONLY in JSON exactly as: {\"items\":[{\"pattern\":\"string\"}]}",
      ].join("\n"),
      user: `From this chunk, extract 5–15 critical user-facing patterns.\n\nChunk:\n${text}`,
      model: "gpt-4o-mini",
      maxOutputTokens: 800,
    });

    const raw = res?.choices?.[0]?.message?.content ?? "";
    if (process.env.DIP_LLM_DEBUG === '1') {
      logger.warn(`[LLM DEBUG][intent.patterns] raw: ${raw.slice(0, 1200)}`);
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.items)) return [];

    return parsed.items
      .filter(r => r && r.pattern)
      .map(r => ({
        doc_id: docId,
        page,
        pattern: String(r.pattern).trim(),
        created_by: 'system',
        status: 'pending',
        confidence: 0.7,
      }));
  } catch (err) {
    logger.warn(`[LLM] intent pattern extraction skipped: ${err.message}`);
    return [];
  }
}

/**
 * Main builder: iterate over chunks and use LLM to extract patterns.
 */
export async function buildIntentSuggestions(chunks, docId) {
  const rows = [];

  for (const chunk of chunks) {
    const extracted = await extractPatternsFromChunk(
      chunk.text || "",
      chunk.page || null,
      docId
    );
    rows.push(...extracted);
  }

  logger.info(`✨ Built ${rows.length} intent patterns from ${chunks.length} chunks`);
  return rows;
}
