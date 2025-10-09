// Test DST810 Pinecone search
import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const index = pc.index(process.env.PINECONE_INDEX);

console.log('🔍 Testing DST810 Pinecone Search\n');
console.log('Index:', process.env.PINECONE_INDEX);
console.log('Namespace:', process.env.PINECONE_NAMESPACE || 'default');
console.log('');

// Create embedding for the query
const query = "DST810 multisensor Airmar B&G features overview";
console.log('Query:', query);
console.log('');

const embeddingResponse = await openai.embeddings.create({
  model: 'text-embedding-3-large',
  input: query
});

const queryEmbedding = embeddingResponse.data[0].embedding;

// Test 1: Search WITH metadata filter
console.log('=== TEST 1: With Metadata Filter ===');
const filter1 = {
  manufacturer: 'Airmar',
  model: 'dst810_smart_multisensor'
};
console.log('Filter:', JSON.stringify(filter1));

const results1 = await index.namespace(process.env.PINECONE_NAMESPACE || '').query({
  vector: queryEmbedding,
  topK: 100,
  filter: filter1,
  includeMetadata: true
});

console.log('Results:', results1.matches.length);
console.log('Above 0.2 threshold:', results1.matches.filter(m => m.score > 0.2).length);
if (results1.matches.length > 0) {
  console.log('\nTop 3 matches:');
  results1.matches.slice(0, 3).forEach((m, i) => {
    console.log(`  ${i+1}. Score: ${m.score.toFixed(4)}`);
    console.log(`     Metadata:`, JSON.stringify(m.metadata, null, 4));
  });
}
console.log('');

// Test 2: Search WITHOUT metadata filter (to see if ANY DST810 docs exist)
console.log('=== TEST 2: Without Metadata Filter (any DST810) ===');
const results2 = await index.namespace(process.env.PINECONE_NAMESPACE || '').query({
  vector: queryEmbedding,
  topK: 100,
  includeMetadata: true
});

console.log('Total results:', results2.matches.length);
const dst810Matches = results2.matches.filter(m =>
  JSON.stringify(m.metadata).toLowerCase().includes('dst810') ||
  JSON.stringify(m.metadata).toLowerCase().includes('dst-810')
);
console.log('Results mentioning DST810:', dst810Matches.length);

if (dst810Matches.length > 0) {
  console.log('\nDST810 matches found:');
  dst810Matches.slice(0, 5).forEach((m, i) => {
    console.log(`  ${i+1}. Score: ${m.score.toFixed(4)}`);
    console.log(`     Manufacturer: ${m.metadata.manufacturer}`);
    console.log(`     Model: ${m.metadata.model}`);
    console.log(`     Doc: ${m.metadata.document_name || m.metadata.filename || 'N/A'}`);
  });
}
console.log('');

// Test 3: Check for Airmar manufacturer
console.log('=== TEST 3: Any Airmar documents ===');
const airmarMatches = results2.matches.filter(m =>
  m.metadata.manufacturer?.toLowerCase() === 'airmar'
);
console.log('Airmar manufacturer matches:', airmarMatches.length);
if (airmarMatches.length > 0) {
  console.log('Sample Airmar models:');
  const models = [...new Set(airmarMatches.map(m => m.metadata.model))].slice(0, 10);
  models.forEach(model => console.log(`  - ${model}`));
}

process.exit(0);
