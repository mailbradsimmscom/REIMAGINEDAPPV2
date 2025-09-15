// src/services/dip-cleaner/intent.cleaner.js
import { logger } from '../../utils/logger.js';
import { tryLLM } from './util.llm.js';

export async function normalizeAndCleanIntents(stagingIntents) {
  if (!stagingIntents?.length) return [];

  logger.warn(`🔍 [INTENT CLEANER] Starting with ${stagingIntents.length} staging items`);

  // Build payload: stable ids + patterns
  const payload = stagingIntents.map((r, idx) => ({
    id: idx,
    pattern: r.pattern ?? r.hint ?? r.description ?? ""
  }));
  const idToPattern = new Map(payload.map(p => [p.id, p.pattern]));

  const allowedCategories = ["cooking","installation","warranty","safety","specifications","general"];

  // Batch LLM calls
  const rows = [];
  const batchSize = 5;
  for (let i = 0; i < payload.length; i += batchSize) {
    const batch = payload.slice(i, i + batchSize);
    const out = await tryLLM("intents", batch, { allowedCategories });
    if (Array.isArray(out)) rows.push(...out);
  }

  function sanitizeRoute(route) {
    if (!route) return "general";
    const s = String(route).trim();
    if (s.toLowerCase().startsWith("system:")) {
      const name = s.slice(7).trim();
      return name ? `system:${name}` : "general";
    }
    const lower = s.toLowerCase();
    return allowedCategories.includes(lower) ? lower : "general";
  }

  const finalRows = rows.map((r, idx) => {
    const intent = String(r.intent ?? "")
      .split(/\s+/)
      .slice(0, 8)   // allow up to 8 words
      .join(" ")
      .trim();

    const route_to = r.system_norm
      ? `system:${r.system_norm}`
      : r.doc_id
        ? `doc:${r.doc_id}`
        : "general";

    return {
      pattern: idToPattern.get(r.id) ?? "",
      intent,
      route_to,
      created_by: "system",
      status: "pending",
      confidence: 0.7,
      page: null,
    };
  });

  if (process.env.DIP_LLM_DEBUG === '1') {
    logger.warn(`[LLM DEBUG][intents] parsed: ${JSON.stringify(rows).slice(0,1200)}`);
    logger.warn(`[LLM DEBUG][intents] mapped: ${JSON.stringify(finalRows).slice(0,1200)}`);
  }

  return finalRows;
}