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

  const batchSize = 3;
  const outRows = [];
  try {
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const llm = await tryLLM("goldens", batch);
      if (Array.isArray(llm)) outRows.push(...llm);
    }
  } catch (e) {
    logger.warn("LLM goldens skipped:", e?.message ?? e);
    // Fall back to original rows (they'll still be inserted so we don't lose data)
    outRows.push(...rows);
  }

  logger.warn("[LLM DEBUG][goldens] parsed:", outRows);

  const finalRows = outRows
    .filter(r => r && (r.query || r.description))
    .map(r => {
      const query = r.query ?? r.description ?? "";
      let expected = r.expected ?? "See documentation";
      // enforce short answers
      if (expected && expected.length > 50) {
        expected = "See documentation";
      }
      return {
        query,
        expected,
        approved_by: null,
        approved_at: null,
        status: "pending",
        confidence: r.confidence ?? 0.7,
        page: r.page ?? null,
      };
    })
    // final guard: drop rows with useless expected answers
    .filter(r => r.query && r.expected !== "See documentation");

  logger.warn("[LLM DEBUG][goldens] mapped:", finalRows);

  return finalRows;
}
