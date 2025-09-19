// src/services/dip-cleaner/spec.cleaner.js
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { logger } from '../../utils/logger.js';
import { tryLLM } from './util.llm.js';

function toNum(x) {
  if (x == null) return null;
  const s = String(x).replace(/[^\d.\-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function dedupeAndMergePages(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.spec_name}::${r.spec_value}::${r.spec_unit}`;
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, { ...r, pages: new Set([r.page].filter(Boolean)) });
    } else {
      if (r.page) prev.pages.add(r.page);
    }
  }
  return Array.from(byKey.values()).map((r) => ({
    ...r,
    page: r.page ?? Array.from(r.pages)?.[0] ?? null,
    pages: Array.from(r.pages),
  }));
}

function basicValidate(r) {
  if (!r.spec_name) return false;
  if (r.spec_value == null || r.spec_value === "") return false;
  return true;
}

async function loadLexicon() {
  const supabase = await getSupabaseClient();
  const res = await supabase.from("spec_lexicon").select("*");
  if (res.error) {
    logger.warn("Failed to load spec_lexicon", res.error);
    return [];
  }
  return res.data ?? [];
}

export async function normalizeAndCleanSpecs(stagingSpecs) {
  if (!stagingSpecs?.length) return [];

  const lexicon = await loadLexicon();

  const normalized = stagingSpecs.map((row) => {
    let nameKey = (row.spec_name ?? "").toLowerCase().trim();
    let canonical = null;
    let unitExtracted = row.spec_unit;
    let expectedUnit = null;

    for (const lex of lexicon) {
      if (
        lex.synonyms?.some((syn) =>
          nameKey.includes(syn.toLowerCase().trim())
        )
      ) {
        canonical = lex.canonical;
        expectedUnit = lex.unit;
        if (!unitExtracted && lex.unit) unitExtracted = lex.unit;
        break;
      }
    }

    if (!canonical) canonical = nameKey.replace(/\s+/g, "_");

    const valueNum = toNum(row.spec_value);

    return {
      ...row,
      spec_name: canonical,
      spec_value: valueNum ?? row.spec_value ?? null,
      spec_unit: expectedUnit ?? null,
      unit_extracted: unitExtracted ?? null,
      confidence: row.confidence ?? 0.7,
      context: row.context ?? "",
    };
  });

  const filtered = normalized.filter(basicValidate);
  
  // Log unit mismatches for review
  const unitMismatches = filtered.filter(r => 
    r.unit_extracted && r.spec_unit && r.unit_extracted !== r.spec_unit
  );
  if (unitMismatches.length > 0) {
    logger.warn(`Unit mismatches detected`, {
      count: unitMismatches.length,
      mismatches: unitMismatches.map(r => ({
        spec_name: r.spec_name,
        extracted: r.unit_extracted,
        expected: r.spec_unit
      }))
    });
  }
  
  let deduped = dedupeAndMergePages(filtered);

  try {
    deduped = await tryLLM("specs", deduped);
  } catch (e) {
    logger.warn("LLM specs upscale skipped:", e?.message ?? e);
  }

  logger.warn("[LLM DEBUG][specs] parsed:", deduped);

  const finalRows = deduped.map((r) => ({
    doc_id: r.doc_id,
    page: r.page ?? null,
    context: r.context ?? "",
    confidence: r.confidence ?? 0.8,
    bbox: r.bbox ?? null,
    approved_at: null,
    approved_by: "system",
    spec_name: r.spec_name,
    spec_value: r.spec_value,
    spec_unit: r.spec_unit,
    unit_extracted: r.unit_extracted ?? null,
    status: "pending",
  }));

  logger.warn("[LLM DEBUG][specs] mapped:", finalRows);

  return finalRows;
}
