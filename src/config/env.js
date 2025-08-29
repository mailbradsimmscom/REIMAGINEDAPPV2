

function readRequired(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readFirstAvailable(names) {
  for (const key of names) {
    const val = process.env[key];
    if (val && val.trim() !== '') return val;
  }
  const display = names.join(', ');
  throw new Error(`Missing required environment variable. Provide one of: ${display}`);
}

export const env = Object.freeze({
  supabaseUrl: readRequired('SUPABASE_URL'),
  // Prefer service role style keys; fall back to anon if needed (read-only).
  supabaseServiceKey: readFirstAvailable([
    'SUPABASE_SERVICE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_ROLE',
    'SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY'
  ]),
  searchRankFloor: Number(process.env.SEARCH_RANK_FLOOR ?? '0.5'),
  searchMaxRows: Number(process.env.SEARCH_MAX_ROWS ?? '8'),
  
  // Pinecone configuration
  pineconeApiKey: readRequired('PINECONE_API_KEY'),
  pineconeIndex: readRequired('PINECONE_INDEX'),
  pineconeRegion: readRequired('PINECONE_REGION'),
  pineconeCloud: readRequired('PINECONE_CLOUD'),
  pineconeNamespace: process.env.PINECONE_NAMESPACE ?? '__default__',
  
  // OpenAI configuration
  openaiApiKey: readRequired('OPENAI_API_KEY'),
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4',
  
  // Chat configuration
  summaryFrequency: Number(process.env.SUMMARY_FREQUENCY ?? '5')
});

export default env;
