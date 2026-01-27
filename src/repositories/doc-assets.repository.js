import { getSupabaseClient } from './supabaseClient.js';
import { logger } from '../utils/logger.js';
import { isSupabaseConfigured } from '../services/guards/index.js';

/**
 * Repository for doc_assets table (Vision Stage 6-7)
 * Handles CRUD operations for extracted figures/tables from documents
 */
class DocAssetsRepository {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  async checkSupabaseAvailability() {
    if (!isSupabaseConfigured()) {
      const error = new Error('Supabase not configured');
      error.code = 'SUPABASE_DISABLED';
      throw error;
    }

    const supabase = await getSupabaseClient();
    if (!supabase) {
      const error = new Error('Supabase client not available');
      error.code = 'SUPABASE_DISABLED';
      throw error;
    }

    return supabase;
  }

  /**
   * Upsert a single doc_asset
   * Uses ON CONFLICT (doc_id, page_number, asset_kind, asset_index)
   */
  async upsertAsset(asset) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('doc_assets')
        .upsert([asset], {
          onConflict: 'doc_id,page_number,asset_kind,asset_index'
        })
        .select()
        .single();

      if (error) throw error;

      this.requestLogger.info('Doc asset upserted', {
        docId: asset.doc_id,
        page: asset.page_number,
        kind: asset.asset_kind,
        index: asset.asset_index
      });

      return data;
    } catch (error) {
      this.requestLogger.error('Failed to upsert doc asset', {
        error: error.message,
        docId: asset.doc_id,
        page: asset.page_number
      });
      throw error;
    }
  }

  /**
   * Upsert multiple doc_assets in batch
   */
  async upsertAssets(assets) {
    if (!assets || assets.length === 0) {
      return { upserted: 0, assets: [] };
    }

    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('doc_assets')
        .upsert(assets, {
          onConflict: 'doc_id,page_number,asset_kind,asset_index'
        })
        .select();

      if (error) throw error;

      this.requestLogger.info('Doc assets batch upserted', {
        count: data.length,
        docId: assets[0]?.doc_id
      });

      return { upserted: data.length, assets: data };
    } catch (error) {
      this.requestLogger.error('Failed to batch upsert doc assets', {
        error: error.message,
        count: assets.length
      });
      throw error;
    }
  }

  /**
   * Get all assets for a document
   */
  async getAssetsByDocId(docId) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('doc_assets')
        .select('*')
        .eq('doc_id', docId)
        .order('page_number')
        .order('asset_kind')
        .order('asset_index');

      if (error) throw error;
      return data || [];
    } catch (error) {
      this.requestLogger.error('Failed to get assets by doc_id', {
        error: error.message,
        docId
      });
      throw error;
    }
  }

  /**
   * Get assets by model (uses GIN index on applies_to_models)
   */
  async getAssetsByModel(modelNorm) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('doc_assets')
        .select('*')
        .contains('applies_to_models', [modelNorm])
        .order('doc_id')
        .order('page_number');

      if (error) throw error;
      return data || [];
    } catch (error) {
      this.requestLogger.error('Failed to get assets by model', {
        error: error.message,
        modelNorm
      });
      throw error;
    }
  }

  /**
   * Get assets by referenced system (uses GIN index on referenced_systems)
   */
  async getAssetsBySystem(systemNorm) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('doc_assets')
        .select('*')
        .contains('referenced_systems', [systemNorm])
        .order('doc_id')
        .order('page_number');

      if (error) throw error;
      return data || [];
    } catch (error) {
      this.requestLogger.error('Failed to get assets by system', {
        error: error.message,
        systemNorm
      });
      throw error;
    }
  }

  /**
   * Get assets by kind (figure or table)
   */
  async getAssetsByKind(docId, assetKind) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('doc_assets')
        .select('*')
        .eq('doc_id', docId)
        .eq('asset_kind', assetKind)
        .order('page_number')
        .order('asset_index');

      if (error) throw error;
      return data || [];
    } catch (error) {
      this.requestLogger.error('Failed to get assets by kind', {
        error: error.message,
        docId,
        assetKind
      });
      throw error;
    }
  }

  /**
   * Delete all assets for a document (for re-processing)
   */
  async deleteAssetsByDocId(docId) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('doc_assets')
        .delete()
        .eq('doc_id', docId)
        .select();

      if (error) throw error;

      this.requestLogger.info('Doc assets deleted', {
        docId,
        count: data?.length || 0
      });

      return { deleted: data?.length || 0 };
    } catch (error) {
      this.requestLogger.error('Failed to delete doc assets', {
        error: error.message,
        docId
      });
      throw error;
    }
  }

  /**
   * Count assets by document
   */
  async countAssetsByDocId(docId) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { count, error } = await supabase
        .from('doc_assets')
        .select('*', { count: 'exact', head: true })
        .eq('doc_id', docId);

      if (error) throw error;
      return count || 0;
    } catch (error) {
      this.requestLogger.error('Failed to count doc assets', {
        error: error.message,
        docId
      });
      throw error;
    }
  }

  /**
   * Get asset count summary by kind
   */
  async getAssetSummary(docId) {
    const supabase = await this.checkSupabaseAvailability();
    try {
      const { data, error } = await supabase
        .from('doc_assets')
        .select('asset_kind')
        .eq('doc_id', docId);

      if (error) throw error;

      const figures = (data || []).filter(a => a.asset_kind === 'figure').length;
      const tables = (data || []).filter(a => a.asset_kind === 'table').length;

      return { figures, tables, total: figures + tables };
    } catch (error) {
      this.requestLogger.error('Failed to get asset summary', {
        error: error.message,
        docId
      });
      throw error;
    }
  }
}

export default new DocAssetsRepository();
