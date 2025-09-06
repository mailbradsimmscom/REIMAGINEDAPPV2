import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { getEnv } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const env = getEnv();

/**
 * Extract text preview from multiple sources in priority order:
 * 1. Supabase Storage: documents/manuals/<docId>/text/preview.txt or text/page-*.txt
 * 2. Postgres table: document_chunks (fallback)
 * 3. Log warning if neither available
 */
export async function extractTextPreviewFromPdf(docId, options = {}) {
  const { maxPages = 6 } = options;
  const log = logger.createRequestLogger();
  
  try {
    log.info('pdfPreview.extract.start', { docId, maxPages });
    
    // Try Supabase Storage first (preferred)
    const storageText = await tryStorageExtraction(docId, maxPages, log);
    if (storageText) {
      log.info('pdfPreview.extract.storage_success', { docId, pages: storageText.length });
      return storageText;
    }
    
    // Fallback to Postgres table
    const dbText = await tryDbExtraction(docId, maxPages, log);
    if (dbText) {
      log.info('pdfPreview.extract.db_success', { docId, pages: dbText.length });
      return dbText;
    }
    
    // Neither source available
    log.warn('pdfPreview.extract.no_sources', { docId });
    return [];
    
  } catch (error) {
    log.error('pdfPreview.extract.error', { docId, error: error.message });
    return [];
  }
}

async function tryStorageExtraction(docId, maxPages, log) {
  try {
    const supabaseClient = await getSupabaseClient();
    
    // Try preview.txt first
    const previewPath = `documents/manuals/${docId}/text/preview.txt`;
    const { data: previewData, error: previewError } = await supabaseClient.storage
      .from('documents')
      .download(previewPath);
    
    if (!previewError && previewData) {
      const text = await previewData.text();
      if (text.trim()) {
        log.info('pdfPreview.storage.preview_found', { docId });
        return [{ page: 1, text: text.trim() }];
      }
    }
    
    // Try individual page files
    const pages = [];
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const pagePath = `documents/manuals/${docId}/text/page-${pageNum}.txt`;
      const { data: pageData, error: pageError } = await supabaseClient.storage
        .from('documents')
        .download(pagePath);
      
      if (!pageError && pageData) {
        const text = await pageData.text();
        if (text.trim()) {
          pages.push({ page: pageNum, text: text.trim() });
        }
      }
    }
    
    if (pages.length > 0) {
      log.info('pdfPreview.storage.pages_found', { docId, count: pages.length });
      return pages;
    }
    
    return null;
  } catch (error) {
    log.warn('pdfPreview.storage.error', { docId, error: error.message });
    return null;
  }
}

async function tryDbExtraction(docId, maxPages, log) {
  try {
    const supabaseClient = await getSupabaseClient();
    
    const { data, error } = await supabaseClient
      .from(env.DOC_CHUNKS_TABLE)
      .select(`${env.DOC_CHUNKS_PAGE_COL}, ${env.DOC_CHUNKS_TEXT_COL}`)
      .eq('doc_id', docId)
      .order(env.DOC_CHUNKS_PAGE_COL)
      .limit(maxPages);
    
    if (error) {
      log.warn('pdfPreview.db.error', { docId, error: error.message });
      return null;
    }
    
    if (!data || data.length === 0) {
      log.info('pdfPreview.db.no_data', { docId });
      return null;
    }
    
    const pages = data.map(row => ({
      page: row[env.DOC_CHUNKS_PAGE_COL],
      text: row[env.DOC_CHUNKS_TEXT_COL]
    }));
    
    log.info('pdfPreview.db.success', { docId, count: pages.length });
    return pages;
    
  } catch (error) {
    log.warn('pdfPreview.db.error', { docId, error: error.message });
    return null;
  }
}