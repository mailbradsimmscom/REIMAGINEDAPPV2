// src/services/dip-cleaner/intent.cleaner.js
import { tryLLM } from './util.llm.js';
import { logger } from '../../utils/logger.js';

function norm(s = "") {
  return s.trim().replace(/\s+/g, " ");
}
function key(txt) {
  return norm(txt).toLowerCase().replace(/[^\w\s]/g, "");
}

export async function normalizeAndCleanIntents(stagingIntents, cleanedGoldens = []) {
  if (!stagingIntents?.length) return [];

  let rows = stagingIntents.map((r) => ({
    pattern: norm(r.pattern ?? r.intent ?? ""),
    intent: norm(r.intent ?? r.pattern ?? ""),
    route_to: r.route_to ?? "See documentation",
    page: r.page ?? null,
    confidence: r.confidence ?? 0.7,
    created_by: "system",
  }));

  rows = rows.filter((r) => r.pattern && r.intent);

  const goldenKeys = new Set(cleanedGoldens.map((g) => key(g.query)));
  rows = rows.filter((r) => !goldenKeys.has(key(r.intent)) && !goldenKeys.has(key(r.pattern)));

  const seen = new Set();
  rows = rows.filter((r) => {
    const k = key(r.pattern);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  try {
    rows = await tryLLM("intents", rows);
  } catch (e) {
    logger.warn("LLM intents upscale skipped:", e?.message ?? e);
  }

  return rows.map((r) => ({
    pattern: r.pattern,
    intent: r.intent,
    route_to: r.route_to,
    created_by: r.created_by ?? "system",
    status: "pending",
    confidence: r.confidence ?? 0.7,
    page: r.page ?? null,
  }));
}
