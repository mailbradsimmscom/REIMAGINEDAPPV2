// src/middleware/validate.js
import { ERR } from '../constants/errorCodes.js';
import { z } from 'zod';

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    if (!schema) {
      return next();
    }

    const target = req[source]; // 'body', 'query', 'params'
    
    // Use safeParse to avoid throwing - always returns result object
    const result = schema.safeParse(target);

    if (!result.success) {
      // Validation failed - return 400 with error details
      const errorDetails = result.error?.errors || result.error?.issues || [];
      
      // This should never throw, but wrap in try-catch as safety net
      try {
        return res.status(400).json({
          success: false,
          data: null,
          error: {
            code: ERR.BAD_REQUEST,
            message: 'Validation failed',
            details: errorDetails
          },
          requestId: res.locals?.requestId ?? null
        });
      } catch (err) {
        // If response already sent, pass to error handler
        return next(err);
      }
    }
    
    // Validation passed - assign parsed data back to request
    // Only assign back to body (writable), for query/params just validate
    if (source === 'body') {
      req[source] = result.data;
    } else if (source === 'query') {
      // For query params, we can't modify req.query directly in Express,
      // but the validated data is available if needed
      // The route handler should use the validated schema result if needed
    }

    next();
  };
}