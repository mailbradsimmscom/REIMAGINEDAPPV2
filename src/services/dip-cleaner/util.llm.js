
// src/services/dip-cleaner/util.llm.js
import { logger } from '../../utils/logger.js';
import { oaiJson } from '../../clients/openai.client.js';

function systemFor(kind, ctx = {}) {
  // All prompts below include the literal word "json" to satisfy response_format: json_object.
  switch (kind) {
    case 'specs':
      return [
        "Normalize specifications into consistent canonical keys, numeric values, and units.",
        "Respond ONLY in valid json exactly as:",
        '{"items":[{"spec_name":"string","spec_value":"string|number","spec_unit":"string","unit_extracted":"string|null","context":"string"}]}',
        "Rules:",
        "- Keep spec_value parsable; do not add prose.",
        "- If unit is unclear, set unit_extracted to null (never omit fields).",
      ].join("\n");
    case 'playbooks':
      return [
        "Rewrite procedural hints into clear, standalone imperative instructions. Fix grammar, remove fragments, and deduplicate semantically identical hints.",
        "Respond ONLY in valid json exactly as:",
        '{"items":[{"description":"string","steps":["string","string"]}]}',
        "Rules:",
        "- Every item MUST include description.",
        "- Steps is required: if none are obvious, return an empty array [].",
        "- Do not include expected results in playbooks.",
      ].join("\n");
    case 'goldens':
      return [
        "Convert each query into a short test with a precise expected answer.",
        "Respond ONLY in valid json exactly as:",
        '{"items":[{"query":"string","expected":"string"}]}',
        "Rules:",
        "- Expected answers MUST be concise (under 10 words).",
        '- Example: {"query":"steak - temp setting 550","expected":"550˚F / setting 16"}',
        '- Example: {"query":"cabinet must have a minimum of two openings","expected":"Two openings required"}',
        '- If unclear, set expected = "See documentation".',
        "- Never include long sentences, prose, or markdown.",
      ].join("\n");
    case 'intents':
      return [
        "You will receive items with {id, pattern}.",
        "For each, return {id, intent}.",
        "Respond ONLY in valid json exactly as:",
        '{"items":[{"id":0,"intent":"string"}]}',
        "Rules:",
        "- intent: 1-8 words, short natural language summary of the user's goal.",
        "- Do not copy the pattern verbatim; rewrite into a generalized description.",
        "Examples:",
        '{"id":0,"intent":"Troubleshoot GPS signal issues"}',
        '{"id":1,"intent":"Check dinghy fuel capacity"}',
        '{"id":2,"intent":"Sea.ai alert handling"}',
        '{"id":3,"intent":"Ventilation requirement for cabinet"}',
      ].join("\n");
    default:
      return "Respond ONLY in valid json as {\"items\":[]}";
  }
}

const TOKEN_BUDGET = {
  specs: 900,
  playbooks: 1000,
  goldens: 500,
  intents: 800,
};

export async function tryLLM(kind, items, ctx = {}) {
  if (!items?.length) return items;

  const system = systemFor(kind, ctx);
  const user =
    JSON.stringify({ items: items }).slice(0, 8000) +
    "\n\nReturn ONLY valid json exactly as instructed above. No prose.";

  try {
    const res = await oaiJson({
      system,
      user,
      model: "gpt-4o-mini",
      maxOutputTokens: TOKEN_BUDGET[kind] ?? 600,
      seed: 11,
    });

    const text = res?.choices?.[0]?.message?.content ?? "";
    if (process.env.DIP_LLM_DEBUG === '1') {
      logger.warn(`[LLM DEBUG][${kind}] raw: ${text.slice(0, 1200)}`);
    }

    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.items) ? parsed.items : items;
  } catch (err) {
    logger.warn(`[LLM] ${kind} skipped: ${err.message}`);
    return items;
  }
}
