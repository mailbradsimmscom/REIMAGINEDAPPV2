// src/services/dip-cleaner/dip-cleaner.service.js
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { normalizeAndCleanSpecs } from './spec.cleaner.js';
import { normalizeAndCleanPlaybooks } from './playbook.cleaner.js';
import { normalizeAndCleanGoldens } from './goldens.cleaner.js';
import { normalizeAndCleanIntents } from './intent.cleaner.js';
import { logger } from '../../utils/logger.js';
import documentRepository from '../../repositories/document.repository.js';

async function setJobStatus(jobId, status, updates = {}) {
  if (!jobId) return;
  await documentRepository.updateJobStatus(jobId, status, updates);
}

async function fetchStagingRows(docId) {
  const supabase = await getSupabaseClient();
  
  const [specs, playbooks, goldens, intents] = await Promise.all([
    supabase.from("staging_spec_suggestions").select("*").eq("doc_id", docId),
    supabase.from("staging_playbook_hints").select("*").eq("doc_id", docId),
    supabase.from("staging_golden_tests").select("*").eq("doc_id", docId),
    supabase.from("staging_intent_router").select("*").eq("doc_id", docId),
  ]);

  const get = (res) => {
    if (res.error) throw res.error;
    return res.data ?? [];
  };
  return {
    specs: get(specs),
    playbooks: get(playbooks),
    goldens: get(goldens),
    intents: get(intents),
  };
}

async function insertProduction({
  docId,
  cleanedSpecs,
  cleanedPlaybooks,
  cleanedGoldens,
  cleanedIntents,
}) {
  const supabase = await getSupabaseClient();
  const ops = [];

  if (cleanedSpecs.length) {
    ops.push(
      supabase.from("spec_suggestions").insert(
        cleanedSpecs.map((r) => ({
          ...r,
          doc_id: docId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }))
      )
    );
  }

  if (cleanedPlaybooks.length) {
    ops.push(
      supabase.from("playbook_hints").insert(
        cleanedPlaybooks.map((r) => ({
          ...r,
          doc_id: docId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }))
      )
    );
  }

  if (cleanedGoldens.length) {
    ops.push(
      supabase.from("golden_tests").insert(
        cleanedGoldens.map((r) => ({
          ...r,
          doc_id: docId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }))
      )
    );
  }

  if (cleanedIntents.length) {
    ops.push(
      supabase.from("intent_router").insert(
        cleanedIntents.map((r) => ({
          ...r,
          doc_id: docId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }))
      )
    );
  }

  if (!ops.length) return;
  const results = await Promise.all(ops);
  for (const res of results) {
    if (res.error) throw res.error;
  }
}

export async function cleanDipForDoc(docId, jobId = null) {
  try {
    if (jobId) await setJobStatus(jobId, "DIP cleaning");
    logger.info(`DIP Cleaner: start for doc ${docId}`);

    const { specs, playbooks, goldens, intents } = await fetchStagingRows(docId);

    const cleanedSpecs = await normalizeAndCleanSpecs(specs);
    const cleanedPlaybooks = await normalizeAndCleanPlaybooks(playbooks);
    const cleanedGoldens = await normalizeAndCleanGoldens(goldens);
    const cleanedIntents = await normalizeAndCleanIntents(intents, cleanedGoldens);

    await insertProduction({
      docId,
      cleanedSpecs,
      cleanedPlaybooks,
      cleanedGoldens,
      cleanedIntents,
    });

    if (jobId) await setJobStatus(jobId, "completed");
    logger.info(`DIP Cleaner: done for doc ${docId}`);

    return {
      success: true,
      counts: {
        specs: cleanedSpecs.length,
        playbooks: cleanedPlaybooks.length,
        goldens: cleanedGoldens.length,
        intents: cleanedIntents.length,
      },
    };
  } catch (err) {
    logger.error("DIP Cleaner failed", err);
    if (jobId) await setJobStatus(jobId, "failed", { error: err.message });
    throw err;
  }
}
