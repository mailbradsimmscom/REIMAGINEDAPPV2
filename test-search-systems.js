import 'dotenv/config';
import { searchSystems } from './src/repositories/systems.repository.js';

async function test() {
  try {
    console.log('Calling searchSystems("dst810")...\n');
    const result = await searchSystems('dst810');
    console.log('Result:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

test();
