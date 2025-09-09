import { getSupabaseClient } from './supabaseClient.js';

const db = getSupabaseClient();

/**
 * Add spec tag to document chunk metadata for retrieval boost
 */
export async function addSpecTag(chunkId, tag) {
  const { data, error } = await db
    .from('document_chunks')
    .select('metadata')
    .eq('chunk_id', chunkId)
    .single();

  if (error) throw error;
  const meta = data?.metadata ?? {};
  const tags = Array.isArray(meta.spec_tags) ? meta.spec_tags : [];
  const next = { ...meta, spec_tags: [...tags, tag] };

  const { error: updError } = await db
    .from('document_chunks')
    .update({ metadata: next })
    .eq('chunk_id', chunkId);

  if (updError) throw updError;
}

export default { addSpecTag };
