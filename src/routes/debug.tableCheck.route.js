import { getSupabaseClient } from '../repositories/supabaseClient.js';

// GET /debug/table?name=your_table
export async function debugTableCheckRoute(req, res) {
  // Development-only route
  if (process.env.NODE_ENV === 'production') {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const name = url.searchParams.get('name');
  if (!name) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Missing query parameter: name' }));
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from(name).select('*').limit(1);
    
    if (error) {
      // Better error handling with context
      const err = new Error(`Table check failed: ${error.message}`);
      err.cause = error;
      err.context = { tableName: name, operation: 'select' };
      throw err;
    }
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ table: name, sampleRow: data?.[0] ?? null }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ 
      error: error.message, 
      context: error.context,
      type: 'table_check_error'
    }));
  }
}

export default debugTableCheckRoute;
