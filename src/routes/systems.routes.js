import { listSystemsSvc, getSystemSvc, searchSystemsSvc } from '../services/systems.service.js';
import { validate } from '../middleware/validate.js';
import { 
  systemsListQuerySchema, 
  systemsListResponseSchema,
  systemsSearchQuerySchema,
  systemsSearchResponseSchema,
  systemsGetResponseSchema,
  systemsErrorSchema
} from '../schemas/systems.schema.js';

export async function systemsListRoute(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const limit = url.searchParams.get('limit');
  const cursor = url.searchParams.get('cursor');
  
  try {
    // Validate query parameters if present
    const queryParams = {};
    if (limit !== null) queryParams.limit = limit;
    if (cursor !== null) queryParams.cursor = cursor;
    
    const validationResult = systemsListQuerySchema.safeParse(queryParams);
    
    if (!validationResult.success) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: 'Invalid query parameters',
        details: validationResult.error.errors
      }));
      return;
    }

    const result = await listSystemsSvc({ limit, cursor });
    const responseData = {
      success: true,
      data: result
    };

    // TODO: Re-enable response validation after debugging
    // const responseValidation = systemsListResponseSchema.safeParse(responseData);
    // if (!responseValidation.success) {
    //   throw new Error('Invalid response format');
    // }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(responseData));
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
      success: false,
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
        success: false,
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
        success: false,
        error: 'System not found',
        type: 'systems_get_error',
        context: { assetUid },
        timestamp: new Date().toISOString()
      }));
      return;
    }
    
    const responseData = {
      success: true,
      data: item
    };

    // Validate response data
    const responseValidation = systemsGetResponseSchema.safeParse(responseData);
    if (!responseValidation.success) {
      throw new Error('Invalid response format');
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(responseData));
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
      success: false,
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
    // Handle empty query case
    if (!q || q.trim() === '') {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: 'Query parameter is required and must be at least 2 characters'
      }));
      return;
    }

    // Validate query parameters
    const queryParams = { q };
    if (limit !== null) queryParams.limit = limit;
    
    const validationResult = systemsSearchQuerySchema.safeParse(queryParams);
    
    if (!validationResult.success) {
      res.statusCode = 400;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: 'Invalid query parameters',
        details: validationResult.error.errors
      }));
      return;
    }

    const result = await searchSystemsSvc(q, { limit });
    const responseData = {
      success: true,
      data: result
    };

    // Validate response data
    const responseValidation = systemsSearchResponseSchema.safeParse(responseData);
    if (!responseValidation.success) {
      throw new Error('Invalid response format');
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(responseData));
  } catch (error) {
    let statusCode = 500;
    if (error.message.includes('required') || error.message.includes('invalid') || error.message.includes('too long')) {
      statusCode = 400; // Bad Request
    }
    
    res.statusCode = statusCode;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ 
      success: false,
      error: error.message,
      type: 'systems_search_error',
      context: error.context,
      timestamp: new Date().toISOString()
    }));
  }
}

export const systemsRoutes = { systemsListRoute, systemsGetRoute, systemsSearchRoute };
