// src/services/dip-cleaner/goldens.cleaner.js
import { logger } from '../../utils/logger.js';
import { tryLLM } from './util.llm.js';

function norm(s = "") {
  return s.trim().replace(/\s+/g, " ");
}
function isGarbage(text) {
  const t = (text ?? "").toLowerCase();
  return !t || t.length < 5;
}
function key(q) {
  return norm(q).toLowerCase().replace(/[^\w\s]/g, "");
}

export async function normalizeAndCleanGoldens(stagingGoldens) {
  if (!stagingGoldens?.length) return [];

  let rows = stagingGoldens
    .map((r) => ({
      page: r.page ?? null,
      query: norm(r.query ?? r.pattern ?? ""),
      expected: norm(r.expected ?? "See documentation"),
      confidence: r.confidence ?? 0.7,
    }))
    .filter((r) => !isGarbage(r.query));

  const seen = new Set();
  rows = rows.filter((r) => {
    const k = key(r.query);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  try {
    rows = await tryLLM("goldens", rows);
    logger.info("[GOLDENS CLEANER] LLM rewrite completed", { 
      count: rows.length,
      doc_id: stagingGoldens[0]?.doc_id 
    });
  } catch (e) {
    logger.warn("LLM goldens upscale skipped:", e?.message ?? e);
    logger.info("[GOLDENS CLEANER] Using raw data (LLM failed)", { 
      count: rows.length,
      doc_id: stagingGoldens[0]?.doc_id 
    });
  }

  return rows.map((r) => ({
    query: r.query,
    expected: r.expected ?? "See documentation",
    approved_by: null, // Changed from "system" to null for pending approval
    approved_at: null,
    status: "pending",
    confidence: r.confidence ?? 0.7,
    page: r.page ?? null,
  }));
}
