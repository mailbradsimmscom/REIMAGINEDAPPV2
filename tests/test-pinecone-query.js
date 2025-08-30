import 'dotenv/config';

// Test Pinecone query system
async function testPineconeQuery() {
  console.log('🧪 Testing Pinecone Query System...\n');

  try {
    // Test 1: Get index stats
    console.log('1️⃣ Testing index stats...');
    const statsResponse = await fetch('http://localhost:3000/pinecone/stats');
    const stats = await statsResponse.json();
    
    if (stats.success) {
      console.log('✅ Stats retrieved:', {
        totalVectors: stats.data.totalVectors,
        dimension: stats.data.dimension,
        namespaces: Object.keys(stats.data.namespaces || {})
      });
    } else {
      console.log('❌ Stats failed:', stats.error);
      return;
    }

    // Test 2: Simple search
    console.log('\n2️⃣ Testing simple search...');
    const searchResponse = await fetch('http://localhost:3000/pinecone/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'watermaker',
        topK: 5
      })
    });
    
    const searchResults = await searchResponse.json();
    
    if (searchResults.success) {
      console.log('✅ Search completed:', {
        query: searchResults.query,
        resultsCount: searchResults.results?.length || 0,
        enhancedQuery: searchResults.enhancedQuery?.substring(0, 100)
      });
      
      if (searchResults.results && searchResults.results.length > 0) {
        console.log('📄 Sample result:', {
          documentId: searchResults.results[0].documentId,
          manufacturer: searchResults.results[0].manufacturer,
          model: searchResults.results[0].model,
          bestScore: searchResults.results[0].bestScore,
          chunksCount: searchResults.results[0].chunks?.length || 0
        });
      }
    } else {
      console.log('❌ Search failed:', searchResults.error);
    }

    // Test 3: Enhanced query with context
    console.log('\n3️⃣ Testing enhanced query with context...');
    const enhancedResponse = await fetch('http://localhost:3000/pinecone/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'pressure settings',
        context: {
          manufacturer: 'Schenker',
          model: 'ZEN 150',
          previousMessages: [
            { content: 'I need help with my watermaker' }
          ]
        }
      })
    });
    
    const enhancedResults = await enhancedResponse.json();
    
    if (enhancedResults.success) {
      console.log('✅ Enhanced query completed:', {
        query: enhancedResults.query,
        enhancedQuery: enhancedResults.enhancedQuery?.substring(0, 100),
        resultsCount: enhancedResults.results?.length || 0
      });
    } else {
      console.log('❌ Enhanced query failed:', enhancedResults.error);
    }

    console.log('\n🎉 All tests completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run tests
testPineconeQuery();
