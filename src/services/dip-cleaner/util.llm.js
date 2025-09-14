// src/services/dip-cleaner/util.llm.js
import { logger } from '../../utils/logger.js';
import { oaiJson } from '../../clients/openai.client.js';

async function llmCall(kind, payload) {
  const system = {
    specs: "Normalize specifications into consistent canonical keys, numeric values, and units. Respond ONLY in json with the format {\"items\": [...]}. Escape all double quotes with a backslash in the json output.",
    playbooks: "Rewrite procedural hints into clear, standalone imperative instructions. Fix grammar, remove fragments, ensure each hint is a complete actionable step. Deduplicate semantically identical hints. Keep the imperative style (e.g., 'Disconnect power before servicing', 'Never operate without proper ventilation'). Respond ONLY in valid json, exactly in this format:\n\n{\"items\": [\n  {\"description\": \"string\", \"steps\": [\"string\", \"string\", ...]}\n]}\n\nEvery item MUST have a description. If no steps are obvious, return an empty array, but never omit the steps field.",
    goldens: "Replace placeholder expected values with short, precise answers when obvious. Respond ONLY in valid json, exactly in this format:\n\n{\"items\": [\n  {\"description\": \"Check cooking setting for burgers.\", \"expected_result\": \"500˚F / setting 9\"},\n  {\"description\": \"Verify cabinet ventilation.\", \"expected_result\": \"Minimum of two openings\"}\n]}\n\nEvery item MUST have both fields. If expected_result is unclear, set it to \"See documentation\". Never include prose, markdown, or extra fields.",
    intents: "Generalize intent patterns without changing meaning. Respond ONLY in json with the format {\"items\": [...]}. Escape all double quotes with a backslash in the json output.",
  }[kind];

  const user = JSON.stringify({ items: payload })
    .slice(0, 8000) +
    "\n\nReturn ONLY valid json — exactly as instructed above.";

  try {
    const res = await oaiJson({
      system,
      user,
      model: "gpt-4o-mini",
      maxOutputTokens: 2000,
    });

    const text = res?.choices?.[0]?.message?.content ?? "";

    if (kind === "goldens") {
      logger.info(`[LLM DEBUG] Raw golden response:\n${text}`);
    }

    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.items) ? parsed.items : payload;
  } catch (err) {
    logger.warn(`[LLM] ${kind} skipped: ${err.message}`);
    return payload;
  }
}

export async function tryLLM(kind, items) {
  try {
    if (!items?.length) return items;
    const out = await llmCall(kind, items);
    // Allow LLM to return fewer items (deduplication) or same number
    return Array.isArray(out) && out.length <= items.length ? out : items;
  } catch (e) {
    logger.warn(`LLM ${kind} skipped:`, e?.message ?? e);
    return items;
  }
}
