// src/services/dip-cleaner/util.llm.js
import { logger } from '../../utils/logger.js';
import openai from '../../clients/openai.client.js';

async function llmCall(kind, payload) {
  if (!openai) throw new Error("OpenAI client not available");

  const system = {
    specs: "Normalize specifications into consistent canonical keys, numeric values, and units.",
    playbooks: "Rewrite procedural hints into clear, standalone imperative instructions. Fix grammar, remove fragments, ensure each hint is a complete actionable step. Deduplicate semantically identical hints. Keep the imperative style (e.g., 'Disconnect power before servicing', 'Never operate without proper ventilation').",
    goldens: "Replace placeholder expected values with short, precise answers when obvious.",
    intents: "Generalize intent patterns without changing meaning.",
  }[kind];

  const user = JSON.stringify({ items: payload }).slice(0, 8000);

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: "Return ONLY JSON { items: [...] } matching length/order." },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });

  const text = res?.choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(text);
  return Array.isArray(parsed?.items) ? parsed.items : payload;
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
