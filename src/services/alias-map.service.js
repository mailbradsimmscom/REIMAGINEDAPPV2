/**
 * Alias Map Service
 *
 * Builds pipeline model parameters from DB for Vision, DIP, and Index services.
 * Replaces frontend pass-through of selected_models/referenced_selections.
 */

import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { normalizeModelKey } from '../utils/normalize-model-key.js';
import { logger } from '../utils/logger.js';

const log = logger.createRequestLogger();

/**
 * Build expanded model arrays and alias map from DB for a given document.
 *
 * @param {string} docId - Document ID
 * @returns {Object} { selected_models, referenced_selections, alias_map, models_covered }
 */
export async function buildPipelineModelParams(docId) {
  const supabase = await getSupabaseClient();

  // Fetch document record
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('model_norm, models_covered, family_aliases')
    .eq('doc_id', docId)
    .single();

  if (docError || !doc) {
    log.warn('buildPipelineModelParams: document not found', { docId });
    return { selected_models: [], referenced_selections: [], alias_map: {}, models_covered: [] };
  }

  const modelNorm = doc.model_norm;
  const modelsCovered = doc.models_covered || [];
  const familyAliases = doc.family_aliases || [];

  // Recover original form of primary model from models_covered
  // model_norm is normalized (uppercase, stripped) — we need the original for text matching
  const primaryOriginal = modelNorm
    ? (modelsCovered.find(m => normalizeModelKey(m) === modelNorm) || modelNorm)
    : null;

  // selected_models = [primaryOriginal] + family_aliases (deduped)
  const selectedSet = new Set();
  const selectedModels = [];
  if (primaryOriginal) {
    selectedSet.add(normalizeModelKey(primaryOriginal));
    selectedModels.push(primaryOriginal);
  }
  for (const alias of familyAliases) {
    const norm = normalizeModelKey(alias);
    if (!selectedSet.has(norm)) {
      selectedSet.add(norm);
      selectedModels.push(alias);
    }
  }

  // Fetch user-selected referenced systems
  const { data: refs } = await supabase
    .from('document_referenced_systems')
    .select('canonical_model, raw_model, aliases, user_selected')
    .eq('doc_id', docId)
    .eq('user_selected', true);

  // Build expanded referenced_selections and alias_map
  const referencedSet = new Set();
  const referencedSelections = [];
  const aliasMap = {};

  // Family aliases → model_norm (normalized canonical)
  for (const alias of familyAliases) {
    aliasMap[alias] = [modelNorm];
  }

  // Referenced systems: raw_model + aliases → canonical_model
  for (const ref of (refs || [])) {
    // Add raw_model
    if (ref.raw_model && !referencedSet.has(ref.raw_model)) {
      referencedSet.add(ref.raw_model);
      referencedSelections.push(ref.raw_model);
    }
    aliasMap[ref.raw_model] = [ref.canonical_model];

    // Add aliases
    for (const alias of (ref.aliases || [])) {
      if (!referencedSet.has(alias)) {
        referencedSet.add(alias);
        referencedSelections.push(alias);
      }
      aliasMap[alias] = [ref.canonical_model];
    }
  }

  log.info('Built pipeline model params from DB', {
    docId: docId.substring(0, 16),
    selectedModels: selectedModels.length,
    referencedSelections: referencedSelections.length,
    aliasMapKeys: Object.keys(aliasMap).length
  });

  return {
    selected_models: selectedModels,
    referenced_selections: referencedSelections,
    alias_map: aliasMap,
    models_covered: modelsCovered
  };
}
