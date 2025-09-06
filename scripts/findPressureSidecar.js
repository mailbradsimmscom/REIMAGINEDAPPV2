// ESM, Node 20+
// Usage: node scripts/findPressureSidecar.js

import 'dotenv/config';

const sidecarUrl = process.env.PYTHON_SIDECAR_URL || 'http://localhost:8000';
const namespace = process.env.PINECONE_NAMESPACE || 'REIMAGINEDDOCS';

// Test the sidecar search endpoint
async function testSidecarSearch() {
  try {
    console.log(`Testing sidecar search at: ${sidecarUrl}`);
    console.log(`Using namespace: ${namespace}`);
    
    const searchPayload = {
      query: 'pressure watermaker operating',
      topK: 10,
      namespace,
      filter: {},
      includeMetadata: true,
      includeValues: false
    };

    console.log('Search payload:', JSON.stringify(searchPayload, null, 2));

    const response = await fetch(`${sidecarUrl}/v1/pinecone/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(searchPayload)
    });

    if (!response.ok) {
      throw new Error(`Sidecar search failed: ${response.status} ${response.statusText}`);
    }

    const results = await response.json();
    
    console.log('\n=== SIDECAR SEARCH RESULTS ===');
    console.log(`Status: ${response.status}`);
    console.log(`Results:`, JSON.stringify(results, null, 2));
    
    if (results.matches && results.matches.length > 0) {
      console.log(`\nFound ${results.matches.length} matches:`);
      results.matches.forEach((match, i) => {
        console.log(`\nMatch ${i + 1}:`);
        console.log(`  ID: ${match.id}`);
        console.log(`  Score: ${match.score}`);
        console.log(`  Metadata:`, match.metadata);
      });
    } else {
      console.log('\nNo matches found.');
    }

  } catch (error) {
    console.error('Error testing sidecar search:', error.message);
  }
}

// Test sidecar health
async function testSidecarHealth() {
  try {
    console.log('Testing sidecar health...');
    const response = await fetch(`${sidecarUrl}/health`);
    
    if (response.ok) {
      const health = await response.json();
      console.log('Sidecar health:', health);
    } else {
      console.log(`Sidecar health check failed: ${response.status}`);
    }
  } catch (error) {
    console.error('Sidecar health check error:', error.message);
  }
}

(async () => {
  await testSidecarHealth();
  console.log('\n' + '='.repeat(50) + '\n');
  await testSidecarSearch();
})();
