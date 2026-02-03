import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';
import docAssetsRepository from '../repositories/doc-assets.repository.js';
import documentRepository from '../repositories/document.repository.js';

/**
 * Vision Pipeline Service
 *
 * Orchestrates Vision Stage 6-7:
 * 1. Call sidecar /v1/vision/analyze-pages (Stage 6)
 * 2. Call sidecar /v1/vision/crop-figures (Stage 7)
 * 3. Upsert assets to doc_assets table
 */

const log = logger.createRequestLogger();

/**
 * Get the Python sidecar URL
 */
function getSidecarUrl() {
  return getEnv().PYTHON_SIDECAR_URL || 'http://localhost:8000';
}

/**
 * Run the full vision pipeline for a document
 *
 * @param {Object} params
 * @param {string} params.docId - Document ID
 * @param {string} params.storagePath - Supabase Storage path to PDF
 * @param {string[]} params.selectedModels - User-approved primary models (tag universe)
 * @param {string[]} [params.referencedSelections=[]] - User's selected referenced systems
 * @param {string} [params.pages='1-10'] - Page range to analyze
 * @param {string} [params.context=''] - Document context for Vision prompt
 * @returns {Promise<Object>} Pipeline results
 */
export async function runVisionPipeline({
  docId,
  storagePath,
  selectedModels,
  referencedSelections = [],
  pages = '1-10',
  context = ''
}) {
  const startTime = Date.now();
  const sidecarUrl = getSidecarUrl();
  const warnings = [];

  log.info('Starting vision pipeline', {
    docId,
    storagePath,
    selectedModels,
    referencedSelections,
    pages
  });

  // ========================================================================
  // Fetch document to get models_covered (all primary models in the manual)
  // ========================================================================
  let modelsCovered;
  try {
    const document = await documentRepository.getDocument(docId);
    modelsCovered = document?.models_covered;

    if (!modelsCovered || modelsCovered.length === 0) {
      log.error('Document missing models_covered', { docId });
      return {
        success: false,
        error: 'MODELS_COVERED_MISSING',
        error_message: 'Document is missing models_covered; rerun model detection before vision.',
        pages_analyzed: 0,
        figures_cropped: 0,
        tables_cropped: 0,
        assets_saved: 0,
        manifest_path: null,
        warnings: [],
        processing_time: Date.now() - startTime
      };
    }

    log.info('Using models_covered from document', { docId, modelsCovered });
  } catch (error) {
    log.error('Failed to fetch document for models_covered', { docId, error: error.message });
    return {
      success: false,
      error: `Failed to fetch document: ${error.message}`,
      pages_analyzed: 0,
      figures_cropped: 0,
      tables_cropped: 0,
      assets_saved: 0,
      manifest_path: null,
      warnings: [],
      processing_time: Date.now() - startTime
    };
  }

  // ========================================================================
  // Stage 6: Analyze pages with Vision
  // ========================================================================
  let analyzeResponse;
  try {
    const analyzeRequest = {
      doc_id: docId,
      storage_path: storagePath,
      models_covered: modelsCovered,
      selected_models: selectedModels,
      referenced_selections: referencedSelections,
      pages,
      context
    };

    log.info('Calling vision analyze-pages', { docId, pages });

    const response = await fetch(`${sidecarUrl}/v1/vision/analyze-pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(analyzeRequest)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vision analyze failed: ${response.status} - ${errorText}`);
    }

    analyzeResponse = await response.json();

    if (!analyzeResponse.success) {
      throw new Error(`Vision analyze failed: ${analyzeResponse.error}`);
    }

    log.info('Vision analyze complete', {
      docId,
      pagesAnalyzed: analyzeResponse.pages_analyzed,
      analysisPaths: analyzeResponse.analysis_paths?.length || 0
    });

    if (analyzeResponse.warnings?.length > 0) {
      warnings.push(...analyzeResponse.warnings);
    }

  } catch (error) {
    log.error('Vision analyze-pages failed', { docId, error: error.message });
    return {
      success: false,
      error: `Stage 6 (analyze) failed: ${error.message}`,
      pages_analyzed: 0,
      figures_cropped: 0,
      tables_cropped: 0,
      assets_saved: 0,
      manifest_path: null,
      warnings,
      processing_time: Date.now() - startTime
    };
  }

  // Check if any pages had figures/tables
  const hasFiguresOrTables = (analyzeResponse.analysis_paths || []).some(
    ap => (ap.figures_found || 0) > 0 || (ap.tables_found || 0) > 0
  );

  if (!hasFiguresOrTables) {
    log.info('No figures or tables found, skipping crop stage', { docId });
    return {
      success: true,
      pages_analyzed: analyzeResponse.pages_analyzed || 0,
      figures_cropped: 0,
      tables_cropped: 0,
      assets_saved: 0,
      manifest_path: null,
      warnings,
      processing_time: Date.now() - startTime
    };
  }

  // ========================================================================
  // Stage 7: Crop figures and tables
  // ========================================================================
  let cropResponse;
  try {
    const cropRequest = {
      doc_id: docId,
      storage_path: storagePath,
      analysis_paths: analyzeResponse.analysis_paths
    };

    log.info('Calling vision crop-figures', {
      docId,
      analysisPaths: analyzeResponse.analysis_paths?.length || 0
    });

    const response = await fetch(`${sidecarUrl}/v1/vision/crop-figures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cropRequest)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vision crop failed: ${response.status} - ${errorText}`);
    }

    cropResponse = await response.json();

    if (!cropResponse.success) {
      throw new Error(`Vision crop failed: ${cropResponse.error}`);
    }

    log.info('Vision crop complete', {
      docId,
      figuresCropped: cropResponse.figures_cropped,
      tablesCropped: cropResponse.tables_cropped
    });

    if (cropResponse.warnings?.length > 0) {
      warnings.push(...cropResponse.warnings);
    }

  } catch (error) {
    log.error('Vision crop-figures failed', { docId, error: error.message });
    return {
      success: false,
      error: `Stage 7 (crop) failed: ${error.message}`,
      pages_analyzed: analyzeResponse.pages_analyzed || 0,
      figures_cropped: 0,
      tables_cropped: 0,
      assets_saved: 0,
      manifest_path: null,
      warnings,
      processing_time: Date.now() - startTime
    };
  }

  // ========================================================================
  // Stage 8: Upsert assets to database
  // ========================================================================
  let assetsSaved = 0;
  try {
    const assets = (cropResponse.assets || []).map(asset => ({
      doc_id: asset.doc_id,
      page_number: asset.page_number,
      asset_kind: asset.asset_kind,
      asset_index: asset.asset_index,
      asset_type: asset.asset_type || null,
      title: asset.title || null,
      description: asset.description || null,
      figure_reference: asset.figure_reference || null,
      bbox: asset.bbox,
      storage_path: asset.storage_path,
      analysis_path: asset.analysis_path,
      applies_to_models: asset.applies_to_models,
      referenced_systems: asset.referenced_systems || [],
      is_universal: asset.is_universal || false,
      confidence: asset.confidence || 'low',
      attribution_warnings: asset.attribution_warnings || [],
      asset_json: asset.asset_json
    }));

    if (assets.length > 0) {
      const result = await docAssetsRepository.upsertAssets(assets);
      assetsSaved = result.upserted;
      log.info('Assets saved to database', { docId, assetsSaved });
    }

  } catch (error) {
    log.error('Failed to save assets to database', { docId, error: error.message });
    warnings.push({
      stage: 'db_upsert',
      message: `Database upsert failed: ${error.message}`
    });
  }

  // ========================================================================
  // Return results
  // ========================================================================
  const processingTime = Date.now() - startTime;

  log.info('Vision pipeline complete', {
    docId,
    pagesAnalyzed: analyzeResponse.pages_analyzed,
    figuresCropped: cropResponse.figures_cropped,
    tablesCropped: cropResponse.tables_cropped,
    assetsSaved,
    processingTime
  });

  return {
    success: true,
    pages_analyzed: analyzeResponse.pages_analyzed || 0,
    figures_cropped: cropResponse.figures_cropped || 0,
    tables_cropped: cropResponse.tables_cropped || 0,
    assets_saved: assetsSaved,
    manifest_path: cropResponse.manifest_path || null,
    warnings,
    processing_time: processingTime
  };
}

/**
 * Get assets for a document from the database
 */
export async function getDocumentAssets(docId) {
  return docAssetsRepository.getAssetsByDocId(docId);
}

/**
 * Get asset summary counts for a document
 */
export async function getDocumentAssetSummary(docId) {
  return docAssetsRepository.getAssetSummary(docId);
}

/**
 * Delete all assets for a document (for re-processing)
 */
export async function deleteDocumentAssets(docId) {
  return docAssetsRepository.deleteAssetsByDocId(docId);
}
