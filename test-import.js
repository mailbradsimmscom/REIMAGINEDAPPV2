// test-import.js
import 'dotenv/config';

console.log('🧪 Testing DIP Cleaner imports...');

try {
  console.log('1. Importing cleanDipForDoc...');
  const { cleanDipForDoc } = await import('./src/services/dip-cleaner/dip-cleaner.service.js');
  console.log('✅ cleanDipForDoc imported successfully');
  
  console.log('2. Checking if function exists...');
  console.log('Function type:', typeof cleanDipForDoc);
  
  console.log('✅ All imports successful - DIP Cleaner service is loadable');
  
} catch (error) {
  console.error('❌ Import failed:');
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
}
