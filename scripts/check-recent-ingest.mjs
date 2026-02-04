import {getSupabaseClient} from '../src/repositories/supabaseClient.js';
const sb = await getSupabaseClient();

// Recent systems
const {data: systems} = await sb.from('systems').select('asset_uid, manufacturer_norm, model_norm, description, created_at, synonyms_fts, colloquial_keywords, spec_keywords').order('created_at', {ascending: false}).limit(5);

console.log('=== Most recent systems ===');
for (const s of (systems || [])) {
  console.log('\n---');
  console.log('asset_uid:', s.asset_uid);
  console.log('manufacturer:', s.manufacturer_norm);
  console.log('model_norm:', s.model_norm);
  console.log('description:', (s.description || '').substring(0, 100));
  console.log('created_at:', s.created_at);
  console.log('synonyms_fts:', (s.synonyms_fts || '').substring(0, 200));
  console.log('colloquial_keywords:', (s.colloquial_keywords || '').substring(0, 200));
  console.log('spec_keywords:', (s.spec_keywords || '').substring(0, 100));
}

// Recent documents
const {data: docs} = await sb.from('documents').select('doc_id, manufacturer_norm, model_norm, models_covered, is_multi_model, created_at').order('created_at', {ascending: false}).limit(3);

console.log('\n\n=== Most recent documents ===');
for (const d of (docs || [])) {
  console.log('\n---');
  console.log('doc_id:', (d.doc_id || '').substring(0, 20) + '...');
  console.log('manufacturer:', d.manufacturer_norm);
  console.log('model_norm:', d.model_norm);
  console.log('models_covered:', d.models_covered);
  console.log('is_multi_model:', d.is_multi_model);
  console.log('created_at:', d.created_at);
}

// Check model_norm is L1 normalized (no spaces, hyphens, underscores, all uppercase)
console.log('\n\n=== L1 Normalize check ===');
for (const s of (systems || [])) {
  const hasSpaces = /\s/.test(s.model_norm || '');
  const hasHyphens = /-/.test(s.model_norm || '');
  const hasUnderscores = /_/.test(s.model_norm || '');
  const hasLower = /[a-z]/.test(s.model_norm || '');
  const issues = [];
  if (hasSpaces) issues.push('spaces');
  if (hasHyphens) issues.push('hyphens');
  if (hasUnderscores) issues.push('underscores');
  if (hasLower) issues.push('lowercase');
  if (issues.length > 0) {
    console.log('WARNING:', s.model_norm, '- has:', issues.join(', '));
  } else {
    console.log('OK:', s.model_norm);
  }
}
