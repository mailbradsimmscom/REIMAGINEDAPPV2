// Test script to ingest playbook_hints DIP for Zeus3S
import { ingestDipOutputsToDb } from './src/services/dip.ingest.service.js';

const docId = 'c0423de72bdbb87d3bb3b517bc4f4ba189c02e21d5da4f815d0cac303848770f';

console.log('Testing playbook_hints DIP ingestion...');
console.log('Doc ID:', docId);

try {
  const result = await ingestDipOutputsToDb({
    docId,
    paths: {
      playbook_hints: `manuals/${docId}/DIP/${docId}_playbook_hints_an.json`
    }
  });

  console.log('✅ SUCCESS:', JSON.stringify(result, null, 2));
  process.exit(0);
} catch (error) {
  console.error('❌ FAILED:', error.message);
  console.error(error);
  process.exit(1);
}
