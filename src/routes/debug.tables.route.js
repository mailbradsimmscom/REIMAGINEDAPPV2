import { getPublicTables } from '../services/introspect.service.js';

export async function debugTablesRoute(_req, res) {
  // Development-only route
  if (process.env.NODE_ENV === 'production') {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }

  try {
    const result = await getPublicTables();
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: error.message }));
  }
}

export default debugTablesRoute;
