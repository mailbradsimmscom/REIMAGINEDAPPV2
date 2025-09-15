#!/usr/bin/env node

import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
dotenv.config();

async function clearNamespace() {
  try {
    const pc = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });

    const index = pc.index(process.env.PINECONE_INDEX);
    const namespace = process.env.PINECONE_NAMESPACE;
    
    console.log(`🧹 Clearing namespace '${namespace}'...`);
    await index.namespace(namespace).deleteAll();
    console.log(`✅ Done! Namespace '${namespace}' is now empty`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

clearNamespace();