import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * Response validation middleware factory
 * Validates response data against Zod schemas when enabled
 */
export function validateResponse(schema, routeName) {
  return (req, res, next) => {
    // Store original res.json method
    const originalJson = res.json;
    
    // Override res.json to validate response
    res.json = function(data) {
      // Check if response validation is enabled for this route
      if (env.enableResponseValidation && env.responseValidationRoutes.includes(routeName)) {
        try {
          const result = schema.safeParse(data);
          
          if (!result.success) {
            logger.warn('Response validation failed', {
              route: routeName,
              path: req.path,
              method: req.method,
              errors: result.error.errors.map(err => ({
                field: err.path.join('.'),
                message: err.message,
                code: err.code
              }))
            });
            
            // Log the validation failure but don't break the response
            // This allows us to catch schema drift without breaking the API
          } else {
            logger.debug('Response validation passed', {
              route: routeName,
              path: req.path,
              method: req.method
            });
          }
        } catch (error) {
          logger.error('Response validation error', {
            route: routeName,
            path: req.path,
            method: req.method,
            error: error.message,
            stack: error.stack
          });
          
          // Don't break the response on validation errors
        }
      }
      
      // Call original json method
      return originalJson.call(this, data);
    };
    
    next();
  };
}

/**
 * Helper function to check if response validation is enabled for a route
 */
export function isResponseValidationEnabled(routeName) {
  return env.enableResponseValidation && env.responseValidationRoutes.includes(routeName);
}
