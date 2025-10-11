// Test search exactness - case sensitivity, partial matches, special chars
import { createClient } from '@supabase/supabase-js';
import { getEnv } from './src/config/env.js';

const env = getEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

console.log('🔍 Testing Search Exactness\n');
console.log('Testing against model_norm: "mkii_50_50kg"\n');
console.log('='.repeat(80));

const testQueries = [
  'MKII',           // Uppercase
  'mkii',           // Lowercase
  'MkII',           // Mixed case
  'mkii 50',        // Partial with space
  'mkii_50',        // Partial with underscore
  'mkii_50_50kg',   // Exact match
  'mk',             // Prefix only
  'rocna mkii',     // With manufacturer
  'rocna mk2',      // Common alternate spelling
  '50kg',           // Just weight
];

for (const query of testQueries) {
  console.log(`\n📊 Query: "${query}"`);
  console.log('─'.repeat(80));

  const { data, error } = await supabase.rpc('search_systems', {
    q: query,
    top_n: 5
  });

  if (error) {
    console.error(`   ❌ Error: ${error.message}`);
    continue;
  }

  if (!data || data.length === 0) {
    console.log('   ⚠️  No results found');
    continue;
  }

  // Get full details
  const assetUids = data.map(r => r.asset_uid);
  const { data: systems } = await supabase
    .from('systems')
    .select('asset_uid, manufacturer_norm, model_norm')
    .in('asset_uid', assetUids);

  const results = data.map(result => {
    const system = systems.find(s => s.asset_uid === result.asset_uid);
    return { ...result, ...system };
  });

  console.log(`   Found ${results.length} results:\n`);

  results.forEach((r, i) => {
    console.log(`   ${i+1}. ${r.manufacturer_norm || 'Unknown'} ${r.model_norm || 'Unknown'}`);
    console.log(`      rank: ${r.rank.toFixed(6)}`);
  });
}

console.log('\n' + '='.repeat(80));
console.log('📚 How PostgreSQL Full-Text Search Works:');
console.log('='.repeat(80));
console.log(`
1. **Case Insensitive** ✅
   - "MKII", "mkii", "MkII" all match the same

2. **Word Boundaries Matter**
   - "mkii_50_50kg" is tokenized as: ["mkii", "50", "50kg"]
   - Underscore (_) is treated as a word separator
   - So searching "mkii" will match "mkii_50_50kg"

3. **Stemming** (for English)
   - "winches" → stem "winch"
   - "winch" → stem "winch"
   - Both match!

4. **Partial Words DON'T Match**
   - "mk" won't match "mkii" (not a complete word)
   - Use prefix search (:*) for that

5. **Numbers are Tokenized**
   - "50" and "50kg" are separate tokens
   - "50kg" is one token (number + letters together)

6. **Common Misspellings**
   - "mk2" won't match "mkii" (different tokens)
   - No fuzzy matching by default
`);

console.log('\n🎯 Key Insight for Your Question:');
console.log('─'.repeat(80));
console.log(`
model_norm: "mkii_50_50kg"

Tokenized as: ["mkii", "50", "50kg"]

Search "MKII":
  ✅ WILL match (case insensitive, "mkii" is a token)

Search "mk":
  ❌ WON'T match ("mk" ≠ "mkii", not a prefix search)

Search "mkii 50":
  ✅ WILL match (both "mkii" and "50" are tokens)

Search "mk2":
  ❌ WON'T match ("mk2" ≠ "mkii", different tokens)

To enable prefix matching: use websearch_to_tsquery with "mk*"
To enable fuzzy matching: need pg_trgm extension
`);

process.exit(0);
