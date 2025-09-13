// test-dip-cleaner.js
import 'dotenv/config';
import { cleanDipForDoc } from './src/services/dip-cleaner/dip-cleaner.service.js';

const docId = '31c1c1786e4c7a98ac38079bce69232fe7b1600faaef4442dab3447f0582448e';
const jobId = 'e3418cd5-169a-4c7a-a27d-8031bdfa0b32';

console.log('🧪 Testing DIP Cleaner service directly...');
console.log(`📄 Doc ID: ${docId}`);
console.log(`🔧 Job ID: ${jobId}`);
console.log('');

(async () => {
  try {
    const result = await cleanDipForDoc(docId, jobId);
    console.log('✅ DIP Cleaner completed successfully!');
    console.log('📊 Results:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ DIP Cleaner failed:');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
})();
