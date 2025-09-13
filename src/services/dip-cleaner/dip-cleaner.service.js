// src/services/dip-cleaner/dip-cleaner.service.js

import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { normalizeAndCleanSpecs } from './spec.cleaner.js';
import { normalizeAndCleanPlaybooks } from './playbook.cleaner.js';
import { normalizeAndCleanGoldens } from './goldens.cleaner.js';
import { normalizeAndCleanIntents } from './intent.cleaner.js';
import { logger } from '../../utils/logger.js';

export async function cleanDipForDoc(doc_id, jobId) {
  const supabase = await getSupabaseClient();

  logger.info(`DIP Cleaner: start for doc ${doc_id}`, { jobId });

  // 1. Fetch staging rows for this doc
  const [specsRes, playbooksRes, goldensRes, intentsRes] = await Promise.all([
    supabase.from("staging_spec_suggestions").select("*").eq("doc_id", doc_id),
    supabase.from("staging_playbook_hints").select("*").eq("doc_id", doc_id),
    supabase.from("staging_golden_tests").select("*").eq("doc_id", doc_id),
    supabase.from("staging_intent_router").select("*").eq("doc_id", doc_id),
  ]);

  if (specsRes.error || playbooksRes.error || goldensRes.error || intentsRes.error) {
    logger.error("DIP Cleaner: error fetching staging rows", {
      doc_id,
      specsError: specsRes.error,
      playbooksError: playbooksRes.error,
      goldensError: goldensRes.error,
      intentsError: intentsRes.error,
    });
    throw new Error("Failed to fetch staging rows");
  }

  // 2. Normalize and clean
  const specs = await normalizeAndCleanSpecs(specsRes.data || []);
  const playbooks = await normalizeAndCleanPlaybooks(playbooksRes.data || []);
  const goldens = await normalizeAndCleanGoldens(goldensRes.data || []);
  const intents = await normalizeAndCleanIntents(intentsRes.data || []);

  // 3. Insert into production tables
  await supabase.from("spec_suggestions").insert(
    specs.map((s) => ({
      ...s,
      doc_id,
      status: "pending",
    }))
  );

  await supabase.from("playbook_hints").insert(
    playbooks.map((p) => ({
      ...p,
      doc_id,
      status: "pending",
    }))
  );

  await supabase.from("golden_tests").insert(
    goldens.map((g) => ({
      ...g,
      doc_id,
      status: "pending",
    }))
  );

  await supabase.from("intent_router").insert(
    intents.map((i) => ({
      ...i,
      doc_id,
      status: "pending",
    }))
  );

  logger.info(`DIP Cleaner: done for doc ${doc_id}`, { jobId });

  return {
    success: true,
    doc_id,
    jobId,
    inserted: {
      specs: specs.length,
      playbooks: playbooks.length,
      goldens: goldens.length,
      intents: intents.length,
    },
  };
}
