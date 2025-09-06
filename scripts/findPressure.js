// ESM, Node 20+
// Usage:
//   node scripts/findPressure.js <docId> [topK]
// Example:
//   node scripts/findPressure.js ZEN150_DOC_ID 100

import 'dotenv/config';
import { Pinecone } from '@pinecone-database/pinecone';

// If you already have a central getEmbedding(), import and use it instead.
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
async function getEmbedding(text) {
  // Use the same embedding model you used at index time.
  // The Python sidecar uses text-embedding-3-large (3072 dimensions)
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: text,
  });
  return res.data[0].embedding;
}

const indexName = process.env.PINECONE_INDEX;
const namespace = process.env.PINECONE_NAMESPACE || 'REIMAGINEDDOCS';

const docId = process.argv[2];
const topK = Number(process.argv[3] || 100);

if (!docId) {
  console.log('No document ID provided. Listing all documents in namespace...');
  // We'll handle this case in the main function
}

const TERMS = [
  'operating pressure',
  'working pressure',
  'pressure',
  'psi',
  'bar'
];
const queryText = TERMS.join(' ');

const contains = new RegExp('\\b(?:pressure|psi|bar)\\b', 'i');

// Pretty preview sans newlines
function preview(s, n = 140) {
  return (s || '').replace(/\s+/g, ' ').slice(0, n);
}

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(indexName).namespace(namespace);

(async () => {
  if (!docId) {
    // List all documents in the namespace
    console.log(`Listing all documents in namespace: ${namespace}`);
    const res = await index.query({
      vector: new Array(3072).fill(0), // Dummy vector for listing
      topK: 1000,
      includeMetadata: true,
    });
    
    const matches = res.matches || [];
    const docIds = new Set();
    
    for (const match of matches) {
      if (match.metadata?.docId) {
        docIds.add(match.metadata.docId);
      }
    }
    
    console.log(`Found ${docIds.size} unique documents:`);
    for (const id of docIds) {
      console.log(`- ${id}`);
    }
    
    if (docIds.size === 0) {
      console.log('No documents found in this namespace.');
    }
    return;
  }

  // 1) Embed the focused query
  const qvec = await getEmbedding(queryText);

  // 2) Query within this document only
  const res = await index.query({
    vector: qvec,
    topK,
    includeMetadata: true,
    filter: { docId }, // <-- IMPORTANT: scope to the single document
  });

  const matches = res.matches || [];
  let total = matches.length;

  // 3) Keep only chunks whose metadata.text actually contains our terms
  const hits = matches
    .map(m => {
      const text = (m.metadata?.text ?? m.metadata?.content ?? '').trim();
      return {
        id: m.id,
        score: m.score,
        page: m.metadata?.page,
        text,
      };
    })
    .filter(h => h.text && contains.test(h.text));

  // 4) Report
  console.log(`Queried docId=${docId} topK=${topK}`);
  console.log(`Total vector matches: ${total}`);
  console.log(`Matches containing /(pressure|psi|bar)/i in metadata.text: ${hits.length}\n`);

  // 5) Show a compact list
  for (const h of hits) {
    console.log(`- id=${h.id} page=${h.page} score=${h.score?.toFixed(3)}`);
    console.log(`  ${preview(h.text)}`);
  }

  // 6) Tally pages for quick sanity
  const byPage = new Map();
  for (const h of hits) byPage.set(h.page, (byPage.get(h.page) || 0) + 1);
  const pages = [...byPage.entries()].sort((a, b) => a[0] - b[0]);
  if (pages.length) {
    console.log('\nPage hit counts:');
    for (const [p, c] of pages) console.log(`  page ${p}: ${c}`);
  }
})();
