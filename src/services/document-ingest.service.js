import { getSupabaseClient } from '../repositories/supabaseClient.js';
import { createSystem, createInstance } from './system-management.service.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

/**
 * Document Ingest Service
 *
 * Business logic for document ingestion.
 * Follows cursor rules: Business logic only, routes call this service.
 *
 * IMPORTANT: FK Dependencies require this order:
 * 1. documents (first - others reference it)
 * 2. systems (can exist independently, but detected_from_doc_id references documents)
 * 3. instances (references systems.asset_uid)
 * 4. document_systems (references both documents.doc_id and systems.asset_uid)
 * 5. document_referenced_systems (references documents.doc_id)
 */

const log = logger.createRequestLogger();

/**
 * Parse Postgres/Supabase error into structured format
 */
function parseDbError(error, context) {
  const message = error?.message || String(error);

  let code = 'DB_ERROR';
  if (message.includes('23505') || message.includes('duplicate key')) {
    code = '23505';
  } else if (message.includes('23503') || message.includes('foreign key')) {
    code = '23503';
  } else if (message.includes('23502') || message.includes('not-null')) {
    code = '23502';
  }

  return {
    code,
    message: `${context}: ${message}`,
    context,
    details: error?.details || null
  };
}

/**
 * Look up reference table IDs for categories
 */
export async function lookupReferenceIds({ manufacturer, product_type, system_category, subsystem_category }) {
  const supabase = await getSupabaseClient();

  try {
    const [mfrResult, typeResult, sysResult, subResult] = await Promise.all([
      manufacturer
        ? supabase.from('ref_manufacturers').select('id, name').eq('name', manufacturer).single()
        : { data: null },
      product_type
        ? supabase.from('ref_product_types').select('id, name').eq('name', product_type).single()
        : { data: null },
      system_category
        ? supabase.from('ref_system_categories').select('id, name').eq('name', system_category).single()
        : { data: null },
      subsystem_category
        ? supabase.from('ref_subsystem_categories').select('id, name').eq('name', subsystem_category).single()
        : { data: null }
    ]);

    return {
      success: true,
      data: {
        manufacturerId: mfrResult.data?.id || null,
        productTypeId: typeResult.data?.id || null,
        systemCategoryId: sysResult.data?.id || null,
        subsystemCategoryId: subResult.data?.id || null,
        systemNorm: sysResult.data?.name || null,
        subsystemNorm: subResult.data?.name || null
      }
    };
  } catch (error) {
    log.error('Failed to lookup reference IDs', { error: error.message });
    return { success: false, error: parseDbError(error, 'Reference lookup failed') };
  }
}

/**
 * Find existing system or create new one
 * Does NOT create instance or document_systems link
 */
export async function findOrCreateSystem({ manufacturerNorm, modelNorm, refIds, docId }) {
  const supabase = await getSupabaseClient();

  try {
    // Check if system already exists
    const { data: existingSystem, error: lookupError } = await supabase
      .from('systems')
      .select('asset_uid, model_norm, manufacturer_norm')
      .eq('manufacturer_norm', manufacturerNorm)
      .eq('model_norm', modelNorm)
      .single();

    if (existingSystem && !lookupError) {
      log.info('Reusing existing system', { assetUid: existingSystem.asset_uid, model: modelNorm });
      return {
        success: true,
        data: {
          asset_uid: existingSystem.asset_uid,
          reused: true
        }
      };
    }

    // Create new system
    const systemRecord = {
      manufacturer_id: refIds.manufacturerId,
      manufacturer_norm: manufacturerNorm,
      model_norm: modelNorm,
      product_type_id: refIds.productTypeId,
      system_category_id: refIds.systemCategoryId,
      subsystem_category_id: refIds.subsystemCategoryId,
      system_norm: refIds.systemNorm,
      subsystem_norm: refIds.subsystemNorm,
      description: modelNorm,
      source: 'document',
      detected_from_doc_id: docId
    };

    const systemResult = await createSystem(systemRecord);

    if (!systemResult.success) {
      return {
        success: false,
        error: {
          code: 'SYSTEM_CREATE_FAILED',
          message: `Failed to create system: ${systemResult.error}`,
          context: 'system_creation',
          validationErrors: systemResult.validationErrors
        }
      };
    }

    log.info('System created', { assetUid: systemResult.data.asset_uid, model: modelNorm });

    return {
      success: true,
      data: {
        asset_uid: systemResult.data.asset_uid,
        reused: false
      }
    };

  } catch (error) {
    log.error('Failed to find/create system', { error: error.message });
    return { success: false, error: parseDbError(error, 'System find/create failed') };
  }
}

/**
 * Create an instance for a system
 */
export async function createInstanceForSystem({
  assetUid,
  serialNumber,
  location,
  manufacturerNorm,
  modelNorm,
  systemNorm,
  subsystemNorm
}) {
  try {
    const instanceData = {
      asset_uid: assetUid,
      serial_number: serialNumber || null,
      location: location || null
    };

    const denormalizedFields = {
      manufacturer_norm: manufacturerNorm,
      model_norm: modelNorm,
      system_norm: systemNorm,
      subsystem_norm: subsystemNorm
    };

    log.info('Creating instance', { assetUid, serialNumber, location });

    const result = await createInstance(instanceData, denormalizedFields);

    if (!result.success) {
      log.error('Instance creation failed', {
        error: result.error,
        validationErrors: result.validationErrors,
        instanceData
      });
      return {
        success: false,
        error: {
          code: 'INSTANCE_CREATE_FAILED',
          message: `Instance creation failed: ${result.error}`,
          context: 'instance_creation',
          validationErrors: result.validationErrors
        }
      };
    }

    return {
      success: true,
      data: result.data
    };

  } catch (error) {
    log.error('Failed to create instance', { error: error.message });
    return { success: false, error: parseDbError(error, 'Instance creation failed') };
  }
}

/**
 * Create document_systems link
 */
export async function createDocumentSystemLink({ docId, assetUid, isPrimary }) {
  const supabase = await getSupabaseClient();

  try {
    const { error } = await supabase
      .from('document_systems')
      .upsert([{
        doc_id: docId,
        asset_uid: assetUid,
        is_primary: isPrimary
      }], { onConflict: 'doc_id,asset_uid' });

    if (error) {
      return { success: false, error: parseDbError(error, 'Failed to create document-system link') };
    }

    log.info('Document-system link created', { docId, assetUid });
    return { success: true };

  } catch (error) {
    log.error('Failed to create document-system link', { error: error.message });
    return { success: false, error: parseDbError(error, 'Document-system link failed') };
  }
}

/**
 * Save referenced systems to document_referenced_systems
 *
 * Stores ALL detected referenced products from model detection, marking which
 * ones the user selected. This enables DIP to compute exclude lists:
 *   exclude_refs = detected_refs (user_selected=false)
 *
 * @param {string} docId - Document ID
 * @param {string[]} referencedSelections - Models the user selected as installed
 * @param {Array} referencedProducts - ALL models detected by model detection
 * @param {string} filename - Document filename for evidence
 */
export async function saveReferencedSystems({
  docId,
  referencedSelections,
  referencedProducts,
  filename
}) {
  const supabase = await getSupabaseClient();
  const errors = [];
  const saved = [];

  // Normalize referencedSelections to an array of model strings
  const userSelections = new Set(
    (referencedSelections || []).map(r => typeof r === 'string' ? r : r.model).filter(Boolean)
  );

  // Get ALL detected refs from referencedProducts
  const allDetectedRefs = (referencedProducts || [])
    .map(rp => typeof rp === 'string' ? rp : rp.model)
    .filter(Boolean);

  // If no detected refs, nothing to save
  if (allDetectedRefs.length === 0) {
    return { success: true, data: { saved: [], count: 0, userSelected: 0 } };
  }

  // Save ALL detected refs, marking user_selected appropriately
  for (const refModel of allDetectedRefs) {
    const refData = (referencedProducts || []).find(rp =>
      (typeof rp === 'string' ? rp : rp.model) === refModel
    );

    const isUserSelected = userSelections.has(refModel);

    const record = {
      doc_id: docId,
      canonical_model: refModel,
      source: 'detected',
      raw_model: typeof refData === 'object' ? refData.model : refModel,
      raw_manufacturer: typeof refData === 'object' ? refData.manufacturer : null,
      evidence: `Referenced in ${filename}`,
      user_selected: isUserSelected
    };

    try {
      const { error: refError } = await supabase
        .from('document_referenced_systems')
        .upsert([record], { onConflict: 'doc_id,canonical_model' });

      if (refError) {
        errors.push({
          model: refModel,
          error: parseDbError(refError, `Failed to save reference: ${refModel}`)
        });
      } else {
        saved.push({ model: refModel, user_selected: isUserSelected });
      }
    } catch (error) {
      errors.push({
        model: refModel,
        error: parseDbError(error, `Failed to save reference: ${refModel}`)
      });
    }
  }

  const userSelectedCount = saved.filter(s => s.user_selected).length;

  if (errors.length > 0 && saved.length === 0) {
    return {
      success: false,
      error: {
        code: 'REFERENCED_SAVE_FAILED',
        message: `Failed to save all referenced systems`,
        context: 'referenced_systems',
        details: errors
      }
    };
  }

  if (errors.length > 0) {
    return {
      success: true,
      data: {
        saved: saved.map(s => s.model),
        count: saved.length,
        userSelected: userSelectedCount
      },
      warnings: errors
    };
  }

  return {
    success: true,
    data: {
      saved: saved.map(s => s.model),
      count: saved.length,
      userSelected: userSelectedCount
    }
  };
}

/**
 * Create or update the document record
 */
export async function upsertDocumentRecord({
  docId,
  manufacturer,
  primaryModelNorm,
  primaryAssetUid,
  modelsDetected,
  referencedModels,
  storagePath
}) {
  const supabase = await getSupabaseClient();

  try {
    // models_covered = primary models only (NOT referenced systems)
    const modelsCovered = (modelsDetected || []).filter((v, i, a) => v && a.indexOf(v) === i);

    const docRecord = {
      doc_id: docId,
      manufacturer_norm: manufacturer || null,
      model_norm: primaryModelNorm || modelsDetected?.[0] || null,
      models_covered: modelsCovered.length > 0 ? modelsCovered : null,
      is_multi_model: (modelsDetected?.length || 0) > 1,
      asset_uid: primaryAssetUid || null
    };

    // Only include storage_path if provided, to avoid overwriting existing value with null
    if (storagePath) {
      docRecord.storage_path = storagePath;
    }

    const { data: docData, error: docError } = await supabase
      .from('documents')
      .upsert([docRecord], { onConflict: 'doc_id' })
      .select()
      .single();

    if (docError) {
      return { success: false, error: parseDbError(docError, 'Failed to save document') };
    }

    return { success: true, data: docData };

  } catch (error) {
    log.error('Failed to upsert document record', { error: error.message });
    return { success: false, error: parseDbError(error, 'Document save failed') };
  }
}

/**
 * Save detection results for debugging (optional, non-blocking)
 */
export async function saveDetectionResults({
  docId,
  filename,
  manufacturer,
  modelsDetected,
  referencedProducts,
  markdownLength
}) {
  const supabase = await getSupabaseClient();

  try {
    const detectionRecord = {
      doc_id: docId,
      filename,
      manufacturer_detected: manufacturer,
      models_detected: modelsDetected || [],
      referenced_products: referencedProducts || [],
      markdown_length: markdownLength || 0,
      created_at: new Date().toISOString()
    };

    await supabase
      .from('document_detection_results')
      .upsert([detectionRecord], { onConflict: 'doc_id' });

  } catch (e) {
    log.debug('Detection results table not available', { error: e.message });
  }
}

/**
 * Validate installed primary selection
 */
export function validateInstalledPrimary(installedPrimary, systems) {
  if (installedPrimary) {
    if (!installedPrimary.model_norm) {
      return {
        valid: false,
        error: {
          code: 'INVALID_PRIMARY',
          message: 'Installed primary must have a model_norm',
          context: 'validation'
        }
      };
    }
    return { valid: true, primary: installedPrimary };
  }

  if (systems && systems.length > 0) {
    const primaryItems = systems.filter(s => s.is_primary === true);

    if (primaryItems.length === 0) {
      return { valid: true, primary: null };
    }

    const uniquePrimaryModels = [...new Set(primaryItems.map(s => s.model_norm))];

    if (uniquePrimaryModels.length > 1) {
      return {
        valid: false,
        error: {
          code: 'MULTIPLE_PRIMARIES',
          message: `Exactly one installed primary model required, but ${uniquePrimaryModels.length} were selected: ${uniquePrimaryModels.join(', ')}`,
          context: 'validation'
        }
      };
    }

    return { valid: true, primary: primaryItems[0] };
  }

  return { valid: true, primary: null };
}

/**
 * Generate document ID from content hash
 */
export function generateDocId(content, filename) {
  return crypto
    .createHash('sha256')
    .update(content || filename)
    .digest('hex');
}
