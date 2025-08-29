import { getIndexStats, searchByText, fetchSampleVectors } from '../repositories/pinecone.repository.js';

export async function debugPineconeRoute(req, res) {
  // Development-only route
  if (process.env.NODE_ENV === 'production') {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const action = url.searchParams.get('action') || 'stats';
  const query = url.searchParams.get('query') || 'watermaker';
  const topK = Number(url.searchParams.get('topK') || '3');

  try {
    let result;
    
    switch (action) {
      case 'stats':
        result = await getIndexStats();
        break;
        
      case 'search':
        result = await searchByText(query, { topK });
        break;
        
      case 'samples':
        result = await fetchSampleVectors({ topK });
        break;
        
      case 'explore':
        // Get both stats and a sample search
        const [stats, searchResults] = await Promise.all([
          getIndexStats(),
          searchByText(query, { topK: 2 })
        ]);
        
        result = {
          indexStats: stats,
          sampleSearch: {
            query,
            topK: 2,
            results: searchResults
          },
          metadataFields: searchResults.length > 0 ? 
            Object.keys(searchResults[0].metadata || {}) : []
        };
        break;
        
      default:
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ 
          error: 'Invalid action. Use: stats, search, samples, or explore',
          availableActions: ['stats', 'search', 'samples', 'explore']
        }));
        return;
    }
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      action,
      timestamp: new Date().toISOString(),
      result
    }));
    
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ 
      error: error.message,
      context: error.context,
      type: 'pinecone_debug_error',
      timestamp: new Date().toISOString()
    }));
  }
}

export default debugPineconeRoute;
