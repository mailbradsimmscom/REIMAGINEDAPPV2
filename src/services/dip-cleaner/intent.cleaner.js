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

  logger.warn(`🔍 [INTENT CLEANER] Starting with ${stagingIntents.length} staging items`);

  let rows = stagingIntents.map((r) => ({
    pattern: norm(r.pattern ?? r.intent ?? ""),
    intent: norm(r.intent ?? r.pattern ?? ""),
    route_to: r.route_to ?? "See documentation",
    page: r.page ?? null,
    confidence: r.confidence ?? 0.7,
    created_by: "system",
  }));

  logger.warn(`📝 [INTENT CLEANER] After normalization: ${rows.length} items`);

  // Filter 1: Remove items without pattern/intent
  const beforePatternFilter = rows.length;
  rows = rows.filter((r) => r.pattern && r.intent);
  const afterPatternFilter = rows.length;
  
  if (beforePatternFilter !== afterPatternFilter) {
    logger.warn(`❌ [INTENT CLEANER] Filtered out ${beforePatternFilter - afterPatternFilter} items without pattern/intent`);
    logger.warn(`📊 [INTENT CLEANER] Remaining after pattern filter: ${afterPatternFilter} items`);
  }

  // Filter 2: Remove items that match golden test keys
  const goldenKeys = new Set(cleanedGoldens.map((g) => key(g.query)));
  logger.warn(`🏆 [INTENT CLEANER] Golden test keys: ${Array.from(goldenKeys).slice(0, 5).join(', ')}${goldenKeys.size > 5 ? '...' : ''}`);
  
  const beforeGoldenFilter = rows.length;
  rows = rows.filter((r) => {
    const intentKey = key(r.intent);
    const patternKey = key(r.pattern);
    const matchesGolden = goldenKeys.has(intentKey) || goldenKeys.has(patternKey);
    
    if (matchesGolden) {
      logger.warn(`❌ [INTENT CLEANER] Rejected (matches golden): "${r.intent}" (key: ${intentKey}) or "${r.pattern}" (key: ${patternKey})`);
    }
    
    return !matchesGolden;
  });
  const afterGoldenFilter = rows.length;
  
  if (beforeGoldenFilter !== afterGoldenFilter) {
    logger.warn(`❌ [INTENT CLEANER] Filtered out ${beforeGoldenFilter - afterGoldenFilter} items matching golden tests`);
    logger.warn(`📊 [INTENT CLEANER] Remaining after golden filter: ${afterGoldenFilter} items`);
  }

  // Filter 3: Remove duplicates
  const seen = new Set();
  const beforeDupFilter = rows.length;
  rows = rows.filter((r) => {
    const k = key(r.pattern);
    if (seen.has(k)) {
      logger.warn(`❌ [INTENT CLEANER] Rejected (duplicate): "${r.pattern}" (key: ${k})`);
      return false;
    }
    seen.add(k);
    return true;
  });
  const afterDupFilter = rows.length;
  
  if (beforeDupFilter !== afterDupFilter) {
    logger.warn(`❌ [INTENT CLEANER] Filtered out ${beforeDupFilter - afterDupFilter} duplicate items`);
    logger.warn(`📊 [INTENT CLEANER] Remaining after duplicate filter: ${afterDupFilter} items`);
  }

  logger.warn(`🤖 [INTENT CLEANER] Before LLM processing: ${rows.length} items`);

  try {
    rows = await tryLLM("intents", rows);
    logger.warn(`🤖 [INTENT CLEANER] After LLM processing: ${rows.length} items`);
  } catch (e) {
    logger.warn("LLM intents upscale skipped:", e?.message ?? e);
  }

  const finalRows = rows.map((r) => ({
    pattern: r.pattern,
    intent: r.intent,
    route_to: r.route_to,
    created_by: r.created_by ?? "system",
    status: "pending",
    confidence: r.confidence ?? 0.7,
    page: r.page ?? null,
  }));

  logger.warn(`✅ [INTENT CLEANER] Final result: ${finalRows.length} items`);
  
  return finalRows;
}
