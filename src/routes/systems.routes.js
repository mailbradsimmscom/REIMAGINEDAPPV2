import { listSystemsSvc, getSystemSvc, searchSystemsSvc } from '../services/systems.service.js';

export async function systemsListRoute(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const limit = url.searchParams.get('limit');
  const cursor = url.searchParams.get('cursor');
  
  try {
    const result = await listSystemsSvc({ limit, cursor });
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(result));
  } catch (error) {
    // Determine appropriate HTTP status code
    let statusCode = 500;
    if (error.message.includes('required') || error.message.includes('invalid')) {
      statusCode = 400; // Bad Request
    } else if (error.message.includes('Not Found') || error.message.includes('not found')) {
      statusCode = 404; // Not Found
    }
    
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ 
      error: error.message,
      type: 'systems_list_error',
      context: error.context,
      timestamp: new Date().toISOString()
    }));
  }
}

export async function systemsGetRoute(req, res) {
  const match = req.url.match(/^\/systems\/([^\/?#]+)/);
  const assetUid = match ? decodeURIComponent(match[1]) : null;
  
  try {
    if (!assetUid) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ 
        error: 'Invalid asset_uid parameter',
        type: 'systems_get_error',
        timestamp: new Date().toISOString()
      }));
      return;
    }
    
    const item = await getSystemSvc(assetUid);
    if (!item) {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ 
        error: 'System not found',
        type: 'systems_get_error',
        context: { assetUid },
        timestamp: new Date().toISOString()
      }));
      return;
    }
    
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(item));
  } catch (error) {
    let statusCode = 500;
    if (error.message.includes('required') || error.message.includes('invalid')) {
      statusCode = 400;
    } else if (error.message.includes('not found')) {
      statusCode = 404;
    }
    
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ 
      error: error.message,
      type: 'systems_get_error',
      context: error.context,
      timestamp: new Date().toISOString()
    }));
  }
}

export async function systemsSearchRoute(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('q');
  const limit = url.searchParams.get('limit');
  
  try {
    const result = await searchSystemsSvc(q, { limit });
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(result));
  } catch (error) {
    let statusCode = 500;
    if (error.message.includes('required') || error.message.includes('invalid') || error.message.includes('too long')) {
      statusCode = 400; // Bad Request
    }
    
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ 
      error: error.message,
      type: 'systems_search_error',
      context: error.context,
      timestamp: new Date().toISOString()
    }));
  }
}

export const systemsRoutes = { systemsListRoute, systemsGetRoute, systemsSearchRoute };
