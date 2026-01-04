#!/usr/bin/env node

/**
 * Analyze manuals in Pinecone to identify which ones cover multiple product models
 * Uses GPT-4o-mini to analyze chunk content and extract model variants
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { getEnv } from '../src/config/env.js';
import OpenAI from 'openai';

const env = getEnv();
const pc = new Pinecone({ apiKey: env.PINECONE_API_KEY });
const index = pc.index(env.PINECONE_INDEX);
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const NAMESPACE = 'REIMAGINEDDOCS';
const CHUNKS_PER_DOC = 8; // First 8 chunks usually have model info

async function getAllDocuments() {
  // Query with a generic embedding to get a sample of all documents
  const emb = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: 'product specifications model installation maintenance manual',
    dimensions: 3072
  });

  const results = await index.namespace(NAMESPACE).query({
    vector: emb.data[0].embedding,
    topK: 2000, // Get as many as possible
    includeMetadata: true
  });

  // Group by document (manufacturer|model)
  const byDoc = {};
  for (const match of results.matches || []) {
    const mfr = match.metadata?.manufacturer || 'Unknown';
    const model = match.metadata?.model || 'Unknown';
    const key = `${mfr}|${model}`;

    if (!byDoc[key]) {
      byDoc[key] = {
        manufacturer: mfr,
        model: model,
        chunks: []
      };
    }

    if (byDoc[key].chunks.length < CHUNKS_PER_DOC) {
      byDoc[key].chunks.push(match.metadata?.text || '');
    }
  }

  return Object.values(byDoc);
}

async function analyzeDocument(doc) {
  const combinedText = doc.chunks.join('\n\n---\n\n').slice(0, 12000); // Limit to ~3K tokens

  const prompt = `Analyze this product manual content and determine if it covers MULTIPLE product models/variants.

MANUFACTURER: ${doc.manufacturer}
DOCUMENT MODEL NAME: ${doc.model}

MANUAL CONTENT:
${combinedText}

Respond with JSON only:
{
  "covers_multiple_models": true/false,
  "model_numbers": ["list", "of", "specific", "model", "numbers", "found"],
  "model_type": "what kind of identifier (e.g., 'part number', 'model series', 'voltage variant')",
  "specs_that_differ": ["list specs that vary between models, e.g., 'dimensions', 'voltage', 'capacity'"],
  "confidence": "high/medium/low"
}

Look for:
- Model number tables (e.g., B70750, B70770)
- Specification comparison tables
- "Models: X, Y, Z" statements
- Different part numbers with same product name
- Voltage/size variants (e.g., 12V, 24V, 48V versions)

If only ONE model is covered, set covers_multiple_models to false and model_numbers to that single model.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1
    });

    const result = JSON.parse(response.choices[0].message.content);
    return {
      ...result,
      tokens_used: response.usage?.total_tokens || 0
    };
  } catch (e) {
    console.error(`  Error analyzing ${doc.manufacturer}|${doc.model}:`, e.message);
    return {
      covers_multiple_models: null,
      error: e.message,
      tokens_used: 0
    };
  }
}

async function main() {
  console.log('=== Multi-Model Manual Analysis ===\n');
  console.log('Fetching documents from Pinecone...');

  const documents = await getAllDocuments();
  console.log(`Found ${documents.length} documents to analyze\n`);

  const results = [];
  let totalTokens = 0;
  let multiModelCount = 0;

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    process.stdout.write(`[${i + 1}/${documents.length}] ${doc.manufacturer} | ${doc.model}... `);

    const analysis = await analyzeDocument(doc);
    totalTokens += analysis.tokens_used;

    if (analysis.covers_multiple_models) {
      multiModelCount++;
      console.log(`✓ MULTI-MODEL (${analysis.model_numbers?.length || '?'} variants)`);
    } else if (analysis.covers_multiple_models === false) {
      console.log('· single model');
    } else {
      console.log('✗ error');
    }

    results.push({
      manufacturer: doc.manufacturer,
      model: doc.model,
      chunk_count: doc.chunks.length,
      ...analysis
    });

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('ANALYSIS COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total documents: ${documents.length}`);
  console.log(`Multi-model manuals: ${multiModelCount}`);
  console.log(`Single-model manuals: ${documents.length - multiModelCount}`);
  console.log(`Total tokens used: ${totalTokens.toLocaleString()}`);
  console.log(`Estimated cost: $${((totalTokens / 1000000) * 0.15 + (totalTokens / 1000000) * 0.6).toFixed(4)}`);

  // Print multi-model manuals
  console.log('\n' + '='.repeat(60));
  console.log('MULTI-MODEL MANUALS FOUND');
  console.log('='.repeat(60));

  const multiModel = results.filter(r => r.covers_multiple_models);
  multiModel.forEach(r => {
    console.log(`\n${r.manufacturer} | ${r.model}`);
    console.log(`  Models: ${r.model_numbers?.join(', ') || 'unknown'}`);
    console.log(`  Type: ${r.model_type || 'unknown'}`);
    console.log(`  Differs: ${r.specs_that_differ?.join(', ') || 'unknown'}`);
    console.log(`  Confidence: ${r.confidence || 'unknown'}`);
  });

  // Save full results to JSON
  const outputPath = './results/multimodel-analysis.json';
  const { writeFileSync, mkdirSync, existsSync } = await import('fs');
  const { dirname } = await import('path');

  if (!existsSync('./results')) {
    mkdirSync('./results', { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      total_documents: documents.length,
      multi_model_count: multiModelCount,
      single_model_count: documents.length - multiModelCount,
      total_tokens: totalTokens,
      estimated_cost_usd: ((totalTokens / 1000000) * 0.15 + (totalTokens / 1000000) * 0.6)
    },
    multi_model_manuals: multiModel,
    all_results: results
  }, null, 2));

  console.log(`\nFull results saved to: ${outputPath}`);
}

main().catch(console.error);
