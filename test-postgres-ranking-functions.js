// Test different PostgreSQL ranking functions
import { createClient } from '@supabase/supabase-js';
import { getEnv } from './src/config/env.js';

const env = getEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log('🔍 Comparing PostgreSQL Ranking Functions\n');
console.log('Testing query: "harken winches"\n');
console.log('='.repeat(80));

const testQuery = 'harken winches';

// 1. ts_rank() - Current method (frequency-based)
console.log('\n1️⃣  ts_rank() - Frequency-based ranking (CURRENT)');
console.log('─'.repeat(80));
console.log('Ranks based on how often query terms appear in the document');

const { data: tsRankResults } = await supabase.rpc('rpc', {
  params: {
    query: `
      SELECT
        asset_uid,
        manufacturer_norm,
        model_norm,
        ts_rank(
          to_tsvector('english',
            COALESCE(manufacturer_norm, '') || ' ' ||
            COALESCE(model_norm, '') || ' ' ||
            COALESCE(description, '')
          ),
          plainto_tsquery('english', '${testQuery}')
        ) as rank
      FROM systems
      WHERE
        to_tsvector('english',
          COALESCE(manufacturer_norm, '') || ' ' ||
          COALESCE(model_norm, '') || ' ' ||
          COALESCE(description, '')
        ) @@ plainto_tsquery('english', '${testQuery}')
      ORDER BY rank DESC
      LIMIT 5
    `
  }
});

// 2. ts_rank_cd() - Cover density ranking
console.log('\n2️⃣  ts_rank_cd() - Cover Density ranking');
console.log('─'.repeat(80));
console.log('Ranks based on how close together query terms appear (proximity matters)');

const rankCdQuery = `
  SELECT
    asset_uid,
    manufacturer_norm,
    model_norm,
    ts_rank_cd(
      to_tsvector('english',
        COALESCE(manufacturer_norm, '') || ' ' ||
        COALESCE(model_norm, '') || ' ' ||
        COALESCE(description, '')
      ),
      plainto_tsquery('english', '${testQuery}')
    ) as rank_cd
  FROM systems
  WHERE
    to_tsvector('english',
      COALESCE(manufacturer_norm, '') || ' ' ||
      COALESCE(model_norm, '') || ' ' ||
      COALESCE(description, '')
    ) @@ plainto_tsquery('english', '${testQuery}')
  ORDER BY rank_cd DESC
  LIMIT 5
`;

const { data: rankCdResults, error: rankCdError } = await supabase
  .rpc('exec_sql', { sql: rankCdQuery })
  .catch(() => ({ data: null, error: 'RPC not available' }));

// 3. ts_rank() with normalization
console.log('\n3️⃣  ts_rank() with Normalization');
console.log('─'.repeat(80));
console.log('Normalizes scores by document length (prevents long docs from dominating)');

const normQuery = `
  SELECT
    asset_uid,
    manufacturer_norm,
    model_norm,
    ts_rank(
      to_tsvector('english',
        COALESCE(manufacturer_norm, '') || ' ' ||
        COALESCE(model_norm, '') || ' ' ||
        COALESCE(description, '')
      ),
      plainto_tsquery('english', '${testQuery}'),
      32  -- Normalization flag: divide by document length
    ) as rank_normalized
  FROM systems
  WHERE
    to_tsvector('english',
      COALESCE(manufacturer_norm, '') || ' ' ||
      COALESCE(model_norm, '') || ' ' ||
      COALESCE(description, '')
    ) @@ plainto_tsquery('english', '${testQuery}')
  ORDER BY rank_normalized DESC
  LIMIT 5
`;

const { data: normResults, error: normError } = await supabase
  .rpc('exec_sql', { sql: normQuery })
  .catch(() => ({ data: null, error: 'RPC not available' }));

// 4. Weighted ts_rank() - Boost certain fields
console.log('\n4️⃣  ts_rank() with Field Weights');
console.log('─'.repeat(80));
console.log('Gives different importance to different fields (manufacturer > model > description)');

const weightedQuery = `
  SELECT
    asset_uid,
    manufacturer_norm,
    model_norm,
    ts_rank(
      setweight(to_tsvector('english', COALESCE(manufacturer_norm, '')), 'A') ||
      setweight(to_tsvector('english', COALESCE(model_norm, '')), 'B') ||
      setweight(to_tsvector('english', COALESCE(description, '')), 'D'),
      plainto_tsquery('english', '${testQuery}')
    ) as rank_weighted
  FROM systems
  WHERE
    to_tsvector('english',
      COALESCE(manufacturer_norm, '') || ' ' ||
      COALESCE(model_norm, '') || ' ' ||
      COALESCE(description, '')
    ) @@ plainto_tsquery('english', '${testQuery}')
  ORDER BY rank_weighted DESC
  LIMIT 5
`;

const { data: weightedResults, error: weightedError } = await supabase
  .rpc('exec_sql', { sql: weightedQuery })
  .catch(() => ({ data: null, error: 'RPC not available' }));

console.log('\n' + '='.repeat(80));
console.log('📚 PostgreSQL Ranking Functions Summary');
console.log('='.repeat(80));

console.log(`
┌─────────────────────┬──────────────────────────────────────────────────────┐
│ Function            │ Best For                                             │
├─────────────────────┼──────────────────────────────────────────────────────┤
│ ts_rank()           │ General purpose, fast, frequency-based               │
│ ts_rank_cd()        │ When word proximity matters (phrases)                │
│ Normalization       │ When docs vary greatly in length                     │
│ Weighted            │ When some fields are more important than others      │
└─────────────────────┴──────────────────────────────────────────────────────┘

Normalization Flags (for ts_rank and ts_rank_cd):
  0  = No normalization (default)
  1  = Divide by 1 + log(document length)
  2  = Divide by document length
  4  = Divide by mean harmonic distance between extents
  8  = Divide by number of unique words
  16 = Divide by 1 + log(number of unique words)
  32 = Divide by itself + 1
  (Can combine: 1+2+4 = 7)

Weight Labels (A=highest, D=lowest):
  'A' = weight 1.0
  'B' = weight 0.4
  'C' = weight 0.2
  'D' = weight 0.1

📖 Documentation:
https://www.postgresql.org/docs/current/textsearch-controls.html#TEXTSEARCH-RANKING
`);

console.log('\n🎯 Recommendation for Your Use Case:');
console.log('─'.repeat(80));
console.log(`
Since you want to rank YOUR OWNED EQUIPMENT by search relevance:

**Option 1: Weighted ts_rank() (BEST)**
- Manufacturer matches = highest priority
- Model matches = medium priority
- Description matches = lowest priority
- This ensures "Harken 60_3_stea_winch" ranks higher than generic matches

**Option 2: ts_rank_cd() with normalization**
- Good if you want exact phrase matches to rank higher
- e.g., "harken winches" together ranks higher than separate

**Current ts_rank() is fine if:**
- You just want frequency-based ranking
- All fields are equally important
`);

process.exit(0);
