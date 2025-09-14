// src/services/dip-cleaner/playbook.cleaner.js
import { logger } from '../../utils/logger.js';
import { tryLLM } from './util.llm.js';

function normalizeLine(s = "") {
  return s.trim().replace(/\s+/g, " ");
}
function isJunk(s) {
  const t = s.toLowerCase();
  return !t || t.length < 6 || /www\./i.test(t);
}
function keyFor(line) {
  return normalizeLine(line).toLowerCase().replace(/[^\w\s]/g, "");
}
function dedupe(lines) {
  const seen = new Set();
  const out = [];
  for (const r of lines) {
    const k = keyFor(r.description ?? "");
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

export async function normalizeAndCleanPlaybooks(stagingPlaybooks) {
  if (!stagingPlaybooks?.length) return [];

  const base = stagingPlaybooks
    .map((r) => ({
      page: r.page ?? null,
      confidence: r.confidence ?? 0.8,
      description: normalizeLine(
        r.description ?? r.hint ?? r.test_name ?? ""
      ),
      expected_result: r.expected_result ?? "See documentation",
      system_norm: r.system_norm ?? null,
      subsystem_norm: r.subsystem_norm ?? null,
    }))
    .filter((r) => !isJunk(r.description));

  let deduped = dedupe(base);

  try {
    const batchSize = 10;
    const cleaned = [];
    for (let i = 0; i < deduped.length; i += batchSize) {
      const batch = deduped.slice(i, i + batchSize);
      const out = await tryLLM("playbooks", batch);
      cleaned.push(...out);
    }
    deduped = cleaned;
    // Filter out null or malformed rows
    deduped = deduped.filter(r => r && r.description);
  } catch (e) {
    logger.warn("LLM playbooks upscale skipped:", e?.message ?? e);
  }

  return deduped.map((r) => ({
    test_name: "Playbook Hint",
    test_type: "procedure",
    description: r.description,
    steps: Array.isArray(r.steps) ? r.steps : [],
    expected_result: r.expected_result ?? "See documentation",
    page: r.page,
    confidence: r.confidence ?? 0.8,
    approved_by: null,
    approved_at: null,
    status: "pending",
  }));
}
